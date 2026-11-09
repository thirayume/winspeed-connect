import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompanyInfo } from '../types';
import { fetchCompanyInfo as apiFetchCompanyInfo } from '../services/api';

export const DEFAULT_COMPANY_INFO: CompanyInfo = {
  compCode: '001',
  compName: 'บริษัท เวิลด์ เฟอท จำกัด',
  compNameEng: 'WORLD FERT CO., LTD.',
  compOwner: 'บริษัท เวิลด์ เฟอท จำกัด',
  compOwnerEng: 'WORLDFERT CO., LTD.',
  taxId: '0105531024397',
  taxId13: '0105531024397',
  addr1: '933  อาคารรวมทนุไทย ชั้น 11 ถนนมหาไชย แขวงวังบูรพาภิรมย์',
  addr2: 'เขตพระนคร  กรุงเทพมหานคร 10200',
  addr3: null,
  addr1Eng: '11th. Fl., Ruamdhanuthai Bldg. 933 Mahachai Road,',
  addr2Eng: 'Pranakorn, Bangkok 10200. Thailand',
  addr3Eng: null,
  tel: '02 2218444',
  fax: '02 2263069',
  email: 'worldfert_office@yahoo.com',
  homepage: null,
};

interface CompanyState {
  companyInfo: CompanyInfo;
  isLoading: boolean;
  lastFetchedAt: number | null;
  fetchCompanyInfo: (force?: boolean) => Promise<void>;
  setCompanyInfo: (info: CompanyInfo) => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set, get) => ({
      companyInfo: DEFAULT_COMPANY_INFO,
      isLoading: false,
      lastFetchedAt: null,

      fetchCompanyInfo: async (force = false) => {
        const state = get();
        const now = Date.now();
        // Cache for 5 minutes unless force is specified
        if (!force && state.lastFetchedAt && now - state.lastFetchedAt < 5 * 60 * 1000) {
          return;
        }

        set({ isLoading: true });
        try {
          const info = await apiFetchCompanyInfo();
          if (info && info.compNameEng) {
            set({ companyInfo: info, lastFetchedAt: Date.now() });
          }
        } catch (err) {
          console.warn('[useCompanyStore] could not load company info from server, using cached/default:', err);
        } finally {
          set({ isLoading: false });
        }
      },

      setCompanyInfo: (info) => set({ companyInfo: info, lastFetchedAt: Date.now() }),
    }),
    {
      name: 'winspeed-company-info',
    }
  )
);

