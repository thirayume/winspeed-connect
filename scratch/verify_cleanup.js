'use strict';
const { wfQuery, runWithTarget } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    const c = await wfQuery("SELECT COUNT(*) as cnt FROM dbo.WFCoupon WHERE CouponNo LIKE 'UAT-SO08-%'");
    const r = await wfQuery("SELECT COUNT(*) as cnt FROM wf.CouponReservation WHERE CouponId > 980000");
    console.log('SYNTH_COUPONS_LEFT:', c.recordset[0].cnt);
    console.log('SYNTH_RESERVATIONS_LEFT:', r.recordset[0].cnt);
  });
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
