'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { runWithTarget, wfQuery, wfTransaction, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { SECRET } = require('../middleware/auth');

let server;
let baseUrl;

let adminToken;
let salesToken;
let warehouseToken;

const trackedHeaderIds = [];
const trackedTemplateIds = [];
const trackedDedicatedAssignmentKeys = [];
const trackedSharedAssignments = new Map();

function trackHeader(id) {
  if (id && !trackedHeaderIds.includes(Number(id))) trackedHeaderIds.push(Number(id));
}
function trackTemplate(id) {
  if (id && !trackedTemplateIds.includes(Number(id))) trackedTemplateIds.push(Number(id));
}
function trackDedicatedAssignment(key) {
  const k = String(key).toLowerCase();
  if (k && !trackedDedicatedAssignmentKeys.includes(k)) trackedDedicatedAssignmentKeys.push(k);
}
function trackSharedAssignment(reportKey, priorState, trackedAssignmentId, expectedTestVersion) {
  trackedSharedAssignments.set(String(reportKey).toLowerCase(), {
    priorState,
    trackedAssignmentId: String(trackedAssignmentId),
    expectedTestVersion: Number(expectedTestVersion),
  });
}

async function cleanTrackedEntities() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();

    // 1. Restore shared assignments atomically if still at expected test version
    for (const [reportKey, item] of trackedSharedAssignments.entries()) {
      try {
        const result = await wfQuery(`
          UPDATE wf.ReportTemplateAssignment
          SET TemplateId = @tId, IsActive = @active, Version = Version + 1, UpdatedBy = 'TEST_CLEANUP', UpdatedAt = SYSUTCDATETIME()
          WHERE AssignmentId = @aId AND Version = @v
        `, {
          tId: { type: sql.Int, value: item.priorState.TemplateId },
          active: { type: sql.Bit, value: item.priorState.IsActive ? 1 : 0 },
          aId: { type: sql.Int, value: item.trackedAssignmentId },
          v: { type: sql.Int, value: item.expectedTestVersion }
        });
        if (result.rowsAffected[0] !== 1) {
           throw new Error(`Cleanup conflict: Shared assignment '${reportKey}' was modified by another process (Version != ${item.expectedTestVersion}). Restoration failed.`);
        }
      } catch (e) {
        throw new Error(`[cleanTrackedEntities] Fatal error restoring shared assignment '${reportKey}': ${e.message}`);
      }
    }
    trackedSharedAssignments.clear();

    // 2. Delete test-only dedicated assignments
    if (trackedDedicatedAssignmentKeys.length > 0) {
      const keys = trackedDedicatedAssignmentKeys.map(k => `'${k}'`).join(',');
      await wfQuery(`DELETE FROM wf.ReportTemplateAssignment WHERE ReportKey IN (${keys})`);
      trackedDedicatedAssignmentKeys.length = 0;
    }

    // 3. Delete tracked templates if not referenced by other assignments
    if (trackedTemplateIds.length > 0) {
      for (const tId of trackedTemplateIds) {
        const ref = await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.ReportTemplateAssignment WHERE TemplateId = @tId`, {
          tId: { type: sql.Int, value: tId }
        });
        if (ref.recordset?.[0]?.Cnt === 0) {
          await wfQuery(`DELETE FROM wf.ReportTemplate WHERE TemplateId = @tId`, {
            tId: { type: sql.Int, value: tId }
          });
        }
      }
      trackedTemplateIds.length = 0;
    }

    // 4. Delete tracked headers if not referenced by remaining templates
    if (trackedHeaderIds.length > 0) {
      for (const hId of trackedHeaderIds) {
        const ref = await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.ReportTemplate WHERE HeaderId = @hId`, {
          hId: { type: sql.Int, value: hId }
        });
        if (ref.recordset?.[0]?.Cnt === 0) {
          await wfQuery(`DELETE FROM wf.ReportHeaderMaster WHERE HeaderId = @hId`, {
            hId: { type: sql.Int, value: hId }
          });
        }
      }
      trackedHeaderIds.length = 0;
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

    app.use('/api/admin/reports', require('../routes/admin-reports'));
    app.use('/api/reports', require('../routes/reports'));

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

  adminToken = jwt.sign(
    { sub: 1, id: 1, role: 'ADMIN', username: 'admin-so10', displayName: 'System Administrator' },
    SECRET,
    { expiresIn: '2h' }
  );

  salesToken = jwt.sign(
    { sub: 2, id: 2, role: 'SALES', username: 'sales-so10', displayName: 'Sales Person' },
    SECRET,
    { expiresIn: '2h' }
  );

  warehouseToken = jwt.sign(
    { sub: 5, id: 5, role: 'WAREHOUSE', username: 'wh-so10', displayName: 'Warehouse Officer' },
    SECRET,
    { expiresIn: '2h' }
  );
});

