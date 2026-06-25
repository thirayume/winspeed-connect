import { create } from 'zustand';
import type { AppUser } from '../types';
import { getToken, setToken, clearToken } from '../services/api';

type AuthState = {
  user: AppUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: AppUser) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: getToken(),
  isAuthenticated: !!getToken(),

  login: (token, user) => {
    setToken(token);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    clearToken();
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
