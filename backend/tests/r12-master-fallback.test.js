'use strict';

/**
 * Customer edits fail closed when their transactional procedures are missing;
 * never fall back to a direct non-atomic native update.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

h.installDbStub(({ text }) => {
  if (/OBJECT_ID\('wf\.sp_MasterCreatePrice'/.test(text)) return [{ HasProcs: 0 }];
  if (/UPDATE dbo\.EMCust/.test(text)) throw new Error("The UPDATE permission was denied on the object 'EMCust', database 'dbwins_worldfert9', schema 'dbo'.");
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });

test('missing customer procedures returns 503 before any direct native write', async () => {
  const r = await app.call('PATCH', '/api/master/customers/1141', { body: { CustName: 'x' }, user: { sub: 63, role: 'ADMIN' } });
  assert.equal(r.status, 503);
  assert.match(r.body.message, /ฐานข้อมูลยังไม่พร้อม/);
});
