'use strict';
const db = require('../db');

(async () => {
  await db.runWithTarget('remote_b', async () => {
    // Example 1: I69-04068 -> AI69-06789 -> I69-03699 -> C6906916
    const ex1 = await db.query(`
      SELECT 
        b.SOID AS BookingSOID, b.DocuNo AS BookingDocuNo, b.AppvDocuNo, b.CustID, b.CustName,
        d.SOID AS DeliverySOID, d.DocuNo AS DeliveryDocuNo,
        dt.ListNo AS DeliveryListNo, dt.RefListNo AS BookingListNo,
        c.CouponID, c.CouponNo, c.GoodID, c.GoodName, c.GoodQty, c.RemaQty, u.GoodUnitName
      FROM dbo.SOHD b WITH (NOLOCK)
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.RefSOID = b.SOID
      JOIN dbo.SOHD d WITH (NOLOCK) ON d.SOID = dt.SOID AND d.DocuType = 104
      JOIN dbo.WFCoupon c WITH (NOLOCK) ON c.DocuID = d.SOID AND c.RefListno = dt.ListNo
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = c.GoodUnitID
      WHERE b.DocuType = 103 AND (b.DocuNo = 'I69-04068' OR b.AppvDocuNo = 'AI69-06789')
    `);
    console.log('Example 1 (I69-04068 / AI69-06789):', ex1);

    // Example 2: K69-02552 -> AI69-06663 -> K69-02418 -> D6904966 -> 69090039 -> N69-02527
    const ex2 = await db.query(`
      SELECT 
        b.SOID AS BookingSOID, b.DocuNo AS BookingDocuNo, b.AppvDocuNo,
        d.DocuNo AS DeliveryDocuNo,
        c.CouponID, c.CouponNo, c.GoodQty, c.RemaQty,
        rd.GoodQty AS RedeemedQty, rh.DocuNo AS RedemptionDocuNo, rh.DocuType AS RedemptionType,
        inv.DocuNo AS InvoiceDocuNo, inv.DocuType AS InvoiceType
      FROM dbo.SOHD b WITH (NOLOCK)
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.RefSOID = b.SOID
      JOIN dbo.SOHD d WITH (NOLOCK) ON d.SOID = dt.SOID AND d.DocuType = 104
      JOIN dbo.WFCoupon c WITH (NOLOCK) ON c.DocuID = d.SOID AND c.RefListno = dt.ListNo
      LEFT JOIN dbo.WFRedemtionDT rd WITH (NOLOCK) ON rd.CouponID = c.CouponID
      LEFT JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
      LEFT JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.SOInvID = rd.SOInvID
      WHERE b.DocuType = 103 AND (b.DocuNo = 'K69-02552' OR b.AppvDocuNo = 'AI69-06663')
    `);
    console.log('Example 2 (K69-02552 / AI69-06663):', ex2);
  });
})().catch(console.error).finally(() => process.exit(0));