test.after(async () => {
  try {
    await cleanTrackedEntities();
  } catch (err) {
    console.error('[test.after] Cleanup error:', err.message);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  const { pools } = require('../db');
  for (const poolName of Object.keys(pools)) {
    if (pools[poolName]) {
      try {
        await pools[poolName].close();
      } catch (_) {}
    }
  }
  setTimeout(() => process.exit(0), 500);
});

test('SO-10.1: RBAC Security Gate - Non-admin cannot access admin report endpoints', async () => {
  // 1. Sales attempting GET /api/admin/reports/headers
  const resH = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(resH.status, 403, 'Sales must receive 403 on GET /admin/reports/headers');

  // 2. Warehouse attempting POST /api/admin/reports/headers
  const resHPost = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${warehouseToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ headerCode: 'H_TEST_WH', headerName: 'WH Header', reason: 'WH' })
  });
  assert.equal(resHPost.status, 403, 'Warehouse must receive 403 on POST /admin/reports/headers');

  // 3. Sales attempting PUT /api/admin/reports/templates/1
  const resT = await fetch(`${baseUrl}/api/admin/reports/templates/1`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${salesToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ templateName: 'Hack', reason: 'Hack', expectedVersion: 1 })
  });
  assert.equal(resT.status, 403, 'Sales must receive 403 on PUT /admin/reports/templates/:id');

  // 4. Sales attempting PUT /api/admin/reports/assignments/coupon-balance-status
  const resA = await fetch(`${baseUrl}/api/admin/reports/assignments/coupon-balance-status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${salesToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ templateId: 1, reason: 'Hack' })
  });
  assert.equal(resA.status, 403, 'Sales must receive 403 on PUT /admin/reports/assignments/:key');
});

test('SO-10.2: Header Master CRUD, Reason Obligation & Audit Logging in wf.ChangeEvent', async () => {
  const testCode = `HD_SO10_${Date.now().toString().slice(-6)}`;

  // 1. Missing reason returns 400
  const noReasonRes = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerCode: testCode,
      headerName: 'Header Without Reason',
      companyNameTh: 'บริษัท ทดสอบ จำกัด',
      addressTh: '123 ถนนสุขุมวิท',
      taxId: '0105550000001'
    })
  });
  assert.equal(noReasonRes.status, 400, 'Header create without reason must return 400');

  // 2. Admin creates header with reason
  const createRes = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerCode: testCode,
      headerName: 'บริษัท เวิลด์ เฟอท (สำนักงานใหญ่)',
      companyNameTh: 'บริษัท เวิลด์ เฟอท จำกัด',
      companyNameEn: 'World Fert Co., Ltd.',
      branchNameTh: 'สำนักงานใหญ่',
      branchCode: '00000',
      addressTh: '99/9 หมู่ 2 ตำบลบางเตย อำเภอสามโคก จังหวัดปทุมธานี 12160',
      tel: '02-123-4567',
      fax: '02-123-4568',
      taxId: '0105550001234',
      footerNote: 'เอกสารออกโดยระบบ WorldFert ERP',
      termsAndConditions: 'ชำระเงินตามเงื่อนไขในสัญญา',
      reason: 'SO-10 Setup Head Office Master'
    })
  });
  assert.equal(createRes.status, 201, 'Header create must return 201');
  const createdHeader = await createRes.json();
  assert.ok(createdHeader.HeaderId, 'HeaderId must exist');
  assert.equal(createdHeader.Version, 1, 'Initial version must be 1');
  trackHeader(createdHeader.HeaderId);

  // 3. Verify audit log entry in wf.ChangeEvent
  await runWithTarget('remote_b', async () => {
    const audit = (await wfQuery(
      `SELECT TOP 1 * FROM wf.ChangeEvent WHERE EntityType = 'REPORT_HEADER' AND EntityId = @id ORDER BY EventId DESC`,
      { id: { type: sql.VarChar(100), value: String(createdHeader.HeaderId) } }
    )).recordset;

    assert.equal(audit.length, 1, 'Must create 1 audit record in wf.ChangeEvent');
    assert.equal(audit[0].Action, 'CREATE');
    assert.equal(audit[0].ReasonCode, 'HEADER_CREATE');
    assert.equal(audit[0].ReasonText, 'SO-10 Setup Head Office Master');
  });

  // 4. Duplicate headerCode returns 409
  const dupRes = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerCode: testCode,
      headerName: 'Duplicate Header',
      companyNameTh: 'บริษัท เวิลด์ เฟอท จำกัด',
      addressTh: '123',
      taxId: '0105550001234',
      reason: 'Duplicate check'
    })
  });
  assert.equal(dupRes.status, 409, 'Duplicate headerCode must return 409');

  // 5. Verify transaction rollback: failed operation must not record audit entry
  await runWithTarget('remote_b', async () => {
    const failedAudit = (await wfQuery(
      `SELECT * FROM wf.ChangeEvent WHERE EntityType = 'REPORT_HEADER' AND ReasonText = 'Duplicate check'`
    )).recordset;
    assert.equal(failedAudit.length, 0, 'Failed duplicate creation must not commit any audit record');
  });
});

test('SO-10.3: Optimistic Concurrency Control (OCC) - Header update version checks', async () => {
  const testCode = `HD_OCC_${Date.now().toString().slice(-6)}`;
  const createRes = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerCode: testCode,
      headerName: 'Header for OCC test',
      companyNameTh: 'บริษัท ทดสอบ OCC จำกัด',
      addressTh: '123',
      taxId: '0105550001234',
      reason: 'Setup OCC test'
    })
  });
  const header = await createRes.json();
  trackHeader(header.HeaderId);
  assert.equal(header.Version, 1);

  // Stale version (expectedVersion = 0 when actual is 1) returns 409
  const staleRes = await fetch(`${baseUrl}/api/admin/reports/headers/${header.HeaderId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerName: 'Stale update attempt',
      expectedVersion: 0,
      reason: 'Stale version edit'
    })
  });
  assert.equal(staleRes.status, 409, 'Stale expectedVersion must return 409 Conflict');

  // Correct version (expectedVersion = 1) succeeds and bumps version to 2
  const okRes = await fetch(`${baseUrl}/api/admin/reports/headers/${header.HeaderId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerName: 'Updated Header Name OCC',
      expectedVersion: 1,
      reason: 'Legitimate update with correct version'
    })
  });
  assert.equal(okRes.status, 200, 'Matching expectedVersion must return 200');
  const updatedHeader = await okRes.json();
  assert.equal(updatedHeader.Version, 2, 'Version must increment to 2');
  assert.equal(updatedHeader.HeaderName, 'Updated Header Name OCC');

  // Trying with old version 1 again returns 409
  const staleRes2 = await fetch(`${baseUrl}/api/admin/reports/headers/${header.HeaderId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerName: 'Retry with old version 1',
      expectedVersion: 1,
      reason: 'Should fail'
    })
  });
  assert.equal(staleRes2.status, 409, 'Retry with stale version 1 must return 409');
});

