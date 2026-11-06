'use strict';
const { wfQuery, sql } = require('../db');
const { ROLES, ACTIONS, capabilitiesFor } = require('./role-capabilities');
// Only capabilities enforced by API middleware are editable. Business scope/ranks remain inherited.
const EDITABLE = Object.keys(ACTIONS).filter(
  (k) =>
    ![
      'access-as',
      'database.switch',
      'database.set-system',
      'edit-request.create',
      'giveaway.borrow',
    ].includes(k),
);
function parseProfile(input) {
  const { code, name, baseRole, disabledActions, expectedRevision } = input || {};
  if (
    !/^[A-Z][A-Z0-9_]{1,29}$/.test(code || '') ||
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 100 ||
    !ROLES.includes(baseRole) ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  )
    return null;
  if (
    !Array.isArray(disabledActions) ||
    disabledActions.some((k) => !EDITABLE.includes(k) || !ACTIONS[k].includes(baseRole))
  )
    return null;
  if (ROLES.includes(code) && code !== baseRole) return null;
  if (baseRole === 'ADMIN' && !ROLES.includes(code)) return null;
  if (code === 'ADMIN' && disabledActions.length) return null;
  return {
    code,
    name: name.trim(),
    baseRole,
    disabledActions: [...new Set(disabledActions)],
    expectedRevision,
  };
}
async function profiles() {
  const r = await wfQuery('SELECT Code, Name, BaseRole, DisabledActions, Revision FROM wf.RoleProfile');
  return r.recordset.map((p) => ({ ...p, disabledActions: JSON.parse(p.DisabledActions) }));
}
async function resolveProfile(code) {
  const all = await profiles(),
    found = all.find((p) => p.Code === code);
  if (found) return found;
  if (ROLES.includes(code))
    return { Code: code, Name: code, BaseRole: code, disabledActions: [], Revision: 0 };
  return null;
}
async function sessionProfile(user, payload) {
  // Allows a rollout before this additive migration; new management endpoints require migration.
  const r = await wfQuery(
    "IF COL_LENGTH('wf.AppUser','AuthVersion') IS NULL SELECT 1 AS PolicySchemaMissing ELSE EXEC sp_executesql N'SELECT Role, RoleCode, AuthVersion, MustChangePassword, IsActive FROM wf.AppUser WHERE Id=@id',N'@id int',@id=@id",
    { id: { type: sql.Int, value: Number(user.id) } },
  );
  const row = r.recordset?.[0];
  if (row?.PolicySchemaMissing === 1) return user;
  if (!row || !row.Role || !row.IsActive) {
    const e = new Error('ACCOUNT_UNAVAILABLE');
    e.status = 401;
    throw e;
  }
  if (Number(payload.authVersion || 0) !== Number(row.AuthVersion || 0)) {
    const e = new Error('SESSION_REVOKED');
    e.status = 401;
    throw e;
  }
  const p = await resolveProfile(row.RoleCode || row.Role);
  if (!p || p.BaseRole !== row.Role) {
    const e = new Error('ROLE_UNAVAILABLE');
    e.status = 403;
    throw e;
  }
  return {
    ...user,
    role: row.Role,
    roleCode: p.Code,
    disabledActions: p.disabledActions,
    mustChangePassword: Boolean(row.MustChangePassword),
  };
}
function filteredCapabilities(user) {
  const c = capabilitiesFor(user.role, { positionCode: user.positionCode });
  const disabled = user.disabledActions || [];
  return {
    ...c,
    menus: c.menus.filter(
      (k) =>
        !(k === 'admin' && disabled.includes('users.manage')) &&
        !(k === 'trip-board' && disabled.includes('trip.view')),
    ),
    actions: c.actions.filter((k) => !disabled.includes(k)),
  };
}
module.exports = { EDITABLE, parseProfile, profiles, resolveProfile, sessionProfile, filteredCapabilities };
