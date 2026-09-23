'use strict';
const db = require('../db');

(async () => {
  await db.runWithTarget('remote_b', async () => {
    console.log('Querying active coupons on dbwins_worldfert9_test_v2...');
    const t0 = Date.now();
    const rows = await db.query(`
      SELECT 
        c.CouponID,
        c.CouponNo,
        h103.DocuNo AS BookingDocuNo,
        h103.AppvDocuNo,
        h104.DocuNo AS DeliveryDocuNo,
        h104.CustID,
        h104.CustName,
        h104.TransRegistration AS TruckPlate,
        h104.DocuDate,
        c.GoodID,
        g.GoodCode,
        c.GoodName,
        u.GoodUnitName,
        CAST(c.GoodQty AS DECIMAL(12, 3)) AS IssuedQtyTon,
        CAST(c.RemaQty AS DECIMAL(12, 3)) AS NativeRemainingQtyTon,
        CAST(ISNULL(res.TotalReserved, 0) AS DECIMAL(12, 3)) AS ReservedQtyTon,
        CAST(c.RemaQty - ISNULL(res.TotalReserved, 0) AS DECIMAL(12, 3)) AS AvailableQtyTon,
        CASE
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) < 0 THEN 'NEGATIVE'
          WHEN c.RemaQty = 0 THEN 'ZERO'
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0 AND c.RemaQty > 0 THEN 'RESERVED_FULL'
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) > 0 THEN 'POSITIVE'
          ELSE 'UNKNOWN'
        END AS BalanceState,
        'ISSUED' AS Lifecycle
      FROM dbo.WFCoupon c WITH (NOLOCK)
      JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = c.DocuID AND h104.DocuType = 104
      LEFT JOIN dbo.SODT d104 WITH (NOLOCK) ON d104.SOID = c.DocuID AND d104.ListNo = c.RefListno
      LEFT JOIN dbo.SOHD h103 WITH (NOLOCK) ON h103.SOID = d104.RefSOID AND h103.DocuType = 103
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = c.GoodUnitID
      LEFT JOIN (
        SELECT CouponId, SUM(ReservedQty) AS TotalReserved
        FROM wf.CouponReservation WITH (NOLOCK)
        WHERE Status = 'RESERVED' AND (ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE())
        GROUP BY CouponId
      ) res ON res.CouponId = c.CouponID
      WHERE c.RemaQty > 0
      ORDER BY h104.DocuDate DESC, c.CouponID DESC
    `);
    const elapsed = Date.now() - t0;
    console.log(`Found ${rows.length} positive coupons in ${elapsed}ms`);
    console.log('Sample row 0:', rows[0]);
    console.log('Sample row 1:', rows[1]);
  });
})().catch(console.error).finally(() => process.exit(0));