test('SO-10.4: Template Config, Template Assignment & Concurrency OCC', async () => {
  // 1. Create a Header
  const hCode = `HD_TPL_${Date.now().toString().slice(-6)}`;
  const hRes = await fetch(`${baseUrl}/api/admin/reports/headers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      headerCode: hCode,
      headerName: 'Header for Templates',
      companyNameTh: 'เวิลด์เฟอท แม่แบบทดสอบ',
      companyNameEn: 'World Fert Template Test',
      addressTh: 'โรงงานปทุมธานี',
      taxId: '0105550009999',
      reason: 'Create header for template test'
    })
  });
  const header = await hRes.json();
  trackHeader(header.HeaderId);

  // 2. Create Template linked to header
  const tCode = `TPL_TEST_${Date.now().toString().slice(-6)}`;
  const tRes = await fetch(`${baseUrl}/api/admin/reports/templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateCode: tCode,
      templateName: 'แม่แบบทดสอบตั๋วปุ๋ย SO10',
      headerId: header.HeaderId,
      reportCategory: 'sales',
      orientation: 'portrait',
      paperSize: 'A4',
      showPageNumber: true,
      showSignatures: true,
      signatureSalesLabel: 'ผู้ส่งมอบตั๋ว',
      signatureApprovedLabel: 'ผู้อนุมัติการเบิก',
      signatureWarehouseLabel: 'พนักงานจ่ายสินค้า',
      reason: 'Create template for SO10 test'
    })
  });
  assert.equal(tRes.status, 201);
  const template = await tRes.json();
  trackTemplate(template.TemplateId);
  assert.equal(template.Version, 1);

  // 3. Inspect existing assignment for customer-dispatch
  const curAssignRes = await fetch(`${baseUrl}/api/admin/reports/assignments`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const allAssignments = await curAssignRes.json();
  const priorAssignment = allAssignments.find(a => a.ReportKey === 'customer-dispatch');
  assert.ok(priorAssignment, 'customer-dispatch assignment must exist');
  const priorVersion = priorAssignment.Version;

  // 4. Concurrency Guard on existing Assignment:
  // a) Missing expectedVersion -> 400 Bad Request
  const noVerRes = await fetch(`${baseUrl}/api/admin/reports/assignments/customer-dispatch`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateId: template.TemplateId,
      isActive: true,
      reason: 'Missing expectedVersion test'
    })
  });
  assert.equal(noVerRes.status, 400, 'Updating existing assignment without expectedVersion must return 400');

  // b) Stale expectedVersion -> 409 Conflict
  const staleAssignRes = await fetch(`${baseUrl}/api/admin/reports/assignments/customer-dispatch`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateId: template.TemplateId,
      isActive: true,
      expectedVersion: priorVersion + 999,
      reason: 'Stale expectedVersion test'
    })
  });
  assert.equal(staleAssignRes.status, 409, 'Stale expectedVersion on assignment must return 409');

  // c) Matching expectedVersion -> 200 OK and Version increments
  const assignRes = await fetch(`${baseUrl}/api/admin/reports/assignments/customer-dispatch`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateId: template.TemplateId,
      isActive: true,
      expectedVersion: priorVersion,
      reason: 'Assign custom template to customer-dispatch report'
    })
  });
  assert.equal(assignRes.status, 200);
  const updatedAssign = await assignRes.json();
  assert.equal(updatedAssign.Version, priorVersion + 1, 'Version must increment on successful assignment update');
  trackSharedAssignment('customer-dispatch', priorAssignment, priorAssignment.AssignmentId, updatedAssign.Version);

  // 5. Test Dedicated New Assignment Lifecycle
  const dedicatedKey = `test-key-${Date.now().toString().slice(-6)}`;
  // Updating non-existent assignment with expectedVersion > 0 -> 404 Not Found
  const notFoundRes = await fetch(`${baseUrl}/api/admin/reports/assignments/${dedicatedKey}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateId: template.TemplateId,
      isActive: true,
      expectedVersion: 1,
      reason: 'Non-existent with expectedVersion > 0'
    })
  });
  assert.equal(notFoundRes.status, 404, 'Non-existent assignment with expectedVersion > 0 must return 404');

  // Creating new assignment with expectedVersion undefined -> 200 OK (Version 1)
  const newAssignRes = await fetch(`${baseUrl}/api/admin/reports/assignments/${dedicatedKey}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      templateId: template.TemplateId,
      isActive: true,
      reason: 'Create dedicated assignment'
    })
  });
  assert.equal(newAssignRes.status, 200, 'New assignment creation must return 200');
  const newAssign = await newAssignRes.json();
  assert.equal(newAssign.Version, 1, 'New assignment initial version must be 1');
  trackDedicatedAssignment(dedicatedKey);

  // 6. Resolve template via public /api/reports/customer-dispatch/template
  const resolveRes = await fetch(`${baseUrl}/api/reports/customer-dispatch/template`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(resolveRes.status, 200);
  const resolved = await resolveRes.json();
  assert.equal(resolved.reportKey, 'customer-dispatch');
  assert.equal(resolved.template.assignmentType, 'DIRECT');
  assert.equal(resolved.template.templateCode, tCode);
  assert.equal(resolved.template.header.headerCode, hCode);
  assert.equal(resolved.template.header.companyNameTh, 'เวิลด์เฟอท แม่แบบทดสอบ');
  assert.equal(resolved.template.signatureSalesLabel, 'ผู้ส่งมอบตั๋ว');
});

