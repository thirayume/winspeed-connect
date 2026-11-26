const {hasRole} = require('./role-capabilities');
/**
 * visible-scope.js — one data-scoping rule for every list and detail endpoint (R12 O-4).
 *
 * Owner rule (O-4, 2026-10-05): everyone sees only their own records, except team leads,
 * who also see their team members' records according to the Organization Chart — the same
 * way as coupons and rebate.
 *
 * Owner, 26 Nov 2026: executives, managers and approvers follow their own
 * organization branch. RecordScope=GLOBAL is an explicit operational-position
 * setting; ADMIN retains global administration. A missing/inactive position
 * never turns a manager into a company-wide reader.
 *   user with a PositionCode     → own + every position BELOW it in wf.OrgPosition
 *                                  (ReportsTo tree, recursive) — basis ORG. People who share
 *                                  the same position do not see each other's records.
 *   Unplaced accounting/warehouse/weighbridge/counter roles retain their
 *   operational fallback until explicitly placed; all other unplaced users are own-only.
 *   anyone else without position → own records only — basis OWN
 *
 * "Own" = the bill's sales user (wf.SalesOrder.SalesUserId / native SOHD.EmpID mapped to
 * wf.AppUser.EmpId). Under Access As the scope is the impersonated (effective) user's,
 * because req.user carries the effective identity.
 */
const { sql, wfQuery } = require('../db');
const { businessIds } = require('./business-identity');

// A role grants actions, not another division's records. Executives/approvers
// follow the organization tree too. Cross-team operational positions are an
// explicit property of the position; ADMIN retains the owner-approved override.
const ALL_ROLES = Object.freeze(['ADMIN']);
const OPERATIONAL_ROLES = Object.freeze(['ACCOUNTING', 'WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES']);

async function getVisibleScope(user,queryFn=wfQuery,options={}){
 if(!businessIds(user).effective)return {all:false,basis:'NONE',userIds:[],empIds:[]};
 const effective=await resolveVisibleScope(user,queryFn,options),actor=require('./business-identity').actorPerspective(user);
 if(actor===user)return effective;
 const actual=await resolveVisibleScope(actor,queryFn,options);
 if(effective.all)return actual;if(actual.all)return effective;
 return {all:false,basis:'ACTOR_INTERSECTION',userIds:effective.userIds.filter(id=>actual.userIds.includes(id)),empIds:effective.empIds.filter(id=>actual.empIds.includes(id)),positionCodes:(effective.positionCodes||[]).filter(code=>(actual.positionCodes||[]).includes(code))};
}

