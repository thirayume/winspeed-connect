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
  TruckStats, TruckHistoryItem, CustomerFilterOptions, CustomerRequest, CustomerRequestStatus,
} from '../types';


import { dbTargetHeader } from '../store/db-mode';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// ── Auth token storage ────────────────────────────────────────
const TOKEN_KEY = 'wssale_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function notifyAuthExpired() {
  clearToken();
  window.dispatchEvent(new CustomEvent('wssale:auth-expired'));
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

import { useAppStore } from '../store/app-store';

export async function req<T>(path: string, init?: RequestInit & { silent?: boolean }): Promise<T> {
  const silent = init?.silent;
  if (!silent) {
    useAppStore.getState().startLoading();
  }
  
  try {
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
      if (res.status === 401) notifyAuthExpired();
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

export const lineLoginUrl = () => `${API_BASE}/auth/line/start`;

export const linkLineLogin = (username: string, password: string, lineLinkToken: string) =>
  req<{ accessToken: string; user: AppUser; linked: boolean }>('/auth/line/link', {
    method: 'POST', body: JSON.stringify({ username, password, lineLinkToken }),
  });

export const listAccessAsCandidates = () =>
  req<AdminUser[]>('/auth/access-as/candidates', { silent: true });

export const startAccessAs = (userId: number) =>
  req<{ accessToken: string; user: AppUser }>('/auth/access-as', {
    method: 'POST', body: JSON.stringify({ userId }),
  });

export const stopAccessAs = () =>
  req<{ accessToken: string; user: AppUser }>('/auth/access-as/stop', { method: 'POST' });

export const createUser = (payload: {
  username: string; password: string; displayName: string;
  role: string; empId?: string;
}) => req<AppUser>('/auth/users', { method: 'POST', body: JSON.stringify(payload) });

export const listUsers = () => req<AdminUser[]>('/auth/users');

export const updateUser = (id: number, patch: {
  empId?: string | null; role?: string; displayName?: string; isActive?: boolean;
  password?: string; lineUserId?: string | null;
  address?: string | null; phone?: string | null; email?: string | null;
  idCardNo?: string | null; taxId?: string | null;
  /** รหัสตำแหน่งใน wf.OrgPosition · ส่ง null เพื่อถอดออก */
  positionCode?: string | null;
}) =>
  req<{ ok: boolean; id: number }>(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteUser = (id: number) =>
  req<{ ok: boolean }>(`/auth/users/${id}`, { method: 'DELETE' });

export const fetchEmployees = () => req<Employee[]>('/master/employees');

// ── ผังตำแหน่ง (wf.OrgPosition) — จากผังองค์กร 2568 ────────────
export type OrgPosition = {
  PositionCode: string; PositionName: string;
  ReportsTo: string | null; ReportsToName: string | null;
  OrgUnit: string; Tier: number;
  DefaultRole: string | null; CanApprove: boolean; IsActive: boolean;
  Note: string | null; AssignedCount: number;
};
export const listOrgPositions = () => req<OrgPosition[]>('/auth/org-positions');

// ── Master data ───────────────────────────────────────────────
const MASTER_CACHE_TTL = 5 * 60 * 1000;
const masterCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

function cachedReq<T>(key: string, loader: () => Promise<T>, ttl = MASTER_CACHE_TTL): Promise<T> {
  const now = Date.now();
  const cached = masterCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise as Promise<T>;
  const promise = loader().catch(error => {
    masterCache.delete(key);
    throw error;
  });
  masterCache.set(key, { expiresAt: now + ttl, promise });
  return promise;
}

export const fetchCustomerFilters = () =>
  req<CustomerFilterOptions>('/master/customer-filters');

export const fetchCustomers = (params?: string | {
  q?: string;
  salesperson?: string;
  area?: string;
  group?: string;
  employee?: string;
  limit?: number;
}) => {
  const queryParams = typeof params === 'string' ? { q: params } : (params || {});
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  ).toString();
  return req<EMCust[]>(`/master/customers${qs ? `?${qs}` : ''}`);
};

export const updateCustomer = (id: string, patch: Partial<EMCust>) =>
  req<{ ok: boolean }>(`/master/customers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const fetchCustomerRequests = () =>
  req<CustomerRequest[]>('/master/customer-requests');

export const createCustomerRequest = (payload: Partial<CustomerRequest> & { CustName: string }) =>
  req<{ id: number }>('/master/customer-requests', { method: 'POST', body: JSON.stringify(payload) });

export const reviewCustomerRequest = (
  id: number,
  payload: { status: Exclude<CustomerRequestStatus, 'PENDING'>; winspeedCustId?: string; reviewNote?: string }
) =>
  req<{ ok: boolean }>(`/master/customer-requests/${id}/review`, { method: 'PATCH', body: JSON.stringify(payload) });

export const fetchGoods = (q?: string) => {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const target = dbTargetHeader()['X-DB-Target'] || '';
  return cachedReq<EMGood[]>(`goods:${target}:${qs}`, () => req<EMGood[]>(`/master/goods${qs}`, { silent: true }));
};

export const fetchGiveawayGoods = (salesUserId?: string) => {
  const target = dbTargetHeader()['X-DB-Target'] || '';
  const qs = salesUserId ? `?salesUserId=${encodeURIComponent(salesUserId)}` : '';
  return cachedReq<EMGood[]>(`giveaway-goods:${target}:${salesUserId || ''}`, () => req<EMGood[]>(`/master/giveaway-goods${qs}`, { silent: true }));
};

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

export const fetchControlTickets = (custId?: string, includeCompleted?: boolean) => {
  const qs = new URLSearchParams();
  if (custId) qs.set('custId', custId);
  if (includeCompleted) qs.set('includeCompleted', 'true');
  const str = qs.toString();
  return req<import('../types').ControlTicket[]>(`/master/control-tickets${str ? `?${str}` : ''}`);
};

export const fetchControlTicketDraws = (docuNo: string) =>
  req<import('../types').ControlTicketDraw[]>(`/master/control-tickets/${encodeURIComponent(docuNo)}/draws`);

export const fetchControlTicketDetails = (docuNo: string) =>
  req<{ ListNo: number; GoodID: string; GoodCode: string; GoodName: string; QtyTon: number; PricePerTon: number; NetPricePerTon: number; BagPerTon: number }[]>(`/master/control-tickets/${encodeURIComponent(docuNo)}`);

export const fetchTruckPlates = (custId: string) =>
  req<string[]>(`/master/truck-plates?custId=${custId}`);

export const fetchTruckStats = (q?: string) => 
  req<TruckStats[]>(`/master/trucks-stats${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const fetchTruckHistory = (plate: string) => 
  req<TruckHistoryItem[]>(`/master/trucks/${encodeURIComponent(plate)}/history`);

export const fetchTruckTypes = () => req<import('../types').TruckType[]>('/master/truck-types');
export const createTruckType = (data: Partial<import('../types').TruckType>) => req('/master/truck-types', { method: 'POST', body: JSON.stringify(data) });
export const updateTruckType = (id: string, data: Partial<import('../types').TruckType>) => req(`/master/truck-types/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTruckType = (id: string) => req(`/master/truck-types/${encodeURIComponent(id)}`, { method: 'DELETE' });

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
  status?: string; custId?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number; silent?: boolean;
}) => {
  const { silent, ...queryParams } = params || {};
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  ).toString();
  return req<PaginatedResult<SalesOrder>>(`/so${qs ? `?${qs}` : ''}`, { silent });
};

export const fetchSalesOrder = (id: number | string) => req<SalesOrder>(`/so/${id}`);

export const fetchSoStats = (bust = false) =>
  req<{ byStatus: Record<string, number>; total: number }>(`/so/stats${bust ? '?bust=1' : ''}`);

export const getRebateBalance = (custId: string) =>
  req<{ availableRebate: number }>(`/so/rebate-balance/${custId}`, { silent: true });

export const fetchShippedToday = (date: string) =>
  req<import('../types').ShippedRow[]>(`/so/shipped-today?date=${date}`);

export const createSO = (payload: Record<string, unknown> | Record<string, unknown>[]) =>
  req<{ id?: number; ids?: number[]; wfRef?: string; wfRefs?: string[]; needsApproval: boolean }>('/so', {
    method: 'POST', body: JSON.stringify(payload),
  });

export const updateSO = (id: number | string, payload: Record<string, unknown>) =>
  req<{ id: number; wfRef?: string; needsApproval: boolean }>(`/so/${id}`, {
    method: 'PUT', body: JSON.stringify(payload),
  });

export const confirmSO = (id: number | string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/confirm`, { method: 'PATCH', body: '{}' });

export const approveGiveawayLine = (id: number | string, lineNum: number, note?: string) =>
  req<{ id: number | string; lineNum: number; status: 'APPROVED' }>(`/so/${id}/giveaway-lines/${lineNum}/approve`, {
    method: 'PATCH', body: JSON.stringify({ note }),
  });

export const moveToPicking = (id: number | string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/picking`, { method: 'PATCH', body: '{}' });

export const confirmLoading = (id: number, sequences: { lineNum: number, seq: number }[], overloadReason?: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/load`, {
    method: 'PATCH', body: JSON.stringify({ sequences, overloadReason }),
  });

export const unlockSO = (id: number, note?: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/unlock`, {
    method: 'PATCH', body: JSON.stringify({ note }),
  });

export const shipSO = (
  id: number | string,
  weighOutWeight?: number,
  opts?: {
    tareKg?: number;
    scaleNo?: number;
    movebill?: string;
    overrideReason?: string;
    overrideApprovedBy?: number;
    overrideApprovedByName?: string;
    evidencePhotoUrl?: string;
  }
) =>
  req<{ id: number; status: SOStatus; netKg?: number; importFilePath?: string; weightEval?: any }>(`/so/${id}/ship`, {
    method: 'PATCH', body: JSON.stringify({ weighOutWeight, ...(opts || {}) }),
  });

export const fetchWeighTicket = (soId: number | string) =>
  req<import('../types').WeighTicket | null>(`/so/${soId}/weigh`, { silent: true });

export const logItemWeighPass = (soId: number | string, data: { grossScaleKg: number; lineNum?: number; goodCode?: string; goodName?: string; note?: string; tareKg?: number }) =>
  req<{ ok: boolean; passNo: number; grossScaleKg: number; incrementalNetKg: number | null }>(`/so/${soId}/weigh-item`, { method: 'POST', body: JSON.stringify(data) });

export const fetchSoWeighHistory = (soId: number | string) =>
  req<{ ticket: import('../types').WeighTicket | null; itemLogs: any[]; weightEval: any }>(`/so/${soId}/weigh-history`);

export const fetchSystemSettings = () =>
  req<{ settings: { minPct: number; maxPct: number; standardBagKg: number }; rows: any[] }>('/master/system-settings');

export const updateSystemSettings = (updates: Record<string, string | number>) =>
  req<{ ok: boolean; settings: { minPct: number; maxPct: number; standardBagKg: number } }>('/master/system-settings', { method: 'PATCH', body: JSON.stringify(updates) });

export const syncImported = (id: number, docuNo: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/sync-imported`, {
    method: 'PATCH', body: JSON.stringify({ docuNo }),
  });

// FR-022 Verification Gate
export const verifySO = (id: number) =>
  req<{ id: number; verified: boolean }>(`/so/${id}/verify`, { method: 'PATCH', body: '{}' });

// FR-006/007 Unlock Request flow
export const createUnlockRequest = (soId: number | string, reason: string, reqType: 'UNLOCK' | 'EDIT' | 'CANCEL' = 'UNLOCK') =>
  req<{ id: string; ok: boolean }>(`/so/${soId}/unlock-request`, { method: 'POST', body: JSON.stringify({ reason, reqType }) });
export const listUnlockRequests = (status = 'PENDING', silent = false) =>
  req<import('../types').UnlockReq[]>(`/so/unlock-requests?status=${status}`, { silent });
export const listPendingGiveaways = (silent = false) =>
  req<import('../types').PendingGiveaway[]>('/so/giveaways/pending', { silent });
export const fetchUnlockReasons = (type: 'EDIT' | 'CANCEL') =>
  req<string[]>(`/so/unlock-reasons?type=${type}`);
export const resolveUnlockReq = (reqId: number, approve: boolean, note?: string) =>
  req<{ id: number; status: string }>(`/so/unlock-requests/${reqId}/resolve`, { method: 'PATCH', body: JSON.stringify({ approve, note }) });

export const cancelSO = (id: number | string, note?: string) =>
  req<{ id: number; status: SOStatus }>(`/so/${id}/cancel`, {
    method: 'PATCH', body: JSON.stringify({ note }),
  });

export const deleteSO = (id: number | string) =>
  req<{ id: number; deleted: boolean }>(`/so/${id}`, {
    method: 'DELETE',
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

export const fetchRebateClaimDetail = (id: number) =>
  req<{
    claim: RebateClaim; lines: any[]; approvals: any[]; invoices: any[];
    totals?: any;
    /** เลขสาย RB ที่ใบนี้จะได้ — มีค่าเฉพาะตอนที่ยังไม่อนุมัติ (CnDocuNo ยังว่าง) */
    suggestedRbNo?: string | null;
  }>(`/rebate/claims/${id}`);

export const createRebateClaim = (payload: {
  /** ไม่บังคับแล้ว — ยอดสะสมอ่านจาก WINSpeed ส่วน pool คือ "งบที่จัดสรร" คนละเรื่อง */
  poolId?: number; claimAmt?: number; custId?: string; note?: string;
  lines?: any[]; invoices?: string[];
}) =>
  req<RebateClaim>('/rebate/claims', { method: 'POST', body: JSON.stringify(payload) });

// ── เอกสารคืนรีเบทของ WINSpeed (RB<รหัสผู้ขอ><ปี พ.ศ.>-<ลำดับ>) ──────────────
// WINSpeed ไม่ได้บันทึกว่าใครเป็นผู้ขอ (EmpID ว่างทุกใบ) อักษรในเลขที่เอกสาร
// จึงเป็นร่องรอยเดียว — ตั้งค่าที่บัญชีผู้ใช้ ดู migration 079

export type RebateDocCodeRow = {
  UserId: number; Username: string; DisplayName: string | null;
  EmpId: string | null; Role: string; RebateDocCode: string | null;
  /** ข้อเสนอจากชื่อไทย (ตัวแรกชื่อ + ตัวแรกนามสกุล) — ต้องกดยืนยัน ไม่ได้ตั้งให้เอง */
  suggested?: string | null;
};
export type RebateDocCodeEvidence = {
  SeriesCode: string; EmpCode: string; EmpName: string;
  DocCount: number; FirstDoc: string; LastDoc: string; TotalAmnt: number;
};

export const fetchRebateDocCodes = () =>
  req<{ assigned: RebateDocCodeRow[]; evidence: RebateDocCodeEvidence[] }>('/rebate/doc-codes');

export const setRebateDocCode = (userId: number, code: string | null) =>
  req<{ Id: number; Username: string; RebateDocCode: string | null }>(`/rebate/doc-codes/${userId}`, {
    method: 'PATCH', body: JSON.stringify({ code }),
  });

/** เลขที่ใบคืนรีเบทใบถัดไป อ่านลำดับล่าสุดจาก WINSpeed ไม่เก็บตัวนับของตัวเอง */
export const fetchNextRbNo = (userId?: number) => {
  const qs = userId ? `?userId=${userId}` : '';
  return req<{ docCode: string; beYear: string; lastDocuNo: string | null; suggested: string }>(`/rebate/next-rb-no${qs}`);
};

export const fetchRbReconciliation = (params: { from?: string; to?: string; onlyProblems?: boolean } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.onlyProblems) qs.set('onlyProblems', 'true');
  const suffix = qs.toString();
  return req<{ summary: Record<string, number>; rows: any[]; truncated: boolean }>(`/rebate/rb-reconciliation${suffix ? `?${suffix}` : ''}`);
};

export const approveRebateClaim = (id: number, docuNo?: string, note?: string) =>
  req<{ id: number; status: string; currentTier?: number; message?: string }>(`/rebate/claims/${id}/approve`, {
    method: 'POST', body: JSON.stringify({ docuNo, note }),
  });

export const rejectRebateClaim = (id: number, reason: string) =>
  req<{ id: number; status: string; message?: string }>(`/rebate/claims/${id}/reject`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });

export const fetchRebateRegions = () =>
  req<{ regions: any[]; userAreas: any[] }>('/rebate/regions');

export const setUserRegion = (payload: { userId: number; regionCode: string; isPrimary?: boolean }) =>
  req<{ success: boolean; message: string }>('/rebate/user-regions', { method: 'POST', body: JSON.stringify(payload) });

export type RegionCoverage = {
  RegionCode: string; RegionName: string;
  UserId: number | null; Username: string | null; DisplayName: string | null;
  Role: string | null; IsActive: boolean | null; IsPrimary: boolean | null;
  Customers: number;
};

export const fetchRegionCoverage = () => req<RegionCoverage[]>('/rebate/regions/coverage');

export const removeUserRegion = (userId: number, regionCode: string) =>
  req<{ ok: boolean }>(`/rebate/user-regions/${userId}/${encodeURIComponent(regionCode)}`, { method: 'DELETE' });

export const fetchRebateSummary = () => req<RebateSummary[]>('/rebate/summary');

// ── Rebate Plan (FR-008/009) ──────────────────────────────────
export const fetchRebatePlans = (status?: string) =>
  req<import('../types').RebatePlan[]>(`/rebate/plans${status ? `?status=${status}` : ''}`);
export const createRebatePlan = (payload: {
  title?: string; refDoc?: string; goodCodePattern?: string; region?: string; returnType?: string;
  netPrice?: number; validFrom?: string; validTo?: string; allocatedAmount?: number; priority?: number; note?: string;
}) => req<import('../types').RebatePlan>('/rebate/plans', { method: 'POST', body: JSON.stringify(payload) });
export const updateRebatePlan = (id: number, patch: Record<string, unknown>) =>
  req<{ id: number; ok: boolean }>(`/rebate/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const allocateRebatePlan = (id: number, payload: { salesUserId: number; amount: number; periodYear?: number; periodMonth?: number; note?: string }) =>
  req<{ ok: boolean; poolId: number; allocated: number }>(`/rebate/plans/${id}/allocate`, { method: 'POST', body: JSON.stringify(payload) });

// ── CN Rebate (dbo) ───────────────────────────────────────────
export const fetchCnRebateSummary = (params?: { year?: number; empId?: number }) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params || {}).filter(([,v]) => v !== undefined).map(([k,v])=>[k,String(v)]))).toString();
  return req<import('../types').CnRebateSummary[]>(`/rebate/cn-summary${qs ? `?${qs}` : ''}`);
};

export const fetchCnRebateList = (params?: { year?: number; empId?: number; custId?: string }) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params || {}).filter(([,v]) => v !== undefined).map(([k,v])=>[k,String(v)]))).toString();
  return req<import('../types').CnRebateRow[]>(`/rebate/cn-list${qs ? `?${qs}` : ''}`);
};

export const fetchCnRebateDetail = (soInvId: number) =>
  req<import('../types').CnRebateDetail[]>(`/rebate/cn-detail/${soInvId}`);

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

export const fetchGiveawayBorrowRequests = () => req<unknown[]>('/giveaway/borrow-requests');
export const resolveGiveawayBorrowRequest = (id: number, approve: boolean, note?: string) => 
  req<{ ok: boolean; status: string }>(`/giveaway/borrow-requests/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({ approve, note })
  });

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
  custId: string; custName: string; validUntil?: string; validDays?: number; remark?: string;
  /** ADMIN-only: create the quotation on behalf of another sales user */
  salesUserId?: number;
  lines: { goodId: string; goodCode: string; goodName: string; qtyTon: number; pricePerTon: number; netPricePerTon: number }[];
}) => req<{
  id: number;
  quoteNo: string;
  winspeedQuoteSoid?: number;
  winspeedQuoteNo?: string;
  winspeedEstimateId?: number;
  winspeedEstimateNo?: string;
}>('/quotation', { method: 'POST', body: JSON.stringify(payload) });

export const updateQuotationStatus = (id: number, status: string) =>
  req<{ id: number; status: string; sourceSoCount?: number }>(`/quotation/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const convertQuotation = (id: number, soPrefix = 'I') =>
  req<{ quoteId: number; soId: number; wfRef: string }>(`/quotation/${id}/convert`, { method: 'POST', body: JSON.stringify({ soPrefix }) });

export const createQuotationFromSoTrip = (payload: {
  soIds: Array<number | string>;
  sourceRefs?: string[];
  validDays?: 7 | 15 | 20 | 30 | 45;
  validUntil?: string;
  remark?: string;
  salesUserId?: number | string;
}) =>
  req<{
    id: number;
    quoteNo: string;
    sourceSoIds: number[];
    sourceWfRefs: string[];
    lineCount: number;
    validUntil: string;
    winspeedQuoteSoid?: number;
    winspeedQuoteNo?: string;
    winspeedEstimateId?: number;
    winspeedEstimateNo?: string;
  }>('/quotation/from-so-trip', { method: 'POST', body: JSON.stringify(payload) });

export const extendQuotationValidity = (id: number, payload: { validDays?: 7 | 15 | 20 | 30 | 45; validUntil?: string }) =>
  req<{ id: number; validUntil: string }>(`/quotation/${id}/valid-until`, { method: 'PATCH', body: JSON.stringify(payload) });

// ── TruckScale (FR-024/025/026) ───────────────────────────────
export const pingTruckScale = () =>
  req<{ ok: boolean; configured: boolean; totalWeighings?: number; completed?: number }>('/truckscale/ping', { silent: true });
export const fetchTruckScaleWeigh = (params: { plate?: string; movebill?: string; limit?: number }) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))).toString();
  return req<import('../types').TruckScaleWeigh[]>(`/truckscale/weigh?${qs}`);
};
export const fetchTruckScaleDetail = (sequence: string) =>
  req<import('../types').TruckScaleDetail>(`/truckscale/scale/${encodeURIComponent(sequence)}`);
export const fetchTruckScaleForSO = (soId: number | string) =>
  req<{ so: { Id: string; WfRef: string; TruckPlate?: string; CustName: string }; candidates: import('../types').TruckScaleWeigh[]; note?: string }>(`/truckscale/for-so/${soId}`);

// ── TruckScale inbox / sync (pull) ────────────────────────────
export interface WeighInboxRow {
  Id: number; Sequence: string; Movebill?: string; Plate?: string; CustName?: string;
  WeightIn?: number; WeightOut?: number; WeightNet?: number; DateIn?: string; DateOut?: string; ScaleNo?: string;
  Status: 'OPEN' | 'COMPLETED'; MatchedSoId?: string | null; MatchedDocuNo?: string | null; MatchStatus?: 'MATCHED' | 'MULTI' | 'UNMATCHED' | null;
  IngestedAt: string; UpdatedAt: string;
}
export interface TsSyncStatus {
  watermark: { LastSid: number; LastSyncAt: string | null; TotalIngested: number; LastError: string | null } | null;
  counts: { Status: string; n: number }[]; matched: { MatchStatus: string; n: number }[]; configured: boolean; intervalMs: number;
}
export const fetchTsSyncStatus = () => req<TsSyncStatus>('/truckscale/sync/status', { silent: true });
export const runTsSync = () => req<{ ingested?: number; refreshed?: number; lastSid?: number; error?: string }>('/truckscale/sync/run', { method: 'POST', body: '{}' });
export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const fetchWeighInbox = (status?: string, match?: string, search?: string, page = 1, limit = 20) =>
  req<PaginatedResponse<WeighInboxRow>>(`/truckscale/inbox?${new URLSearchParams({ 
    ...(status ? { status } : {}), 
    ...(match ? { match } : {}),
    ...(search ? { search } : {}),
    page: String(page),
    limit: String(limit)
  }).toString()}`);
export const matchWeighInbox = (id: number, soId: string) =>
  req<{ ok: boolean }>(`/truckscale/inbox/${id}/match/${encodeURIComponent(soId)}`, { method: 'POST', body: '{}' });

// ── Reconciliation Workbench (FR-027) ─────────────────────────
export type ReconCheck = 'WEIGH' | 'INVOICE';
export interface ReconResolutionInfo { status: 'RESOLVED' | 'IGNORED'; note: string | null; }
export interface ReconCase {
  soId: string; wfRef: string | null; custName: string; truckPlate: string | null;
  shipDate: string; wsDocuNo: string | null; wsInvoiceNo: string | null;
  wsInvoiceId: number | null; wsInvoiceDate: string | null;
  wsInvoiceType: string | null; wsPostId: number | string | null;
  postInvoiceStatus: 'READY' | 'POSTED'; readyForPostInvoice: boolean;
  netApp: number | null; netTs: number | null; variance: number | null;
  tsMatchBy: string | null; tsFallbackMovebill: string | null;
  movebill: string | null; scaleNo: number | null;
  weigh: 'MATCHED' | 'VARIANCE' | 'NO_WEIGH' | 'UNLINKED' | 'TS_NOT_FOUND' | 'TS_UNAVAILABLE';
  invoice: 'MATCHED' | 'PENDING';
  weighResolution: ReconResolutionInfo | null; invoiceResolution: ReconResolutionInfo | null;
  overall: 'OK' | 'EXCEPTION' | 'RESOLVED'; tsAvailable: boolean;
}
export interface ReconSummary {
  total: number; ok: number; exception: number; resolved: number;
  readyForPostInvoice: number; postedInvoice: number; tsAvailable: boolean;
}
export const fetchReconSummary = (days = 7) =>
  req<ReconSummary>(`/recon/summary?days=${days}`, { silent: true });
export const fetchReconCases = (days = 7, status?: string) =>
  req<ReconCase[]>(`/recon/cases?days=${days}${status ? `&status=${status}` : ''}`);
export const resolveReconCase = (
  soId: string,
  body: { checkType: ReconCheck; action: 'RESOLVE' | 'IGNORE'; note?: string; wfRef?: string | null },
) => req<{ soId: string; checkType: string; status: string }>(`/recon/${encodeURIComponent(soId)}/resolve`, {
  method: 'POST', body: JSON.stringify(body),
});

// ── Ops / Observability (FR-030) ──────────────────────────────
export interface OpsStatus {
  version: string; env: string; startedAt: string; uptimeSec: number;
  requests: number; errors: number; lastErrorAt: string | null;
  byStatus: Record<string, number>; alertConfigured: boolean;
  db: { sqlserver: string; mysql: string };
}
export interface OpsError {
  Id?: number; OccurredAt?: string; at?: string;
  Level?: string; level?: string; Source?: string; source?: string;
  Message?: string; message?: string; ReqMethod?: string; method?: string;
  ReqPath?: string; path?: string; StatusCode?: number; status?: number; AppVersion?: string;
}
export const fetchOpsStatus = () => req<OpsStatus>('/ops/status', { silent: true });
export const fetchOpsErrors = (limit = 50) => req<{ source: string; errors: OpsError[] }>(`/ops/errors?limit=${limit}`);
export const testOpsAlert = () => req<{ ok: boolean; message: string }>('/ops/test-alert', { method: 'POST', body: '{}' });

// ── Approval Policy (FR-028) ──────────────────────────────────
export interface ApprovalPolicy {
  Id: number; CaseType: string; MinAmount: number | null; MaxAmount: number | null;
  RequiredRole: string; EffectiveFrom: string; EffectiveTo: string | null;
  IsActive: boolean; Note: string | null; CreatedByName?: string;
}
export const fetchPolicies = () => req<ApprovalPolicy[]>('/policy');
export const createPolicy = (b: Partial<ApprovalPolicy> & { caseType: string; requiredRole: string; minAmount?: number | null; maxAmount?: number | null; note?: string }) =>
  req<{ id: number }>('/policy', { method: 'POST', body: JSON.stringify(b) });
export const updatePolicy = (id: number, b: Record<string, unknown>) =>
  req<{ ok: boolean }>(`/policy/${id}`, { method: 'PUT', body: JSON.stringify(b) });
export const deletePolicy = (id: number) => req<{ ok: boolean }>(`/policy/${id}`, { method: 'DELETE' });

// ── Price Book (FR-023) ───────────────────────────────────────
export interface PriceBook {
  Id: number; Name: string; EffectiveMonth: string; Status: 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'ARCHIVED';
  Note?: string; LineCount?: number; CreatedByName?: string; ApprovedByName?: string; ActivatedByName?: string; CreatedAt?: string;
}
export interface PriceBookLine {
  Id?: number; GoodId: string; GoodName?: string; Unit?: string; Price: number | null;
  LineStatus?: 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED'; Note?: string | null;
}
export interface PriceBookAuditRow { Action: string; FromStatus: string | null; ToStatus: string | null; ByName: string | null; Note: string | null; At: string; }
export interface PriceBookSpecialPrice {
  Id: number; PriceBookId: number; CustId: string; CustName?: string; GoodId?: string; GoodName?: string;
  RequestedPrice?: number; ApprovedPrice?: number; Note?: string; RequestedBy?: number; RequestedByName?: string;
  ApprovedBy?: number; ApprovedByName?: string; ApprovedAt?: string; CreatedAt?: string;
}
export interface EffectivePriceRow {
  GoodId: string; GoodName: string; Unit: string; LineStatus: 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED';
  StandardPrice: number | null; SpecialPrice: number | null; EffectivePrice: number | null; Sellable: 0 | 1;
}

export const fetchPriceBooks = () => req<PriceBook[]>('/pricebook');
export const fetchPriceBook = (id: number) => req<PriceBook & { lines: PriceBookLine[]; audit: PriceBookAuditRow[] }>(`/pricebook/${id}`);
export const createPriceBook = (b: { name: string; effectiveMonth: string; note?: string; seedFromCurrent?: boolean }) =>
  req<{ id: number }>('/pricebook', { method: 'POST', body: JSON.stringify(b) });
/** POST /pricebook/:id/lines reads camelCase; GET returns PascalCase. Convert at the boundary. */
export interface PriceBookLineInput {
  goodId: string; goodName?: string; unit?: string; price: number | null;
  lineStatus?: 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED'; note?: string | null;
}
export const toPriceBookLineInput = (l: PriceBookLine): PriceBookLineInput => ({
  goodId: l.GoodId, goodName: l.GoodName, unit: l.Unit, price: l.Price,
  lineStatus: l.LineStatus, note: l.Note,
});
export const setPriceBookLines = (id: number, lines: PriceBookLine[]) =>
  req<{ ok: boolean; count: number }>(`/pricebook/${id}/lines`, {
    method: 'POST',
    body: JSON.stringify({ lines: lines.map(toPriceBookLineInput) }),
  });
export const priceBookAction = (id: number, action: 'approve' | 'activate' | 'archive', note?: string) =>
  req<{ ok: boolean; status: string }>(`/pricebook/${id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) });
