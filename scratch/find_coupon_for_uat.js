'use strict';
const path = require('path');
const { wfQuery, runWithTarget } = require(path.join(__dirname, '..', 'backend', 'db'));
runWithTarget('remote_b', async () => {
  const row = (await wfQuery(`
    SELECT TOP 1 c.CouponID, c.CouponNo, c.DocuID, s.CustID, s.CustName, c.GoodID, c.GoodName,
                 CAST(c.RemaQty AS DECIMAL(12,4)) as RemaQty
    FROM dbo.WFCoupon c
    JOIN dbo.SOHD s ON s.SOID = c.DocuID
    WHERE c.RemaQty >= 1
    ORDER BY c.CouponID DESC
  `)).recordset[0];
  console.log('REAL_COUPON:', JSON.stringify(row));
  process.exit(0);
});
