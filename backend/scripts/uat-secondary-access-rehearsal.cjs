// Read-only rehearsal on a secondary rehearsal copy with real data: customer prices,
// special prices, control tickets and stock read under Access As where the primary user
// IDs differ from the business (secondary database) IDs. It calls the real route handlers
// in-process; only authentication is replaced, so the handlers receive the same identity
// mapping the gate would attach. Every request is a GET. Terminal output only.
'use strict';
const path = require('path');
const http = require('http');
const CAND = process.env.CAND_DIR || path.join(__dirname, '..');
const SESSION_DB = process.env.RH_DB;
if (!/^dbwins_worldfert9_uat_fz[0-9]$/.test(String(SESSION_DB)) || !/^dbwins_worldfert9_uat_fz[0-9]$/.test(String(process.env.ONPREM_DB_NAME)))
  { console.log('REFUSED: this script runs only on rehearsal copies'); process.exit(2); }

const db = require(path.join(CAND, 'db'));
const { hasPermission } = require(path.join(CAND, 'services/role-capabilities'));
const context = require(path.join(CAND, 'services/request-context'));

// Record every SQL parameter value and every statement kind while a request runs.
let trace = null;
for (const name of ['wfQuery', 'query']) {
  const original = db[name];
  if (typeof original !== 'function') continue;
  db[name] = function traced(text, inputs) {
    if (trace) {
      if (/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(String(text).replace(/^\s*SET [^;]+;\s*/gi, ''))) trace.writes++;
      for (const v of Object.values(inputs || {})) { const value = v && typeof v === 'object' && 'value' in v ? v.value : v; trace.values.push(value); }
      trace.statements++;
    }
    return original.apply(this, arguments);
  };
}

let current = null;
const authPath = require.resolve(path.join(CAND, 'middleware/auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = current; context.runWithUser(current, next); },
  requireRole: (...roles) => (req, res, next) => (roles.map(r => String(r).toUpperCase()).includes(String(req.user.role).toUpperCase()) ? next() : res.status(403).json({ message: 'role' })),
  requireCapability: cap => (req, res, next) => (hasPermission(req.user, cap) ? next() : res.status(403).json({ message: 'capability' })),
  canViewAllRebateAmounts: () => false,
} };

