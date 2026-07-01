/**
 * erp-store.ts — Zustand store (unlock request queue only)
 * SO/Customer/Goods data is now fetched directly from the real API.
 * Mock data removed — app runs against dbwins_worldfert9.
 */
import { create } from 'zustand';
import type { UnlockReq } from '../types';

type State = {
  unlockRequests: UnlockReq[];
};

type Actions = {
  setUnlockRequests: (reqs: UnlockReq[]) => void;
};

export const useErpStore = create<State & Actions>((set) => ({
  unlockRequests: [],
  setUnlockRequests: (reqs) => set({ unlockRequests: reqs }),
}));
