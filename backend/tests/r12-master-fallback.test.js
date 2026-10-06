'use strict';

/**
 * R12 item 15 — without migration 146 the old direct SQL still runs; when the
 * least-privilege login is refused, the screen gets a clear 503 that names the migration
 * (instead of a bare "บันทึกไม่สำเร็จ").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

h.installDbStub(({ text }) => {
  if (/OBJECT_ID\('wf\.sp_MasterCreatePrice'/.test(text)) return [{ HasProcs: 0 }];
  if (/UPDATE dbo\.EMCust/.test(text)) throw new Error("The UPDATE permission was denied on the object 'EMCust', database 'dbwins_worldfert9', schema 'dbo'.");
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });

test('permission denied on dbo.EMCust → 503 naming migration 146', async () => {
  const r = await app.call('PATCH', '/api/master/customers/1141', { body: { CustName: 'x' }, user: { sub: 63, role: 'ADMIN' } });
  assert.equal(r.status, 503);
  assert.match(r.body.message, /146_master_data_procs/);
});
