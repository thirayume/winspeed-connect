/**
 * api.ts — WS-Sale-App API service
 * ──────────────────────────────────────────────────────────────
 * All writes go to wf schema (backend enforces dbo=READ-ONLY).
 * JWT token attached to every authenticated request.
 */
import type {
  EMCust, EMGood, CurrentPrice, Employee,
  SalesOrder, SOStatus,
  RebatePool, RebateLedger, RebateClaim, RebateSummary,
  GiveawayRegion, GiveawayBudgetLine, GiveawayWithdrawal, GiveawayItem,
  Quotation, PaperBoard,
  PaginatedResult, UnlockRequest, AppUser, AdminUser, AgingRow,
  TruckStats, TruckHistoryItem,
} from '../types';

import { isMock, mockRequest } from './mock';
import { dbTargetHeader } from '../store/db-mode';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// ── Auth token storage ────────────────────────────────────────
const TOKEN_KEY = 'wssale_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

import { useAppStore } from '../store/app-store';

async function req<T>(path: string, init?: RequestInit & { silent?: boolean }): Promise<T> {
  const silent = init?.silent;
  if (!silent) {
    useAppStore.getState().startLoading();
  }
  
  try {
    if (isMock()) return await mockRequest<T>(path, init);
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...dbTargetHeader(),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw Object.assign(new Error(err.message || 'Request failed'), { status: res.status, data: err });
    }
    return await res.json();
  } finally {
    if (!silent) {
      useAppStore.getState().stopLoading();
    }
  }
}

// ── Auth ──────────────────────────────────────────────────────
export const login = (username: string, password: string) =>
  req<{ accessToken: string; user: AppUser }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });

export const getMe = () => req<AppUser>('/auth/me');

export const createUser = (payload: {
  username: string; password: string; displayName: string;
  role: string; empId?: string;
}) => req<AppUser>('/auth/users', { method: 'POST', body: JSON.stringify(payload) });

export const listUsers = () => req<AdminUser[]>('/auth/users');

