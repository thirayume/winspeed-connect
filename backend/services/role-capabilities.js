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
  SEPARATION: 0,
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
  voucher: ['SALES', 'COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'edit-requests': ['SALES', 'COUNTER_SALES', 'APPROVER', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  quotation: ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  store: ['COUNTER_SALES', 'WAREHOUSE', 'C_LEVEL', 'ADMIN'],
  stock: ['WAREHOUSE', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  // verify (COUNTER_SALES/MANAGER), unlock review (ACCOUNTING), ship / weigh-item (WAREHOUSE/WEIGHBRIDGE) live on Paper Trail
  papertrail: ['COUNTER_SALES', 'WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'control-ticket': ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'],
  'scale-reports': ['WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  aging: ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'],
  rebate: ['SALES', 'COUNTER_SALES', 'APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'rebate-plan': ['APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  giveaway: ['SALES', 'APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  accounting: ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  recon: ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  incidents: ['WAREHOUSE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  // O-4: reports show company-wide rows → only users who see all records. A MANAGER sees all
  // until placed on the Organization Chart; capabilitiesFor drops it once they have a position.
  reports: ['APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  master: ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  policy: ['MANAGER', 'C_LEVEL', 'ADMIN'],
  ops: ['MANAGER', 'C_LEVEL', 'ADMIN'],
  'app-settings': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'roles': ['ADMIN'],
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
  'so.control-ticket': ['COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'so.approve-native': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'so.create-native-delivery': ['SALES', 'COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'credit.approve-native': ['ACCOUNTING'],
  'coupon.manual116': ['WAREHOUSE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'invoice.post-native': ['ACCOUNTING'],
  // W2: print WinSpeed documents (read-only) — 104 delivery order (pre-printed form), 116 slip and 107 delivery note
  'native.print-104': ['WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'native.print-116': ['WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'native.print-107': ['COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'trip.view': ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'quotation.create': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'quotation.manage': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'edit-request.create': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  // O-3: ACCOUNTING may run Settle Cuts and settle manually
  'coupon.settle': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'giveaway.borrow': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'giveaway.budget': ['MANAGER', 'ADMIN'],
  'reports.manage': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'users.manage': ['ACCOUNTING', 'MANAGER', 'ADMIN'],
  'roles.manage': ['ADMIN'],
  'settings.manage': ['ADMIN'],
  'access-as': ACCESS_AS_ACTOR_ROLES,
  // Switch your own session to another dbwins_worldfert* database (owner 2026-10-25).
  // Add or remove roles here to change who may switch.
  'database.switch': ['ACCOUNTING', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  // Change the system-wide default database for everyone.
  'database.set-system': ['ADMIN'],
  // Granular Master Data vs Cost & Selling Price access (owner 2026-11-11)
  'master.manage': ['C_LEVEL', 'ADMIN'],
  'pricing.view': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'pricing.manage': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'cost.view': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'cost.manage': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],

  // Rebate Pool Over-Limit Approval & Manual Nov-1 Ticket Conversion & Tickets
  'rebate.approve-over-limit': ['MANAGER', 'C_LEVEL', 'ADMIN'],
  'rebate.convert': ['ACCOUNTING', 'ADMIN'],
  // Explicitly assignable; evidence review is not implied by accounting or sales.
  'rebate.evidence.verify': ['ADMIN'],
  'rebate.ticket-redeem': ['COUNTER_SALES', 'SALES', 'ACCOUNTING', 'ADMIN'],
  'rebate.ticket-extend': ['C_LEVEL', 'ADMIN'],
  'rebate.aging-override': ['MANAGER', 'C_LEVEL', 'ADMIN'],
});

function capabilitiesFor(role, { positionCode = null } = {}) {
  const r = String(role || '').toUpperCase();
  if (r === 'SEPARATION') return { menus: [], actions: [] };
  const teamScoped = r === 'MANAGER' && Boolean(positionCode);
  return {
    menus: Object.keys(MENUS).filter(k => MENUS[k].includes(r) && !(teamScoped && k === 'reports')),
    actions: Object.keys(ACTIONS).filter(k => ACTIONS[k].includes(r)
      && (k !== 'so.approve-native' || process.env.NATIVE_BOOKING_AI_ENABLED === 'true')
      && (!['so.create-native-delivery','credit.approve-native'].includes(k) || process.env.NATIVE_DELIVERY_104_ENABLED === 'true')
      && (k !== 'coupon.manual116' || process.env.NATIVE_MANUAL_116_ENABLED === 'true')
      && (k !== 'invoice.post-native' || process.env.NATIVE_INVOICE_107_ENABLED === 'true')),
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

function userRoles(user) { return [...new Set(Array.isArray(user?.roles) ? user.roles : [user?.role].filter(Boolean))]; }
function hasRole(user, ...roles) { return userRoles(user).some(r => roles.includes(r)); }
function hasPermission(user, action) {
  if (userRoles(user).includes('SEPARATION')) return false;
  if (Array.isArray(user?.permissions)) return user.permissions.includes(action);
  return !(user?.disabledActions || []).includes(action) && userRoles(user).some(r => rolesFor(action).includes(r));
}
// Switches that hide an action from the client while its feature is off. This only shapes what
// the screens offer; routes are authorized by hasPermission and closed by their own switch.
const REBATE_POOL_SWITCH = 'REBATE_POOL_103_ENABLED';
const FEATURE_SWITCHES = Object.freeze({
  'so.approve-native': ['NATIVE_BOOKING_AI_ENABLED'], 'so.create-native-delivery': ['NATIVE_DELIVERY_104_ENABLED'],
  'credit.approve-native': ['NATIVE_DELIVERY_104_ENABLED'], 'coupon.manual116': ['NATIVE_MANUAL_116_ENABLED'],
  'invoice.post-native': ['NATIVE_INVOICE_107_ENABLED'],
  // Rebate Pool: price approval, evidence review, conversion and ticket actions exist only with the Pool on
  'rebate.approve-over-limit': [REBATE_POOL_SWITCH], 'rebate.evidence.verify': [REBATE_POOL_SWITCH],
  'rebate.convert': [REBATE_POOL_SWITCH, 'REBATE_CONVERSION_ENABLED'],
  'rebate.ticket-redeem': [REBATE_POOL_SWITCH], 'rebate.ticket-extend': [REBATE_POOL_SWITCH], 'rebate.aging-override': [REBATE_POOL_SWITCH],
});
function featureEnabled(action, env = process.env) {
  return (FEATURE_SWITCHES[action] || []).every(name => env[name] === 'true');
}
// Features that are not tied to one permission, e.g. the discount-mode choice on a draft bill.
function enabledFeatures(env = process.env) {
  return env[REBATE_POOL_SWITCH] === 'true' ? ['rebate-pool-103'] : [];
}
module.exports = { ROLES, ROLE_RANK, ACCESS_AS_ACTOR_ROLES, MENUS, ACTIONS, capabilitiesFor, rolesFor, roleRank, userRoles, hasRole, hasPermission, featureEnabled, enabledFeatures };
