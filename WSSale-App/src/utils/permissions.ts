import type { AppUser, UserRole } from '../types';

const REBATE_ALL_ROLES: UserRole[] = ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING', 'APPROVER'];
const REBATE_OWN_ROLES: UserRole[] = [];

export function canViewRebateAmounts(userOrRole?: AppUser | UserRole | null) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return !!role && [...REBATE_ALL_ROLES, ...REBATE_OWN_ROLES].includes(role);
}

// The company rebate total on the dashboard: the roles GET /api/rebate/summary accepts.
export function canViewRebateSummary(userOrRole?: AppUser | UserRole | null) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return !!role && ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'].includes(role);
}

export function canManageDocHeaderSettings(userOrRole?: AppUser | UserRole | null) {
  if (!userOrRole) return false;
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole.role;
  return !!role && ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'].includes(role);
}
