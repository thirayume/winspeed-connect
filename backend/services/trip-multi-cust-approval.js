'use strict';

const crypto = require('crypto');
const { sql, wfQuery } = require('../db');
const { getSettingValue } = require('./policy-contract');
const { resolveApprovalPolicy } = require('./approval');
const { ROLE_RANK } = require('./role-capabilities');

const TRIP_APPROVER_ROLES = Object.freeze(['APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL']);

function readField(row, pascal, camel) {
  if (!row) return undefined;
  return row[pascal] !== undefined ? row[pascal] : row[camel];
}

function camelizeApprovalRow(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.charAt(0).toLowerCase() + k.slice(1)] = v;
  }
  if (typeof out.customerIdsJson === 'string') {
    try { out.customerIds = JSON.parse(out.customerIdsJson); } catch { out.customerIds = []; }
  }
  return out;
}

/**
 * Compute deterministic distinct-customer snapshot for a Sale Trip's active members.
 * Multiple bills for the SAME CustId count as 1 distinct customer.
 */
function computeTripCustomerSnapshot(members = []) {
  const byCustomer = new Map();

  for (const m of (members || [])) {
    const status = String(readField(m, 'Status', 'status') || '').toUpperCase();
    if (status === 'CANCELLED' || status === 'DELETED') continue;

    const rawCustId = String(readField(m, 'CustId', 'custId') || '').trim();
    const rawCustName = String(readField(m, 'CustName', 'custName') || '').trim();
    const custKey = rawCustId || (rawCustName ? `NAME:${rawCustName}` : '');
    if (!custKey) continue;

    const docuNo = String(
      readField(m, 'DocuNo', 'docuNo') ||
      readField(m, 'WfRef', 'wfRef') ||
      readField(m, 'MemberId', 'memberId') ||
      readField(m, 'Id', 'id') ||
      ''
    ).trim();

    if (!byCustomer.has(custKey)) {
      byCustomer.set(custKey, {
        custId: rawCustId || custKey,
        custName: rawCustName || rawCustId || custKey,
        orderCount: 0,
        docuNos: [],
      });
    }
    const entry = byCustomer.get(custKey);
    entry.orderCount += 1;
    if (docuNo && !entry.docuNos.includes(docuNo)) {
      entry.docuNos.push(docuNo);
    }
  }

  const customers = Array.from(byCustomer.values()).sort((a, b) =>
    String(a.custId).localeCompare(String(b.custId))
  );
  const customerIds = customers.map(c => String(c.custId));
  const customerFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(customerIds))
    .digest('hex');

  const rawSummary = customers
    .map(c => `${c.custName}${c.docuNos.length ? ` (${c.docuNos.join(', ')})` : ''}`)
    .join(' · ');
  const customerSummary = rawSummary.length > 980 ? `${rawSummary.slice(0, 977)}...` : rawSummary;

  return {
    customerIds,
    customerCount: customerIds.length,
    customerFingerprint,
    customers,
    customerSummary,
  };
}

async function getMinCustomersThreshold() {
  const raw = await getSettingValue('TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS');
  const n = parseInt(String(raw ?? 2), 10);
  return Number.isInteger(n) && n >= 2 ? Math.min(n, 50) : 2;
}

async function canUserApproveMultiCustTrip(user, totalAmount = null) {
  if (!user || !user.role) {
    return { allowed: false, requiredRole: 'APPROVER', reason: 'ไม่พบสิทธิ์ผู้ใช้งาน' };
  }
  const policy = await resolveApprovalPolicy('MULTI_CUST_TRIP', totalAmount);
  const requiredRole = policy?.RequiredRole || 'APPROVER';
  if (['ADMIN', 'C_LEVEL'].includes(user.role)) {
    return { allowed: true, requiredRole };
  }
  const hasRank = ROLE_RANK[user.role] !== undefined && ROLE_RANK[requiredRole] !== undefined;
  const rankOk = hasRank ? ROLE_RANK[user.role] >= ROLE_RANK[requiredRole] : user.role === requiredRole;
  const roleOk = (TRIP_APPROVER_ROLES.includes(user.role) || user.role === requiredRole) && rankOk;
  if (!roleOk) {
    return {
      allowed: false,
      requiredRole,
      reason: `ต้องให้ผู้มีอำนาจอนุมัติระดับ ${requiredRole} ขึ้นไปเป็นผู้พิจารณาอนุมัติทริปหลายลูกค้า`,
    };
  }
  return { allowed: true, requiredRole };
}

