import { create } from 'zustand';

export type TripContext = {
  tripId?: number;
  tripCode?: string;
  truckPlate?: string;
  deliveryDate: string;
  isControlTicket?: boolean;
  pSling?: boolean;
  loadInOrder?: boolean;
  remark?: string;
};

type TripState = {
  activeTrip: TripContext | null;
  setTrip: (trip: TripContext) => void;
  clearTrip: () => void;
  updateTrip: (updates: Partial<TripContext>) => void;
};

export const useTripStore = create<TripState>((set) => ({
  activeTrip: null,

  setTrip: (trip) => {
    set({ activeTrip: trip });
  },

  updateTrip: (updates) => {
    set((state) => ({
      activeTrip: state.activeTrip ? { ...state.activeTrip, ...updates } : null
    }));
  },

  clearTrip: () => {
    set({ activeTrip: null });
  },
}));
