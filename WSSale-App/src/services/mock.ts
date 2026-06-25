/**
 * mock.ts — Mock API สำหรับ demo บน Vercel (ไม่ต้องมี backend)
 * เปิดด้วย env VITE_USE_MOCKUP_DATA=true · ข้อมูลจริง (sample 100 ชุด) จาก sample-data.json
 * GET = คืนข้อมูลจริง · write = คืน success จำลอง (ไม่ persist — รีโหลดแล้ว reset)
 */
import sample from '../mock/sample-data.json';
import { getDbMode } from '../store/db-mode';

export const isMock = () => getDbMode() === 'mock';

const d: any = sample;
const delay = (ms = 150) => new Promise(r => setTimeout(r, ms));

function paginate<T>(rows: T[], params: URLSearchParams) {
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 50);
  const start = (page - 1) * limit;
  return { data: rows.slice(start, start + limit), total: rows.length, page, limit };
}

export async function mockRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const [rawPath, qs] = path.split('?');
  const p = new URLSearchParams(qs || '');
  const body = init?.body ? JSON.parse(init.body as string) : {};
  await delay();

  // ── AUTH ──────────────────────────────────────────────────
  if (rawPath === '/auth/login' && method === 'POST') {
    const u = d.users.find((x: any) => x.Username === body.username) || d.users[0]
      || { Id: 1, Username: 'admin', DisplayName: 'ผู้ดูแลระบบ (Demo)', Role: 'ADMIN' };
    return { accessToken: 'mock.demo.token', user: { id: u.Id, username: u.Username, displayName: u.DisplayName + ' (Demo)', role: u.Role } } as T;
  }
  if (rawPath === '/auth/me') return { sub: 1, username: 'admin', role: 'ADMIN', displayName: 'ผู้ดูแลระบบ (Demo)' } as T;
  if (rawPath === '/auth/users' && method === 'GET') return d.users as T;
  if (rawPath.startsWith('/auth/users') && (method === 'PATCH' || method === 'POST')) return { ok: true, id: 1 } as T;

  // ── MASTER ────────────────────────────────────────────────
  if (rawPath === '/master/customers') {
    const q = (p.get('q') || '').toLowerCase();
    const rows = q ? d.customers.filter((c: any) => (c.CustName || '').toLowerCase().includes(q) || String(c.CustID).includes(q)) : d.customers;
    return rows as T;
  }
  if (rawPath === '/master/goods') return d.goods as T;
  if (rawPath.startsWith('/master/customers/') && method === 'PATCH') return { ok: true } as T;
  if (rawPath.startsWith('/master/goods/') && method === 'PATCH') return { ok: true } as T;
  if (rawPath === '/master/employees') return d.employees as T;
  if (rawPath === '/master/prices') return d.prices as T;
  if (rawPath === '/master/aging') return d.aging as T;
  if (rawPath === '/master/giveaway-goods') return (d.giveaway.items || []).map((i: any) => ({ GoodID: String(i.Id), GoodName: i.ItemName })) as T;
  if (rawPath === '/master/control-tickets' || rawPath === '/master/invoices') return [] as T;

  // ── SALES ORDERS ──────────────────────────────────────────
  if (rawPath === '/so/stats') return d.soStats as T;
  if (rawPath === '/so' && method === 'GET') {
    const status = p.get('status');
    let rows = d.salesOrders as any[];
    if (status) rows = rows.filter(s => s.status === status);
    return paginate(rows, p) as T;
  }
  if (rawPath === '/so' && method === 'POST') return { id: 999, wfRef: 'WF69I-DEMO01', needsApproval: false } as T;
  const soId = rawPath.match(/^\/so\/(\d+)$/);
  if (soId && method === 'GET') {
    const so = d.salesOrders.find((s: any) => String(s.id) === soId[1]);
    return { ...(so || {}), auditLogs: [] } as T;
  }
  if (/^\/so\/\d+\/(confirm|picking|ship|unlock|cancel|sync-imported)$/.test(rawPath)) {
    const action = rawPath.split('/').pop();
    const map: any = { confirm: 'CONFIRMED', picking: 'PICKING', ship: 'SHIPPED', unlock: 'DRAFT', cancel: 'CANCELLED', 'sync-imported': 'IMPORTED' };
    return { id: Number(rawPath.split('/')[2]), status: map[action!], importFilePath: 'C:\\wssale-exports\\DEMO' } as T;
  }

  // ── REBATE ────────────────────────────────────────────────
  if (rawPath === '/rebate/pools') return d.rebate.pools as T;
  if (rawPath === '/rebate/ledger') {
    const poolId = p.get('poolId');
    const rows = poolId ? d.rebate.ledger.filter((l: any) => String(l.PoolId) === poolId) : d.rebate.ledger;
    return rows as T;
  }
  if (rawPath === '/rebate/claims' && method === 'GET') return (d.rebate.claims || []) as T;
  if (rawPath === '/rebate/claims' && method === 'POST') return { Id: 999, ClaimAmt: body.claimAmt, Status: 'PENDING' } as T;
  if (rawPath === '/rebate/summary') return d.rebate.summary as T;
  if (/^\/rebate\/claims\/\d+\/approve$/.test(rawPath)) return { id: 1, status: 'APPROVED' } as T;

  // ── GIVEAWAY ──────────────────────────────────────────────
  if (rawPath === '/giveaway/regions') return d.giveaway.regions as T;
  if (rawPath === '/giveaway/budget-lines') return (d.giveaway.budgetLines[p.get('region') || ''] || []) as T;
  if (rawPath === '/giveaway/withdrawals' && method === 'GET') return (d.giveaway.withdrawals[p.get('region') || ''] || []) as T;
  if (rawPath === '/giveaway/items') {
    const brand = p.get('brand');
    return (brand ? d.giveaway.items.filter((i: any) => i.Brand === brand) : d.giveaway.items) as T;
  }
  if (rawPath === '/giveaway/withdrawals' && method === 'POST') return { ok: true, status: null, isOverBudget: false } as T;
  if (rawPath === '/giveaway/budgets' && method === 'POST') return { ok: true } as T;

  // ── QUOTATION ─────────────────────────────────────────────
  if (rawPath === '/quotation' && method === 'GET') return d.quotations as T;
  if (rawPath === '/quotation' && method === 'POST') return { id: 999, quoteNo: 'QT69-DEMO01' } as T;
  const qId = rawPath.match(/^\/quotation\/(\d+)$/);
  if (qId && method === 'GET') return d.quotations.find((q: any) => String(q.Id) === qId[1]) as T;
  if (/^\/quotation\/\d+\/convert$/.test(rawPath)) return { quoteId: 1, soId: 999, wfRef: 'WF69I-DEMO01' } as T;
  if (/^\/quotation\/\d+\/status$/.test(rawPath)) return { id: 1, status: body.status } as T;

  // ── PAPER TRAIL ───────────────────────────────────────────
  if (rawPath === '/papertrail/board') return d.paperBoard as T;

  // ── HEALTH / fallback ─────────────────────────────────────
  if (rawPath === '/health') return { ok: true, mock: true } as T;
  console.warn('[mock] unhandled', method, rawPath);
  return ({} as T);
}
