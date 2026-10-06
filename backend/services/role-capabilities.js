/**
 * role-capabilities.js — single source of truth for roles (R12 item 3).
 *
 * MENUS: which roles see each sidebar menu. Every menu listed here is backed by
 *        an API the role can call, so a visible menu never ends in a 403.
 * ACTIONS: key buttons/writes; the routes guard with requireCapability(action)
 *        and the frontend reads the same list from /api/auth/me (capabilities).
 * RANK:  used by Access As and user management (actor may act on lower or equal
 *        rank for Access As; user management needs a strictly lower rank).
 */

const ROLES = Object.freeze([
  'SALES', 'COUNTER_SALES', 'APPROVER', 'WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN',
]);

// WAREHOUSE / WEIGHBRIDGE sit below ACCOUNTING (O-1): ADMIN/C_LEVEL can Access As every role.
const ROLE_RANK = Object.freeze({
  SALES: 1,
  WEIGHBRIDGE: 1,
  COUNTER_SALES: 2,
  WAREHOUSE: 2,
  APPROVER: 3,
  ACCOUNTING: 4,
  MANAGER: 5,
  C_LEVEL: 6,
  ADMIN: 7,
});

// O-5: senior operators keep Access As
const ACCESS_AS_ACTOR_ROLES = Object.freeze(['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'COUNTER_SALES']);

const ALL = ROLES;
const MENUS = Object.freeze({
  dashboard: ALL,
  sales: ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'trip-board': ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  voucher: ['SALES', 'COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'edit-requests': ['SALES', 'COUNTER_SALES', 'APPROVER', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  quotation: ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  store: ['COUNTER_SALES', 'WAREHOUSE', 'C_LEVEL', 'ADMIN'],
  // verify (COUNTER_SALES/MANAGER), unlock review (ACCOUNTING), ship / weigh-item (WAREHOUSE/WEIGHBRIDGE) live on Paper Trail
  papertrail: ['COUNTER_SALES', 'WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'control-ticket': ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'],
  'scale-reports': ['WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  aging: ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'],
  rebate: ['SALES', 'APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'rebate-plan': ['APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  giveaway: ['SALES', 'APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  accounting: ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  recon: ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  // O-4: reports show company-wide rows → only users who see all records. A MANAGER sees all
  // until placed on the Organization Chart; capabilitiesFor drops it once they have a position.
  reports: ['APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  master: ['C_LEVEL', 'ADMIN'],
  policy: ['MANAGER', 'C_LEVEL', 'ADMIN'],
  ops: ['MANAGER', 'C_LEVEL', 'ADMIN'],
  admin: ['ACCOUNTING', 'MANAGER', 'ADMIN'],
  org: ['ACCOUNTING', 'MANAGER', 'ADMIN'],
  beneficiaries: ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
});

const ACTIONS = Object.freeze({
  'so.create': ['SALES', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  'so.edit': ['SALES', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  'so.cancel': ['SALES', 'C_LEVEL', 'ADMIN'],
  'so.verify': ['COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'so.confirm': ['SALES', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  'trip.view': ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'quotation.create': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'quotation.manage': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'edit-request.create': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  // O-3: ACCOUNTING may run Settle Cuts and settle manually
  'coupon.settle': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'giveaway.borrow': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'giveaway.budget': ['MANAGER', 'ADMIN'],
  'users.manage': ['ACCOUNTING', 'MANAGER', 'ADMIN'],
  'access-as': ACCESS_AS_ACTOR_ROLES,
});

function capabilitiesFor(role, { positionCode = null } = {}) {
  const r = String(role || '').toUpperCase();
  const teamScoped = r === 'MANAGER' && Boolean(positionCode);
  return {
    menus: Object.keys(MENUS).filter(k => MENUS[k].includes(r) && !(teamScoped && k === 'reports')),
    actions: Object.keys(ACTIONS).filter(k => ACTIONS[k].includes(r)),
  };
}

function rolesFor(action) {
  const roles = ACTIONS[action];
  if (!roles) throw new Error(`unknown capability: ${action}`);
  return roles;
}

function roleRank(role) {
  return ROLE_RANK[String(role || '').toUpperCase()] || 0;
}

module.exports = { ROLES, ROLE_RANK, ACCESS_AS_ACTOR_ROLES, MENUS, ACTIONS, capabilitiesFor, rolesFor, roleRank };
