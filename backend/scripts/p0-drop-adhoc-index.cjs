'use strict';
const db = require('../db');

async function main() {
  await db.runWithTarget('remote_b', async () => {
    const check = await db.query('SELECT DB_NAME() as db, @@SERVERNAME as srv');
    console.log('Connected to target DB:', check[0]);
    if (check[0]?.db !== 'dbwins_worldfert9_test_v2') {
      throw new Error(`SAFETY ERROR: Expected dbwins_worldfert9_test_v2, got ${check[0]?.db}`);
    }

    const idx = await db.query(
      "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
    );
    console.log('Existing index count:', idx.length);
    if (idx.length > 0) {
      await db.wfQuery('DROP INDEX UQ_ControlTicketOverlay_DocuId ON wf.ControlTicketOverlay');
      console.log('Successfully dropped index UQ_ControlTicketOverlay_DocuId');
    } else {
      console.log('Index was not present.');
    }

    const verify = await db.query(
      "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
    );
    console.log('Post-drop index count:', verify.length);
    if (verify.length !== 0) {
      throw new Error('Index drop verification failed: index still exists!');
    }
    console.log('PASS: ad-hoc index dropped cleanly from test_v2.');
  });
  await db.closeAll();
}

main().catch(err => {
  console.error('Failure:', err);
  process.exit(1);
});