function buildMultiCustTripSummary({ members = [], approvalRows = [], minCustomers = 2 }) {
  const snapshot = computeTripCustomerSnapshot(members);
  const threshold = Number.isInteger(Number(minCustomers)) && Number(minCustomers) >= 2
    ? Math.min(Number(minCustomers), 50)
    : 2;
  const requiresApproval = snapshot.customerCount >= threshold;

  const activeRows = (approvalRows || []).filter(r => String(r.Status || '').toUpperCase() !== 'CANCELLED');
  const latest = activeRows[0] || null;

  let approvalStatus = 'NOT_REQUIRED';
  let isApproved = true;
  let isStale = false;

  if (requiresApproval) {
    if (!latest) {
      approvalStatus = 'REQUIRED';
      isApproved = false;
    } else if (String(latest.CustomerFingerprint || '').trim() !== snapshot.customerFingerprint) {
      approvalStatus = 'REQUIRED';
      isApproved = false;
      isStale = true;
    } else if (latest.Status === 'SUPERSEDED') {
      approvalStatus = 'REQUIRED';
      isApproved = false;
      isStale = true;
    } else {
      approvalStatus = latest.Status;
      isApproved = latest.Status === 'APPROVED';
    }
  }

  return {
    minCustomers: threshold,
    customerCount: snapshot.customerCount,
    customerIds: snapshot.customerIds,
    customerFingerprint: snapshot.customerFingerprint,
    customers: snapshot.customers,
    customerSummary: snapshot.customerSummary,
    requiresApproval,
    approvalStatus,
    isApproved,
    isStale,
    latestApproval: latest ? camelizeApprovalRow(latest) : null,
  };
}

async function fetchTripMultiCustStatus({ tripId, members, minCustomers = null, queryFn = wfQuery }) {
  const threshold = minCustomers ?? await getMinCustomersThreshold();
  let rows = [];
  if (tripId && Number(tripId) > 0) {
    try {
      const r = await queryFn(`
        SELECT TOP 5 a.*,
               ru.DisplayName AS RequestedByName,
               au.DisplayName AS ApprovedByName
        FROM wf.TripMultiCustomerApproval a
        LEFT JOIN wf.AppUser ru ON ru.Id = a.RequestedBy
        LEFT JOIN wf.AppUser au ON au.Id = a.ApprovedBy
        WHERE a.TripId = @tripId
        ORDER BY a.Id DESC
      `, { tripId: { type: sql.Int, value: Number(tripId) } });
      rows = r.recordset || [];
    } catch (e) {
      // Allow pre-migration or legacy unit mocks that do not mount wf.TripMultiCustomerApproval
      if (!/Invalid object name/i.test(String(e.message || ''))) throw e;
    }
  }
  return buildMultiCustTripSummary({ members, approvalRows: rows, minCustomers: threshold });
}

