import { useErpStore, nextSOID } from '../store/erp-store';
import type { 
  EMCust, 
  EMGood, 
  EMVendor,
  SOHD, 
  SODT, 
  POHD, 
  SOStatus, 
  SOWithDetails, 
  POWithDetails, 
  UnlockRequest 
} from '../types';

const USE_MOCKUP = import.meta.env.VITE_USE_MOCKUP_DATA !== 'false';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const delay = <T>(value: T, ms = 1000): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const fetchCustomers = async (): Promise<EMCust[]> => {
  if (USE_MOCKUP) {
    return delay(useErpStore.getState().customers, 300);
  }
  const response = await fetch(`${API_BASE_URL}/customers`);
  return response.json();
};

export const fetchItems = async (): Promise<EMGood[]> => {
  if (USE_MOCKUP) {
    return delay(useErpStore.getState().items, 300);
  }
  const response = await fetch(`${API_BASE_URL}/items`);
  return response.json();
};

export const fetchVendors = async (): Promise<EMVendor[]> => {
  if (USE_MOCKUP) {
    return delay(useErpStore.getState().vendors, 300);
  }
  const response = await fetch(`${API_BASE_URL}/vendors`);
  return response.json();
};

export const fetchSalesOrders = async (params?: { page?: number, limit?: number, search?: string, customer?: string, status?: string }): Promise<{ data: SOWithDetails[], total: number }> => {
  const page = params?.page || 1;
  const limit = params?.limit || 20;

  if (USE_MOCKUP) {
    const { soHeaders, soDetails, customers } = useErpStore.getState();
    
    // In-memory filter
    let filtered = soHeaders;
    if (params?.search) {
      const q = params.search.toLowerCase();
      filtered = filtered.filter(h => {
        const custName = customers.find(c => c.CustID === h.CustID)?.CustName || '';
        return h.SOID.toLowerCase().includes(q) || 
               (h.DocuNo && h.DocuNo.toLowerCase().includes(q)) || 
               custName.toLowerCase().includes(q);
      });
    }
    if (params?.customer && params.customer !== "") {
      filtered = filtered.filter(h => h.CustID === params.customer);
    }
    if (params?.status && params.status !== "") {
      filtered = filtered.filter(h => h.Status === params.status);
    }

    const total = filtered.length;
    const paginatedHeaders = filtered.slice((page - 1) * limit, page * limit);

    const data: SOWithDetails[] = paginatedHeaders.map((h) => ({
      ...h,
      lines: soDetails.filter((d) => d.SOID === h.SOID),
    }));
    return delay({ data, total }, 600);
  }

  // Live API request
  const query = new URLSearchParams();
  if (params?.page) query.append('page', params.page.toString());
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.search) query.append('search', params.search);
  if (params?.customer) query.append('customer', params.customer);

  const response = await fetch(`${API_BASE_URL}/sales-orders?${query.toString()}`);
  return response.json();
};

export const fetchPurchaseOrders = async (): Promise<POWithDetails[]> => {
  if (USE_MOCKUP) {
    const { poHeaders, poDetails } = useErpStore.getState();
    const data: POWithDetails[] = poHeaders.map((h) => ({
      ...h,
      lines: poDetails.filter((d) => d.POID === h.POID),
    }));
    return delay(data, 600);
  }
  const response = await fetch(`${API_BASE_URL}/purchase-orders`);
  return response.json();
};

export const createSO = async (payload: {
  CustID: string;
  lines: Omit<SODT, "SOID" | "ListNo">[];
}): Promise<SOHD> => {
  if (USE_MOCKUP) {
    const state = useErpStore.getState();
    const SOID = nextSOID(state.soHeaders.map((h) => h.SOID));
    const header: SOHD = {
      SOID,
      CustID: payload.CustID,
      DocuDate: new Date().toISOString().slice(0, 10),
      Status: "Draft",
      TotalAmt: payload.lines.reduce((sum, l) => sum + (l.GoodQty1 * l.GoodPrice1), 0)
    };
    state.addSO(
      header,
      payload.lines.map((l, i) => ({ ...l, SOID, ListNo: i + 1 })),
    );
    return delay(header);
  }
  
  const response = await fetch(`${API_BASE_URL}/sales-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to create Sales Order");
  return response.json();
};

export const updateSOStatus = async (
  SOID: string,
  status: SOStatus,
): Promise<{ SOID: string; status: SOStatus }> => {
  if (USE_MOCKUP) {
    useErpStore.getState().setSOStatus(SOID, status);
    return delay({ SOID, status });
  }
  const response = await fetch(`${API_BASE_URL}/sales-orders/${SOID}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error("Failed to update status");
  return response.json();
};

export const deleteSO = async (SOID: string): Promise<{ success: boolean }> => {
  if (USE_MOCKUP) {
    // In-memory delete is not implemented in erp-store but we can just skip
    return delay({ success: true });
  }
  const response = await fetch(`${API_BASE_URL}/sales-orders/${SOID}`, { method: 'DELETE' });
  if (!response.ok) throw new Error("Failed to delete Sales Order");
  return response.json();
};

export const updateSO = async (SOID: string, payload: any): Promise<{ success: boolean }> => {
  if (USE_MOCKUP) return delay({ success: true });
  const response = await fetch(`${API_BASE_URL}/sales-orders/${SOID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Failed to update Sales Order");
  return response.json();
};

export const fetchUnlockRequests = async (): Promise<UnlockRequest[]> => {
  if (USE_MOCKUP) return delay(useErpStore.getState().unlockRequests, 300);
  const response = await fetch(`${API_BASE_URL}/unlock-requests?_t=${Date.now()}`, { cache: 'no-store' });
  return response.json();
};

export const requestUnlock = async (SOID: string, reason?: string): Promise<UnlockRequest> => {
  if (USE_MOCKUP) {
    const req = useErpStore.getState().addUnlockRequest(SOID);
    return delay(req);
  }
  const response = await fetch(`${API_BASE_URL}/unlock-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ SOID, reason }),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error("Failed to request unlock");
  return response.json();
};

export const resolveUnlockRequest = async (id: string): Promise<{ ok: true }> => {
  if (USE_MOCKUP) {
    useErpStore.getState().resolveUnlockRequest(id);
    return delay({ ok: true });
  }
  const response = await fetch(`${API_BASE_URL}/unlock-requests/${id}`, { 
    method: 'PUT',
    cache: 'no-store'
  });
  if (!response.ok) throw new Error("Failed to resolve unlock request");
  return response.json();
};

export const receivePO = async (
  POID: string,
  lines?: { GoodID: string; GoodQty1: number }[],
): Promise<{ POID: string }> => {
  if (USE_MOCKUP) {
    useErpStore.getState().receivePO(POID, lines);
    return delay({ POID });
  }
  console.warn("POST /api/purchase-orders/:id/receive not yet implemented on backend");
  return { POID };
};

export const syncToWINSpeed = async (
  entity: "SO" | "PO",
  id: string,
): Promise<{ entity: string; id: string; syncedAt: string }> => {
  console.info(`[WINSpeed] Syncing ${entity} ${id} to SQL Server (dbwins_demo)...`);
  return delay({ entity, id, syncedAt: new Date().toISOString() });
};
