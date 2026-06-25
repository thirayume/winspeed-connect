/**
 * erp-store.ts — Zustand store (unlock request queue only)
 * SO/Customer/Goods data is now fetched directly from the real API.
 * Mock data removed — app runs against dbwins_worldfert9.
 */
import { create } from 'zustand';
import type { UnlockRequest } from '../types';

type State = {
  unlockRequests: UnlockRequest[];
};

type Actions = {
  addUnlockRequest: (soId: string, wfRef?: string) => UnlockRequest;
  resolveUnlockRequest: (id: string) => void;
  setUnlockRequests: (reqs: UnlockRequest[]) => void;
};

export const useErpStore = create<State & Actions>((set) => ({
  unlockRequests: [],

  addUnlockRequest: (soId, wfRef) => {
    const req: UnlockRequest = {
      id: `UR-${Date.now()}`,
      SOID: soId,
      wfRef,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    set(s => ({ unlockRequests: [req, ...s.unlockRequests] }));
    return req;
  },

  resolveUnlockRequest: (id) =>
    set(s => ({
      unlockRequests: s.unlockRequests.map(r => r.id === id ? { ...r, resolved: true } : r),
    })),

  setUnlockRequests: (reqs) => set({ unlockRequests: reqs }),
}));