async function assertTripMultiCustApprovedForConfirm({ tx, tripId, resultingMembers }) {
  const threshold = await getMinCustomersThreshold();
  const snapshot = computeTripCustomerSnapshot(resultingMembers);
  if (snapshot.customerCount < threshold) {
    return {
      requiresApproval: false,
      isApproved: true,
      minCustomers: threshold,
      customerCount: snapshot.customerCount,
    };
  }

  const r = await tx.request()
    .input('tripId', sql.Int, Number(tripId))
    .query(`
      SELECT TOP 1 *
      FROM wf.TripMultiCustomerApproval WITH (UPDLOCK, HOLDLOCK)
      WHERE TripId = @tripId AND Status <> 'CANCELLED'
      ORDER BY Id DESC
    `);
  const summary = buildMultiCustTripSummary({
    members: resultingMembers,
    approvalRows: r.recordset || [],
    minCustomers: threshold,
  });

  if (summary.isApproved) {
    return summary;
  }

  let code = 'MULTI_CUST_TRIP_APPROVAL_REQUIRED';
  let message = `ทริปนี้มีลูกค้า ${summary.customerCount} ราย (ตั้งแต่ ${summary.minCustomers} รายขึ้นไป) ต้องส่งขออนุมัติจากผู้มีอำนาจอนุมัติก่อนยืนยันการสั่งซื้อ`;
  if (summary.approvalStatus === 'PENDING') {
    code = 'MULTI_CUST_TRIP_APPROVAL_PENDING';
    message = `คำขออนุมัติทริปหลายลูกค้า (${summary.customerCount} ราย) ยังรอผู้มีอำนาจอนุมัติตรวจสอบ`;
  } else if (summary.approvalStatus === 'REJECTED') {
    code = 'MULTI_CUST_TRIP_APPROVAL_REJECTED';
    message = `คำขออนุมัติทริปหลายลูกค้าถูกปฏิเสธ (${summary.latestApproval?.approvalNote || '-'}) กรุณาปรับแก้ไขหรือส่งขออนุมัติใหม่`;
  } else if (summary.isStale) {
    code = 'MULTI_CUST_TRIP_APPROVAL_STALE';
    message = `รายชื่อลูกค้าในทริปเปลี่ยนแปลงหลังจากส่งขออนุมัติเดิม กรุณาส่งขออนุมัติทริปหลายลูกค้าใหม่อีกครั้ง`;
  }

  throw Object.assign(new Error(message), {
    status: 409,
    code,
    multiCustApproval: summary,
  });
}

async function supersedeStaleTripApprovalsOnMembershipChange(txOrQueryFn, tripId) {
  const numericTripId = Number(tripId);
  if (!Number.isInteger(numericTripId) || numericTripId <= 0) return 0;

  const execQuery = async (text, inputs = {}) => {
    if (typeof txOrQueryFn === 'function') return txOrQueryFn(text, inputs);
    const req = txOrQueryFn.request();
    for (const [k, { type, value }] of Object.entries(inputs)) req.input(k, type, value);
    return req.query(text);
  };

  try {
    const membersRes = await execQuery(`
      SELECT MemberKind, MemberId, DocuNo, CustId, CustName, Status
      FROM wf.v_TripMember
      WHERE TripId = @tripId
    `, { tripId: { type: sql.Int, value: numericTripId } });
    const snapshot = computeTripCustomerSnapshot(membersRes.recordset || []);

    const updRes = await execQuery(`
      UPDATE wf.TripMultiCustomerApproval
      SET Status = 'SUPERSEDED',
          UpdatedAt = SYSUTCDATETIME()
      WHERE TripId = @tripId
        AND Status IN ('PENDING', 'APPROVED')
        AND CustomerFingerprint <> @fp
    `, {
      tripId: { type: sql.Int, value: numericTripId },
      fp: { type: sql.VarChar(64), value: snapshot.customerFingerprint },
    });
    return Number(updRes?.rowsAffected?.[0] || 0);
  } catch (e) {
    if (/Invalid object name/i.test(String(e.message || ''))) return 0;
    throw e;
  }
}

module.exports = {
  TRIP_APPROVER_ROLES,
  camelizeApprovalRow,
  computeTripCustomerSnapshot,
  getMinCustomersThreshold,
  canUserApproveMultiCustTrip,
  buildMultiCustTripSummary,
  fetchTripMultiCustStatus,
  assertTripMultiCustApprovedForConfirm,
  supersedeStaleTripApprovalsOnMembershipChange,
};

