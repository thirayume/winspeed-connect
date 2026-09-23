'use strict';
const db = require('../db');

(async () => {
  await db.runWithTarget('remote_b', async () => {
    const cols = await db.query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME IN ('WFCoupon', 'WFRedemtionHD', 'WFRedemtionDT', 'SOInvHD', 'SOInvDT') 
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);
    const tables = {};
    for (const c of cols) {
      if (!tables[c.TABLE_NAME]) tables[c.TABLE_NAME] = [];
      tables[c.TABLE_NAME].push(`${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    }
    console.log(JSON.stringify(tables, null, 2));

    const dupes = await db.query(`
      SELECT TOP 5 CouponNo, COUNT(*) AS cnt 
      FROM dbo.WFCoupon 
      GROUP BY CouponNo 
      HAVING COUNT(*) > 1 
      ORDER BY cnt DESC
    `);
    console.log('Top 5 duplicate coupon examples:', dupes);

    if (dupes.length > 0) {
      const sample = await db.query(`
        SELECT c.CouponID, c.CouponNo, c.DocuID, s.DocuNo AS DeliveryDocuNo, s.DocuDate, s.CustID, s.CustName, c.GoodName, c.RemaQty
        FROM dbo.WFCoupon c
        JOIN dbo.SOHD s ON s.SOID = c.DocuID
        WHERE c.CouponNo = @cNo
      `, { cNo: { type: db.sql.NVarChar(50), value: dupes[0].CouponNo } });
      console.log('Sample duplicate coupon details:', sample);
    }
  });

})().catch(console.error).finally(() => process.exit(0));
