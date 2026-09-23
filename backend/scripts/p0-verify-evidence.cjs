'use strict';
const db = require('../db');

(async () => {
  await db.runWithTarget('remote_b', async () => {
    const id = await db.query('SELECT DB_NAME() AS db, @@SERVERNAME AS srv');
    console.log('Target:', id[0]);

    const prefixes = await db.query(`
      SELECT LEFT(DocuNo, 1) AS Prefix, COUNT(*) AS n,
             SUM(CASE WHEN AppvDocuNo LIKE 'AI%' THEN 1 ELSE 0 END) AS HasAI
      FROM dbo.SOHD
      WHERE DocuType = 103
      GROUP BY LEFT(DocuNo, 1)
      ORDER BY Prefix DESC
    `);
    console.log('103 Prefixes:', prefixes);

    const dupCoupons = await db.query(`
      SELECT COUNT(*) AS DuplicateCouponGroups
      FROM (
        SELECT CouponNo FROM dbo.WFCoupon GROUP BY CouponNo HAVING COUNT(*) > 1
      ) d
    `);
    console.log('Duplicate coupon groups:', dupCoupons[0]);

    const couponBalances = await db.query(`
      SELECT 
        LEFT(c.CouponNo, 1) AS Prefix,
        u.GoodUnitName,
        COUNT(*) AS n,
        SUM(CASE WHEN c.RemaQty > 0 THEN 1 ELSE 0 END) AS PositiveBalance
      FROM dbo.WFCoupon c
      LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID = c.GoodUnitID
      GROUP BY LEFT(c.CouponNo, 1), u.GoodUnitName
      ORDER BY Prefix, u.GoodUnitName
    `);
    console.log('Coupon balance groups:', couponBalances);

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
    console.log('Current Top 300 results:', top300[0]);

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
    console.log('Positive coupons linked to Top 300:', linkedCoupons[0]);
  });


})().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  process.exit(0);
});
