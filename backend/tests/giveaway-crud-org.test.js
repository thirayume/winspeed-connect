'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const state = {
  masterGood: {
    GoodID: '5001',
    GoodCode: 'GW-1688',
    GoodName: 'กระเป๋าปุ๋ย 16-8-8 ตรารถเกษตร',
  },
  budgetRow: {
    Id: 101,
    Region: 'ภาคกลาง-ตะวันตก',
    RegionCode: '02',
    SalesUserId: 40,
    EmpId: '10040',
    EmpCode: 'S040',
    PeriodYear: 2569,
    Brand: 'รถเกษตร',
    ItemName: 'กระเป๋าปุ๋ย 16-8-8 ตรารถเกษตร',
    GoodId: '5001',
    GoodCode: 'GW-1688',
    GoodName: 'กระเป๋าปุ๋ย 16-8-8 ตรารถเกษตร',
    BudgetQty: 500,
    WithdrawnQty: 120,
    RemainingQty: 380,
  },
  existingBudget: null,
};

const db = h.installDbStub((call) => {
  const t = call.text;
  if (/COL_LENGTH\('wf\.GiveawayBudget',\s*'GoodId'\)/i.test(t)) return [{ Len: 50 }];
  if (/FROM dbo\.EMGood g/i.test(t) && /WHERE g\.GoodID = @gid/i.test(t)) {
    const gid = String(call.inputs.gid?.value ?? call.inputs.gid ?? '');
    if (gid === state.masterGood.GoodID) {
      return [{ ...state.masterGood, NormalizedBrand: 'รถเกษตร' }];
    }
    return [];
  }
  if (/FROM wf\.SaleRegion/i.test(t)) {
    return [
      { RegionCode: '02', RegionName: 'ภาคกลาง-ตะวันตก', Description: 'ภาคกลาง', IsActive: 1 },
      { RegionCode: '04', RegionName: 'ภาคเหนือ', Description: 'ภาคเหนือ', IsActive: 1 },
    ];
  }
  if (/FROM wf\.AppUser u/i.test(t) && /wf\.OrgPosition/i.test(t)) {
    return [
      {
        UserId: 40,
        Username: 'decho',
        DisplayName: 'เดโช',
        Role: 'SALES',
        EmpId: '10040',
        EmpCode: 'S040',
        EmpName: 'เดโช พ.',
        PositionCode: 'SALE-CENTRAL',
        PositionName: 'พนักงานขายภาคกลาง-ตะวันตก',
        OrgUnit: 'ภาคกลาง-ตะวันตก',
        Tier: 2,
        AssignedRegionCode: '02',
        AssignedRegionName: 'ภาคกลาง-ตะวันตก',
      },
      {
        UserId: 41,
        Username: 'suchat',
        DisplayName: 'สุชาติ',
        Role: 'SALES',
        EmpId: '10041',
        EmpCode: 'S041',
        EmpName: 'สุชาติ น.',
        PositionCode: 'SALE-NORTH',
        PositionName: 'พนักงานขายภาคเหนือ',
        OrgUnit: 'ภาคเหนือ',
        Tier: 2,
        AssignedRegionCode: null,
        AssignedRegionName: null,
      },
    ];
  }
  if (/FROM wf\.AppUser u LEFT JOIN dbo\.EMEmp/i.test(t)) {
    return [{ EmpId: '10040', EmpCode: 'S040' }];
  }
  if (/FROM wf\.v_GiveawayBudgetStatus WHERE Id = @id/i.test(t)) {
    const id = Number(call.inputs.id?.value ?? call.inputs.id);
    return id === state.budgetRow.Id ? [{ ...state.budgetRow }] : [];
  }
  if (/FROM wf\.v_GiveawayBudgetStatus WHERE/i.test(t)) {
    return state.existingBudget ? [state.existingBudget] : [];
  }
  if (/INSERT INTO wf\.GiveawayBudget/i.test(t)) {
    return [{ Id: 777 }];
  }
  if (/UPDATE wf\.GiveawayBudget/i.test(t) || /DELETE FROM wf\.GiveawayBudget/i.test(t)) {
    return { recordset: [], rowsAffected: [1] };
  }
  if (/INSERT INTO wf\.ChangeEvent/i.test(t)) {
    return [{ EventId: 9001 }];
  }
  if (/FROM wf\.GiveawayWithdrawal/i.test(t) || /FROM wf\.ChangeEvent/i.test(t) || /FROM wf\.GiveawayBorrowRequest/i.test(t)) {
    return [];
  }
  return [];
}, { activeUsers: [1, 25, 40, 41] });