export const fetchPriceBookSpecial = (id: number) => req<PriceBookSpecialPrice[]>(`/pricebook/${id}/special`);
export const requestPriceBookSpecial = (id: number, data: { custId: string; custName?: string; goodId?: string; goodName?: string; requestedPrice?: number; note?: string }) =>
  req<{ id: number }>(`/pricebook/${id}/special`, { method: 'POST', body: JSON.stringify(data) });
export const approvePriceBookSpecial = (spId: number, approvedPrice: number) =>
  req<{ id: number; approvedPrice: number }>(`/pricebook/special/${spId}`, { method: 'PATCH', body: JSON.stringify({ approvedPrice }) });
export const fetchEffectivePrices = (priceBookId: number, custId?: string) =>
  req<EffectivePriceRow[]>(`/pricebook/${priceBookId}/effective${custId ? `?custId=${encodeURIComponent(custId)}` : ''}`);

// ── Ops outbox (FR-029) ───────────────────────────────────────
export interface OutboxRow { Id: number; EventType: string; AggregateId: string | null; Status: string; RetryCount: number; LastError: string | null; CreatedAt: string; ProcessedAt: string | null; }
export const fetchOpsOutbox = () => req<{ summary: { Status: string; n: number }[]; recent: OutboxRow[] }>('/ops/outbox');

