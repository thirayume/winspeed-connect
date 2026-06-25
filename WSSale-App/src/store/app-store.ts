import { create } from 'zustand';

type PortalKey = 'dashboard' | 'sales' | 'quotation' | 'store' | 'papertrail' | 'rebate' | 'accounting' | 'giveaway' | 'admin' | 'master';

type NavParams = {
  soId?: number;
};

type AppState = {
  activePortal: PortalKey;
  navParams: NavParams | null;
  globalLoadingCount: number;
};

type AppActions = {
  navigate: (portal: PortalKey, params?: NavParams) => void;
  clearNavParams: () => void;
  startLoading: () => void;
  stopLoading: () => void;
};

export const useAppStore = create<AppState & AppActions>((set) => ({
  activePortal: 'dashboard',
  navParams: null,
  globalLoadingCount: 0,

  navigate: (portal, params) => set({ 
    activePortal: portal, 
    navParams: params || null 
  }),

  clearNavParams: () => set({ navParams: null }),
  
  startLoading: () => set((state) => ({ globalLoadingCount: state.globalLoadingCount + 1 })),
  stopLoading: () => set((state) => ({ globalLoadingCount: Math.max(0, state.globalLoadingCount - 1) })),
}));