test('SO-10.5: Report Data Contract Integrity across Archetypes', async () => {
  // Archetype 1: Customer Dispatch & Delivery (`customer-dispatch`)
  const cRes = await fetch(`${baseUrl}/api/reports/customer-dispatch?from=2026-01-01&to=2026-12-31`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(cRes.status, 200, 'customer-dispatch must return 200');
  const cData = await cRes.json();
  assert.ok(Array.isArray(cData.columns), 'Must have columns');
  assert.ok(Array.isArray(cData.rows), 'Must have rows');

  // Verify column typing: identifier columns must NOT be marked numeric
  const docNoCol = cData.columns.find(c => c.key === 'DocuNo');
  if (docNoCol) {
    assert.equal(docNoCol.type, 'identifier', 'DocuNo must be typed identifier to preserve leading zeros');
  }
  const custCodeCol = cData.columns.find(c => c.key === 'CustCode');
  if (custCodeCol) {
    assert.equal(custCodeCol.type, 'identifier', 'CustCode must be typed identifier');
  }

  // Verify weight precision: QtyTon must specify 3 decimal places
  const qtyTonCol = cData.columns.find(c => c.key === 'QtyTon');
  if (qtyTonCol) {
    assert.equal(qtyTonCol.precision, 3, 'QtyTon must have 3 decimal precision');
  }

  // Archetype 2: Daily Weighing Log (`weighbridge-log`) - accessible by warehouse
  const wRes = await fetch(`${baseUrl}/api/reports/weighbridge-log`, {
    headers: { Authorization: `Bearer ${warehouseToken}` }
  });
  assert.equal(wRes.status, 200, 'weighbridge-log must return 200');
  const wData = await wRes.json();
  const movebillCol = wData.columns.find(c => c.key === 'Movebill');
  if (movebillCol) {
    assert.equal(movebillCol.type, 'identifier', 'Movebill must be typed identifier');
  }

  // Archetype 3: Rebate Trail / Coupon Redemption (`cn-rebate`) - accessible by admin
  const rRes = await fetch(`${baseUrl}/api/reports/cn-rebate`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(rRes.status, 200, 'cn-rebate must return 200');
  const rData = await rRes.json();
  const redeemedTonCol = rData.columns.find(c => c.key === 'RedeemedTon');
  if (redeemedTonCol) {
    assert.equal(redeemedTonCol.type, 'quantity', 'RedeemedTon must be typed quantity');
    assert.equal(redeemedTonCol.precision, 3, 'RedeemedTon must have 3 decimal precision');
  }
});

test('SO-10.6: Export XLSX & CSV Endpoints Return Correct Content-Type & Data', async () => {
  // 1. Export CSV
  const csvRes = await fetch(`${baseUrl}/api/reports/customer-dispatch/export?format=csv&from=2026-01-01&to=2026-12-31`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(csvRes.status, 200, 'CSV export must return 200 OK');
  const csvType = csvRes.headers.get('content-type') || '';
  assert.ok(csvType.includes('text/csv'), 'Content-Type must be text/csv');
  const csvBuffer = Buffer.from(await csvRes.arrayBuffer());
  // Verify UTF-8 BOM (0xEF, 0xBB, 0xBF)
  assert.equal(csvBuffer[0], 0xEF, 'BOM byte 1 must be 0xEF');
  assert.equal(csvBuffer[1], 0xBB, 'BOM byte 2 must be 0xBB');
  assert.equal(csvBuffer[2], 0xBF, 'BOM byte 3 must be 0xBF');

  // 2. Export XLSX
  const xlsxRes = await fetch(`${baseUrl}/api/reports/customer-dispatch/export?format=xlsx&from=2026-01-01&to=2026-12-31`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(xlsxRes.status, 200, 'XLSX export must return 200 OK');
  const xlsxType = xlsxRes.headers.get('content-type') || '';
  assert.ok(
    xlsxType.includes('spreadsheetml.sheet') || xlsxType.includes('octet-stream'),
    'Content-Type must be spreadsheetml.sheet'
  );
  const xlsxBuffer = Buffer.from(await xlsxRes.arrayBuffer());
  // Verify PK zip header (0x50, 0x4B)
  assert.equal(xlsxBuffer[0], 0x50, 'PK zip header byte 1 must be 0x50');
  assert.equal(xlsxBuffer[1], 0x4B, 'PK zip header byte 2 must be 0x4B');
});

test('SO-10.7: Atomic Cleanup Intervening Edit Test', async () => {
  await runWithTarget('remote_b', async () => {
    // We simulate an intervening edit by manually bumping the version of a tracked assignment
    const { recordset } = await wfQuery(`SELECT * FROM wf.ReportTemplateAssignment WHERE ReportKey = 'customer-dispatch'`);
    const assign = recordset[0];
    if (!assign) {
      // If customer-dispatch isn't there, skip (though it should be tracked by SO-10.4)
      return;
    }
    
    // Simulate an intervening edit by another process
    await wfQuery(`UPDATE wf.ReportTemplateAssignment SET Version = Version + 1, UpdatedBy = 'TEST', UpdatedAt = SYSUTCDATETIME() WHERE AssignmentId = @aId`, {
      aId: { type: sql.Int, value: assign.AssignmentId }
    });
    
    // cleanTrackedEntities should throw an error containing 'Cleanup conflict' because the version does not match
    await assert.rejects(
      cleanTrackedEntities(),
      /Cleanup conflict.*Restoration failed/
    );

    // Revert the simulated edit so normal cleanup can succeed
    await wfQuery(`UPDATE wf.ReportTemplateAssignment SET Version = Version - 1, UpdatedBy = 'TEST', UpdatedAt = SYSUTCDATETIME() WHERE AssignmentId = @aId`, {
      aId: { type: sql.Int, value: assign.AssignmentId }
    });
  });
});

test('SO-10.8: Audit Rollback on Master Mutation Failure', async () => {
  await runWithTarget('remote_b', async () => {
    const testKey = 'audit-rollback-test';
    
    // Ensure clear start
    await wfQuery(`DELETE FROM wf.ReportTemplateAssignment WHERE ReportKey = @key`, { key: { type: sql.VarChar(50), value: testKey } });
    await wfQuery(`DELETE FROM wf.ChangeEvent WHERE EntityType = 'REPORT_ASSIGNMENT' AND EntityId = 'some-id'`);
    
    try {
      await wfTransaction(async (tx) => {
        // Master mutation
        const req1 = tx.request();
        req1.input('key', sql.VarChar(50), testKey);
        await req1.query(`
          INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, Version, UpdatedBy, UpdatedAt)
          VALUES (@key, 1, 1, 1, 'TEST', SYSUTCDATETIME())
        `);
        
        // Audit mutation with forced constraint failure
        // Action is VARCHAR(30). A string longer than 30 chars will throw 'String or binary data would be truncated'.
        const tooLongString = 'THIS_ACTION_STRING_IS_WAY_TOO_LONG_FOR_THE_COLUMN_WHICH_WILL_CAUSE_A_SQL_ERROR';
        const req2 = tx.request();
        req2.input('act', sql.VarChar(100), tooLongString);
        await req2.query(`
          INSERT INTO wf.ChangeEvent (EntityType, EntityId, Action, UserId)
          VALUES ('REPORT_ASSIGNMENT', 'some-id', @act, 1)
        `);
      });
      assert.fail('Transaction should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('String or binary data would be truncated') || e.message.includes('truncated'), 'Should throw truncation error: ' + e.message);
    }

    // Verify Master is rolled back
    const masterRes = await wfQuery(`SELECT * FROM wf.ReportTemplateAssignment WHERE ReportKey = @key`, { key: { type: sql.VarChar(50), value: testKey } });
    assert.equal(masterRes.recordset.length, 0, 'Master mutation should be rolled back');
    
    // Verify Audit is rolled back (no ghost audit)
    const auditRes = await wfQuery(`SELECT * FROM wf.ChangeEvent WHERE EntityType = 'REPORT_ASSIGNMENT' AND EntityId = 'some-id'`);
    assert.equal(auditRes.recordset.length, 0, 'Audit mutation should be rolled back');
  });
});

