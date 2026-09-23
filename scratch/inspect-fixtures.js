const { query, sql, runWithTarget, closeAll } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    try {
      console.log('--- 1. Check Duplicate CouponNo ---');
      const dupes = await query(`
        SELECT CouponNo, COUNT(*) as cnt, MIN(CouponID) as minId, MAX(CouponID) as maxId
        FROM dbo.WFCoupon
        WHERE CouponNo IS NOT NULL AND RTRIM(CouponNo) <> ''
        GROUP BY CouponNo
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
      `);
      console.log(`Found ${dupes.length} duplicate coupon numbers. Top 5:`);
      console.table(dupes.slice(0, 5));

      if (dupes.length > 0) {
        const topDupe = dupes[0];
        const details = await query(`
          SELECT *
          FROM dbo.WFCoupon
          WHERE CouponNo = @cno
        `, { cno: { type: sql.NVarChar(50), value: topDupe.CouponNo } });
        console.log(`Details of duplicate coupon "${topDupe.CouponNo}":`);
        console.table(details);
      }

      console.log('\n--- 2. Check Direct Invoice Links (SOInvDT -> SOHD) ---');
      const directInv = await query(`
        SELECT TOP 5
          invHd.SOInvID, invHd.DocuNo AS InvDocuNo, invHd.DocuDate AS InvDocuDate,
          invDt.RefID, invDt.RefListNo,
          soHd.DocuNo AS RefDocuNo, soHd.DocuType AS RefDocuType
        FROM dbo.SOInvDT invDt
        JOIN dbo.SOInvHD invHd ON invHd.SOInvID = invDt.SOInvID
        JOIN dbo.SOHD soHd ON soHd.SOID = invDt.RefID
        ORDER BY invHd.DocuDate DESC
      `);
      console.log(`Direct invoice rows:`, directInv.length);
      console.table(directInv);

      console.log('\n--- 3. Check Cancelled 104 Deliveries ---');
      const cancelled104 = await query(`
        SELECT TOP 5 SOID, DocuNo, DocuDate, DocuStatus, CustID, CustName
        FROM dbo.SOHD
        WHERE DocuType = 104 AND DocuStatus = 'C'
        ORDER BY DocuDate DESC
      `);
      console.log('Cancelled 104 rows:', cancelled104.length);
      console.table(cancelled104);

    } catch (err) {
      console.error('Error:', err);
    }
  });
  await closeAll();
}

main();