// ── Credit master (FR-003) ────────────────────────────────────
export interface CreditInfo { CustId: string; CustName?: string; CreditLimit: number | null; CreditHold: boolean; Note?: string; UpdatedByName?: string; UpdatedAt?: string; }
export const fetchCredits = () => req<CreditInfo[]>('/credit');
export const setCredit = (custId: string, b: { custName?: string; creditLimit?: number | null; creditHold?: boolean; note?: string }) =>
  req<{ ok: boolean }>(`/credit/${encodeURIComponent(custId)}`, { method: 'PUT', body: JSON.stringify(b) });

// ── Operational stock (DG-04) ─────────────────────────────────
export interface StockRow { GoodId: string; WarehouseId: string; GoodName?: string; QtyOnHand: number; Unit?: string; Source?: string; AsOf?: string; UpdatedByName?: string; }
export const fetchStock = () => req<StockRow[]>('/stock');
export const setStock = (b: { goodId: string; warehouseId?: string; goodName?: string; qtyOnHand: number; unit?: string; source?: string }) =>
  req<{ ok: boolean }>('/stock', { method: 'PUT', body: JSON.stringify(b) });

// ── PDPA retention / DSAR (FR-032) ────────────────────────────
export interface RetentionPolicy { Id: number; DataClass: string; RetentionDays: number; Note?: string; UpdatedAt?: string; }
export interface DsarRow { Id: number; SubjectType: string; SubjectId: string; Action: string; Status: string; ByName?: string; RequestedAt: string; Note?: string; }
export const fetchRetentionPolicies = () => req<RetentionPolicy[]>('/pdpa/policies');
export const updateRetentionPolicy = (id: number, retentionDays: number, note?: string) =>
  req<{ ok: boolean }>(`/pdpa/policies/${id}`, { method: 'PUT', body: JSON.stringify({ retentionDays, note }) });
