"use strict";
const { wfQuery, sql } = require("../db");
const {
  ROLES,
  ACTIONS,
  capabilitiesFor,
  userRoles,
  hasPermission,
  featureEnabled,
} = require("./role-capabilities");
const EDITABLE = Object.keys(ACTIONS);
function parseProfile(input) {
  const { code, name, baseRole, expectedRevision } = input || {};
  const isSep = code === "SEPARATION";
  const validBaseRole = ROLES.includes(baseRole) || (isSep && (baseRole === "NONE" || baseRole === "SEPARATION"));
  if (
    !/^[A-Z][A-Z0-9_]{1,29}$/.test(code || "") ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    !validBaseRole ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  )
    return null;
  let permissions = input.permissions;
  if (
    !permissions &&
    Array.isArray(input.disabledActions) &&
    input.disabledActions.every(
      (k) => EDITABLE.includes(k) && ACTIONS[k].includes(baseRole),
    )
  )
    permissions = EDITABLE.filter(
      (k) =>
        ACTIONS[k].includes(baseRole) && !input.disabledActions.includes(k),
    );
  if (
    !Array.isArray(permissions) ||
    permissions.some((k) => !EDITABLE.includes(k))
  )
    return null;
  if (ROLES.includes(code) && code !== baseRole) return null;
  return {
    code,
    name: name.trim(),
    baseRole,
    permissions: [...new Set(permissions)],
    expectedRevision,
  };
}
async function profiles() {
  const r =
    await wfQuery(`SELECT p.Code,p.Name,p.BaseRole,p.Revision,g.PermissionCode,
    (SELECT COUNT(*) FROM wf.vUserRole u WHERE u.RoleCode=p.Code) AS MemberCount
    FROM wf.RoleProfile p LEFT JOIN wf.RolePermission g ON g.RoleCode=p.Code ORDER BY p.Code,g.PermissionCode`);
  const map = new Map();
  for (const row of r.recordset) {
    if (!map.has(row.Code))
      map.set(row.Code, {
        Code: row.Code,
        Name: row.Name,
        BaseRole: row.BaseRole,
        Revision: row.Revision,
        MemberCount: row.MemberCount,
        permissions: [],
      });
    if (row.PermissionCode)
      map.get(row.Code).permissions.push(row.PermissionCode);
  }
  return [...map.values()];
}
async function resolveProfile(code) {
  return (await profiles()).find((p) => p.Code === code) || null;
}
async function sessionProfile(user, payload) {
  const r = await wfQuery(
    "IF COL_LENGTH('wf.AppUser','AuthVersion') IS NULL SELECT 1 AS PolicySchemaMissing ELSE EXEC sp_executesql N'SELECT Role,RoleCode,AuthVersion,MustChangePassword,IsActive FROM wf.AppUser WHERE Id=@id',N'@id int',@id=@id",
    { id: { type: sql.Int, value: Number(user.id) } },
  );
  const row = r.recordset?.[0];
  if (row?.PolicySchemaMissing === 1) return user;
  const reject = (code, status) => {
    throw Object.assign(new Error(code), { status });
  };
  if (!row || !row.Role || !row.IsActive || row.Role === 'SEPARATION' || row.RoleCode === 'SEPARATION') reject("ACCOUNT_UNAVAILABLE", 401);
  if (Number(payload.authVersion || 0) !== Number(row.AuthVersion || 0))
    reject("SESSION_REVOKED", 401);
  const assignments = (
    await wfQuery(
      `SELECT p.Code,p.BaseRole,g.PermissionCode FROM wf.vUserRole u
    JOIN wf.RoleProfile p ON p.Code=u.RoleCode LEFT JOIN wf.RolePermission g ON g.RoleCode=p.Code WHERE u.UserId=@id`,
      { id: { type: sql.Int, value: Number(user.id) } },
    )
  ).recordset;
  if (!assignments.length || assignments.some((p) => p.Code === 'SEPARATION')) reject("ROLE_UNAVAILABLE", 403);
  return {
    ...user,
    role: row.Role,
    roleCode: row.RoleCode || row.Role,
    roleCodes: [...new Set(assignments.map((p) => p.Code))],
    roles: [...new Set(assignments.map((p) => p.BaseRole))],
    permissions: [
      ...new Set(assignments.map((p) => p.PermissionCode).filter(Boolean)),
    ],
    mustChangePassword: Boolean(row.MustChangePassword),
  };
}
const MENU_PERMISSION = {
  admin: "users.manage",
  roles: "roles.manage",
  "app-settings": "settings.manage",
  "trip-board": "trip.view",
  quotation: "quotation.manage",
};
function filteredCapabilities(user) {
  if (userRoles(user).includes('SEPARATION')) {
    return { menus: [], actions: [] };
  }
  const inherited = new Set(
    userRoles(user).flatMap(
      (r) => capabilitiesFor(r, { positionCode: user.positionCode }).menus,
    ),
  );
  for (const [menu, permission] of Object.entries(MENU_PERMISSION)) {
    if (hasPermission(user, permission)) inherited.add(menu);
    else inherited.delete(menu);
  }
  if (
    ["so.create", "so.edit", "so.confirm"].some((k) => hasPermission(user, k))
  )
    inherited.add("sales");
  if (hasPermission(user, "quotation.create")) inherited.add("quotation");
  if (
    [
      "so.verify",
      "so.approve-native",
      "so.create-native-delivery",
      "credit.approve-native",
      "invoice.post-native",
    ].some((k) => hasPermission(user, k))
  )
    inherited.add("papertrail");
  if (hasPermission(user, "coupon.manual116")) inherited.add("control-ticket");
  return {
    menus: [...inherited],
    actions: Object.keys(ACTIONS).filter(
      (k) => hasPermission(user, k) && featureEnabled(k),
    ),
  };
}
module.exports = {
  EDITABLE,
  parseProfile,
  profiles,
  resolveProfile,
  sessionProfile,
  filteredCapabilities,
};
