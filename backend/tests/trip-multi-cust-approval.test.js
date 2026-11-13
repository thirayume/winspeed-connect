'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/route-harness.cjs');

let state;
function resetState() {
  state = {
    thresholdSetting: '2',
    policyRole: 'APPROVER',
    trip: {
      TripId: 10,
      TripCode: 'TRIP6911-0010',
      TransRegistration: '70-1010',
      TruckCapacityTon: 50,
      CreatedBy: 43,
      Status: 'DRAFT',
      DocumentRevision: 1,
      PreSlingRequired: 0,
      TripRemark: null,
      PickupDueDate: null,
    },
    members: [
      { TripId: 10, MemberKind: 'DRAFT', MemberId: 101, DocuNo: 'I69-0101', SoPrefix: 'I', CustId: 'C001', CustName: 'บริษัท ก', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' },
      { TripId: 10, MemberKind: 'DRAFT', MemberId: 102, DocuNo: 'I69-0102', SoPrefix: 'I', CustId: 'C002', CustName: 'บริษัท ข', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' },
    ],
    approvals: [],
    nextApprovalId: 1,
  };
}
resetState();

const readInputVal = (inputs, key) => {
  const v = inputs?.[key];
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
};

const db = h.installDbStub(({ kind, text, inputs, proc }) => {
  if (kind === 'proc' || /sp_ConfirmSalesOrder/i.test(String(proc || text))) {
    const soId = Number(readInputVal(inputs, 'SoId') || 1);
    return { recordset: [], rowsAffected: [1], output: { NewSoid: String(90000 + soId) } };
  }

  if (/FROM wf\.SystemSetting WHERE SettingKey = @k/i.test(text)) {
    const k = readInputVal(inputs, 'k');
    if (k === 'TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS') {
      return state.thresholdSetting != null ? [{ SettingValue: String(state.thresholdSetting) }] : [];
    }
    return [];
  }

  if (/FROM wf\.ApprovalPolicy/i.test(text)) {
    const caseType = readInputVal(inputs, 'c');
    if (caseType === 'MULTI_CUST_TRIP') {
      return [{ Id: 99, RequiredRole: state.policyRole, MinAmount: null, MaxAmount: null, Note: 'Multi-customer trip' }];
    }
    return [];
  }

  if (/FROM wf\.SalesOrder WHERE Id IN/i.test(text)) {
    return state.members
      .filter(m => m.MemberKind === 'DRAFT')
      .map(m => ({ Id: m.MemberId, NoTruckRequired: m.NoTruckRequired, TruckPlate: m.TruckPlate, SoPrefix: m.SoPrefix }));
  }

  if (/FROM wf\.SalesOrder(?:\s+WITH\s*\([^)]+\))?\s+WHERE\s+Id\s*=\s*@id/i.test(text)) {
    const id = Number(readInputVal(inputs, 'id'));
    const m = state.members.find(x => x.MemberKind === 'DRAFT' && Number(x.MemberId) === id);
    if (!m) return [];
    return [{
      Id: m.MemberId,
      TripId: state.trip.TripId,
      Status: m.Status,
      DocumentRevision: 1,
      SalesUserId: m.SalesUserId,
      VerifiedAt: new Date(),
      TruckPlate: m.TruckPlate,
      SoPrefix: m.SoPrefix,
      NoTruckRequired: m.NoTruckRequired,
      IsControlTicket: 0,
      RequiresPriceApproval: 0,
      PriceApprovalStatus: 'NONE',
      CustId: m.CustId,
      WfRef: m.DocuNo,
      DeliveryDate: '2099-12-31',
      PickupDueType: 'DEFAULT',
      RebateDiscountAmt: 0,
      AppliedRebateClaimId: null,
      ClaimDiscountAmt: 0,
    }];
  }

  if (/FROM wf\.SalesOrderLine/i.test(text)) {
    if (/SUM\(/.test(text)) return [{ TotalTon: 25, TotalAmt: 250000 }];
    const soId = Number(readInputVal(inputs, 'id'));
    return [{ Id: soId * 10, SoId: soId, LineNum: 1, GoodId: 101, GoodCode: 'F1', GoodName: '15-15-15', QtyTon: 12.5, QtyBag: 250, PricePerTon: 10000, NetPricePerTon: 9800, IsGiveaway: 0 }];
  }

  if (/FROM wf\.CreditMaster/i.test(text)) return [{ CreditHold: 0 }];
  if (/FROM wf\.PriceApproval/i.test(text) || /FROM wf\.QuotationSourceSO/i.test(text)) return [];
  if (/FROM dbo\.SOHD WHERE DocuType=103/i.test(text)) return [];

  if (/SELECT \* FROM wf\.SalesTrip st WHERE st\.TripId = @id/i.test(text) || /SELECT \* FROM wf\.SalesTrip WITH \(UPDLOCK, HOLDLOCK\) WHERE TripId = @id/i.test(text) || /SELECT \* FROM wf\.SalesTrip WITH \(UPDLOCK, ROWLOCK\) WHERE TripId = @id/i.test(text) || /SELECT TripId, Status, DocumentRevision FROM wf\.SalesTrip/i.test(text)) {
    const tid = Number(readInputVal(inputs, 'id') ?? readInputVal(inputs, 'tid'));
    return tid === state.trip.TripId ? [{ ...state.trip }] : [];
  }

  if (/FROM wf\.v_TripMember/i.test(text)) {
    return state.members.map(m => ({ ...m }));
  }

  if (/SELECT .*WfRef.*CustId.*CustName.*TruckPlate/i.test(text) && /FROM wf\.SalesOrder/i.test(text)) {
    return state.members
      .filter(m => m.MemberKind === 'DRAFT')
      .map(m => ({
        Id: m.MemberId,
        WfRef: m.DocuNo,
        SoPrefix: m.SoPrefix,
        CustId: m.CustId,
        CustCode: m.CustCode || null,
        CustName: m.CustName,
        TruckPlate: m.TruckPlate,
        Status: m.Status,
        CreatedAt: new Date().toISOString(),
        NoTruckRequired: m.NoTruckRequired,
        PSling: 0,
        DeliveryDate: '2099-12-31',
        TripId: state.trip.TripId,
      }));
  }

  if (/SELECT Id, TripId, Status, RequestedBy FROM wf\.TripMultiCustomerApproval/i.test(text) || /SELECT \* FROM wf\.TripMultiCustomerApproval WHERE Id = @id/i.test(text)) {
    const id = Number(readInputVal(inputs, 'id') ?? readInputVal(inputs, 'aid'));
    const row = state.approvals.find(a => a.Id === id);
    return row ? [{ ...row }] : [];
  }

  if (/FROM wf\.TripMultiCustomerApproval/i.test(text) && /ORDER BY/i.test(text)) {
    const tid = Number(readInputVal(inputs, 'tripId'));
    let list = state.approvals
      .filter(a => (!tid || a.TripId === tid))
      .filter(a => !/Status <> 'CANCELLED'/i.test(text) || a.Status !== 'CANCELLED');
    const qStatus = readInputVal(inputs, 'status');
    if (qStatus) list = list.filter(a => a.Status === qStatus);
    if (/TOP 1 /i.test(text)) list = list.slice().sort((a, b) => b.Id - a.Id).slice(0, 1);
    else if (/TOP 5 /i.test(text)) list = list.slice().sort((a, b) => b.Id - a.Id).slice(0, 5);
    else list = list.slice().sort((a, b) => (a.Status === 'PENDING' ? 0 : 1) - (b.Status === 'PENDING' ? 0 : 1) || b.Id - a.Id);
    return list.map(a => ({ ...a, RequestedByName: 'Sales User', ApprovedByName: a.ApprovedBy ? 'Approver User' : null }));
  }

  if (/UPDATE wf\.TripMultiCustomerApproval\s+SET Status = 'SUPERSEDED'/i.test(text)) {
    const id = Number(readInputVal(inputs, 'id'));
    const tid = Number(readInputVal(inputs, 'tripId'));
    let changed = 0;
    for (const a of state.approvals) {
      if ((id && a.Id === id && a.Status === 'PENDING') || (tid && a.TripId === tid && a.Status === 'PENDING')) {
        a.Status = 'SUPERSEDED';
        changed++;
      }
    }
    return { recordset: [], rowsAffected: [changed] };
  }

  if (/INSERT INTO wf\.TripMultiCustomerApproval/i.test(text)) {
    const row = {
      Id: state.nextApprovalId++,
      TripId: Number(readInputVal(inputs, 'tripId')),
      TripCode: readInputVal(inputs, 'tripCode'),
      TripRevision: Number(readInputVal(inputs, 'tripRev')),
      MinCustomersSetting: Number(readInputVal(inputs, 'minCust')),
      CustomerCount: Number(readInputVal(inputs, 'custCnt')),
      CustomerIdsJson: readInputVal(inputs, 'custJson'),
      CustomerSummary: readInputVal(inputs, 'custSummary'),
      CustomerFingerprint: readInputVal(inputs, 'fp'),
      OrderCount: Number(readInputVal(inputs, 'orderCnt')),
      TotalTon: Number(readInputVal(inputs, 'totalTon')),
      TotalAmount: Number(readInputVal(inputs, 'totalAmt')),
      ReasonText: readInputVal(inputs, 'reason'),
      Status: 'PENDING',
      RequestedBy: Number(readInputVal(inputs, 'reqBy')),
      ApprovedBy: null,
      ApprovedAt: null,
      ApprovalNote: null,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: null,
    };
    state.approvals.push(row);
    return [{ Id: row.Id }];
  }

  if (/UPDATE wf\.TripMultiCustomerApproval\s+SET Status = 'APPROVED'/i.test(text)) {
    const id = Number(readInputVal(inputs, 'id'));
    const row = state.approvals.find(a => a.Id === id && a.Status === 'PENDING');
    if (!row) return { recordset: [], rowsAffected: [0] };
    row.Status = 'APPROVED';
    row.ApprovedBy = Number(readInputVal(inputs, 'by'));
    row.ApprovedAt = new Date().toISOString();
    row.ApprovalNote = readInputVal(inputs, 'note');
    return { recordset: [], rowsAffected: [1] };
  }

  if (/UPDATE wf\.TripMultiCustomerApproval\s+SET Status = 'REJECTED'/i.test(text)) {
    const id = Number(readInputVal(inputs, 'id'));
    const row = state.approvals.find(a => a.Id === id && a.Status === 'PENDING');
    if (!row) return { recordset: [], rowsAffected: [0] };
    row.Status = 'REJECTED';
    row.ApprovedBy = Number(readInputVal(inputs, 'by'));
    row.ApprovedAt = new Date().toISOString();
    row.ApprovalNote = readInputVal(inputs, 'note');
    return { recordset: [], rowsAffected: [1] };
  }

  if (/UPDATE wf\.TripMultiCustomerApproval\s+SET Status = 'CANCELLED'/i.test(text)) {
    const id = Number(readInputVal(inputs, 'aid'));
    const row = state.approvals.find(a => a.Id === id && a.Status === 'PENDING');
    if (!row) return { recordset: [], rowsAffected: [0] };
    row.Status = 'CANCELLED';
    return { recordset: [], rowsAffected: [1] };
  }

  if (/INSERT INTO wf\.SalesTrip/i.test(text)) return [{ TripId: 11 }];
  if (/INSERT INTO wf\.PickupPolicySnapshot/i.test(text)) return [{ Id: 1 }];
  if (/sp_getapplock/i.test(text)) return [{ LockResult: 0 }];
  if (/INSERT INTO wf\.AppOutbox/i.test(text)) return [];
  if (/UPDATE wf\.SalesTrip/i.test(text)) return { recordset: [], rowsAffected: [1] };
  return [];
}, { activeUserIds: h.TEST_USERS });

const { clearSettingCache } = require('../services/policy-contract');
const { computeTripCustomerSnapshot } = require('../services/trip-multi-cust-approval');

let app;
test.before(async () => {
  app = await h.startApp([
    ['/api/trips', '../../routes/trips'],
    ['/api/edit-requests', '../../routes/edit-requests'],
  ]);
});
test.after(async () => {
  await app.close();
});

const sales = { sub: 43, role: 'SALES' };
const approver = { sub: 20, role: 'APPROVER' };
const manager = { sub: 31, role: 'MANAGER' };

test('unit: distinct customer snapshot counts multiple bills for same customer as 1 customer and excludes cancelled bills', () => {
  const singleCustTwoBills = computeTripCustomerSnapshot([
    { CustId: '1000', CustName: 'บริษัท เอ', DocuNo: 'I69-01', Status: 'DRAFT' },
    { CustId: '1000', CustName: 'บริษัท เอ', DocuNo: 'I69-02', Status: 'DRAFT' },
    { CustId: '9999', CustName: 'ยกเลิก', DocuNo: 'I69-03', Status: 'CANCELLED' },
  ]);
  assert.equal(singleCustTwoBills.customerCount, 1);
  assert.deepEqual(singleCustTwoBills.customerIds, ['1000']);

  const twoCusts = computeTripCustomerSnapshot([
    { CustId: '1001', CustName: 'บริษัท บี', DocuNo: 'I69-02', Status: 'DRAFT' },
    { CustId: '1000', CustName: 'บริษัท เอ', DocuNo: 'I69-01', Status: 'DRAFT' },
  ]);
  assert.equal(twoCusts.customerCount, 2);
  assert.deepEqual(twoCusts.customerIds, ['1000', '1001']);
});

test('route: confirming 2+ distinct customer trip is blocked (409) until approved, while same-customer multi-bill trip confirms without approval', async () => {
  resetState();
  clearSettingCache();

  // Case 1: Same customer across 2 bills -> allowed without multi-cust approval
  state.members = [
    { TripId: 10, MemberKind: 'DRAFT', MemberId: 101, DocuNo: 'I69-0101', SoPrefix: 'I', CustId: 'C001', CustName: 'บริษัท ก', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' },
    { TripId: 10, MemberKind: 'DRAFT', MemberId: 102, DocuNo: 'I69-0102', SoPrefix: 'I', CustId: 'C001', CustName: 'บริษัท ก', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' },
  ];
  const sameCustConfirm = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(sameCustConfirm.status, 200, JSON.stringify(sameCustConfirm.body));

  // Case 2: 2 distinct customers -> blocked with 409 MULTI_CUST_TRIP_APPROVAL_REQUIRED
  resetState();
  clearSettingCache();
  const detail = await app.call('GET', '/api/trips/10', { user: sales });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.multiCustApproval.requiresApproval, true);
  assert.equal(detail.body.multiCustApproval.customerCount, 2);
  assert.equal(detail.body.multiCustApproval.approvalStatus, 'REQUIRED');

  const blockedConfirm = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(blockedConfirm.status, 409);
  assert.equal(blockedConfirm.body.code, 'MULTI_CUST_TRIP_APPROVAL_REQUIRED');
});

test('route: raising TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS in settings to 3 skips approval for 2 customers and enforces for 3', async () => {
  resetState();
  state.thresholdSetting = '3';
  clearSettingCache();

  const detail2 = await app.call('GET', '/api/trips/10', { user: sales });
  assert.equal(detail2.status, 200);
  assert.equal(detail2.body.multiCustApproval.minCustomers, 3);
  assert.equal(detail2.body.multiCustApproval.requiresApproval, false);

  const confirm2 = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(confirm2.status, 200, JSON.stringify(confirm2.body));

  // Now add 3rd customer -> blocked at threshold 3
  resetState();
  state.thresholdSetting = '3';
  clearSettingCache();
  state.members.push({ TripId: 10, MemberKind: 'DRAFT', MemberId: 103, DocuNo: 'I69-0103', SoPrefix: 'I', CustId: 'C003', CustName: 'บริษัท ค', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' });
  const confirm3 = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102, 103], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(confirm3.status, 409);
  assert.equal(confirm3.body.code, 'MULTI_CUST_TRIP_APPROVAL_REQUIRED');
});

test('route: full approval lifecycle — request -> block while pending -> reject self-approve -> approve -> confirm -> stale if new customer added', async () => {
  resetState();
  clearSettingCache();

  // 1. Submit request
  const reqRes = await app.call('POST', '/api/trips/10/multi-cust-approval', {
    body: { reason: 'ทางเดียวกัน 2 เจ้า ลงไม่เกินน้ำหนักพ่วง' },
    user: sales,
  });
  assert.equal(reqRes.status, 201, JSON.stringify(reqRes.body));
  const approvalId = reqRes.body.id;

  // 2. Confirm while PENDING -> blocked 409 MULTI_CUST_TRIP_APPROVAL_PENDING
  const pendingConfirm = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(pendingConfirm.status, 409);
  assert.equal(pendingConfirm.body.code, 'MULTI_CUST_TRIP_APPROVAL_PENDING');

  // 3. Requester / SALES cannot approve
  const salesApprove = await app.call('PATCH', `/api/edit-requests/trip-approvals/${approvalId}/approve`, {
    body: { note: 'try self' },
    user: sales,
  });
  assert.equal(salesApprove.status, 403);

  // 4. Policy enforces RequiredRole (when policy = MANAGER, APPROVER is refused; MANAGER passes)
  state.policyRole = 'MANAGER';
  const lowRoleApprove = await app.call('PATCH', `/api/edit-requests/trip-approvals/${approvalId}/approve`, {
    body: { note: 'approver try' },
    user: approver,
  });
  assert.equal(lowRoleApprove.status, 403);

  state.policyRole = 'APPROVER';
  const appRes = await app.call('PATCH', `/api/edit-requests/trip-approvals/${approvalId}/approve`, {
    body: { note: 'อนุมัติเส้นทางเดียวกัน' },
    user: approver,
  });
  assert.equal(appRes.status, 200, JSON.stringify(appRes.body));

  // 5. Adding a 3rd customer invalidates previously approved [C001, C002] fingerprint!
  state.members.push({ TripId: 10, MemberKind: 'DRAFT', MemberId: 103, DocuNo: 'I69-0103', SoPrefix: 'I', CustId: 'C003', CustName: 'บริษัท ค', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' });
  const staleConfirm = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102, 103], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(staleConfirm.status, 409);
  assert.equal(staleConfirm.body.code, 'MULTI_CUST_TRIP_APPROVAL_STALE');

  // 6. Original [101, 102] (when only 2 customers are confirmed into tripId) succeeds because fingerprint matches [C001, C002]
  const partialConfirm = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(partialConfirm.status, 200, JSON.stringify(partialConfirm.body));
});

test('route: rejection requires note >= 5 chars and blocks confirm until re-requested & approved', async () => {
  resetState();
  clearSettingCache();

  const reqRes = await app.call('POST', '/api/trips/10/multi-cust-approval', {
    body: { reason: 'ขอร่วมเที่ยว' },
    user: sales,
  });
  const approvalId = reqRes.body.id;

  const shortReject = await app.call('PATCH', `/api/edit-requests/trip-approvals/${approvalId}/reject`, {
    body: { note: 'ไม่' },
    user: manager,
  });
  assert.equal(shortReject.status, 400);

  const rejectRes = await app.call('PATCH', `/api/edit-requests/trip-approvals/${approvalId}/reject`, {
    body: { note: 'คนละเส้นทาง ให้แยกรถ' },
    user: manager,
  });
  assert.equal(rejectRes.status, 200);

  const blockedConfirm = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(blockedConfirm.status, 409);
  assert.equal(blockedConfirm.body.code, 'MULTI_CUST_TRIP_APPROVAL_REJECTED');

  // Verify listing shows status=REJECTED
  const listRes = await app.call('GET', '/api/edit-requests/trip-approvals?status=REJECTED', { user: manager });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.length, 1);
  assert.equal(listRes.body.data[0].status, 'REJECTED');
});

test('unit: same CustCode prefix before "-" (e.g. 0462002 and 0462002-1) collapses into 1 customer', () => {
  const { getBaseCustCode } = require('../services/trip-multi-cust-approval');
  assert.equal(getBaseCustCode('0462002'), '0462002');
  assert.equal(getBaseCustCode('0462002-1'), '0462002');
  assert.equal(getBaseCustCode(' 0462002-02 '), '0462002');

  const branchSameCustomer = computeTripCustomerSnapshot([
    { CustId: '18006', CustCode: '0462002-1', CustName: 'กลุ่มชาวไร่น้ำจืด', DocuNo: 'I69-02', Status: 'DRAFT' },
    { CustId: '18005', CustCode: '0462002', CustName: 'บริษัท ทวีชัยเคมีเกษตร จำกัด', DocuNo: 'I69-01', Status: 'DRAFT' },
    { CustId: '18007', CustCode: '0462002-2', CustName: 'กลุ่มชาวไร่สาขา 2', DocuNo: 'I69-03', Status: 'DRAFT' },
  ]);
  assert.equal(branchSameCustomer.customerCount, 1);
  assert.deepEqual(branchSameCustomer.customerIds, ['CODE:0462002']);
  assert.equal(branchSameCustomer.customers[0].custName, 'บริษัท ทวีชัยเคมีเกษตร จำกัด');

  const twoDistinctPrefixes = computeTripCustomerSnapshot([
    { CustId: '18005', CustCode: '0462002', CustName: 'บริษัท ทวีชัยเคมีเกษตร จำกัด', DocuNo: 'I69-01', Status: 'DRAFT' },
    { CustId: '18006', CustCode: '0462002-1', CustName: 'กลุ่มชาวไร่น้ำจืด', DocuNo: 'I69-02', Status: 'DRAFT' },
    { CustId: '19001', CustCode: '0462003', CustName: 'ร้านเกษตรรุ่งเรือง', DocuNo: 'I69-03', Status: 'DRAFT' },
  ]);
  assert.equal(twoDistinctPrefixes.customerCount, 2);
  assert.deepEqual(twoDistinctPrefixes.customerIds, ['CODE:0462002', 'CODE:0462003']);
});

test('route: confirming trip with 0462002 and 0462002-1 succeeds without multi-customer approval', async () => {
  resetState();
  clearSettingCache();
  state.members = [
    { TripId: 10, MemberKind: 'DRAFT', MemberId: 101, DocuNo: 'I69-0101', SoPrefix: 'I', CustId: '18005', CustCode: '0462002', CustName: 'บริษัท ทวีชัยเคมีเกษตร จำกัด', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' },
    { TripId: 10, MemberKind: 'DRAFT', MemberId: 102, DocuNo: 'I69-0102', SoPrefix: 'I', CustId: '18006', CustCode: '0462002-1', CustName: 'กลุ่มชาวไร่น้ำจืด', Status: 'DRAFT', SalesUserId: 43, SOID: null, NoTruckRequired: 0, TruckPlate: '70-1010' },
  ];

  const detail = await app.call('GET', '/api/trips/10', { user: sales });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.multiCustApproval.customerCount, 1);
  assert.equal(detail.body.multiCustApproval.requiresApproval, false);

  const confirmRes = await app.call('POST', '/api/trips/10/confirm', {
    body: { confirmedOrderIds: [101, 102], transRegistration: '70-1010', pickupDueDate: '2099-12-31' },
    user: sales,
  });
  assert.equal(confirmRes.status, 200, JSON.stringify(confirmRes.body));
});

test('migration 185 & 189 define TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS, MULTI_CUST_TRIP policy, and SQL 2008-compatible schema', () => {
  const sqlText = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '185_trip_multi_customer_approval.sql'),
    'utf8'
  );
  assert.match(sqlText, /TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS/);
  assert.match(sqlText, /MULTI_CUST_TRIP/);
  assert.match(sqlText, /CREATE TABLE wf\.TripMultiCustomerApproval/);
  assert.doesNotMatch(sqlText, /\b(TRY_CAST|TRY_CONVERT|CREATE\s+OR\s+ALTER|THROW|CONCAT|STRING_AGG|OFFSET\s+.+FETCH\s+NEXT)\b/i);

  const sql189 = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '189_trip_member_cust_code.sql'),
    'utf8'
  );
  assert.match(sql189, /ALTER VIEW wf\.v_TripMember/);
  assert.match(sql189, /\bCustCode\b/);
  assert.doesNotMatch(sql189, /\b(TRY_CAST|TRY_CONVERT|CREATE\s+OR\s+ALTER|THROW|CONCAT|STRING_AGG|OFFSET\s+.+FETCH\s+NEXT)\b/i);
});