export const fetchDsarLog = () => req<DsarRow[]>('/pdpa/dsar');
export const dsarExport = (subjectType: 'CUSTOMER' | 'USER', subjectId: string) =>
  req<{ subjectType: string; subjectId: string; exportedAt: string; data: Record<string, unknown> }>('/pdpa/dsar/export', { method: 'POST', body: JSON.stringify({ subjectType, subjectId }) });
export const runRetention = () => req<{ ok: boolean; ranAt: string; result: Record<string, number> }>('/pdpa/retention/run', { method: 'POST', body: '{}' });

// ── LINE (FR-016) ─────────────────────────────────────────────
export const fetchLineStatus = () => req<{ webhookConfigured: boolean; pushConfigured: boolean }>('/line/status', { silent: true });

// ── Reports (FR-017) ──────────────────────────────────────────
export type ReportData = { type: string; title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };
// ใบจ่ายสินค้าของ TruckScale — แทน RptSaYPan.rpt ของโปรแกรมชั่ง
// หัวเอกสารมาจาก tblscale · บรรทัดสินค้ามาจาก tblproduct_detail (ผูกกันด้วย one_num)
export type DeliveryNoteItem = {
  Id: number; GoodCode: string; GoodName: string; Brand: string;
  Bag: number; KgPerBag: number; Ton: number;
  // Godown แยกว่าใบนี้ตรงกับรายงานต้นฉบับใบไหน (สายพาน / คลัง / โกดัง1-6 / อื่น ๆ)
  // GodownType = ประเภทโกดัง (เชิงผสม · แฮนแพ็ค · เทกอง · ห้องกระสอบ · ท่าน้ำ)
  IssueNo: string; Destination: string; Godown: string; GodownType: string;
};
export type DeliveryNote = {
  Sequence: string; Movebill: string; Plate: string; CustName: string;
  DateIn: string; TimeIn: string; DateOut: string; TimeOut: string;
  WeightIn: number; WeightOut: number; WeightNet: number;
  OneNum: number; Note: string;
  issueNo: string | null; issueNoAll: string[];
  items: DeliveryNoteItem[];
  totals: { bag: number; ton: number };
};
export const fetchDeliveryNote = (sequence: string) =>
  req<DeliveryNote>(`/truckscale/delivery-note/${encodeURIComponent(sequence)}`);