const { findMatchingQuota, normalizeBrand } = require('../services/giveaway-matcher');

let app;

test('matcher: normalizes brand prefixes and prioritizes GoodId over Brand+ItemName', () => {
  assert.equal(normalizeBrand('ตรารถเกษตร'), 'รถเกษตร');
  assert.equal(normalizeBrand('ตราปุ๋ยเทพ'), 'ปุ๋ยเทพ');
  assert.equal(normalizeBrand('ส่วนกลาง'), 'ทั่วไป');

  const qById = { Id: 10, Brand: 'รถเกษตร', ItemName: 'ชื่อเดิม', GoodId: '5001', RemainingQty: 90 };
  const qByLegacy = { Id: 11, Brand: 'รถเกษตร', ItemName: 'เสื้อยืดแขนยาว', GoodId: null, RemainingQty: 40 };
  const matched = findMatchingQuota(
    { goodId: '5001', goodName: 'กระเป๋าปุ๋ย 16-8-8 ตรารถเกษตร', brand: 'ตรารถเกษตร' },
    [qByLegacy, qById]
  );
  assert.equal(matched?.Id, 10);
});

test('GET /api/giveaway/org-roster returns synced regions and org staff', async () => {
  app = await h.startApp([['/api/giveaway', '../../routes/giveaway']]);
  const r = await app.call('GET', '/api/giveaway/org-roster', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.regions.length, 2);
  assert.equal(r.body.staff.length, 2);
  assert.equal(r.body.staff[1].RegionCode, '04');
  assert.equal(r.body.staff[1].RegionName, 'ภาคเหนือ');
});

test('POST /api/giveaway/budgets links master goodId/goodCode/goodName and salesUserId', async () => {
  state.existingBudget = null;
  const before = db.calls.length;
  const r = await app.call('POST', '/api/giveaway/budgets', {
    body: {
      region: 'ภาคกลาง-ตะวันตก',
      salesUserId: 40,
      goodId: '5001',
      budgetQty: 300,
      reason: 'เปิดโควต้าประจำปี',
    },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.id, 777);

  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.GiveawayBudget/i.test(c.text));
  assert.ok(ins, 'expected INSERT INTO wf.GiveawayBudget');
  assert.equal(ins.inputs.gid, '5001');
  assert.equal(ins.inputs.gc, 'GW-1688');
  assert.equal(ins.inputs.su, 40);
  assert.equal(ins.inputs.rc, '02');
});

test('PUT /api/giveaway/budgets/:id warns when new qty is below withdrawn qty', async () => {
  const before = db.calls.length;
  const r = await app.call('PUT', '/api/giveaway/budgets/101', {
    body: { budgetQty: 80, reason: 'ลดโควต้า' },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.warning || '', /น้อยกว่ายอดเบิกแล้ว/);
  const upd = db.calls.slice(before).find(c => /UPDATE wf\.GiveawayBudget/i.test(c.text));
  assert.ok(upd);
  assert.equal(upd.inputs.bq, 80);
});

test('DELETE /api/giveaway/budgets/:id enforces 409 confirm guard when WithdrawnQty > 0', async () => {
  const blocked = await app.call('DELETE', '/api/giveaway/budgets/101', {
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.requiresConfirm, true);
  assert.equal(blocked.body.withdrawnQty, 120);

  const forced = await app.call('DELETE', '/api/giveaway/budgets/101?force=true', {
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.ok, true);
});

test('GET /api/giveaway/withdrawals and /budget-history include region aliases for central region', async () => {
  const beforeWd = db.calls.length;
  const wd = await app.call('GET', '/api/giveaway/withdrawals?region=' + encodeURIComponent('ภาคกลาง-ตะวันตก'), {
    user: { sub: 1, role: 'ADMIN' },
  });
  assert.equal(wd.status, 200);
  const wdSql = db.calls.slice(beforeWd).find(c => /FROM wf\.GiveawayWithdrawal/i.test(c.text));
  assert.ok(wdSql);
  assert.match(wdSql.text, /Region = @rg0 OR Region = @rg1/);

  const beforeHist = db.calls.length;
  const hist = await app.call('GET', '/api/giveaway/budget-history?region=' + encodeURIComponent('ภาคกลาง-ตะวันตก'), {
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(hist.status, 200);
  const chSql = db.calls.slice(beforeHist).find(c => /FROM wf\.ChangeEvent e/i.test(c.text));
  assert.ok(chSql);
  assert.match(chSql.text, /e\.EntityId LIKE @prefix0 OR e\.EntityId LIKE @prefix1/);
});

after(async () => {
  if (app) await app.close();
});
