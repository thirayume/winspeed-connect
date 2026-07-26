import type { AppUser, UserRole } from '../types';

const REBATE_ALL_ROLES: UserRole[] = ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING', 'APPROVER'];
const REBATE_OWN_ROLES: UserRole[] = [];

export function canViewRebateAmounts(userOrRole?: AppUser | UserRole | null) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return !!role && [...REBATE_ALL_ROLES, ...REBATE_OWN_ROLES].includes(role);
}

export function canViewAllRebateAmounts(userOrRole?: AppUser | UserRole | null) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return !!role && REBATE_ALL_ROLES.includes(role);
}

export function canManageDocHeaderSettings(userOrRole?: AppUser | UserRole | null) {
  if (!userOrRole) return false;
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole.role;
  return !!role && ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'].includes(role);
}
