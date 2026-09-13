'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { runWithTarget, query, wfQuery, pools, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { SECRET } = require('../middleware/auth');
const couponService = require('../services/coupon-service');

let server;
let baseUrl;

let salesToken;
let mgrRegion01Token;
let mgrRegion03Token;
let clevelToken;
let adminToken;
let warehouseToken;

const trackedClaimIds = [];
function trackClaim(id) {
  if (id && !trackedClaimIds.includes(Number(id))) {
    trackedClaimIds.push(Number(id));
  }
}

async function cleanTrackedClaims() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();
    if (trackedClaimIds.length > 0) {
      const idList = [...new Set(trackedClaimIds)].join(',');
      await wfQuery(`DELETE FROM wf.RebateClaimInvoice WHERE ClaimId IN (${idList})`);
      await wfQuery(`DELETE FROM wf.RebateClaimApproval WHERE ClaimId IN (${idList})`);
      await wfQuery(`DELETE FROM wf.RebateClaimLine WHERE ClaimId IN (${idList})`);
      await wfQuery(`DELETE FROM wf.RebateClaim WHERE Id IN (${idList})`);
      trackedClaimIds.length = 0;
    }
  });
}

async function startTestServer() {
  if (server) return;
  await new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      runWithTarget('remote_b', next);
    });

    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/rebate', require('../routes/rebate'));
    app.use('/api/coupons', require('../routes/coupons'));

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ message: err.message, ...err });
    });

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

test.before(async () => {
  await startTestServer();
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();
  });

  // Generate tokens for each role in the 4-tier approval hierarchy
  salesToken = jwt.sign(
    { sub: 2, id: 2, role: 'SALES', username: 'emp-00002', displayName: 'เกษร  ดีบรรเจิด' },
    SECRET,
    { expiresIn: '2h' }
  );

  // Region 01 Manager (UserId 21)
  mgrRegion01Token = jwt.sign(
    { sub: 21, id: 21, role: 'MANAGER', username: 'emp-00021', displayName: 'จักรพงษ์' },
    SECRET,
    { expiresIn: '2h' }
  );

  // Region 03 Manager (UserId 25)
  mgrRegion03Token = jwt.sign(
    { sub: 25, id: 25, role: 'MANAGER', username: 'emp-00025', displayName: 'บุญเยี่ยม' },
    SECRET,
    { expiresIn: '2h' }
  );

  clevelToken = jwt.sign(
    { sub: 16, id: 16, role: 'C_LEVEL', username: 'emp-00016', displayName: 'เกศ  อัศวทองกุล' },
    SECRET,
    { expiresIn: '2h' }
  );

  adminToken = jwt.sign(
    { sub: 63, id: 63, role: 'ADMIN', username: 'admin', displayName: 'ผู้ดูแลระบบ' },
    SECRET,
    { expiresIn: '2h' }
  );

  warehouseToken = jwt.sign(
    { sub: 26, id: 26, role: 'WAREHOUSE', username: 'emp-00026', displayName: 'คลังสินค้า' },
    SECRET,
    { expiresIn: '2h' }
  );
});

test.after(async () => {
  try {
    await cleanTrackedClaims();
  } catch (err) {
    console.error('[test.after] Cleanup error:', err.message);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const poolName of Object.keys(pools)) {
    if (pools[poolName]) {
      try {
        await pools[poolName].close();
      } catch (_) {}
    }
  }
  setTimeout(() => process.exit(0), 500);
});

async function getRegionManagersForCustomer(custId) {
  let regionCode = '99';
  await runWithTarget('remote_b', async () => {
    const r = await wfQuery(`
      SELECT TOP 1 sa.SaleAreaCode
      FROM dbo.EMCust c
      JOIN dbo.EMSaleArea sa ON sa.SaleAreaID = c.SaleAreaID
      WHERE c.CustID = @cid
    `, { cid: { type: sql.NVarChar(20), value: String(custId) } });
    const code = r.recordset?.[0]?.SaleAreaCode;
    if (code && code.length >= 2) {
      const reg = code.substring(0, 2);
      if (['01', '02', '03', '04', '05', '06'].includes(reg)) regionCode = reg;
    }
  });

  if (regionCode === '01') {
    return { correct: mgrRegion01Token, wrong: mgrRegion03Token, regionCode };
  }
  return { correct: mgrRegion03Token, wrong: mgrRegion01Token, regionCode };
}

