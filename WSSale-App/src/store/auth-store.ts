import { create } from 'zustand';
import type { AppUser } from '../types';
import { getToken, setToken, clearToken } from '../services/api';

const USER_KEY = 'wssale_user';

function getStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUser & Record<string, unknown>;
    return {
      ...parsed,
      id: Number(parsed.id ?? parsed.Id),
      username: String(parsed.username ?? parsed.Username ?? ''),
      displayName: String(parsed.displayName ?? parsed.DisplayName ?? ''),
      role: (parsed.role ?? parsed.Role) as AppUser['role'],
      empId: (parsed.empId ?? parsed.EmpId ?? null) as string | null,
      isActive: parsed.isActive === undefined && parsed.IsActive === undefined ? true : Boolean(parsed.isActive ?? parsed.IsActive),
      address: (parsed.address ?? parsed.Address ?? null) as string | null,
      phone: (parsed.phone ?? parsed.Phone ?? null) as string | null,
      email: (parsed.email ?? parsed.Email ?? null) as string | null,
      idCardNo: (parsed.idCardNo ?? parsed.IdCardNo ?? null) as string | null,
      taxId: (parsed.taxId ?? parsed.TaxId ?? null) as string | null,
      signatureFile: (parsed.signatureFile ?? parsed.SignatureFile ?? null) as string | null,
      lineUserId: (parsed.lineUserId ?? parsed.LineUserId ?? null) as string | null,
      lineDisplayName: (parsed.lineDisplayName ?? parsed.LineDisplayName ?? null) as string | null,
      lineLinkedAt: (parsed.lineLinkedAt ?? parsed.LineLinkedAt ?? null) as string | null,
    } as AppUser;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function setStoredUser(user: AppUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearStoredUser() {
  localStorage.removeItem(USER_KEY);
}

function isJwtExpired(token: string | null) {
  if (!token) return true;
  try {
    const body = (token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = body.padEnd(Math.ceil(body.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

type AuthState = {
  user: AppUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: AppUser) => void;
  logout: () => void;
};

const storedToken = getToken();
if (isJwtExpired(storedToken)) {
  clearToken();
  clearStoredUser();
}
const initialToken = isJwtExpired(storedToken) ? null : storedToken;
const initialUser = initialToken ? getStoredUser() : null;

export const useAuthStore = create<AuthState>((set) => ({
  user: initialUser,
  token: initialToken,
  isAuthenticated: !!initialToken,

  login: (token, user) => {
    setToken(token);
    setStoredUser(user);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    clearToken();
    clearStoredUser();
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
