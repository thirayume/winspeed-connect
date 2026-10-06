const { runWithTarget, wfQuery, query, closeAll, sql } = require('../db');

(async () => {
  try {
    await runWithTarget('remote_b', async () => {
      // Find the latest reservation with carrierDocuNo 'SO-BETA-02'
      const res = await wfQuery(`
        SELECT TOP 1 * FROM wf.CouponReservation 
        WHERE CarrierDocuNo = 'SO-BETA-02' 
        ORDER BY Id DESC
      `);
      console.log('Reservation B:', res.recordset?.[0]);
      if (res.recordset?.[0]) {
        const r = res.recordset[0];
        console.log('TripId:', r.TripId);
        const members = await wfQuery(`
          SELECT * FROM wf.v_TripMember WHERE TripId = @tid
        `, { tid: { type: sql.Int, value: r.TripId } });
        console.log('Trip members in v_TripMember:', members.recordset);
      }
    });
    await closeAll();
  } catch (e) {
    console.error(e);
    await closeAll().catch(() => {});
  }
})();