// ─────────────────────────────────────────────────────────────
// SO-09 TESTS: Vertical Slice (Accrual -> Claim -> Approval -> Settlement)
// ─────────────────────────────────────────────────────────────

test('SO-09.1: Entitlement & Accrual query: reads FIFO lots from wf.v_RebateAccrualRemaining', async () => {
  // 1. Query general accrual overview
  const resOverview = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(resOverview.status, 200);
  const overviewList = await resOverview.json();
  assert.ok(Array.isArray(overviewList));
  assert.ok(overviewList.length > 0, 'Must have active accrual customers in test database');

  const topCust = overviewList[0];
  assert.ok(topCust.CustId, 'Customer must have CustId');
  assert.ok(Number(topCust.RemainingTon) > 0, 'Customer must have positive remaining tons');

  // 2. Query detailed lots for top customer (FIFO ordered)
  const resDetail = await fetch(`${baseUrl}/api/rebate/accrual/${topCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(resDetail.status, 200);
  const lots = await resDetail.json();
  assert.ok(Array.isArray(lots));
  assert.ok(lots.length > 0, 'Must return lots for active accrual customer');

  // Verify FIFO order: SourceDocuDate ascending
  for (let i = 1; i < lots.length; i++) {
    const prevDate = new Date(lots[i - 1].SourceDocuDate).getTime();
    const currDate = new Date(lots[i].SourceDocuDate).getTime();
    assert.ok(currDate >= prevDate, 'Lots must be ordered chronologically (FIFO)');
  }
});

test('SO-09.2: 100/0 Rule & Policy Snapshot Invariant: Client cannot override 100% Customer / 0% WF', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const eligibleLot = lots.find(l => Number(l.RemainingTon) >= 1.0);
  assert.ok(eligibleLot, 'Must find a lot with at least 1.0 ton remaining');

  const idempotencyKey = `CLAIM:TEST:100-0:${Date.now()}`;

  // Submit claim with hostile attempt to override ratio: customerRatio: 50, companyRatio: 50
  const claimRes = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      custId: targetCust.CustId,
      customerRatio: 50,
      companyRatio: 50,
      lines: [
        {
          lineType: 'REBATE',
          goodCode: eligibleLot.GoodCode,
          qtyTon: 1.0,
          pricePerTon: Number(eligibleLot.ListPricePerTon || 15000),
          netPricePerTon: Number(eligibleLot.NetPricePerTon || (Number(eligibleLot.ListPricePerTon || 15000) - 500)),
          sourceSOID: eligibleLot.SourceSOID,
          sourceListNo: eligibleLot.SourceListNo,
        }
      ]
    })
  });

  assert.equal(claimRes.status, 200);
  const claimData = await claimRes.json();
  const claimId = claimData.claim?.Id || claimData.Id;
  trackClaim(claimId);

  // Assert server strictly enforced 100/0 ratio and linked policy snapshot
  assert.equal(Number(claimData.CustomerRatio), 100.00, 'CustomerRatio must be 100%');
  assert.equal(Number(claimData.CompanyRatio), 0.00, 'CompanyRatio must be 0%');
  assert.equal(Number(claimData.CustomerAmount), Number(claimData.ClaimAmt), 'CustomerAmount must equal full ClaimAmt');
  assert.equal(Number(claimData.RetainedAmount), 0.00, 'RetainedAmount must be 0');
  assert.ok(claimData.PolicySnapshotId, 'Must link to active PolicySnapshotId');

  // Verify in database
  await runWithTarget('remote_b', async () => {
    const row = (await wfQuery('SELECT * FROM wf.RebateClaim WHERE Id = @id', {
      id: { type: sql.Int, value: claimId }
    })).recordset?.[0];
    assert.ok(row);
    assert.equal(Number(row.CustomerRatio), 100.00);
    assert.equal(Number(row.CompanyRatio), 0.00);
    assert.equal(Number(row.CustomerAmount), Number(row.ClaimAmt));
    assert.equal(Number(row.RetainedAmount), 0.00);
    assert.equal(row.Status, 'TIER2_PENDING');
  });
});

test('SO-09.3: Idempotency Key Replay, Conflict, and Cross-Actor Guard', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const lot = lots[0];

  const idempotencyKey = `CLAIM:IDEM:TEST:${Date.now()}`;
  const payload = {
    custId: targetCust.CustId,
    note: 'Idempotency test claim',
    lines: [
      {
        lineType: 'REBATE',
        goodCode: lot.GoodCode,
        qtyTon: 0.5,
        pricePerTon: Number(lot.ListPricePerTon || 15000),
        netPricePerTon: Number(lot.NetPricePerTon || 14500),
        sourceSOID: lot.SourceSOID,
        sourceListNo: lot.SourceListNo,
      }
    ]
  };

  // 1. Initial submission
  const res1 = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload)
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  const claimId = data1.claim?.Id || data1.Id;
  trackClaim(claimId);

  // 2. Exact replay with same key and same payload: returns 200 with replayed: true
  const resReplay = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload)
  });
  assert.equal(resReplay.status, 200);
  const dataReplay = await resReplay.json();
  assert.equal(dataReplay.Id, claimId);
  assert.equal(dataReplay.replayed, true);

  // 3. Same key with altered payload: returns 409 Conflict
  const resConflict = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      ...payload,
      note: 'Altered note'
    })
  });
  assert.equal(resConflict.status, 409);
  const conflictData = await resConflict.json();
  assert.ok(conflictData.message.includes('Idempotency key reused with different payload'));

  // 4. Same key replayed by different user: returns 403 Forbidden
  const otherSalesToken = jwt.sign(
    { sub: 99992, id: 99992, role: 'SALES', username: 'other-sales-99992' },
    SECRET,
    { expiresIn: '1h' }
  );
  const resCrossActor = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${otherSalesToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload)
  });
  assert.equal(resCrossActor.status, 403);
  const crossData = await resCrossActor.json();
  assert.ok(crossData.message.includes('ไม่มีสิทธิ์เข้าถึงหรือใช้ Idempotency-Key ของผู้ใช้อื่น'));
});

test('SO-09.4: Quantity Guard: Cannot claim more tons than available in lot', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const lot = lots[0];

  const excessiveQty = Number(lot.RemainingTon) + 9999.0;

  const resOver = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': `CLAIM:OVERFLOW:${Date.now()}`
    },
    body: JSON.stringify({
      custId: targetCust.CustId,
      lines: [
        {
          lineType: 'REBATE',
          goodCode: lot.GoodCode,
          qtyTon: excessiveQty,
          pricePerTon: Number(lot.ListPricePerTon || 15000),
          netPricePerTon: Number(lot.NetPricePerTon || 14500),
          sourceSOID: lot.SourceSOID,
          sourceListNo: lot.SourceListNo,
        }
      ]
    })
  });

  assert.equal(resOver.status, 400);
  const errData = await resOver.json();
  assert.ok(errData.message.includes('ยอดขอเคลียร์ไม่ตรงกับยอดขนจริง'));
});

test('SO-09.5: Amount-only role guard: SALES role rejected with 403 Forbidden', async () => {
  const resAmountOnly = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': `CLAIM:AMOUNT_ONLY:SALES:${Date.now()}`
    },
    body: JSON.stringify({
      custId: '7057',
      claimAmt: 50000,
      note: 'Attempting amount-only claim as sales'
    })
  });

  assert.equal(resAmountOnly.status, 403);
  const errData = await resAmountOnly.json();
  assert.ok(errData.message.includes('Amount-only'));
});

test('SO-09.6: 4-Tier Approval Progression, Wrong-Role, Wrong-Region, SoD, and Terminal-State Guard', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];
  const mgrTokens = await getRegionManagersForCustomer(targetCust.CustId);

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const lot = lots[0];

  // 1. Submit claim as Sales User
  const submitRes = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': `CLAIM:4TIER:${Date.now()}`
    },
    body: JSON.stringify({
      custId: targetCust.CustId,
      note: '4-Tier Approval Flow Test',
      lines: [
        {
          lineType: 'REBATE',
          goodCode: lot.GoodCode,
          qtyTon: 0.5,
          pricePerTon: Number(lot.ListPricePerTon || 15000),
          netPricePerTon: Number(lot.NetPricePerTon || 14500),
          sourceSOID: lot.SourceSOID,
          sourceListNo: lot.SourceListNo,
        }
      ]
    })
  });
  assert.equal(submitRes.status, 200);
  const claimData = await submitRes.json();
  const claimId = claimData.claim?.Id || claimData.Id;
  trackClaim(claimId);

  assert.equal(claimData.Status, 'TIER2_PENDING');
  assert.equal(claimData.CurrentTier, 2);

  // 2a. Segregation of Duties: Submitter cannot approve Tier 2
  const selfApproveTier2 = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
    },
    body: JSON.stringify({ note: 'Self approve attempt' })
  });
  assert.equal(selfApproveTier2.status, 403);

  // 2b. Segregation of Duties: Submitter cannot reject Tier 2
  const selfRejectTier2 = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
    },
    body: JSON.stringify({ reason: 'Self reject attempt' })
  });
  assert.equal(selfRejectTier2.status, 403);

  // 2c. Wrong-Role: WAREHOUSE user cannot approve
  const wrongRoleApprove = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({ note: 'Warehouse approve attempt' })
  });
  assert.equal(wrongRoleApprove.status, 403);

  // 2d. Wrong-Region: Manager from different region cannot approve
  const wrongRegionApprove = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.wrong}`,
    },
    body: JSON.stringify({ note: 'Wrong region approve attempt' })
  });
  assert.equal(wrongRegionApprove.status, 403);

  // 2e. Wrong-Region: Manager from different region cannot reject
  const wrongRegionReject = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.wrong}`,
    },
    body: JSON.stringify({ reason: 'Wrong region reject attempt' })
  });
  assert.equal(wrongRegionReject.status, 403);

  // 3. Correct Region Manager approves Tier 2
  const mgrApproveRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.correct}`,
    },
    body: JSON.stringify({ note: 'อนุมัติโดยผู้จัดการภาคที่ถูกต้อง' })
  });
  assert.equal(mgrApproveRes.status, 200);
  const mgrData = await mgrApproveRes.json();
  assert.equal(mgrData.status, 'TIER3_PENDING');
  assert.equal(mgrData.currentTier, 3);

  // 4. Consecutive Tier SoD: Region Manager cannot immediately approve Tier 3
  const mgrConsecutiveApprove = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.correct}`,
    },
    body: JSON.stringify({ note: 'Consecutive approve attempt' })
  });
  assert.equal(mgrConsecutiveApprove.status, 403);

  // 5. C_Level approves Tier 3
  const clevelApproveRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clevelToken}`,
    },
    body: JSON.stringify({ note: 'อนุมัติชั้นที่ 3 โดยกรรมการบริหาร' })
  });
  assert.equal(clevelApproveRes.status, 200);
  const clevelData = await clevelApproveRes.json();
  assert.equal(clevelData.status, 'TIER4_PENDING');
  assert.equal(clevelData.currentTier, 4);

  // 6. Admin finalizes Tier 4
  const adminFinalApproveRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ docuNo: 'RB-TEST-001', note: 'อนุมัติชั้นที่ 4 สมบูรณ์' })
  });
  assert.equal(adminFinalApproveRes.status, 200);
  // 7. Idempotency: Calling approve again with matching expectedTier returns 200 (idempotent: true)
  const idempotentApproveRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ docuNo: 'RB-TEST-001', expectedTier: 4 })
  });
  assert.equal(idempotentApproveRes.status, 200);
  const idemData = await idempotentApproveRes.json();
  assert.equal(idemData.idempotent, true);

  // 7.1 Calling approve by unauthorized caller (Sales) on finalized claim returns 403
  const unauthApproveRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
    },
    body: JSON.stringify({ docuNo: 'RB-TEST-001', expectedTier: 4 })
  });
  assert.equal(unauthApproveRes.status, 403);

  // 7.2 Calling approve on finalized claim with non-existent tier returns 400
  const wrongTierApproveRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ docuNo: 'RB-TEST-001', expectedTier: 5 })
  });
  assert.equal(wrongTierApproveRes.status, 400);

  // 8. Terminal State Guard: Cannot reject an already APPROVED claim
  const rejectTerminalRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Attempt to reject finalized approved claim' })
  });
  assert.equal(rejectTerminalRes.status, 400);
  const termData = await rejectTerminalRes.json();
  assert.ok(termData.message.includes('Terminal State'));

  // 9. Verify DB integrity
  await runWithTarget('remote_b', async () => {
    const claimRow = (await wfQuery('SELECT * FROM wf.RebateClaim WHERE Id = @id', {
      id: { type: sql.Int, value: claimId }
    })).recordset?.[0];
    assert.equal(claimRow.Status, 'APPROVED');
    assert.ok(claimRow.ApprovedAt);
    assert.equal(Number(claimRow.ApprovedBy), 63);

    const approvals = (await wfQuery('SELECT * FROM wf.RebateClaimApproval WHERE ClaimId = @id ORDER BY Tier ASC', {
      id: { type: sql.Int, value: claimId }
    })).recordset || [];
    assert.equal(approvals.length, 4);
    assert.equal(approvals[0].Tier, 1);
    assert.equal(approvals[1].Tier, 2);
    assert.equal(approvals[2].Tier, 3);
    assert.equal(approvals[3].Tier, 4);
  });
});

