'use strict';
const assert = require('node:assert/strict');
const db = require('../backend/db');

// Proposed SQL with R5-01 fix
const proposedSql = `WITH InvoicedLines AS (
  -- 1. Direct invoice lines (enforcing DocuType IN (107, 202))
  SELECT 
    d.SOID AS SOID,
    d.ListNo AS SOListNo,
    idt.SOInvID,
    idt.ListNo AS InvListNo,
    idt.GoodAmnt AS InvoicedAmnt
  FROM dbo.SODT d WITH (NOLOCK)
  JOIN dbo.SOInvDT idt WITH (NOLOCK) ON idt.RefID = d.SOID AND idt.RefListNo = d.ListNo
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'

  UNION

  -- 2. Delivery Order (104) invoice lines (enforcing DocuType IN (107, 202))
  SELECT 
    d.SOID AS SOID,
    d.ListNo AS SOListNo,
    idt104.SOInvID,
    idt104.ListNo AS InvListNo,
    idt104.GoodAmnt AS InvoicedAmnt
  FROM dbo.SODT d WITH (NOLOCK)
  JOIN dbo.SODT dt104 WITH (NOLOCK) ON dt104.RefSOID = d.SOID AND dt104.RefListNo = d.ListNo
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = dt104.SOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  JOIN dbo.SOInvDT idt104 WITH (NOLOCK) ON idt104.RefID = dt104.SOID AND idt104.RefListNo = dt104.ListNo
  JOIN dbo.SOInvHD ih104 WITH (NOLOCK) ON ih104.SOInvID = idt104.SOInvID AND ih104.DocuType IN (107, 202) AND ih104.DocuStatus <> 'C'
),
UnallocatedInvoices AS (
  -- Branch 1: Line has direct RefID pointing to SO 103, but line is not in InvoicedLines
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    idt.RefID AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = idt.RefID AND h.DocuType = 103
  WHERE NOT EXISTS (
    SELECT 1 FROM InvoicedLines il 
    WHERE il.SOInvID = idt.SOInvID AND il.InvListNo = idt.ListNo AND il.SOID = idt.RefID
  )

  UNION

  -- Branch 2: Line has RefID pointing to Delivery 104, but line is not in InvoicedLines
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    COALESCE(dt104_exact.RefSOID, dt104_any.RefSOID) AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = idt.RefID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  LEFT JOIN dbo.SODT dt104_exact WITH (NOLOCK) ON dt104_exact.SOID = idt.RefID AND dt104_exact.ListNo = idt.RefListNo
  LEFT JOIN (
    SELECT DISTINCT SOID AS DeliverySOID, RefSOID
    FROM dbo.SODT WITH (NOLOCK)
    WHERE RefSOID IS NOT NULL
  ) dt104_any ON dt104_any.DeliverySOID = hd104.SOID
  WHERE COALESCE(dt104_exact.RefSOID, dt104_any.RefSOID) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM InvoicedLines il 
      WHERE il.SOInvID = idt.SOInvID AND il.InvListNo = idt.ListNo AND il.SOID = COALESCE(dt104_exact.RefSOID, dt104_any.RefSOID)
    )

  UNION

  -- Branch 3: Line does NOT have a valid line-level RefID, but invoice header ih.RefSOID points to SO 103
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    ih.RefSOID AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = ih.RefSOID AND h.DocuType = 103 AND h.DocuStatus <> 'C'
  WHERE (idt.RefID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.SOHD refH WITH (NOLOCK) WHERE refH.SOID = idt.RefID))
    AND NOT EXISTS (
      SELECT 1 FROM InvoicedLines il 
      WHERE il.SOInvID = idt.SOInvID AND il.InvListNo = idt.ListNo AND il.SOID = ih.RefSOID
    )

  UNION

  -- Branch 4: Line does NOT have a valid line-level RefID, but invoice header ih.RefSOID points to Delivery 104
  SELECT 
    ih.SOInvID,
    idt.ListNo AS InvListNo,
    dt104_any.RefSOID AS SOID,
    idt.GoodAmnt AS UnallocatedAmnt
  FROM dbo.SOInvDT idt WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = idt.SOInvID AND ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = ih.RefSOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  JOIN (
    SELECT DISTINCT SOID AS DeliverySOID, RefSOID
    FROM dbo.SODT WITH (NOLOCK)
    WHERE RefSOID IS NOT NULL
  ) dt104_any ON dt104_any.DeliverySOID = hd104.SOID
  WHERE (idt.RefID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.SOHD refH WITH (NOLOCK) WHERE refH.SOID = idt.RefID))
    AND NOT EXISTS (
      SELECT 1 FROM InvoicedLines il 
      WHERE il.SOInvID = idt.SOInvID AND il.InvListNo = idt.ListNo AND il.SOID = dt104_any.RefSOID
    )

  UNION

  -- Branch 5: Genuine header-only invoice without any lines in SOInvDT (direct to SO 103)
  SELECT 
    ih.SOInvID,
    0 AS InvListNo,
    ih.RefSOID AS SOID,
    CAST(0 AS decimal(12,2)) AS UnallocatedAmnt
  FROM dbo.SOInvHD ih WITH (NOLOCK)
  JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = ih.RefSOID AND h.DocuType = 103 AND h.DocuStatus <> 'C'
  WHERE ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.SOInvDT idt WITH (NOLOCK) WHERE idt.SOInvID = ih.SOInvID
    )

  UNION

  -- Branch 6: Genuine header-only invoice without any lines in SOInvDT (via Delivery 104)
  SELECT 
    ih.SOInvID,
    0 AS InvListNo,
    dt104_any.RefSOID AS SOID,
    CAST(0 AS decimal(12,2)) AS UnallocatedAmnt
  FROM dbo.SOInvHD ih WITH (NOLOCK)
  JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = ih.RefSOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
  JOIN (
    SELECT DISTINCT SOID AS DeliverySOID, RefSOID
    FROM dbo.SODT WITH (NOLOCK)
    WHERE RefSOID IS NOT NULL
  ) dt104_any ON dt104_any.DeliverySOID = hd104.SOID
  WHERE ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.SOInvDT idt WITH (NOLOCK) WHERE idt.SOInvID = ih.SOInvID
    )
),
UnallocatedBySO AS (
  SELECT SOID, COUNT_BIG(*) AS UnallocatedCnt, SUM(UnallocatedAmnt) AS UnallocatedTotalAmnt
  FROM (
    SELECT DISTINCT SOID, SOInvID, InvListNo, UnallocatedAmnt
    FROM UnallocatedInvoices
  ) u
  GROUP BY SOID
),
DedupedInvoicedLines AS (
  SELECT SOID, SOListNo, SUM(InvoicedAmnt) AS TotalLineInvoicedAmnt
  FROM (
    SELECT DISTINCT SOID, SOListNo, SOInvID, InvListNo, InvoicedAmnt
    FROM InvoicedLines
  ) sub
  GROUP BY SOID, SOListNo
),
SOBalances AS (
  SELECT 
    h.SOID,
    h.DocuNo,
    CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
    h.CustName,
    SUM(d.GoodAmnt) AS TotalOrderAmnt,
    SUM(ISNULL(inv.TotalLineInvoicedAmnt, 0)) AS TotalInvoicedAmnt,
    SUM(d.GoodAmnt) - SUM(ISNULL(inv.TotalLineInvoicedAmnt, 0)) AS OutstandingAmnt,
    ISNULL(u.UnallocatedCnt, 0) AS UnallocatedCount,
    ISNULL(u.UnallocatedTotalAmnt, 0) AS UnallocatedTotalAmnt
  FROM dbo.SOHD h WITH (NOLOCK)
  JOIN dbo.SODT d WITH (NOLOCK) ON d.SOID = h.SOID
  LEFT JOIN DedupedInvoicedLines inv ON inv.SOID = d.SOID AND inv.SOListNo = d.ListNo
  LEFT JOIN UnallocatedBySO u ON u.SOID = h.SOID
  WHERE h.DocuType = 103 AND h.DocuStatus <> 'C'
  GROUP BY h.SOID, h.DocuNo, h.DocuDate, h.CustName, u.UnallocatedCnt, u.UnallocatedTotalAmnt
)
SELECT TOP 200
  DocuNo,
  DocuDate,
  CustName,
  CASE
    WHEN UnallocatedCount > 0 THEN NULL
    ELSE CAST(OutstandingAmnt AS DECIMAL(12,2))
  END AS EstimatedAmount,
  CASE
    WHEN UnallocatedCount > 0 THEN 'UNKNOWN'
    WHEN OutstandingAmnt < -0.009 THEN 'OVER_INVOICED'
    ELSE 'NORMAL'
  END AS AllocationStatus,
  CASE
    WHEN UnallocatedCount > 0 THEN N'พบรายการใบกำกับที่ไม่สามารถระบุรายการสั่งซื้อได้ (UNKNOWN Allocation)'
    WHEN OutstandingAmnt < -0.009 THEN N'ออกใบกำกับเกินยอดสั่งซื้อ (Over-invoiced exception)'
    ELSE N'ประมาณการยอดขายค้างออกใบกำกับ (ไม่ใช่หลักฐาน GL)'
  END AS Note,
  CAST(SOID AS VARCHAR(50)) AS RefSO
FROM SOBalances
WHERE (OutstandingAmnt >= 0.01 OR OutstandingAmnt < -0.009 OR UnallocatedCount > 0)
ORDER BY DocuDate DESC, SOID DESC`;

