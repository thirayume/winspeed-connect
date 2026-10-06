/**
 * visible-scope.js — one data-scoping rule for every list and detail endpoint (R12 O-4).
 *
 * Owner rule (O-4, 2026-10-05): everyone sees only their own records, except team leads,
 * who also see their team members' records according to the Organization Chart — the same
 * way as coupons and rebate.
 *
 * Owner confirmed the rows below on 2026-10-06 (SHARED-CONTEXT §123.4):
 *   ADMIN, C_LEVEL, ACCOUNTING   → all records
 *   WAREHOUSE, WEIGHBRIDGE, COUNTER_SALES, APPROVER → all records too: their job is to load,
 *                                  weigh, verify or approve everyone's bills
 *   user with a PositionCode     → own + every position BELOW it in wf.OrgPosition
 *                                  (ReportsTo tree, recursive) — basis ORG. People who share
 *                                  the same position do not see each other's records.
 *   MANAGER without a position   → all records, basis MANAGER_UNMAPPED, until placed on the
 *                                  Organization Chart. The team of a manager is defined only by the
 *                                  Organization Chart; until the manager is placed on it there is
 *                                  no team to filter by, and self-only would hide every approval
 *                                  (price edits, rebate claims, unlock requests) from managers.
 *                                  wf.UserSaleArea cannot stand in: on 2026-10-06 only the three
 *                                  managers had rows there, no sales user did.
 *   anyone else without position → own records only — basis OWN
 *
 * "Own" = the bill's sales user (wf.SalesOrder.SalesUserId / native SOHD.EmpID mapped to
 * wf.AppUser.EmpId). Under Access As the scope is the impersonated (effective) user's,
 * because req.user carries the effective identity.
 */
const { sql, wfQuery } = require('../db');

const ALL_ROLES = Object.freeze(['ADMIN', 'C_LEVEL', 'ACCOUNTING', 'WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'APPROVER']);

async function getVisibleScope(user, queryFn = wfQuery) {
  const role = String(user?.role || '').toUpperCase();
  const userId = Number(user?.sub ?? user?.id);
  if (ALL_ROLES.includes(role)) return { all: true, basis: 'ALL', userIds: [], empIds: [] };
  if (!userId) return { all: false, basis: 'NONE', userIds: [], empIds: [] };

  const me = (await queryFn(
    `SELECT Id, EmpId, PositionCode FROM wf.AppUser WHERE Id = @id`,
    { id: { type: sql.Int, value: userId } }
  ))?.recordset?.[0] || { Id: userId, EmpId: null, PositionCode: null };

  let rows = [];
  let basis = 'OWN';
  if (me.PositionCode) {
    basis = 'ORG';
    // Start from the positions BELOW the user's own: several people share one position
    // (e.g. every lower-Isan salesperson is SALE-ISAN-L) and must not see each other's records.
    rows = (await queryFn(`
      ;WITH tree AS (
        SELECT PositionCode FROM wf.OrgPosition WHERE ReportsTo = @pos AND PositionCode <> @pos
        UNION ALL
        SELECT p.PositionCode FROM wf.OrgPosition p JOIN tree t ON p.ReportsTo = t.PositionCode
        WHERE p.PositionCode <> @pos
      )
      SELECT u.Id, u.EmpId FROM wf.AppUser u
      WHERE u.Id = @id OR u.PositionCode IN (SELECT PositionCode FROM tree)
      OPTION (MAXRECURSION 32)
    `, { pos: { type: sql.VarChar(30), value: me.PositionCode }, id: { type: sql.Int, value: userId } }))?.recordset || [];
  } else if (role === 'MANAGER') {
    return { all: true, basis: 'MANAGER_UNMAPPED', userIds: [], empIds: [] };
  }
  if (!rows.some(r => Number(r.Id) === userId)) rows.push({ Id: userId, EmpId: me.EmpId });

  const userIds = [...new Set(rows.map(r => Number(r.Id)).filter(Boolean))];
  const empIds = [...new Set(rows.map(r => r.EmpId).filter(v => v != null && String(v).trim() !== '').map(v => String(v).trim()))];
  return { all: false, basis, userIds, empIds };
}

/**
 * SQL filter for a scope. Pass the column names that identify the owner:
 *   userCol — app user id column (e.g. so.SalesUserId)
 *   empCol  — WINSpeed EmpID column (e.g. hd.EmpID)
 * Returns { sql: '(...)', inputs } — '1=1' for ALL, '1=0' when nothing is visible.
 */
function scopeFilter(scope, { userCol = null, empCol = null, prefix = 'scope' } = {}) {
  if (!scope || scope.all) return { sql: '1=1', inputs: {} };
  const parts = [];
  const inputs = {};
  if (userCol && scope.userIds.length) {
    const names = scope.userIds.map((id, i) => { inputs[`${prefix}U${i}`] = { type: sql.Int, value: id }; return `@${prefix}U${i}`; });
    parts.push(`${userCol} IN (${names.join(', ')})`);
  }
  if (empCol && scope.empIds.length) {
    const names = scope.empIds.map((id, i) => { inputs[`${prefix}E${i}`] = { type: sql.VarChar(20), value: id }; return `@${prefix}E${i}`; });
    parts.push(`CAST(${empCol} AS VARCHAR(20)) IN (${names.join(', ')})`);
  }
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '1=0', inputs };
}

/** True when a record owned by (userId, empId) is visible in the scope. */
function inScope(scope, { userId = null, empId = null, extraUserIds = [] } = {}) {
  if (!scope || scope.all) return true;
  const ids = [userId, ...extraUserIds].filter(v => v != null).map(Number);
  if (ids.some(id => scope.userIds.includes(id))) return true;
  return empId != null && scope.empIds.includes(String(empId).trim());
}

// Roles that key bills on behalf of another salesperson (routes/so.js resolveSalesOwner):
// they need that salesperson's quota and giveaway list while keying.
const ENTER_FOR_OTHERS_ROLES = Object.freeze(['ADMIN', 'C_LEVEL', 'MANAGER', 'COUNTER_SALES']);

/**
 * May this user read data that belongs to another sales user (quota, giveaway goods)?
 * Self always; roles that key bills for others; otherwise only users inside the scope.
 */
async function canViewSalesUser(user, targetUserId, queryFn = wfQuery) {
  const self = Number(user?.sub ?? user?.id);
  const target = Number(targetUserId);
  if (!target || target === self) return true;
  if (ENTER_FOR_OTHERS_ROLES.includes(String(user?.role || '').toUpperCase())) return true;
  return inScope(await getVisibleScope(user, queryFn), { userId: target });
}

/** Sync form of the ALL rule, for places that already know the user's PositionCode. */
function seesAllRecords(role, positionCode) {
  const r = String(role || '').toUpperCase();
  return ALL_ROLES.includes(r) || (r === 'MANAGER' && !positionCode);
}

module.exports = { ALL_ROLES, ENTER_FOR_OTHERS_ROLES, getVisibleScope, scopeFilter, inScope, seesAllRecords, canViewSalesUser };
