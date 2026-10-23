'use strict';
// Initial-only UAT2 contract. This is not the below-price or credit-override policy.
const { createHash } = require('crypto');
const { sql, wfTransaction, wfQuery } = require('../db');
const { getVisibleScope, inScope } = require('./visible-scope');
const { rolesFor, roleRank, ACCESS_AS_ACTOR_ROLES } = require('./role-capabilities');
const POLICY = 'O11-AI-INITIAL-UAT2-v1';
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const idInput = id => ({ soid: { type: sql.Int, value: id } });
function queryFor(tx) {
  return async (text, inputs = {}) => {
    const r = tx.request();
    for (const [key, { type, value }] of Object.entries(inputs)) r.input(key, type, value);
    return r.query('SET ARITHABORT ON; SET ANSI_WARNINGS ON; ' + text);
  };
}
async function assertTarget(query) {
  const row = (await query(`SELECT CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName')) AS ServerName,
    DB_NAME() AS DbName, DB_ID() AS DbId`)).recordset?.[0];
  if (row?.ServerName !== 'AMYOU-YOGA7\\V2008R2' || row?.DbName !== 'dbwins_worldfert9_uat2' || Number(row?.DbId) !== 10) fail('AI_TARGET_NOT_SUPPORTED', 403);
}
// XML preserves exact native decimal/date/null values, rather than hashing JS floats.
// Only fixed table names enter this SQL; the document ID is always parameterized.
async function nativeFingerprint(query, soid) {
  const parts = [];
  for (const [table, order] of [['SOHD', 'SOID'], ['SODT', 'ListNo'], ['SOHDRemark', 'ListNo'], ['SODTRemark', 'ListNo, RefListNo']]) {
    const r = await query(`SELECT COALESCE(CONVERT(NVARCHAR(MAX),(SELECT * FROM dbo.${table} WITH (UPDLOCK,HOLDLOCK)
      WHERE SOID=@soid ORDER BY ${order} FOR XML RAW, BINARY BASE64, ELEMENTS XSINIL)),N'') AS Snapshot`, idInput(soid));
    if (typeof r.recordset?.[0]?.Snapshot !== 'string') fail('AI_SNAPSHOT_UNAVAILABLE', 503);
    parts.push(r.recordset[0].Snapshot);
  }
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}
async function captureBookingOrigin({ query, soid, sourceDraftId, salesUserId, user }) {
  if (process.env.NATIVE_BOOKING_AI_ENABLED !== 'true') return false;
  await assertTarget(query);
  const exists = (await query("SELECT OBJECT_ID('wf.NativeBookingOrigin','U') AS OriginTable")).recordset?.[0]?.OriginTable;
  if (!exists) fail('AI_ORIGIN_REQUIRED', 503);
  const fingerprint = await nativeFingerprint(query, Number(soid));
  await query(`INSERT INTO wf.NativeBookingOrigin
    (SOID,SourceDraftId,SalesUserId,ConfirmedById,ConfirmedActorId,Fingerprint,PolicyVersion)
    VALUES (@soid,@draft,@sales,@effective,@actor,@fingerprint,@policy)`, {
    ...idInput(Number(soid)), draft: { type: sql.Int, value: Number(sourceDraftId) },
    sales: { type: sql.Int, value: Number(salesUserId) },
    effective: { type: sql.Int, value: Number(user.sub) },
    actor: { type: sql.Int, value: Number(user.actorSub || user.sub) },
    fingerprint: { type: sql.VarChar(64), value: fingerprint }, policy: { type: sql.VarChar(40), value: POLICY },
  });
  return true;
}
async function identity(query, user) {
  const effective = Number(user?.sub), actor = Number(user?.actorSub || user?.sub);
  if (![effective, actor].every(n => Number.isSafeInteger(n) && n > 0)) fail('AI_ACTOR_INVALID', 401);
  const rows = (await query(`SELECT Id,Role,IsActive,MustChangePassword,EmpId,Username FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK)
    WHERE Id IN (@effective,@actor)`, { effective: { type: sql.Int, value: effective }, actor: { type: sql.Int, value: actor } })).recordset || [];
  const current = rows.find(r => Number(r.Id) === effective), real = rows.find(r => Number(r.Id) === actor);
  if (![current, real].every(r => r && (r.IsActive === true || r.IsActive === 1) && !r.MustChangePassword)) fail('AI_ACTOR_UNAVAILABLE', 403);
  if (current.Role !== user.role || real.Role !== (user.actorRole || user.role)) fail('AI_ROLE_CHANGED', 403);
  if (!rolesFor('so.approve-native').includes(current.Role)) fail('AI_ROLE_FORBIDDEN', 403);
  if (actor !== effective && (!ACCESS_AS_ACTOR_ROLES.includes(real.Role) || roleRank(real.Role) < roleRank(current.Role))) fail('AI_ACCESS_AS_FORBIDDEN', 403);
  const empId = Number(current.EmpId);
  if (!Number.isSafeInteger(empId) || empId <= 0) fail('AI_APPROVER_EMPLOYEE_REQUIRED', 409);
  return { effective, actor, empId };
}
function publicReceipt(row, replayed) {
  return { soid: row.SOID, approvalNo: row.ApprovalNo, approvedAt: row.ApprovedAt,
    effectiveApproverId: row.ApproverId, actualApproverId: row.ApproverActorId,
    selfApproval: Boolean(row.SelfApproval), policyVersion: row.PolicyVersion, replayed };
}
async function initialBookingAi({ soid, user, fingerprint, requestId, preview = false }, options = {}) {
  const enabled = options.enabled ?? (process.env.NATIVE_BOOKING_AI_ENABLED === 'true');
  if (!enabled) fail('AI_NOT_ENABLED', 503);
  if (!Number.isSafeInteger(Number(soid)) || Number(soid) <= 0 || !/^\d+$/.test(String(soid))) fail('AI_BOOKING_ID_INVALID', 400);
  if (!preview && (!/^[a-f0-9]{64}$/.test(String(fingerprint || '')) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(requestId || '')))) fail('AI_REQUEST_INVALID', 400);
  return (options.transaction || wfTransaction)(async tx => {
    const query = queryFor(tx);
    await assertTarget(query);
    const who = await identity(query, user);
    // Consistent lock order for app confirmations/approval writes. Native row locks below
    // still matter: WinSpeed itself does not participate in the application's applock.
    const locked = (await query(`DECLARE @r INT;
      EXEC @r=sp_getapplock @Resource='WF_INITIAL_BOOKING_AI',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
      SELECT @r AS LockResult`)).recordset?.[0]?.LockResult;
    if (!(Number(locked) >= 0)) fail('AI_BUSY');
    const row = (await query(`SELECT h.SOID,h.DocuNo,h.EmpID,e.SalesUserId,h.AppvFlag,h.AppvDocuNo,h.Appvid
      FROM dbo.SOHD h WITH (UPDLOCK,HOLDLOCK) LEFT JOIN wf.SalesOrderExt e WITH (UPDLOCK,HOLDLOCK) ON e.SOID=CAST(h.SOID AS VARCHAR(50))
      WHERE h.SOID=@soid AND h.DocuType=103`, idInput(Number(soid)))).recordset?.[0];
    const scope = await getVisibleScope(user, query);
    if (!row || !inScope(scope, { userId: row.SalesUserId, empId: row.EmpID })) fail('AI_BOOKING_NOT_FOUND', 404);
    const old = (await query('SELECT * FROM wf.NativeBookingApproval WITH (UPDLOCK,HOLDLOCK) WHERE SOID=@soid', idInput(Number(soid)))).recordset?.[0];
    if (old) {
      if (preview) fail('AI_ALREADY_APPROVED');
      if (old.RequestId !== requestId || old.Fingerprint !== fingerprint || Number(old.ApproverId) !== who.effective || Number(old.ApproverActorId) !== who.actor) fail('AI_REQUEST_CONFLICT');
      if (row.AppvFlag !== 'Y' || row.AppvDocuNo !== old.ApprovalNo || Number(row.Appvid) !== Number(old.ApproverEmpId)) fail('AI_RECEIPT_DIVERGED');
      return publicReceipt(old, true);
    }
    const origin = (await query('SELECT * FROM wf.NativeBookingOrigin WITH (UPDLOCK,HOLDLOCK) WHERE SOID=@soid', idInput(Number(soid)))).recordset?.[0];
    if (!origin || origin.PolicyVersion !== POLICY) fail('AI_ORIGIN_REQUIRED');
    const current = await nativeFingerprint(query, Number(soid));
    if (current !== origin.Fingerprint) fail('AI_BOOKING_CHANGED');
    // The same procedure validates the narrow contract in preview and apply. Preview
    // executes no UPDATE/INSERT/allocator and cannot reserve a document number.
    const p = { ...idInput(Number(soid)), userId: { type: sql.Int, value: who.effective }, actorId: { type: sql.Int, value: who.actor },
      empId: { type: sql.Int, value: who.empId }, preview: { type: sql.Bit, value: preview },
      requestId: { type: sql.VarChar(36), value: preview ? null : requestId },
      fingerprint: { type: sql.VarChar(64), value: current } };
    if (!preview && current !== fingerprint) fail('AI_PREVIEW_STALE');
    const result = await query(`EXEC wf.usp_ApproveInitialBooking @SOID=@soid,@UserId=@userId,@ActorId=@actorId,
      @EmpId=@empId,@Preview=@preview,@RequestId=@requestId,@Fingerprint=@fingerprint`, p);
    const receipt = result.recordset?.[0];
    if (!receipt) fail('AI_RECEIPT_UNAVAILABLE', 503);
    return preview ? { soid: Number(soid), docuNo: row.DocuNo, fingerprint: current,
      effectiveApproverId: who.effective, actualApproverId: who.actor, approverEmpId: who.empId,
      selfApproval: Number(origin.ConfirmedActorId) === who.actor, policyVersion: POLICY } : publicReceipt(receipt, false);
  });
}
function aiHttpError(e) {
  if (e.status && /^AI_[A-Z_]+$/.test(e.code || '')) return { status: e.status, code: e.code };
  const known = /\b(AI_(?:CONTRACT_UNSUPPORTED|BOOKING_UNAVAILABLE|COUNTER_UNSUPPORTED|NUMBER_EXHAUSTED|NUMBER_COLLISION|APPROVER_INVALID|ORIGIN_REQUIRED|REQUEST_CONFLICT|TARGET_NOT_SUPPORTED))\b/.exec(String(e.message || ''));
  return known ? { status: 409, code: known[1] } : { status: 503, code: 'AI_APPROVAL_FAILED' };
}
// The pilot ends at AI. Until 104/116 are implemented and verified together, a
// pilot receipt must not unlock the legacy shipping path, even after the flag is off.
async function assertInitialAiShipmentReady(soid, query = wfQuery) {
  try {
    const has = (await query("SELECT CASE WHEN OBJECT_ID('wf.NativeBookingApproval','U') IS NULL THEN 0 ELSE 1 END AS HasAiReceipts")).recordset?.[0]?.HasAiReceipts;
    if (has === 0) return;
    if (has !== 1) fail('AI_READINESS_UNAVAILABLE', 503);
    const receipt = (await query('SELECT SOID FROM wf.NativeBookingApproval WHERE SOID=@soid', idInput(Number(soid)))).recordset?.[0];
    if (receipt) fail('AI_DOWNSTREAM_NOT_READY', 409);
  } catch (e) {
    if (e.code === 'AI_DOWNSTREAM_NOT_READY') throw e;
    fail('AI_READINESS_UNAVAILABLE', 503);
  }
}
module.exports = { POLICY, nativeFingerprint, captureBookingOrigin, initialBookingAi, aiHttpError, assertInitialAiShipmentReady };