test('SO-09.7: Rejection Lifecycle, SoD, Short Reason Validation, Idempotent Replay, and Exactly-Once Balance Release', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];
  const mgrTokens = await getRegionManagersForCustomer(targetCust.CustId);

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const lot = lots[0];
  const initialLotRemaining = Number(lot.RemainingTon);

  // 1. Submit claim
  const submitRes = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': `CLAIM:REJECT:${Date.now()}`
    },
    body: JSON.stringify({
      custId: targetCust.CustId,
      note: 'Rejection test claim',
      lines: [
        {
          lineType: 'REBATE',
          goodCode: lot.GoodCode,
          qtyTon: 0.5,
          pricePerTon: Number(lot.ListPricePerTon || 15000),
          netPricePerTon: Number(lot.NetPricePerTon || 14500),
          sourceSOID: lot.SourceSOID,
          sourceListNo: lot.SourceListNo,
        }
      ]
    })
  });
  assert.equal(submitRes.status, 200);
  const claimData = await submitRes.json();
  const claimId = claimData.claim?.Id || claimData.Id;
  trackClaim(claimId);

  // 2. Reject validation: reason < 5 chars rejected with 400
  const shortReasonRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.correct}`,
    },
    body: JSON.stringify({ reason: 'bad' })
  });
  assert.equal(shortReasonRes.status, 400);

  // 3. Reject with valid reason (>= 5 chars) succeeds
  const rejectRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.correct}`,
    },
    body: JSON.stringify({ reason: 'เอกสารหลักฐานแนบไม่ครบถ้วน ตรวจสอบใหม่', expectedTier: 2 })
  });
  assert.equal(rejectRes.status, 200);
  const rejectData = await rejectRes.json();
  assert.equal(rejectData.status, 'REJECTED');

  // 3.1 Idempotent replay: Same authorized manager, same reason, same expectedTier returns 200 (idempotent: true)
  const replayRejectRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.correct}`,
    },
    body: JSON.stringify({ reason: 'เอกสารหลักฐานแนบไม่ครบถ้วน ตรวจสอบใหม่', expectedTier: 2 })
  });
  assert.equal(replayRejectRes.status, 200);
  const replayData = await replayRejectRes.json();
  assert.equal(replayData.idempotent, true);
  assert.equal(replayData.status, 'REJECTED');

  // 3.2 Payload conflict: Calling reject with different reason returns 409
  const conflictRejectRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.correct}`,
    },
    body: JSON.stringify({ reason: 'เหตุผลขัดแย้งที่ไม่ตรงกับข้อมูลเดิม', expectedTier: 2 })
  });
  assert.equal(conflictRejectRes.status, 409);

  // 3.3 Unauthorized actor replay: Calling reject by another actor returns 403
  const wrongActorRejectRes = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrTokens.wrong}`,
    },
    body: JSON.stringify({ reason: 'เอกสารหลักฐานแนบไม่ครบถ้วน ตรวจสอบใหม่', expectedTier: 2 })
  });
  assert.equal(wrongActorRejectRes.status, 403);

  // 4. Rejection on terminal state: trying to reject again with different payload returns 409
  const secondReject = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Another reject attempt on terminal state', expectedTier: 3 })
  });
  assert.equal(secondReject.status, 409);

  // 5. Trying to approve an already REJECTED claim returns 400
  const approveRejected = await fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clevelToken}`,
    },
    body: JSON.stringify({ note: 'Attempting to approve rejected claim' })
  });
  assert.equal(approveRejected.status, 400);

  // 6. Verify DB: Status = REJECTED, CurrentTier = 1, exactly 1 rejection record in wf.RebateClaimApproval
  await runWithTarget('remote_b', async () => {
    const claimRow = (await wfQuery('SELECT * FROM wf.RebateClaim WHERE Id = @id', {
      id: { type: sql.Int, value: claimId }
    })).recordset?.[0];
    assert.equal(claimRow.Status, 'REJECTED');
    assert.equal(claimRow.CurrentTier, 1);

    const approvalRows = (await wfQuery('SELECT * FROM wf.RebateClaimApproval WHERE ClaimId = @id AND Decision = \'REJECTED\'', {
      id: { type: sql.Int, value: claimId }
    })).recordset || [];
    assert.equal(approvalRows.length, 1);
    assert.ok(approvalRows[0].Reason.includes('เอกสารหลักฐานแนบไม่ครบถ้วน'));
  });

  // 7. Verify lot balance release: lot remaining tons restored to original in wf.v_RebateAccrualRemaining
  const lotsAfterRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lotsAfter = await lotsAfterRes.json();
  const lotAfter = lotsAfter.find(l => l.SourceSOID === lot.SourceSOID && l.SourceListNo === lot.SourceListNo);
  assert.ok(lotAfter);
  assert.equal(Number(lotAfter.RemainingTon), initialLotRemaining, 'Lot remaining tons must be fully restored upon rejection');
});

