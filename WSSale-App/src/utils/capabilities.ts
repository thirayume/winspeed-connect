import { useAuthStore } from '../store/auth-store';

// R12 item 3: the backend role-capability map (backend/services/role-capabilities.js) is the
// source of truth and arrives on the user as capabilities.actions. This copy is only the
// fallback for a session stored before the backend sent capabilities.
const FALLBACK_ACTIONS: Record<string, string[]> = {
  'so.create': ['SALES', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  'so.edit': ['SALES', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  'so.cancel': ['SALES', 'C_LEVEL', 'ADMIN'],
  'so.verify': ['COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'so.confirm': ['SALES', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN'],
  'trip.view': ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'quotation.create': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'quotation.manage': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'edit-request.create': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'coupon.settle': ['ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'giveaway.borrow': ['SALES', 'COUNTER_SALES', 'MANAGER', 'C_LEVEL', 'ADMIN'],
  'giveaway.budget': ['MANAGER', 'ADMIN'],
  'users.manage': ['ACCOUNTING', 'MANAGER', 'ADMIN'],
  'access-as': ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'COUNTER_SALES'],
};

export function canDo(user: { role?: string; capabilities?: { actions: string[] } } | null | undefined, action: string): boolean {
  if (!user) return false;
  if (user.capabilities?.actions) return user.capabilities.actions.includes(action);
  return Boolean(user.role && (FALLBACK_ACTIONS[action] || []).includes(user.role));
}

/** const can = useCan(); if (can('quotation.create')) ... */
export function useCan() {
  const user = useAuthStore(s => s.user);
  return (action: string) => canDo(user, action);
}
