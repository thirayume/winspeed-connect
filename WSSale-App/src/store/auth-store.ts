import { create } from 'zustand';
import type { AppUser } from '../types';
import { getToken, setToken, clearToken } from '../services/api';

const USER_KEY = 'wssale_user';

function getStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as AppUser : null;
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
