const { query, runWithTarget } = require('../db');

runWithTarget('remote_b', async () => {
  const couponCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'WFCoupon'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('--- WFCoupon COLUMNS ---');
  console.table(couponCols);

  const couponSample = await query(`
    SELECT TOP 5 CouponID, CouponNo, DocuID, RefListno, GoodID, CustID, TotalTon, RemainTon, ExpireDate, ValidDays, Status
    FROM dbo.WFCoupon
    ORDER BY CouponID DESC
  `);
  console.log('--- WFCoupon SAMPLE ---');
  console.table(couponSample);

  const redemCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'WFRedemtionDT'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('--- WFRedemtionDT COLUMNS ---');
  console.table(redemCols);
}).catch(console.error);