export const updateUser = (id: number, patch: { empId?: string | null; role?: string; displayName?: string; isActive?: boolean; password?: string }) =>
  req<{ ok: boolean; id: number }>(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteUser = (id: number) =>
  req<{ ok: boolean }>(`/auth/users/${id}`, { method: 'DELETE' });

export const fetchEmployees = () => req<Employee[]>('/master/employees');

// ── Master data ───────────────────────────────────────────────
export const fetchCustomers = (q?: string) =>
  req<EMCust[]>(`/master/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const updateCustomer = (id: string, patch: Partial<EMCust>) =>
  req<{ ok: boolean }>(`/master/customers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const fetchGoods = (q?: string) =>
  req<EMGood[]>(`/master/goods${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const fetchGiveawayGoods = () => req<EMGood[]>('/master/giveaway-goods');

export const updateGood = (id: string, patch: Partial<EMGood>) =>
  req<{ ok: boolean }>(`/master/goods/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const fetchPrices = (params?: { custId?: string; goodId?: string }) => {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return req<CurrentPrice[]>(`/master/prices${qs ? `?${qs}` : ''}`);
};

export const updatePrice = (payload: { SetPriceID: number; ListNo: number; GoodPriceNet: number; BeginDate?: string; EndDate?: string }) =>
  req<{ ok: boolean }>('/master/prices', { method: 'PATCH', body: JSON.stringify(payload) });

export const createPrice = (payload: { GoodID: string; CustID: string | null; GoodPriceNet: number; BeginDate: string; EndDate: string; startgoodqty: number; endgoodqty: number }) =>
  req<{ ok: boolean; SetPriceID: number }>('/master/prices', { method: 'POST', body: JSON.stringify(payload) });

export const bulkExtendPrices = (payloads: { GoodID: string; CustID: string | null; GoodPriceNet: number; BeginDate: string; EndDate: string; startgoodqty: number; endgoodqty: number }[]) =>
  req<{ ok: boolean; createdCount: number }>('/master/prices/bulk-extend', { method: 'POST', body: JSON.stringify({ items: payloads }) });

export const fetchControlTickets = (custId?: string) =>
  req<unknown[]>(`/master/control-tickets${custId ? `?custId=${custId}` : ''}`);

export const fetchControlTicketDetails = (docuNo: string) =>
  req<{ ListNo: number; GoodID: string; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number; NetPricePerTon: number; BagPerTon: number }[]>(`/master/control-tickets/${encodeURIComponent(docuNo)}`);

export const fetchTruckPlates = (custId: string) =>
  req<string[]>(`/master/truck-plates?custId=${custId}`);

export const fetchTruckStats = (q?: string) => 
  req<TruckStats[]>(`/master/trucks-stats${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const fetchTruckHistory = (plate: string) => 
  req<TruckHistoryItem[]>(`/master/trucks/${encodeURIComponent(plate)}/history`);

export const fetchInvoices = (params?: { custId?: string; dateFrom?: string; dateTo?: string }) => {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return req<unknown[]>(`/master/invoices${qs ? `?${qs}` : ''}`);
};

export const fetchAgingOrders = (bust = false) => req<AgingRow[]>(`/master/aging${bust ? '?bust=1' : ''}`);

export const searchAgingOrders = (params: {
  q?: string; status?: string; page?: number; pageSize?: number; dateFrom?: string;
}) => {
  const qs = new URLSearchParams();
  if (params.q)        qs.set('q',        params.q);
  if (params.status)   qs.set('status',   params.status);
  if (params.page)     qs.set('page',     String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  return req<PaginatedResult<AgingRow>>(`/master/aging/search?${qs}`);
};

// ── Sales Orders ──────────────────────────────────────────────
export const fetchSalesOrders = (params?: {
  status?: string; custId?: string; search?: string; page?: number; limit?: number; silent?: boolean;
}) => {
  const { silent, ...queryParams } = params || {};
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  ).toString();
  return req<PaginatedResult<SalesOrder>>(`/so${qs ? `?${qs}` : ''}`, { silent });
};

export const fetchSalesOrder = (id: number) => req<SalesOrder>(`/so/${id}`);

export const fetchSoStats = (bust = false) =>
  req<{ byStatus: Record<string, number>; total: number }>(`/so/stats${bust ? '?bust=1' : ''}`);

export const getRebateBalance = (custId: string) =>
  req<{ availableRebate: number }>(`/so/rebate-balance/${custId}`, { silent: true });

export const createSO = (payload: any) =>
  req<{ id?: number; ids?: number[]; wfRef?: string; wfRefs?: string[]; needsApproval: boolean }>('/so', {
    method: 'POST', body: JSON.stringify(payload),
  });

export const confirmSO = (id: number) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/confirm`, { method: 'PATCH', body: '{}' });

export const moveToPicking = (id: number) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/picking`, { method: 'PATCH', body: '{}' });

export const confirmLoading = (id: number, sequences: { lineNum: number, seq: number }[]) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/load`, {
    method: 'PATCH', body: JSON.stringify({ sequences }),
  });

export const unlockSO = (id: number, note?: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/unlock`, {
    method: 'PATCH', body: JSON.stringify({ note }),
  });

export const shipSO = (id: number, weighOutWeight?: number) =>
  req<{ id: number; status: SOStatus; importFilePath: string }>(`/so/${id}/ship`, {
    method: 'PATCH', body: JSON.stringify({ weighOutWeight }),
  });

export const syncImported = (id: number, docuNo: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/sync-imported`, {
    method: 'PATCH', body: JSON.stringify({ docuNo }),
  });

export const cancelSO = (id: number, note?: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/cancel`, {
    method: 'PATCH', body: JSON.stringify({ note }),
  });

// ── Rebate ────────────────────────────────────────────────────
export const fetchRebatePools = (params?: { userId?: number; year?: number; month?: number }) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString();
  return req<RebatePool[]>(`/rebate/pools${qs ? `?${qs}` : ''}`);
};

export const fetchRebateLedger = (params?: { poolId?: number; soId?: number; custId?: string }) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString();
  return req<RebateLedger[]>(`/rebate/ledger${qs ? `?${qs}` : ''}`);
};

export const fetchRebateClaims = (status?: string) =>
  req<RebateClaim[]>(`/rebate/claims${status ? `?status=${status}` : ''}`);

export const createRebateClaim = (payload: { poolId: number; claimAmt: number; custId?: string; note?: string }) =>
  req<RebateClaim>('/rebate/claims', { method: 'POST', body: JSON.stringify(payload) });

export const approveRebateClaim = (id: number, docuNo?: string) =>
  req<{ id: number; status: string }>(`/rebate/claims/${id}/approve`, {
    method: 'PATCH', body: JSON.stringify({ docuNo }),
  });

export const fetchRebateSummary = () => req<RebateSummary[]>('/rebate/summary');

export const fetchVoucherSummary = () =>
  req<import('../types').VoucherSummary[]>('/rebate/voucher-summary');

export const fetchCouponCustomers = (params?: { empId?: number }) => {
  const qs = params?.empId ? `?empId=${params.empId}` : '';
  return req<import('../types').CouponCustomer[]>(`/rebate/coupons${qs}`);
};

export const fetchCouponDetail = (custId: string) =>
  req<import('../types').CouponRow[]>(`/rebate/coupons/${encodeURIComponent(custId)}`);

// ── Giveaway (qty model) ──────────────────────────────────────
export const fetchGiveawayRegions = (year?: number) =>
  req<GiveawayRegion[]>(`/giveaway/regions${year ? `?year=${year}` : ''}`);

export const fetchGiveawayBudgetLines = (region: string, year?: number) =>
  req<GiveawayBudgetLine[]>(`/giveaway/budget-lines?region=${encodeURIComponent(region)}${year ? `&year=${year}` : ''}`);

export const fetchGiveawayWithdrawals = (region?: string, year?: number) => {
  const qs = new URLSearchParams();
  if (region) qs.set('region', region);
  if (year) qs.set('year', String(year));
  return req<GiveawayWithdrawal[]>(`/giveaway/withdrawals${qs.toString() ? `?${qs}` : ''}`);
};

export const fetchGiveawayItems = (brand?: string) =>
  req<GiveawayItem[]>(`/giveaway/items${brand ? `?brand=${encodeURIComponent(brand)}` : ''}`);

export const createGiveawayWithdrawal = (payload: {
  region: string; brand: string; itemName: string; qty: number;
  issueMonth?: number; periodYear?: number; custId?: string; note?: string;
}) => req<{ ok: boolean; status: GiveawayBudgetLine | null; isOverBudget: boolean }>(
  '/giveaway/withdrawals', { method: 'POST', body: JSON.stringify(payload) });

export const setGiveawayBudgetLine = (payload: {
  region: string; brand: string; itemName: string; budgetQty: number; periodYear?: number; empCode?: string;
}) => req<{ ok: boolean }>('/giveaway/budgets', { method: 'POST', body: JSON.stringify(payload) });

// ── Quotation ─────────────────────────────────────────────────
export const fetchQuotations = (status?: string) =>
  req<Quotation[]>(`/quotation${status ? `?status=${status}` : ''}`);

export const fetchQuotation = (id: number) => req<Quotation>(`/quotation/${id}`);

export const createQuotation = (payload: {
  custId: string; custName: string; validUntil?: string; remark?: string;
  lines: { goodId: string; goodCode: string; goodName: string; qtyTon: number; pricePerTon: number; netPricePerTon: number }[];
}) => req<{ id: number; quoteNo: string }>('/quotation', { method: 'POST', body: JSON.stringify(payload) });

export const updateQuotationStatus = (id: number, status: string) =>
  req<{ id: number; status: string }>(`/quotation/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const convertQuotation = (id: number, soPrefix = 'I') =>
  req<{ quoteId: number; soId: number; wfRef: string }>(`/quotation/${id}/convert`, { method: 'POST', body: JSON.stringify({ soPrefix }) });

// ── Paper Trail ───────────────────────────────────────────────
export const fetchPaperBoard = () => req<PaperBoard>('/papertrail/board');

// ── Unlock Requests (in-memory approximation via SO unlock endpoint) ─
export const fetchUnlockRequests = (): Promise<UnlockRequest[]> =>
  fetchSalesOrders({ status: 'PICKING', silent: true }).then(r =>
    r.data.map(so => ({
      id: String(so.id),
      SOID: String(so.id),
      wfRef: so.wfRef,
      createdAt: so.createdAt || '',
      resolved: false,
    }))
  );

export const requestUnlock = (soId: number | string, note?: string) =>
  req<{ ok: boolean }>(`/so/${soId}/unlock`, { method: 'PATCH', body: JSON.stringify({ note }) });

export const resolveUnlockRequest = (id: string) =>
  req<{ ok: boolean }>(`/so/${id}/unlock`, { method: 'PATCH', body: '{}' });