test('SO-09.8: Concurrent Approve-vs-Reject Race (Applock & Conditional Optimistic State Guard)', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];
  const mgrTokens = await getRegionManagersForCustomer(targetCust.CustId);

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const lot = lots[0];

  // Submit claim (status: TIER2_PENDING)
  const submitRes = await fetch(`${baseUrl}/api/rebate/claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`,
      'Idempotency-Key': `CLAIM:RACE:${Date.now()}`
    },
    body: JSON.stringify({
      custId: targetCust.CustId,
      note: 'Approve vs Reject Race Claim',
      lines: [
        {
          lineType: 'REBATE',
          goodCode: lot.GoodCode,
          qtyTon: 0.5,
          pricePerTon: Number(lot.ListPricePerTon || 15000),
          netPricePerTon: Number(lot.NetPricePerTon || 14500),
          sourceSOID: lot.SourceSOID,
          sourceListNo: lot.SourceListNo,
        }
      ]
    })
  });
  assert.equal(submitRes.status, 200);
  const claimData = await submitRes.json();
  const claimId = claimData.claim?.Id || claimData.Id;
  trackClaim(claimId);

  // Fire approve and reject concurrently
  const [approveRes, rejectRes] = await Promise.all([
    fetch(`${baseUrl}/api/rebate/claims/${claimId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mgrTokens.correct}`,
      },
      body: JSON.stringify({ note: 'Concurrent approve' })
    }),
    fetch(`${baseUrl}/api/rebate/claims/${claimId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mgrTokens.correct}`,
      },
      body: JSON.stringify({ reason: 'Concurrent reject attempt' })
    })
  ]);

  const statuses = [approveRes.status, rejectRes.status];
  // Exactly one must succeed (200) and the other must fail (400, 403, or 409)
  assert.ok(statuses.includes(200), 'One decision must succeed');
  assert.ok(statuses.includes(409) || statuses.includes(400) || statuses.includes(403), 'The losing decision must fail with conflict/invalid state');

  // Verify DB state is consistent with the winner
  await runWithTarget('remote_b', async () => {
    const claimRow = (await wfQuery('SELECT * FROM wf.RebateClaim WHERE Id = @id', {
      id: { type: sql.Int, value: claimId }
    })).recordset?.[0];

    const winnerStatus = approveRes.status === 200 ? 'TIER3_PENDING' : 'REJECTED';
    assert.equal(claimRow.Status, winnerStatus);

    const approvals = (await wfQuery('SELECT * FROM wf.RebateClaimApproval WHERE ClaimId = @id AND Tier = 2', {
      id: { type: sql.Int, value: claimId }
    })).recordset || [];
    assert.equal(approvals.length, 1, 'Only one approval/rejection row may exist for Tier 2');
  });
});

