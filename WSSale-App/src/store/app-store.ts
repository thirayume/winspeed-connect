import { create } from 'zustand';
import { confirmLeaveEditors, hasUnsavedEditors } from '../utils/unsaved-changes';

// ⚠ รายการนี้ซ้ำกับ PortalKey ใน App.tsx — เพิ่มหน้าใหม่ต้องแก้ทั้งสองที่
type PortalKey = 'roles' | 'app-settings' | 'incidents' | 'dashboard' | 'sales' | 'trip-board' | 'voucher' | 'edit-requests' | 'quotation' | 'store' | 'stock' | 'papertrail' | 'rebate' | 'rebate-plan' | 'control-ticket' | 'accounting' | 'recon' | 'giveaway' | 'aging' | 'reports' | 'scale-reports' | 'policy' | 'ops' | 'admin' | 'org' | 'approvers' | 'master' | 'profile' | 'incentive-report' | 'budget-report' | 'beneficiaries';

type NavParams = {
  soId?: number | string;
  quoteId?: number;
  quoteNo?: string;
  action?: 'edit' | 'view';
  search?: string;
};

type AppState = {
  activePortal: PortalKey;
  navParams: NavParams | null;
  globalLoadingCount: number;
  /** Saves in flight among globalLoadingCount: they are never cancelled from the loader. */
  globalWritingCount: number;
};

type AppActions = {
  navigate: (portal: PortalKey, params?: NavParams) => void;
  clearNavParams: () => void;
  startLoading: (write?: boolean) => void;
  stopLoading: (write?: boolean) => void;
};

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  activePortal: 'dashboard',
  navParams: null,
  globalLoadingCount: 0,
  globalWritingCount: 0,

  navigate: (portal, params) => {
    if ((portal !== get().activePortal || params) && hasUnsavedEditors()) {
      void confirmLeaveEditors().then((ok) => {
        if (ok) set({ activePortal: portal, navParams: params || null });
      });
      return;
    }
    set({ activePortal: portal, navParams: params || null });
  },

  clearNavParams: () => set({ navParams: null }),
  
  startLoading: (write = false) => set((state) => ({ globalLoadingCount: state.globalLoadingCount + 1,
    globalWritingCount: state.globalWritingCount + (write ? 1 : 0) })),
  stopLoading: (write = false) => set((state) => ({ globalLoadingCount: Math.max(0, state.globalLoadingCount - 1),
    globalWritingCount: Math.max(0, state.globalWritingCount - (write ? 1 : 0)) })),
}));
