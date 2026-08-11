const { query } = require('../db');

async function run() {
  try {
    const q = `
      SELECT so.SOID, so.WfRef, so.ControlTicketNo
      FROM wf.SalesOrderExt so WITH (NOLOCK)
      WHERE so.WfRef IN ('I69-02473', 'I69-02484', 'I69-02496')
    `;
    const res = await query(q);
    console.log('SalesOrderExt:', res);
    
    const q2 = `
      SELECT so.Id, so.WfRef, so.ControlTicketNo
      FROM wf.SalesOrder so WITH (NOLOCK)
      WHERE so.WfRef IN ('I69-02473', 'I69-02484', 'I69-02496') OR so.ControlTicketNo = 'I69-02473'
    `;
    const res2 = await query(q2);
    console.log('SalesOrder:', res2);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
