'use strict';
const path = require('path');
const { wfQuery, runWithTarget, sql } = require(path.join(__dirname, '..', 'backend', 'db'));

runWithTarget('remote_b', async () => {
  const synthId = 988888;
  const cNo = 'UAT-SO08-JOURNEY-01';
  const goodId = 1156;
  const goodName = '0-0-60 (เม็ด)  ตรารถเกษตร';
  const custId = '00100'; // or existing customer
  const docuId = 276866;
  const initialQty = 15.0;

  // Clean if exists
  await wfQuery('DELETE FROM dbo.WFCoupon WHERE CouponID = @cid', { cid: { type: sql.Int, value: synthId } });
  await wfQuery('DELETE FROM wf.CouponReservation WHERE CouponId = @cid', { cid: { type: sql.Int, value: synthId } });

  await wfQuery(`
    INSERT INTO dbo.WFCoupon (CouponID, GoodID, DocuID, CouponNo, GoodQty, RemaQty, GoodPrice, GoodName)
    VALUES (@cid, @gid, @docId, @cno, @qty, @qty, 15000, @gname)
  `, {
    cid: { type: sql.Int, value: synthId },
    gid: { type: sql.Int, value: goodId },
    docId: { type: sql.Int, value: docuId },
    cno: { type: sql.VarChar(25), value: cNo },
    qty: { type: sql.Decimal(12, 4), value: initialQty },
    gname: { type: sql.VarChar(200), value: goodName }
  });

  console.log('SYNTH_UAT_COUPON_CREATED:', { synthId, cNo, custId: '23048' });
  process.exit(0);
});