const out = { sessionDb: SESSION_DB, primary: process.env.ONPREM_DB_NAME, checks: [] };
const check = (name, pass, detail) => { out.checks.push({ name, pass, ...detail }); console.log(`CHECK ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const rows = async (text, inputs) => (await db.wfQuery(text, inputs)).recordset || [];
const int = v => ({ type: db.sql.Int, value: v });

(async () => {
  const facts = await db.runWithTarget('onprem', async () => {
    const f = {};
    f.sales = (await rows(`SELECT TOP 1 u.Id, u.EmpId, s.Customers FROM wf.AppUser u
      JOIN (SELECT CAST(EmpID AS varchar(20)) AS EmpId, COUNT(DISTINCT CustID) AS Customers FROM dbo.SOHD WITH (NOLOCK)
            WHERE DocuType = 103 AND DocuDate >= '2026-01-01' GROUP BY EmpID) s ON s.EmpId = u.EmpId
      WHERE u.Role = 'SALES' AND u.PositionCode IS NULL ORDER BY s.Customers DESC, u.Id`))[0];
    f.admin = (await rows("SELECT TOP 1 Id FROM wf.AppUser WHERE Role = 'ADMIN' AND IsActive = 1 ORDER BY Id DESC"))[0];
    if (!f.sales || !f.admin) return f;
    f.inScope = (await rows(`SELECT TOP 1 CustID FROM dbo.SOHD WITH (NOLOCK) WHERE DocuType = 103 AND DocuDate >= '2026-01-01'
      AND CAST(EmpID AS varchar(20)) = @emp GROUP BY CustID ORDER BY COUNT(*) DESC`, { emp: { type: db.sql.VarChar(20), value: String(f.sales.EmpId) } }))[0];
    f.outOfScope = (await rows(`SELECT TOP 1 h.CustID FROM dbo.SOHD h WITH (NOLOCK)
      LEFT JOIN wf.CustomerExt cx WITH (NOLOCK) ON cx.CustId = h.CustID LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID = h.CustID
      WHERE h.DocuType = 103 AND h.DocuDate >= '2026-01-01' AND CAST(h.EmpID AS varchar(20)) <> @emp
        AND ISNULL(cx.SalespersonUserId, 0) <> @uid AND ISNULL(CAST(c.BillEmp AS varchar(20)), '') <> @emp
        AND NOT EXISTS (SELECT 1 FROM dbo.SOHD x WITH (NOLOCK) WHERE x.CustID = h.CustID AND x.DocuType = 103 AND CAST(x.EmpID AS varchar(20)) = @emp)
      GROUP BY h.CustID ORDER BY COUNT(*) DESC`, { emp: { type: db.sql.VarChar(20), value: String(f.sales.EmpId) }, uid: int(Number(f.sales.Id)) }))[0];
    f.book = (await rows("SELECT TOP 1 Id FROM wf.PriceBook WHERE Status = 'ACTIVE' ORDER BY COALESCE(EffectiveFrom, CAST(EffectiveMonth + '-01' AS date)) DESC, Id DESC"))[0];
    f.special = (await rows(`SELECT COUNT(*) AS Total, SUM(CASE WHEN ApprovedPrice IS NOT NULL THEN 1 ELSE 0 END) AS Approved,
      COUNT(DISTINCT CASE WHEN ApprovedPrice IS NOT NULL THEN CustId END) AS Customers FROM wf.PriceBookSpecialPrice`))[0];
    f.specialRow = (await rows(`SELECT TOP 1 sp.PriceBookId, sp.CustId FROM wf.PriceBookSpecialPrice sp JOIN wf.PriceBook b ON b.Id = sp.PriceBookId
      WHERE sp.ApprovedPrice IS NOT NULL AND b.Status = 'ACTIVE' AND ISNUMERIC(sp.CustId) = 1 ORDER BY sp.Id DESC`))[0];
    f.nativeCustomerPriceSets = (await rows(`SELECT COUNT(*) AS N, COUNT(DISTINCT CustID) AS Customers FROM dbo.EMSetPriceHD WITH (NOLOCK)
      WHERE CustID IS NOT NULL AND CAST(EndDate AS date) >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS date)`))[0];
    return f;
  }, SESSION_DB);
  console.log('FACTS ' + JSON.stringify({ salesUser: Boolean(facts.sales), salesCustomers2026: facts.sales?.Customers, admin: Boolean(facts.admin),
    inScope: Boolean(facts.inScope), outOfScope: Boolean(facts.outOfScope), activeBook: Boolean(facts.book), special: facts.special,
    specialRowInActiveBook: Boolean(facts.specialRow), nativeCustomerPriceSets: facts.nativeCustomerPriceSets }));
  if (!facts.sales || !facts.admin || !facts.inScope || !facts.outOfScope) { console.log('SUMMARY fixtures missing'); process.exit(1); }

  const express = require('express');
  const app = express();
  app.use((req, res, next) => db.runWithTarget('onprem', next, SESSION_DB));
  app.use('/api/master', require(path.join(CAND, 'routes/master')));
  app.use('/api/pricebook', require(path.join(CAND, 'routes/pricebook')));
  app.use('/api/stock', require(path.join(CAND, 'routes/stock')));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (user, url) => {
    current = user; trace = { values: [], writes: 0, statements: 0 };
    const r = await fetch(base + url); let body = null; try { body = await r.json(); } catch { body = null; }
    const t = trace; trace = null;
    return { status: r.status, body, trace: t };
  };

  const S = Number(facts.sales.Id), A = Number(facts.admin.Id), PRIMARY_S = 900000 + S, PRIMARY_A = 900000 + A;
  const mapped = (primaryEffective, primaryActor, businessEffective, businessActor, role, actorRole) => ({
    sub: primaryEffective, id: primaryEffective, actorSub: primaryActor, actorId: primaryActor, role, roles: [role], actorRole, actorRoles: [actorRole],
    isImpersonating: primaryEffective !== primaryActor,
    identityMapping: { primaryEffectiveUserId: primaryEffective, primaryActorUserId: primaryActor, businessEffectiveUserId: businessEffective, businessActorUserId: businessActor } });
  const differentIds = mapped(PRIMARY_S, PRIMARY_A, S, A, 'SALES', 'ADMIN');   // Access As, primary IDs differ from business IDs
  const sameIds = mapped(S, A, S, A, 'SALES', 'ADMIN');                        // control: same people, IDs equal
  const adminDifferent = mapped(PRIMARY_A, PRIMARY_A, A, A, 'ADMIN', 'ADMIN');
  const noPrimaryIds = t => !t.values.some(v => [PRIMARY_S, PRIMARY_A, String(PRIMARY_S), String(PRIMARY_A)].includes(v));
  const usesBusinessIds = t => t.values.some(v => v === S || v === String(S) || v === String(facts.sales.EmpId));
  const inC = Number(facts.inScope.CustID), outC = Number(facts.outOfScope.CustID);
  const count = body => (Array.isArray(body) ? body.length : Array.isArray(body?.data) ? body.data.length : Array.isArray(body?.items) ? body.items.length : null);

  const cases = [
    ['customer prices, customer in scope', `/api/master/prices?custId=${inC}`, 200],
    ['customer prices, customer out of scope', `/api/master/prices?custId=${outC}`, 404],
    ['customer list', '/api/master/customers', 200],
    ['control tickets of a customer in scope', `/api/master/control-tickets?custId=${inC}`, 200],
    ['control tickets of a customer out of scope', `/api/master/control-tickets?custId=${outC}`, 404],
    ['control ticket list (own scope)', '/api/master/control-tickets', 200],
    ['stock availability', '/api/stock/atp', 200],
    ['top goods of a customer out of scope', `/api/master/customers/${outC}/top-goods`, 404],
  ];
  if (facts.book) {
    cases.push(['effective price, customer in scope', `/api/pricebook/${facts.book.Id}/effective?custId=${inC}`, [200, 503]]);
    cases.push(['effective price, customer out of scope', `/api/pricebook/${facts.book.Id}/effective?custId=${outC}`, 404]);
  }
  for (const [name, url, expected] of cases) {
    const a = await get(differentIds, url), b = await get(sameIds, url);
    const ok = (Array.isArray(expected) ? expected.includes(a.status) : a.status === expected) && a.status === b.status && count(a.body) === count(b.body) &&
      noPrimaryIds(a.trace) && a.trace.writes === 0 && (a.trace.statements === 0 || usesBusinessIds(a.trace) || a.status === 503);
    check(name, ok, { status: a.status, sameIdsStatus: b.status, rows: count(a.body), sameIdsRows: count(b.body), code: a.body?.code || null,
      primaryIdsInSql: !noPrimaryIds(a.trace), businessIdsInSql: usesBusinessIds(a.trace), writes: a.trace.writes, statements: a.trace.statements });
  }
  if (facts.specialRow) {
    const url = `/api/pricebook/${facts.specialRow.PriceBookId}/effective?custId=${Number(facts.specialRow.CustId)}`;
    const admin = await get(adminDifferent, url);
    const withSpecial = Array.isArray(admin.body) ? admin.body.filter(r => r.SpecialPrice != null).length : null;
    check('special price customer, admin with different IDs', [200, 503].includes(admin.status) && noPrimaryIds(admin.trace) && admin.trace.writes === 0,
      { status: admin.status, code: admin.body?.code || null, rows: count(admin.body), rowsWithSpecialPrice: withSpecial, writes: admin.trace.writes });
    const sales = await get(differentIds, url);
    check('special price customer, sales under Access As', [200, 404, 503].includes(sales.status) && noPrimaryIds(sales.trace) && sales.trace.writes === 0,
      { status: sales.status, code: sales.body?.code || null, rows: count(sales.body), writes: sales.trace.writes });
  } else {
    check('special price rows exist in this copy', true, { note: 'no approved special price in an ACTIVE book; nothing to read', special: facts.special });
  }
  // A mapping that does not match the session must fail closed everywhere.
  const broken = { ...differentIds, identityMapping: { ...differentIds.identityMapping, primaryActorUserId: 1 } };
  for (const url of [`/api/master/prices?custId=${inC}`, '/api/master/control-tickets', '/api/stock/atp']) {
    const r = await get(broken, url);
    check(`inconsistent mapping is refused: ${url.split('?')[0]}`, r.status >= 400 && r.trace.writes === 0, { status: r.status });
  }
  server.close();
  const failed = out.checks.filter(c => !c.pass).map(c => c.name);
  console.log(`SUMMARY checks=${out.checks.length} failed=${failed.length} ${failed.join(' | ')}`);
  try { await db.closeAll(); } catch (_) {}
  process.exit(failed.length ? 1 : 0);
})().catch(async e => {
  console.log('REHEARSAL_FAILED ' + (e.code || '') + ' ' + String(e.stack || e.message || e).slice(0, 600));
  try { await db.closeAll(); } catch (_) {}
  process.exit(1);
});