async function resolveVisibleScope(user, queryFn = wfQuery,options={}) {
  const role = String(user?.role || '').toUpperCase();
  const userId = businessIds(user).effective;
  const selectedBranch = require('./request-context').currentOrgBranch?.();
  if (hasRole(user,...ALL_ROLES) && !selectedBranch) return { all: true, basis: 'ALL', userIds: [], empIds: [] };
  if (!userId) return { all: false, basis: 'NONE', userIds: [], empIds: [] };

  const me = (await queryFn(
    `SELECT Id, EmpId, PositionCode FROM wf.AppUser WHERE Id = @id`,
    { id: { type: sql.Int, value: userId } }
  ))?.recordset?.[0] || { Id: userId, EmpId: null, PositionCode: null };

  const ownPosition=me.PositionCode;
  let rows = [];
  let basis = 'OWN';
  const position = me.PositionCode ? (await queryFn(
    'SELECT PositionCode,ReportsTo,RecordScope,IsActive FROM wf.OrgPosition WHERE PositionCode=@pos',
    {pos:{type:sql.VarChar(30),value:me.PositionCode}}
  ))?.recordset?.[0] : null;
  const global = hasRole(user,'ADMIN') || (position?.IsActive && position.RecordScope==='GLOBAL') ||
    (!me.PositionCode && hasRole(user,...OPERATIONAL_ROLES));
  if(global && !selectedBranch)return {all:true,basis:'OPERATIONAL',userIds:[],empIds:[]};
  if(selectedBranch){
    if(!global){
      const allowed=(await queryFn(`;WITH permitted AS (
        SELECT PositionCode FROM wf.OrgPosition WHERE PositionCode=@pos AND IsActive=1
        UNION ALL SELECT p.PositionCode FROM wf.OrgPosition p JOIN permitted t ON p.ReportsTo=t.PositionCode WHERE p.IsActive=1
      ) SELECT PositionCode FROM permitted WHERE PositionCode=@branch OPTION(MAXRECURSION 32)`,{
        pos:{type:sql.VarChar(30),value:me.PositionCode},branch:{type:sql.VarChar(30),value:selectedBranch}
      }))?.recordset||[];
      if(!allowed.length)throw Object.assign(Error('ORG_BRANCH_NOT_VISIBLE'),{status:403,code:'ORG_BRANCH_NOT_VISIBLE'});
    }
    const branch=(await queryFn('SELECT PositionCode,IsActive FROM wf.OrgPosition WHERE PositionCode=@pos',{
      pos:{type:sql.VarChar(30),value:selectedBranch}
    }))?.recordset?.[0];
    if(!branch?.IsActive)throw Object.assign(Error('ORG_BRANCH_NOT_VISIBLE'),{status:403,code:'ORG_BRANCH_NOT_VISIBLE'});
    me.PositionCode=selectedBranch;basis='BRANCH';
  }
  if (me.PositionCode && (selectedBranch || position?.IsActive)) {
    basis = selectedBranch?'BRANCH':'ORG';
    // Start from the positions BELOW the user's own: several people share one position
    // (e.g. every lower-Isan salesperson is SALE-ISAN-L) and must not see each other's records.
    rows = (await queryFn(`
      ;WITH tree AS (
        SELECT PositionCode FROM wf.OrgPosition WHERE ReportsTo = @pos AND PositionCode <> @pos AND IsActive=1
        UNION ALL
        SELECT p.PositionCode FROM wf.OrgPosition p JOIN tree t ON p.ReportsTo = t.PositionCode
        WHERE p.PositionCode <> @pos AND p.IsActive=1
      )
      SELECT u.Id, u.EmpId FROM wf.AppUser u
      WHERE ${selectedBranch&&(global||selectedBranch!==ownPosition)?'(u.PositionCode=@pos OR u.PositionCode IN (SELECT PositionCode FROM tree))':'(u.Id = @id OR u.PositionCode IN (SELECT PositionCode FROM tree))'}
      OPTION (MAXRECURSION 32)
    `, { pos: { type: sql.VarChar(30), value: me.PositionCode }, id: { type: sql.Int, value: userId } }))?.recordset || [];
  }
  if (!selectedBranch && !rows.some(r => Number(r.Id) === userId)) rows.push({ Id: userId, EmpId: me.EmpId });

  // Annual plans belong to the position, including vacant descendant positions.
  // This directory never expands the personal-record IDs.
  let positionCodes=[];
  if(options.includePositions&&me.PositionCode&&(selectedBranch||position?.IsActive)){
    const positions=(await queryFn(`;WITH budgetBranches AS (
      SELECT PositionCode FROM wf.OrgPosition WHERE PositionCode=@pos AND IsActive=1
      UNION ALL SELECT p.PositionCode FROM wf.OrgPosition p JOIN budgetBranches t ON p.ReportsTo=t.PositionCode WHERE p.IsActive=1
    ) SELECT PositionCode FROM budgetBranches OPTION(MAXRECURSION 32)`,{pos:{type:sql.VarChar(30),value:me.PositionCode}}))?.recordset||[];
    positionCodes=[...new Set(positions.map(p=>p.PositionCode).filter(p=>typeof p==='string'&&p.length>0))];
  }
  const userIds = [...new Set(rows.map(r => Number(r.Id)).filter(Boolean))];
  const empIds = [...new Set(rows.map(r => r.EmpId).filter(v => v != null && String(v).trim() !== '').map(v => String(v).trim()))];
  return { all: false, basis, userIds, empIds, positionCodes };
}

/**
 * SQL filter for a scope. Pass the column names that identify the owner:
 *   userCol — app user id column (e.g. so.SalesUserId)
 *   empCol  — WINSpeed EmpID column (e.g. hd.EmpID)
 * Returns { sql: '(...)', inputs } — '1=1' for ALL, '1=0' when nothing is visible.
 */
function scopeFilter(scope, { userCol = null, empCol = null, prefix = 'scope' } = {}) {
  if (!scope) return {sql:'1=0',inputs:{}};
  if (scope.all===true) return { sql: '1=1', inputs: {} };
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
  if (!scope) return false;
  if (scope.all===true) return true;
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
  const self = businessIds(user).effective;
  const target = Number(targetUserId);
  if (!target) return false;
  if (target === self) return true;
  return inScope(await getVisibleScope(user, queryFn), { userId: target });
}

/** Sync form of the ALL rule, for places that already know the user's PositionCode. */
function seesAllRecords(role, positionCode) {
  const r = String(role || '').toUpperCase();
  return ALL_ROLES.includes(r) || (!positionCode && OPERATIONAL_ROLES.includes(r));
}

module.exports = { ALL_ROLES, ENTER_FOR_OTHERS_ROLES, getVisibleScope, scopeFilter, inScope, seesAllRecords, canViewSalesUser };
