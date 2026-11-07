"use strict";
const { roleRank } = require("./role-capabilities");
async function query(tx, text, params = {}) {
  const q = tx.request();
  for (const [k, v] of Object.entries(params)) q.input(k, v);
  return q.query(text);
}
function error(message, status = 409) {
  return Object.assign(new Error(message), { status });
}
async function lockPolicy(tx, actor, permission) {
  const r = await query(
    tx,
    `DECLARE @result int; EXEC @result=sp_getapplock @Resource='WF_ROLE_POLICY',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
    SELECT @result AS LockResult`,
  );
  if (!(r.recordset?.[0]?.LockResult >= 0))
    throw error("มีผู้ดูแลกำลังแก้สิทธิ์ กรุณาลองใหม่");
  await query(
    tx,
    "SELECT Id FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) ORDER BY Id",
  );
  const check = await query(
    tx,
    "SELECT wf.fn_UserHasPermission(@id,@permission) AS Allowed",
    { id: Number(actor), permission },
  );
  if (!check.recordset?.[0]?.Allowed)
    throw error("สิทธิ์ผู้ทำรายการเปลี่ยน กรุณาเข้าสู่ระบบใหม่", 403);
}
async function assertAdministrator(tx) {
  const r = await query(
    tx,
    `SELECT TOP(1) Id FROM wf.AppUser WHERE IsActive=1 AND
    wf.fn_UserHasPermission(Id,'roles.manage')=1 AND wf.fn_UserHasPermission(Id,'users.manage')=1`,
  );
  if (!r.recordset?.length)
    throw error(
      "ต้องเหลือผู้ใช้ที่ใช้งานอยู่และมีทั้งสิทธิ์จัดการ Role และผู้ใช้อย่างน้อย 1 คน",
    );
}
function changeMembership(current, requested, mode = "replace") {
  if (!["replace", "add", "remove"].includes(mode))
    throw error("รูปแบบการเปลี่ยน Role ไม่ถูกต้อง", 400);
  const next =
    mode === "replace"
      ? requested
      : mode === "add"
        ? [...current, ...requested]
        : current.filter((k) => !requested.includes(k));
  const unique = [...new Set(next)].sort();
  if (!unique.length)
    throw error(
      "ผู้ใช้ต้องมีอย่างน้อย 1 Role กรุณาเพิ่ม Role ใหม่ก่อนลบ Role เดิม",
    );
  return unique;
}
function membershipCodes(value) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    value.some(
      (c) => typeof c !== "string" || !/^[A-Z][A-Z0-9_]{0,29}$/.test(c),
    ) ||
    new Set(value).size !== value.length
  )
    throw error("เลือก Role อย่างน้อย 1 รายการ และห้ามซ้ำ", 400);
  return [...value].sort();
}
async function validateAssignment(tx, codes, callerRole) {
  const rows = (
    await query(
      tx,
      "SELECT Code,BaseRole FROM wf.RoleProfile WITH(UPDLOCK,HOLDLOCK)",
    )
  ).recordset;
  if (codes.some((c) => !rows.some((r) => r.Code === c)))
    throw error("ไม่พบ Role ที่เลือก กรุณาโหลดใหม่", 400);
  const selected = rows.filter((r) => codes.includes(r.Code));
  if (
    callerRole !== "ADMIN" &&
    selected.some((r) => roleRank(r.BaseRole) >= roleRank(callerRole))
  )
    throw error("ไม่สามารถกำหนดบทบาทที่เทียบเท่าหรือสูงกว่าตนเองได้", 403);
  return selected.sort(
    (a, b) =>
      roleRank(b.BaseRole) - roleRank(a.BaseRole) ||
      a.Code.localeCompare(b.Code),
  )[0];
}
async function setMembership(tx, id, codes) {
  const rows = (
    await query(
      tx,
      "SELECT Code,BaseRole FROM wf.RoleProfile WITH(UPDLOCK,HOLDLOCK)",
    )
  ).recordset;
  if (codes.some((c) => !rows.some((r) => r.Code === c)))
    throw error("ไม่พบ Role ที่เลือก กรุณาโหลดใหม่", 400);
  const primary = rows
    .filter((r) => codes.includes(r.Code))
    .sort(
      (a, b) =>
        roleRank(b.BaseRole) - roleRank(a.BaseRole) ||
        a.Code.localeCompare(b.Code),
    )[0];
  if (!primary) throw error("ผู้ใช้ต้องมีอย่างน้อย 1 Role");
  await query(tx, "DELETE FROM wf.UserRole WHERE UserId=@id", { id });
  for (const code of codes)
    await query(tx, "INSERT wf.UserRole(UserId,RoleCode) VALUES(@id,@code)", {
      id,
      code,
    });
  await query(
    tx,
    "UPDATE wf.AppUser SET Role=@role,RoleCode=@code WHERE Id=@id",
    { id, role: primary.BaseRole, code: primary.Code },
  );
}
module.exports = {
  query,
  error,
  lockPolicy,
  assertAdministrator,
  changeMembership,
  membershipCodes,
  validateAssignment,
  setMembership,
};
