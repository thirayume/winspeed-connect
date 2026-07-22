/* smoke test TC-4..TC-7 (new v8 features) against a running local API */
const BASE = process.env.SMOKE_API || 'http://localhost:3100/api';
const PW = process.env.E2E_PASSWORD || 'W0rldF3rt';
const H = { 'Content-Type': 'application/json', 'X-DB-Target': 'local' };
let TOK = '';

const api = async (path, init = {}) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...H, ...(TOK ? { Authorization: `Bearer ${TOK}` } : {}), ...(init.headers || {}) },
  });
  const txt = await res.text();
  let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  return { status: res.status, body };
};

const pass = [], fail = [];
const check = (name, ok, detail) => {
  (ok ? pass : fail).push(name);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  // login
  const lg = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'e2e_admin', password: PW }) });
  if (lg.status !== 200) { console.error('login failed', lg.status, lg.body); process.exit(1); }
  TOK = lg.body.accessToken;
  console.log(`logged in as ${lg.body.user.username} (${lg.body.user.role})\n`);

  // ---------- TC-7b : Ops / observability ----------
  console.log('TC-7b  สถานะระบบ (Ops)');
  const st = await api('/ops/status');
  check('GET /ops/status = 200', st.status === 200);
  check('มี version + uptime', !!st.body?.version, `v${st.body?.version}, up ${st.body?.uptimeSec}s`);
  check('SQL Server = up', st.body?.db?.sqlserver === 'up', st.body?.db?.sqlserver);
  check('MySQL (TruckScale) = up', st.body?.db?.mysql === 'up', st.body?.db?.mysql);
  const ob = await api('/ops/outbox');
  check('GET /ops/outbox = 200', ob.status === 200, `events=${ob.body?.recent?.length ?? 0}`);
  const er = await api('/ops/errors?limit=5');
  check('GET /ops/errors = 200', er.status === 200, `source=${er.body?.source}`);

  // ---------- TC-4 : Weigh Inbox (TruckScale pull) ----------
  console.log('\nTC-4   Weigh Inbox — ดึงข้อมูลชั่งจาก TruckScale');
  const p0 = await api('/truckscale/ping');
  check('truckscale/ping ok', p0.status === 200 && p0.body?.ok === true, `total=${p0.body?.totalWeighings}`);
  const sync = await api('/truckscale/sync/run', { method: 'POST', body: '{}' });
  check('POST /truckscale/sync/run = 200', sync.status === 200,
    sync.body?.error ? 'ERR ' + sync.body.error : `ingested=${sync.body?.ingested} refreshed=${sync.body?.refreshed}`);
  const ss = await api('/truckscale/sync/status');
  check('sync/status มี watermark', ss.status === 200 && !!ss.body?.watermark,
    `lastSid=${ss.body?.watermark?.LastSid} total=${ss.body?.watermark?.TotalIngested}`);
  const inbox = await api('/truckscale/inbox?status=COMPLETED&limit=20');
  const rows = inbox.body?.data ?? (Array.isArray(inbox.body) ? inbox.body : []);
  check('inbox มีรายการชั่งจริง', rows.length > 0,
    `${rows.length} แสดง / ${inbox.body?.pagination?.total ?? '?'} ทั้งหมด`);
  if (rows.length) {
    const r = rows[0];
    check('รายการมีทะเบียน + น้ำหนักสุทธิ', !!r.Plate && r.WeightNet != null,
      `${r.Plate} net=${r.WeightNet} mb=${r.Movebill}`);
    check('มีผลการจับคู่ SO', !!r.MatchStatus, r.MatchStatus);
  }

  // ---------- TC-5 : Reconciliation ----------
  console.log('\nTC-5   กระทบยอด (Reconciliation)');
  const rs = await api('/recon/summary?days=3650');
  check('GET /recon/summary = 200', rs.status === 200,
    `total=${rs.body?.total} exception=${rs.body?.exception} ok=${rs.body?.ok}`);
  const rc = await api('/recon/cases?days=3650');
  const cases = Array.isArray(rc.body) ? rc.body : [];
  check('recon/cases คืนรายการ', rc.status === 200, `${cases.length} เคส`);
  if (cases.length) {
    const c = cases[0];
    check('เคสมีผลตรวจ weigh + invoice', !!c.weigh && !!c.invoice, `weigh=${c.weigh} invoice=${c.invoice}`);
    const rv = await api(`/recon/${encodeURIComponent(c.soId)}/resolve`, {
      method: 'POST', body: JSON.stringify({ checkType: 'INVOICE', action: 'IGNORE', note: 'smoke test', wfRef: c.wfRef }),
    });
    check('resolve/ignore ได้', rv.status === 200, `status=${rv.body?.status}`);
  }

  // ---------- TC-6 : Credit Hold ----------
  console.log('\nTC-6   Credit Hold');
  const CUST = 'SMOKE01';
  const up = await api(`/credit/${CUST}`, {
    method: 'PUT', body: JSON.stringify({ custName: 'ลูกค้าทดสอบ smoke', creditLimit: 100000, creditHold: true, note: 'smoke test' }),
  });
  check('ตั้ง credit hold ได้', up.status === 200);
  const cg = await api(`/credit/${CUST}`);
  check('อ่านกลับได้ + hold = true', cg.status === 200 && cg.body?.CreditHold === true, `limit=${cg.body?.CreditLimit}`);
  const pol = await api('/policy/resolve?caseType=CREDIT_OVERRIDE');
  check('approval policy ตอบ role ผู้อนุมัติ', pol.status === 200 && !!pol.body?.RequiredRole, pol.body?.RequiredRole);
  await api(`/credit/${CUST}`, { method: 'PUT', body: JSON.stringify({ creditHold: false, note: 'smoke cleanup' }) });

  // ---------- TC-7 : Price Book ----------
  console.log('\nTC-7   Price Book workflow');
  const month = new Date().toISOString().slice(0, 7);
  const cr = await api('/pricebook', { method: 'POST', body: JSON.stringify({ name: `Smoke ${Date.now()}`, effectiveMonth: month, seedFromCurrent: true, note: 'smoke test' }) });
  check('สร้าง Price Book (DRAFT) + seed ราคา', cr.status === 200 && !!cr.body?.id, `id=${cr.body?.id}`);
  const id = cr.body?.id;
  if (id) {
    const d1 = await api(`/pricebook/${id}`);
    check('มีรายการราคาจาก seed', (d1.body?.lines?.length || 0) > 0, `${d1.body?.lines?.length} รายการ`);
    const ap = await api(`/pricebook/${id}/approve`, { method: 'POST', body: '{}' });
    check('อนุมัติ (DRAFT→APPROVED)', ap.status === 200, ap.body?.status);
    const ac = await api(`/pricebook/${id}/activate`, { method: 'POST', body: '{}' });
    check('เปิดใช้งาน (APPROVED→ACTIVE)', ac.status === 200, ac.body?.status);
    const d2 = await api(`/pricebook/${id}`);
    check('audit ครบ 3 ขั้น', (d2.body?.audit?.length || 0) >= 3, `${d2.body?.audit?.length} รายการ`);
    await api(`/pricebook/${id}/archive`, { method: 'POST', body: '{}' });
  }

  console.log(`\n================  ผ่าน ${pass.length} / ล้มเหลว ${fail.length}  ================`);
  if (fail.length) { console.log('FAILED:'); fail.forEach(f => console.log('  - ' + f)); }
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
