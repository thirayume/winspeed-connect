'use strict';
// Menu switches (owner, 20 Nov 2026): ADMIN switches menus off; everyone else stops seeing them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMenuSwitches, ALWAYS_ON } = require('../services/menu-switches');

function fakeDb(rows = []) {
  const writes = [];
  class Request {
    constructor() { this.inputs = {}; }
    input(k, _t, v) { this.inputs[k] = v; return this; }
    async query(text) { writes.push({ text, inputs: this.inputs }); return { recordset: [] }; }
  }
  return {
    writes,
    getTarget: () => 'local', getDbName: () => 'db',
    wfQuery: async () => ({ recordset: rows }),
    wfTransaction: async fn => fn({}),
    sql: { Request, NVarChar: () => 'nvarchar', Int: 'int', MAX: 'max' },
  };
}
const MENUS = ['dashboard', 'sales', 'quotation', 'reports', 'app-settings', 'admin', 'roles', 'giveaway'];

test('menus that keep the system manageable cannot be switched off', () => {
  const s = createMenuSwitches(fakeDb(), MENUS);
  for (const k of ALWAYS_ON) assert.ok(!s.switchable.includes(k), k);
  assert.throws(() => s.validate({ disabled: ['app-settings'] }), /ไม่ถูกต้อง/);
  assert.throws(() => s.validate({ disabled: ['unknown-menu'] }), /ไม่ถูกต้อง/);
  assert.throws(() => s.validate({ disabled: ['sales', 'sales'] }), /ไม่ถูกต้อง/);
  assert.deepEqual(s.validate({ disabled: ['quotation', 'sales'] }).disabled, ['sales', 'quotation']);
});

test('a switched-off menu disappears for other users; ADMIN keeps it and sees the list', async () => {
  const s = createMenuSwitches(fakeDb([
    { SettingKey: 'MENU_CFG_quotation', SettingValue: '{"enabled":false}' },
    { SettingKey: 'MENU_CFG_sales', SettingValue: '{"enabled":true}' },
    { SettingKey: 'MENU_CFG_app-settings', SettingValue: '{"enabled":false}' },
  ]), MENUS);
  const caps = { menus: ['dashboard', 'sales', 'quotation', 'app-settings'], actions: ['so.create'] };
  const user = await s.apply(caps, false);
  assert.deepEqual(user.menus, ['dashboard', 'sales', 'app-settings'], 'app-settings can never be switched off');
  assert.deepEqual(user.actions, ['so.create']);
  const admin = await s.apply(caps, true);
  assert.deepEqual(admin.menus, caps.menus);
  assert.deepEqual(admin.disabledMenus, ['quotation']);
});

test('saving writes one row per switchable menu and an audit row in one transaction', async () => {
  const db = fakeDb();
  const s = createMenuSwitches(db, MENUS);
  await s.save({ disabled: ['giveaway'] }, 7);
  const rows = db.writes.filter(w => /MERGE wf\.SystemSetting/.test(w.text));
  assert.equal(rows.length, s.switchable.length);
  assert.equal(rows.find(w => w.inputs.k === 'MENU_CFG_giveaway').inputs.v, '{"enabled":false}');
  assert.equal(rows.find(w => w.inputs.k === 'MENU_CFG_sales').inputs.v, '{"enabled":true}');
  const audit = db.writes.find(w => /AdminChangeAudit/.test(w.text));
  assert.equal(audit.inputs.actor, 7);
  assert.match(audit.text, /MENU_SWITCH_SAVE/);
});