export const fetchReportTypes = () => req<{ key: string; title: string }[]>('/reports/types');
// รายงานบางตัว (เช่น truckscale-writeback) รับช่วงวัน ส่วนตัวอื่นไม่สนใจพารามิเตอร์
export const fetchReport = (type: string, params?: Record<string, string>) => {
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return req<ReportData>(`/reports/${type}${qs}`);
};
export async function exportReport(type: string, params?: Record<string, string>) {
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(`${API_BASE}/reports/${type}/export${qs}`, { headers: { ...authHeaders(), ...dbTargetHeader() } });
  if (!res.ok) throw new Error('Export ล้มเหลว');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${type}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Paper Trail ───────────────────────────────────────────────
export const fetchPaperBoard = () => req<PaperBoard>('/papertrail/board');

// Paper Trail v2 — เอกสาร 4 สี + QR + scan
export const fetchPaperDocument = (soId: string | number) =>
  req<import('../types').PaperDocument>(`/papertrail/document/${soId}`);
export const fetchPaperCopies = (soId: string | number) =>
  req<import('../types').PaperCopy[]>(`/papertrail/${soId}/copies`);
export const printPaperCopies = (soId: string | number, docType = 'ISSUE') =>
  req<{ soId: string; docType: string; copies: import('../types').PrintedCopy[] }>(
    `/papertrail/${soId}/print`, { method: 'POST', body: JSON.stringify({ docType }) });
export const scanPaper = (qrNonce: string, action: string, opts?: { note?: string; location?: string }) =>
  req<{ qrNonce: string; color: string; soId: string; status: string }>(
    '/papertrail/scan', { method: 'POST', body: JSON.stringify({ qrNonce, action, ...(opts || {}) }) });
export const fetchPaperHistory = (qrNonce: string) =>
  req<{ copy: import('../types').PaperCopy; history: import('../types').PaperScanRow[] }>(
    `/papertrail/scan/${encodeURIComponent(qrNonce)}`);
export const fetchLostPapers = () =>
  req<import('../types').PaperCopy[]>('/papertrail/lost');

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

export const apiFetch = req;

export const fetchTransports = () => req<{ TranspID: number; TranspName: string }[]>('/master/transports');

export const fetchWfRebateTrailSummary = (params?: { year?: number }) => {
  const qs = new URLSearchParams();
  if (params?.year) qs.set('year', String(params.year));
  const suffix = qs.toString();
  return req<import('../types').WfRebateTrailSummary[]>(`/rebate/wf-trail-summary${suffix ? `?${suffix}` : ''}`);
};

// ยอดสะสมรีเบท — อ่านจาก WINSpeed โดยตรง ไม่มีสำเนาในแอป (ดู migration 076)
export const fetchRebateAccrual = (params: { custId?: string; empId?: number; from?: string; to?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.custId) qs.set('custId', params.custId);
  if (params.empId) qs.set('empId', String(params.empId));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString();
  return req<import('../types').RebateAccrualSummary[]>(`/rebate/accrual${suffix ? `?${suffix}` : ''}`);
};

// ล็อตของลูกค้ารายนี้ เรียงเก่าก่อน — เป็นลำดับเดียวกับที่เซิร์ฟเวอร์ตัด FIFO
export const fetchRebateAccrualLots = (
  custId: string,
  params: { lineType?: 'REBATE' | 'DIFF'; goodCode?: string; from?: string; to?: string } = {}
) => {
  const qs = new URLSearchParams();
  if (params.lineType) qs.set('lineType', params.lineType);
  if (params.goodCode) qs.set('goodCode', params.goodCode);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString();
  return req<import('../types').RebateAccrualLot[]>(`/rebate/accrual/${encodeURIComponent(custId)}${suffix ? `?${suffix}` : ''}`);
};

export const fetchWfRebateTrailList = (params: { year?: number; empId?: number; custId?: string; q?: string }) => {
  const qs = new URLSearchParams();
  if (params.year) qs.set('year', String(params.year));
  if (params.empId != null) qs.set('empId', String(params.empId));
  if (params.custId) qs.set('custId', params.custId);
  if (params.q) qs.set('q', params.q);
  return req<import('../types').WfRebateTrailRow[]>(`/rebate/wf-trail-list?${qs}`);
};

export const fetchWfRebateTrailDetail = (orderId: number | string) =>
  req<import('../types').WfRebateTrailDetail>(`/rebate/wf-trail-detail/${orderId}`);

// รายงานเครื่องชั่ง (T6-02) — แทน Crystal Reports เดิม
/**
 * @deprecated อ่าน MySQL ของ TruckScale — เลิกใช้แล้ว 02/09/2569
 * เส้นทาง `/scale-reports` ถูกปิดที่ backend (ดู server.js) ใช้ `fetchWeighingReport` แทน
 * ไม่ลบทิ้งเพื่อให้ถอยกลับได้ถ้าจำเป็น
 */
/**
 * @deprecated เลิกใช้ 03/09/2569 — `/api/scale-reports` ถูกปิดใน server.js พร้อมกับ
 * การยกเลิก MySQL TruckScale ทั้งหมด · เรียกแล้วจะได้ 404 · ใช้ `fetchWeighingReport` แทน
 * ไม่ลบทิ้งตามคำสั่งเจ้าของระบบ เผื่อต้องถอยกลับ
 */
export const fetchScaleReport = (report: string, from: string, to: string, filterParam?: string, filterValue?: string) => {
  const q = new URLSearchParams({ from, to });
  if (filterParam && filterValue) q.set(filterParam, filterValue);
  return req<{ rows: any[]; count: number; from: number; to: number }>(`/scale-reports/${report}?${q}`);
};

// ── สถานะการชั่งรถ อ่านจาก WINSpeed (WGHD/WGDT) — อ่านอย่างเดียว ─────
// แอปไม่เขียนสามตารางนี้เลย เครื่องชั่งเป็นผู้เขียน เราอ่านมาแสดงสถานะ
export type WgType = 'SO' | 'PO' | 'MO';

export type WeighCoverage = {
  Registered: number; Waiting: number; WeighedIn: number; WeighedOut: number;
  TypeSO: number; TypePO: number; TypeMO: number; WithNetWeight: number;
  FirstDate: string | null; LastDate: string | null; LastWeighOut: string | null;
  DetailRows: number; WithCoupon: number;
};
export const fetchWeighCoverage = () => req<WeighCoverage>('/weighing/coverage');

/** หนึ่งคันในคิวชั่ง · `Status` มาเป็นสตริงจากฐาน จึงประกาศเป็น number|string */
export type WeighLiveRow = {
  Id: number; WGType: WgType | null; Status: number | string; StatusText: string;
  MoveBill: string | null; Plate: string | null; DriverName: string | null;
  CVCode: string | null; PartyName: string | null;
  DateReg: string | null; DateIn: string | null; DateOut: string | null;
  WeightIn: number | null; WeightOut: number | null; WeightNet: number | null;
  TotalTon: number | null; TotalKasob: number | null;
  SPID: number | null; SODocuNo: string | null; SODocuType: number | string | null;
  SODate: string | null; AppvDocuNo: string | null; CouponFlag: string | null; clearflag: string | null;
  SoStage: 'WAITING' | 'LOADING' | 'SHIPPED' | null;
  Lines: number; CouponLines: number;
};
export type WeighTally = { waiting: number; weighedIn: number; weighedOut: number; unknown: number };

export const fetchWeighLive = (type?: WgType, sinceHours = 24) => {
  const q = new URLSearchParams({ sinceHours: String(sinceHours) });
  if (type) q.set('type', type);
  return req<{ rows: WeighLiveRow[]; count: number; tally: WeighTally; sinceHours: number; serverTime: string }>(
    `/weighing/live?${q}`);
};

export const fetchWeighAnomalies = () =>
  req<{ rows: any[]; count: number }>('/weighing/anomalies');

export const fetchWeighingReport = (report: string, from: string, to: string, type?: WgType) => {
  const q = new URLSearchParams({ from, to });
  if (type) q.set('type', type);
  return req<{ rows: any[]; count: number; from: string; to: string }>(`/weighing/${report}?${q}`);
};

export type WeighingTicketItem = {
  Id: number; ListNo: number; GoodID: number; GoodName: string;
  GoodQty2: number | null; GoodTon: number | null; GoodKasob: number | null; GoodKG: number | null;
  StoreCode: string | null; StoreName: string | null;
  StoreCode2: string | null; StoreName2: string | null;
  CouponNo: string | null; RefNo: string | null;
};
/** ใบชั่งของ WINSpeed (dbo.WGHD) — คนละตัวกับ `WeighTicket` ใน ../types ซึ่งเป็นใบชั่งของแอปเอง */
export type WeighingTicket = {
  Id: number; WGType: WgType | null; Status: number | string; StatusText: string;
  MoveBill: string | null; CarNo: string | null; DriverName: string | null;
  CVCode: string | null; CVName: string | null; SPID: number | null; DocuNo: string | null;
  DateReg: string | null;
  DateInText: string | null; WeightIn: number | null;
  DateOutText: string | null; WeightOut: number | null; WeightNet: number | null;
  TotalTon: number | null; TotalKasob: number | null;
  SODocuNo: string | null; SODocuType: number | string | null; SODate: string | null;
  AppvDocuNo: string | null; CouponFlag: string | null; SOPlate: string | null;
  items: WeighingTicketItem[];
  totals: { ton: number; kasob: number; kgFromSacks: number };
};
export const fetchWeighingTicket = (id: number) => req<WeighingTicket>(`/weighing/tickets/${id}`);

// สายอนุมัติของแบบขออนุมัติรายการส่งเสริมการขาย (ชั้น 3 = ผู้จัดการฝ่ายขาย)
export const fetchRebatePlanApprovals = (planId: number) =>
  req<any[]>(`/rebate/plans/${planId}/approvals`);

export const submitRebatePlan = (planId: number) =>
  req<{ id: number; status: string; currentTier?: number; message?: string }>(
    `/rebate/plans/${planId}/submit`, { method: 'POST', body: '{}' });

export const approveRebatePlan = (planId: number, note?: string) =>
  req<{ id: number; status: string; currentTier?: number; message?: string }>(
    `/rebate/plans/${planId}/approve`, { method: 'POST', body: JSON.stringify({ note }) });

export const rejectRebatePlan = (planId: number, reason: string) =>
  req<{ id: number; status: string; message?: string }>(
    `/rebate/plans/${planId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });

// ── Sale Trip Board (เฟส 4) ───────────────────────────────────
// ลำดับชั้น เที่ยวรถ → ลูกค้า → ใบจอง → รายการสินค้า
// ทุกอย่างเป็นการอ่านอย่างเดียว ไม่มีการเขียน dbo
export type TripLine = {
  memberKind: 'DRAFT' | 'CONFIRMED';
  memberId: string;
  listNo: number;
  goodCode: string | null;
  goodName: string | null;
  qtyTon: number | null;
  qtyBag: number | null;
  pricePerTon: number | null;
  netPricePerTon: number | null;
  lineAmount: number | null;
  isGiveaway: boolean | number;
  loadSequence: number | null;
  masterQty: number | null;
  childQty: number | null;
  refControlTicketNo: string | null;
  isControlTicketDrawn: boolean | number | null;
  giveawayApprovalStatus: string | null;
};

export type TripWeighRow = {
  id: number; carNo: string | null; dateReg: string | null;
  status: number | string; wgType: string | null;
  weightIn: number | null; weightOut: number | null; weightNet: number | null;
  tONNet: number | null; docuNo: string | null; moveBill: string | null;
};

export type TripPendingRequest = {
  id: number | string;
  memberId: string;
  stageAtRequest: string;
  reasonCode: string;
  reasonText: string | null;
  reasonDetail: string | null;
  holdTruck: boolean | number;
  requestedByName: string | null;
  requestedAt: string;
};

export type TripBooking = {
  memberKind: 'DRAFT' | 'CONFIRMED';
  memberId: string;
  docuNo: string | null;
  soPrefix: string | null;
  status: string | null;
  soid: number | null;
  deliveryDate: string | null;
  totalTon: number;
  weighing: TripWeighRow[];
  pendingRequests: TripPendingRequest[];
  lines: TripLine[];
};

export type TripCustomer = { custId: string | null; custName: string | null; bookings: TripBooking[] };

export type TripBoardRow = {
  tripId: number | string;
  tripCode: string;
  transRegistration: string | null;
  driverName: string | null;
  status: string | null;
  pickupDueDate: string | null;
  preSlingRequired: boolean | number;
  tripRemark: string | null;
  createdByName: string | null;
  orderCount: number;
  capacity: {
    capacityTon: number; tolerancePct: number; maxTon: number;
    plannedTon: number; giveawayTon: number;
    remainingTon: number | null; usedPct: number | null; over: boolean;
  };
  weighing: {
    phase: 'PLANNED' | 'REGISTERED' | 'LOADING' | 'SHIPPED' | 'PARTIAL';
    label: string;
    rows: TripWeighRow[];
  };
  hold: { held: boolean; pendingCount: number; requests: TripPendingRequest[] };
  customers: TripCustomer[];
};

export const fetchTripBoard = (params?: { status?: string; search?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('search', params.search);
  const qs = q.toString();
  return req<{ data: TripBoardRow[] }>(`/trips/board${qs ? `?${qs}` : ''}`);
};

export type LoadingPlanRow = TripLine & {
  step: number;
  docuNo: string | null;
  soPrefix: string | null;
  custId: string | null;
  custName: string | null;
  preSling: boolean;
  truckRemark: string | null;
  remark: string | null;
  split: { masterQty: number; childQty: number } | null;
};

export type LoadingPlan = {
  trip: TripBoardRow;
  totals: {
    totalTon: number; capacityTon: number; tolerancePct: number;
    maxTon: number; over: boolean; lineCount: number;
  };
  alerts: { level: 'info' | 'warn' | 'error'; text: string }[];
  plan: LoadingPlanRow[];
};

export const fetchLoadingPlan = (tripId: number | string) =>
  req<LoadingPlan>(`/trips/${tripId}/loading-plan`);

// ── คำขอแก้ไขหลังยืนยัน + Hold รถ (เฟส 5) ─────────────────────
export type EditStage = 'CONFIRMED' | 'REGISTERED' | 'LOADING' | 'SHIPPED';

export type EditReason = {
  reasonCode: string;
  reasonText: string;
  appliesTo: string;
  requiresHold: boolean | number;
  sortOrder: number;
};

export type EditRequestRow = {
  id: number | string;
  soid: string | null;
  tripId: number | string | null;
  stageAtRequest: EditStage;
  reasonCode: string;
  reasonText: string | null;
  reasonDetail: string | null;
  holdTruck: boolean | number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedBy: number | string;
  requestedByName: string | null;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  docuNo: string | null;
  custName: string | null;
  tripCode: string | null;
  transRegistration: string | null;
};

export type EditStageInfo = {
  soid: string;
  docuNo: string | null;
  custName: string | null;
  tripId: number | string | null;
  tripCode: string | null;
  transRegistration: string | null;
  stage: EditStage;
  stageLabel: string;
  editable: boolean;
  weighRows: number;
  pendingRequest: { id: number | string; reasonCode: string; holdTruck: boolean | number } | null;
};

export const fetchEditReasons = (stage?: EditStage) =>
  req<{ data: EditReason[] }>(`/edit-requests/reasons${stage ? `?stage=${stage}` : ''}`);

export const fetchEditStage = (soid: string | number) =>
  req<EditStageInfo>(`/edit-requests/stage/${soid}`);

export const fetchEditRequests = (params?: { status?: string; soid?: string; tripId?: number | string; mine?: boolean }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.soid) q.set('soid', String(params.soid));
  if (params?.tripId) q.set('tripId', String(params.tripId));
  if (params?.mine) q.set('mine', '1');
  const qs = q.toString();
  return req<{ data: EditRequestRow[] }>(`/edit-requests${qs ? `?${qs}` : ''}`);
};

export const createEditRequest = (body: { soid: string | number; reasonCode: string; reasonDetail?: string }) =>
  req<{ id: number; stage: EditStage; stageLabel: string; holdTruck: boolean; message: string }>(
    '/edit-requests', { method: 'POST', body: JSON.stringify(body) });

export const approveEditRequest = (id: number | string, note?: string) =>
  req<{ id: number; status: string; unlocked: boolean; message: string }>(
    `/edit-requests/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ note }) });

export const rejectEditRequest = (id: number | string, note: string) =>
  req<{ id: number; status: string; message: string }>(
    `/edit-requests/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ note }) });

export const cancelEditRequest = (id: number | string, note?: string) =>
  req<{ id: number; status: string; message: string }>(
    `/edit-requests/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ note }) });
