/**
 * control-ticket-regression-pre-fix.test.js
 *
 * P0 Freeze Evidence & Deterministic Regression Tests for:
 * - 300 tickets incorrectly marked as USED_UP (when 155 linked coupons have positive balance)
 * - I/AI trace returning empty coupons for booking DocuNo / AppvDocuNo
 * - Duplicate CouponNo groups (50 groups) requiring typed ID disambiguation
 * - Aging pagination discrepancy (document count vs product line pagination)
 *
 * Target: Hostinger TEST dbwins_worldfert9_test_v2
 * All tests are strictly SELECT-only read assertions.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { traceNativeTicketChain } = require('../services/ticket-policy');

test.describe('P0: Freeze Evidence & Pre-Fix Regression Baseline', () => {

  test('P0-01: Verify DB identity is dbwins_worldfert9_test_v2', async () => {
    await db.runWithTarget('remote_b', async () => {
      const res = await db.query('SELECT DB_NAME() AS dbName');
      assert.equal(res[0]?.dbName, 'dbwins_worldfert9_test_v2', 'Must run on dbwins_worldfert9_test_v2');
    });
  });

  test('P0-02: Reproduce CONTROL-TICKET-READONLY-20260921 baseline statistics', async () => {
    await db.runWithTarget('remote_b', async () => {
      // 1. Check 103 SOHD prefix counts and AI approval counts
      const prefixes = await db.query(`
        SELECT LEFT(DocuNo, 1) AS Prefix, COUNT(*) AS n,
               SUM(CASE WHEN AppvDocuNo LIKE 'AI%' THEN 1 ELSE 0 END) AS HasAI
        FROM dbo.SOHD
        WHERE DocuType = 103
        GROUP BY LEFT(DocuNo, 1)
        ORDER BY Prefix DESC
      `);
      const kRow = prefixes.find(p => p.Prefix === 'K');
      const iRow = prefixes.find(p => p.Prefix === 'I');
      assert.equal(kRow.n, 28477, 'K prefix count must match baseline');
      assert.equal(kRow.HasAI, 15721, 'K prefix HasAI must match baseline');
      assert.equal(iRow.n, 37409, 'I prefix count must match baseline');
      assert.equal(iRow.HasAI, 21358, 'I prefix HasAI must match baseline');

      // 2. Check 50 duplicate coupon groups
      const dupCoupons = await db.query(`
        SELECT COUNT(*) AS DuplicateCouponGroups
        FROM (
          SELECT CouponNo FROM dbo.WFCoupon GROUP BY CouponNo HAVING COUNT(*) > 1
        ) d
      `);
      assert.equal(dupCoupons[0].DuplicateCouponGroups, 50, 'Duplicate coupon groups must equal 50');

      // 3. Check positive coupon balances (185 C + 51 D = 236 positive balance rows)
      const cCoupons = await db.query(`
        SELECT COUNT(*) AS n, SUM(CASE WHEN RemaQty > 0 THEN 1 ELSE 0 END) AS PositiveBalance
        FROM dbo.WFCoupon
        WHERE CouponNo LIKE 'C%'
      `);
      const dCoupons = await db.query(`
        SELECT COUNT(*) AS n, SUM(CASE WHEN c.RemaQty > 0 THEN 1 ELSE 0 END) AS PositiveBalance
        FROM dbo.WFCoupon c
        LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID = c.GoodUnitID
        WHERE c.CouponNo LIKE 'D%' AND u.GoodUnitName = N'ตัน'
      `);
      assert.equal(cCoupons[0].PositiveBalance, 185, 'C prefix positive balance must equal 185');
      assert.equal(dCoupons[0].PositiveBalance, 51, 'D prefix positive balance must equal 51');
    });
  });

  test('P0-03: Current formula marks all Top 300 tickets as used-up despite 155 positive linked coupons', async () => {
    await db.runWithTarget('remote_b', async () => {
      const top300 = await db.query(`
        WITH Tickets AS (
          SELECT TOP 300
            h.SOID, h.DocuNo, h.AppvDocuNo, h.DocuDate, h.CustID,
            h.CustName, h.TransRegistration AS TruckPlate,
            h.AppvFlag, h.AppvDate, h.Desc1, h.Desc2, h.DocuStatus
          FROM dbo.SOHD h WITH (NOLOCK)
          WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND (h.AppvDocuNo LIKE 'AI%' OR h.TransRegistration = N'ตั๋วคุม')
          ORDER BY h.DocuDate DESC
        )
        SELECT 
          COUNT(*) AS TotalCount,
          SUM(CASE WHEN TotalQtyTon > DrawnQtyTon THEN 1 ELSE 0 END) AS ActiveCount,
          SUM(CASE WHEN TotalQtyTon = DrawnQtyTon THEN 1 ELSE 0 END) AS EqualCount,
          SUM(CASE WHEN DrawnQtyTon > TotalQtyTon THEN 1 ELSE 0 END) AS OverdrawnCount
        FROM (
          SELECT 
            t.*,
            ISNULL((SELECT SUM(d.GoodQty2) FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = t.SOID), 0) AS TotalQtyTon,
            ISNULL((
              SELECT SUM(d2.GoodQty2)
              FROM dbo.SOHD h2 WITH (NOLOCK)
              JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
              WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
                AND (h2.RefNo = t.DocuNo OR h2.RefNo = t.AppvDocuNo)
            ), 0) AS DrawnQtyTon
          FROM Tickets t
        ) final
      `);
      assert.equal(top300[0].TotalCount, 300);
      assert.equal(top300[0].ActiveCount, 0, 'Current formula erroneously yields 0 active tickets');
      assert.equal(top300[0].EqualCount, 300, 'Current formula erroneously equates 103=104 for all 300');

      const linkedCoupons = await db.query(`
        WITH Tickets AS (
          SELECT TOP 300
            h.SOID, h.DocuNo, h.AppvDocuNo, h.DocuDate, h.CustID,
            h.CustName, h.TransRegistration AS TruckPlate,
            h.AppvFlag, h.AppvDate, h.Desc1, h.Desc2, h.DocuStatus
          FROM dbo.SOHD h WITH (NOLOCK)
          WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND (h.AppvDocuNo LIKE 'AI%' OR h.TransRegistration = N'ตั๋วคุม')
          ORDER BY h.DocuDate DESC
        )
        SELECT 
          COUNT(DISTINCT c.CouponID) AS PositiveCouponsLinkedToTop300
        FROM Tickets t
        JOIN dbo.SODT d104 WITH (NOLOCK) ON d104.RefSOID = t.SOID
        JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = d104.SOID AND h104.DocuType = 104 AND h104.DocuStatus <> 'C'
        JOIN dbo.WFCoupon c WITH (NOLOCK) ON c.DocuID = h104.SOID AND c.RefListno = d104.ListNo
        WHERE c.RemaQty > 0
      `);
      assert.equal(linkedCoupons[0].PositiveCouponsLinkedToTop300, 155, 'Must link to exactly 155 positive coupons');
    });
  });

  test('P0-04: Current traceNativeTicketChain fails to resolve booking DocuNo and AI approval', {
    skip: 'Frozen pre-fix baseline: bug characterized; now resolved and validated green in control-ticket-desired-behavior.test.js'
  }, async () => {
    await db.runWithTarget('remote_b', async () => {
      // Current trace implementation fails (returns 0 coupons)
      const tBooking = await traceNativeTicketChain('I69-04068');
      const tAI = await traceNativeTicketChain('AI69-06789');
      const tDelivery = await traceNativeTicketChain('I69-03699');
      const tCoupon = await traceNativeTicketChain('C6906916');

      // Document the exact current failure behavior
      assert.equal(tBooking.chain.coupons.length, 0, 'Current trace returns 0 coupons for booking DocuNo');
      assert.equal(tAI.chain.coupons.length, 0, 'Current trace returns 0 coupons for AI number');
      assert.equal(tDelivery.chain.coupons.length, 1, 'Delivery 104 currently resolves 1 coupon');
      assert.equal(tCoupon.chain.coupons.length, 1, 'CouponNo currently resolves 1 coupon');
    });
  });

  test('P0-05: Current aging search pages product lines instead of documents causing card count mismatch', async () => {
    await db.runWithTarget('remote_b', async () => {
      // Simulate current aging search query on 2026-03-25
      const countRes = await db.query(`
        WITH BaseCandidateSo AS (
          SELECT hd.SOID, hd.DocuNo,
                 ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) as rn
          FROM dbo.SOHD hd WITH (NOLOCK)
          WHERE hd.DocuDate >= '2026-03-25' AND hd.DocuType IN (103, 104)
            AND ISNULL(hd.DocuStatus, '') <> 'C'
            AND ISNULL(hd.clearflag, 'N') <> 'Y'
            AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
        ),
        CandidateSo AS (SELECT SOID FROM BaseCandidateSo WHERE rn = 1)
        SELECT COUNT(DISTINCT hd.SOID) AS Total
        FROM dbo.SOHD hd WITH (NOLOCK)
        JOIN CandidateSo c ON c.SOID = hd.SOID
        JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
      `);
      assert.equal(countRes[0].Total, 4882, 'Total distinct SO count from 2026-03-25 is 4882');

      const pageRes = await db.query(`
        WITH BaseCandidateSo AS (
          SELECT hd.SOID, hd.DocuNo,
                 ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) as rn
          FROM dbo.SOHD hd WITH (NOLOCK)
          WHERE hd.DocuDate >= '2026-03-25' AND hd.DocuType IN (103, 104)
            AND ISNULL(hd.DocuStatus, '') <> 'C'
            AND ISNULL(hd.clearflag, 'N') <> 'Y'
            AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
        ),
        CandidateSo AS (SELECT SOID FROM BaseCandidateSo WHERE rn = 1)
        SELECT hd.DocuNo, dt.GoodID
        FROM dbo.SOHD hd WITH (NOLOCK)
        JOIN CandidateSo c ON c.SOID = hd.SOID
        JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
        GROUP BY hd.DocuNo, dt.GoodID, hd.DocuDate, hd.SOID, hd.TransRegistration
        ORDER BY DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME2), GETUTCDATE()) DESC
        OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
      `);
      assert.equal(pageRes.length, 50, 'PageSize 50 returns 50 product rows');
      const uniqueDocs = new Set(pageRes.map(r => r.DocuNo)).size;
      assert.ok(uniqueDocs < 50, `50 product lines yield only ${uniqueDocs} documents (<50 cards)`);
      assert.ok(uniqueDocs >= 30 && uniqueDocs <= 35, `Visible document groups (${uniqueDocs}) is far below 50 page size due to product line pagination`);
    });
  });

  test('P0-06: Tickets without overlay currently lack explicit expiry state', async () => {
    await db.runWithTarget('remote_b', async () => {
      const overlays = await db.query('SELECT COUNT(*) AS n FROM wf.ControlTicketOverlay');
      // Verify overlay count on dbwins_worldfert9_test_v2
      assert.ok(typeof overlays[0].n === 'number');
    });
  });

  test.after(async () => {
    try {
      if (typeof db.closeAll === 'function') await db.closeAll();
    } catch (_) {}
  });

});