(async () => {
  try {
    await db.runWithTarget('remote_b', async () => {
      console.log('--- 1. Testing R5-01 Repro CTE Fixture ---');
      const fixtures = `WITH fSOHD AS (
        SELECT * FROM (VALUES
          (1, 103, 'N', 'AUDIT-SO', CAST('20260920' AS date), 'AUDIT CUSTOMER'),
          (2, 104, 'N', 'AUDIT-DELIVERY', CAST('20260920' AS date), 'AUDIT CUSTOMER')
        ) v(SOID, DocuType, DocuStatus, DocuNo, DocuDate, CustName)
      ), fSODT AS (
        SELECT * FROM (VALUES
          (1, 1, CAST(1000 AS decimal(12,2)), CAST(NULL AS int), CAST(NULL AS int)),
          (2, 1, CAST(1000 AS decimal(12,2)), 1, 1)
        ) v(SOID, ListNo, GoodAmnt, RefSOID, RefListNo)
      ), fSOInvHD AS (
        SELECT 3 SOInvID, 107 DocuType, 'N' DocuStatus, 1 RefSOID
      ), fSOInvDT AS (
        SELECT 3 SOInvID, 1 ListNo, 1 RefID, 1 RefListNo, CAST(400 AS decimal(12,2)) GoodAmnt
        UNION ALL
        SELECT 3, 2, CAST(NULL AS int), CAST(NULL AS int), CAST(100 AS decimal(12,2))
      ), `;

      const query = fixtures + proposedSql.replace(/^\s*WITH\s+/i, '')
        .replace(/dbo\.SOInvHD/g, 'fSOInvHD').replace(/dbo\.SOInvDT/g, 'fSOInvDT')
        .replace(/dbo\.SOHD/g, 'fSOHD').replace(/dbo\.SODT/g, 'fSODT')
        .replace(/\s+WITH\s*\(NOLOCK\)/gi, '');

      const res = (await db.wfQuery(query)).recordset;
      console.log('Result for R5-01 fixture:', JSON.stringify(res));

      assert.equal(res.length, 1);
      assert.equal(res[0].AllocationStatus, 'UNKNOWN', 'Must be UNKNOWN');
      assert.equal(res[0].EstimatedAmount, null, 'Must nullify EstimatedAmount');
      console.log('✓ R5-01 Repro Fixture Assertion PASSED!');

      console.log('\n--- 2. Testing Execution Timing of Proposed SQL on Real Database ---');
      const t0 = Date.now();
      const realRes = (await db.wfQuery(proposedSql)).recordset;
      const elapsed = Date.now() - t0;
      console.log(`Proposed SQL returned ${realRes.length} rows in ${elapsed} ms`);
    });
  } catch (e) {
    console.error('Error in test:', e);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([db.readerReady, db.ownerReady]);
    const pl = db.runWithTarget('remote_b', () => db.pools());
    await Promise.allSettled([db.readerPool.close(), db.ownerPool.close(), pl.readerPool.close(), pl.ownerPool.close()]);
  }
})();
