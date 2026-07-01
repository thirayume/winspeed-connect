import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  productionOverloadPercent: number;
  setProductionOverloadPercent: (value: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      productionOverloadPercent: 20, // Default 20% overtime capacity
      setProductionOverloadPercent: (value) => set({ productionOverloadPercent: value }),
    }),
    {
      name: 'winspeed-settings',
    }
  )
);