test('SO-09.9: Concurrency on Same FIFO Lot: Two concurrent claims competing for remaining balance', async () => {
  const resAccrual = await fetch(`${baseUrl}/api/rebate/accrual`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const accrualList = await resAccrual.json();
  const targetCust = accrualList[0];

  const lotsRes = await fetch(`${baseUrl}/api/rebate/accrual/${targetCust.CustId}?lineType=REBATE`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  const lots = await lotsRes.json();
  const lot = lots[0];
  const lotRem = Number(lot.RemainingTon);

  const payload1 = {
    custId: targetCust.CustId,
    note: 'Concurrent Claim A',
    lines: [
      {
        lineType: 'REBATE',
        goodCode: lot.GoodCode,
        qtyTon: lotRem,
        pricePerTon: Number(lot.ListPricePerTon || 15000),
        netPricePerTon: Number(lot.NetPricePerTon || 14500),
        sourceSOID: lot.SourceSOID,
        sourceListNo: lot.SourceListNo,
      }
    ]
  };

  const payload2 = {
    custId: targetCust.CustId,
    note: 'Concurrent Claim B',
    lines: [
      {
        lineType: 'REBATE',
        goodCode: lot.GoodCode,
        qtyTon: lotRem,
        pricePerTon: Number(lot.ListPricePerTon || 15000),
        netPricePerTon: Number(lot.NetPricePerTon || 14500),
        sourceSOID: lot.SourceSOID,
        sourceListNo: lot.SourceListNo,
      }
    ]
  };

  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/rebate/claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesToken}`,
        'Idempotency-Key': `CLAIM:LOT_COMPETE_A:${Date.now()}`
      },
      body: JSON.stringify(payload1)
    }),
    fetch(`${baseUrl}/api/rebate/claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesToken}`,
        'Idempotency-Key': `CLAIM:LOT_COMPETE_B:${Date.now()}`
      },
      body: JSON.stringify(payload2)
    })
  ]);

  const claimStatuses = [resA.status, resB.status];
  assert.ok(claimStatuses.includes(200), 'One claim must succeed');
  assert.ok(claimStatuses.includes(400) || claimStatuses.includes(409), 'Second competing claim must fail due to insufficient lot balance');

  if (resA.status === 200) {
    const d = await resA.json();
    trackClaim(d.claim?.Id || d.Id);
  }
  if (resB.status === 200) {
    const d = await resB.json();
    trackClaim(d.claim?.Id || d.Id);
  }
});

test('SO-09.10: SO-08 Attachment Guard: Public cancel cannot bypass attachment guard via reason strings or owner role', async () => {
  await runWithTarget('remote_b', async () => {
    // 1. Find or create an active attached reservation
    let attachedRes = (await wfQuery(`
      SELECT TOP 1 sol.CouponReservationId, sol.SoId, hd.DocuNo
      FROM wf.SalesOrderLine sol WITH (NOLOCK)
      JOIN dbo.SOHD hd WITH (NOLOCK) ON hd.SOID = sol.SoId
      JOIN wf.CouponReservation cr WITH (NOLOCK) ON cr.Id = sol.CouponReservationId
      WHERE sol.CouponReservationId IS NOT NULL 
        AND cr.Status = 'RESERVED'
        AND (hd.DocuStatus IS NULL OR hd.DocuStatus NOT IN ('CANCELLED', 'REJECTED'))
    `)).recordset?.[0];

    // If none found, look for attached in wf.SalesOrder (draft)
    if (!attachedRes) {
      attachedRes = (await wfQuery(`
        SELECT TOP 1 sol.CouponReservationId, sol.SoId, so.WfRef AS DocuNo
        FROM wf.SalesOrderLine sol WITH (NOLOCK)
        JOIN wf.SalesOrder so WITH (NOLOCK) ON so.Id = sol.SoId
        JOIN wf.CouponReservation cr WITH (NOLOCK) ON cr.Id = sol.CouponReservationId
        WHERE sol.CouponReservationId IS NOT NULL 
          AND cr.Status = 'RESERVED'
          AND so.Status NOT IN ('CANCELLED', 'DELETED')
      `)).recordset?.[0];
    }

    if (attachedRes) {
      const rId = attachedRes.CouponReservationId;
      const attachedSoId = attachedRes.SoId;

      // Ensure reservation is owned by user 2 for owner test
      await wfQuery('UPDATE wf.CouponReservation SET CreatedBy = 2 WHERE Id = @id', { id: { type: sql.Int, value: rId } });

      // A. Public cancel with reason 'SO_LINE_REMOVED_ON_EDIT' must be REJECTED with 409
      let threwEditReason = false;
      try {
        await couponService.cancelReservation(rId, 'SO_LINE_REMOVED_ON_EDIT', 2, 'SALES');
      } catch (err) {
        if (err.status === 409 && err.code === 'RESERVATION_ALREADY_ATTACHED_TO_SO') {
          threwEditReason = true;
        }
      }
      assert.ok(threwEditReason, 'Public cancel must reject SO_LINE_REMOVED_ON_EDIT reason with 409');

      // B. Public cancel with reason 'SO_CANCELLED' must be REJECTED with 409
      let threwCancelReason = false;
      try {
        await couponService.cancelReservation(rId, 'SO_CANCELLED', 2, 'SALES');
      } catch (err) {
        if (err.status === 409 && err.code === 'RESERVATION_ALREADY_ATTACHED_TO_SO') {
          threwCancelReason = true;
        }
      }
      assert.ok(threwCancelReason, 'Public cancel must reject SO_CANCELLED reason with 409');

      // C. Public HTTP POST /api/coupons/cancel with owner token must be REJECTED with 409
      const httpCancelRes = await fetch(`${baseUrl}/api/coupons/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${salesToken}`,
        },
        body: JSON.stringify({
          reservationId: rId,
          reason: 'SO_LINE_REMOVED_ON_EDIT'
        })
      });
      assert.equal(httpCancelRes.status, 409, 'HTTP /api/coupons/cancel must return 409');

      // D. Verify DB state: reservation is STILL RESERVED
      const checkRow = (await wfQuery('SELECT Status FROM wf.CouponReservation WHERE Id = @id', {
        id: { type: sql.Int, value: rId }
      })).recordset?.[0];
      assert.equal(checkRow.Status, 'RESERVED', 'Attached reservation must remain RESERVED after rejected public cancel attempts');
    }
  });
});
