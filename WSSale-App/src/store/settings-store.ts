import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  productionOverloadPercent: number;
  setProductionOverloadPercent: (value: number) => void;
  truckPayloadLimits: Record<string, number>;
  setTruckPayloadLimit: (truckId: string, limit: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      productionOverloadPercent: 20, // Default 20% overtime capacity
      setProductionOverloadPercent: (value) => set({ productionOverloadPercent: value }),
      truckPayloadLimits: {
        '6w': 2.5,
        '10w': 2.5,
        'trailer': 3.0,
        'container': 3.5
      },
      setTruckPayloadLimit: (truckId, limit) => set((state) => ({
        truckPayloadLimits: { ...state.truckPayloadLimits, [truckId]: limit }
      })),
    }),
    {
      name: 'winspeed-settings',
    }
  )
);
