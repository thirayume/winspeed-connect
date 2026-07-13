const jwt = require('jsonwebtoken');
const { sql, wfQuery } = require('../db');
const { SECRET } = require('../middleware/auth');

const API_BASE = process.env.API_SMOKE_BASE_URL || 'http://localhost:3000/api';
const ROLE_RANK = {
  SALES: 1,
  COUNTER_SALES: 2,
  APPROVER: 3,
  ACCOUNTING: 4,
  MANAGER: 5,
  ADMIN: 6,
};

function assert(condition, message, detail) {
  if (!condition) {
    const err = new Error(message);
    if (detail !== undefined) err.detail = detail;
    throw err;
  }
}

function rank(role) {
  return ROLE_RANK[String(role || '').toUpperCase()] || 0;
}

function tokenFor(user, actor = user) {
  const effectiveId = Number(user.Id);
  const actorId = Number(actor.Id);
  return jwt.sign({
    sub: effectiveId,
    id: effectiveId,
    username: user.Username,
    role: String(user.Role || '').toUpperCase(),
    displayName: user.DisplayName,
    actorSub: actorId,
    actorId,
    actorUsername: actor.Username,
    actorRole: String(actor.Role || '').toUpperCase(),
    actorDisplayName: actor.DisplayName,
    impersonating: actorId !== effectiveId,
  }, SECRET, { expiresIn: '30m' });
}

async function request(path, options = {}) {
  const started = Date.now();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, ms: Date.now() - started, body };
}

async function loadSmokeUsers() {
  const result = await wfQuery(`
    SELECT Id, Username, DisplayName, Role, EmpId, IsActive
    FROM wf.AppUser WITH (NOLOCK)
    WHERE IsActive = 1
  `);
  const users = result.recordset || [];
  const actor = users
    .filter((u) => ['ADMIN', 'MANAGER', 'ACCOUNTING', 'APPROVER', 'COUNTER_SALES'].includes(String(u.Role || '').toUpperCase()))
    .sort((a, b) => rank(b.Role) - rank(a.Role) || Number(a.Id) - Number(b.Id))[0];
  assert(actor, 'No active Access As actor role found in wf.AppUser');

  const actorRank = rank(actor.Role);
  const target = users
    .filter((u) => Number(u.Id) !== Number(actor.Id) && rank(u.Role) > 0 && rank(u.Role) <= actorRank)
    .sort((a, b) => rank(a.Role) - rank(b.Role) || Number(a.Id) - Number(b.Id))[0];
  assert(target, 'No valid Access As target found in wf.AppUser');
  return { actor, target };
}

async function latestAccessAuditCount(actorId, effectiveId) {
  const result = await wfQuery(`
    SELECT COUNT(*) AS Cnt
    FROM wf.AccessAsAudit WITH (NOLOCK)
    WHERE ActorUserId = @actorId
      AND EffectiveUserId = @effectiveId
      AND CreatedAt >= DATEADD(minute, -5, SYSUTCDATETIME())
  `, {
    actorId: { type: sql.Int, value: Number(actorId) },
    effectiveId: { type: sql.Int, value: Number(effectiveId) },
  });
  return Number(result.recordset?.[0]?.Cnt || 0);
}

async function latestApiAuditCount(actorId) {
  const result = await wfQuery(`
    SELECT COUNT(*) AS Cnt,
           SUM(CASE WHEN EffectiveUserId = ActorUserId THEN 1 ELSE 0 END) AS ActorEffectiveRows,
           SUM(CASE WHEN EffectiveUserId <> ActorUserId THEN 1 ELSE 0 END) AS ImpersonatedEffectiveRows
    FROM wf.ApiAuditLog WITH (NOLOCK)
    WHERE ActorUserId = @actorId
      AND Path LIKE '/api/auth/access-as%'
      AND CreatedAt >= DATEADD(minute, -5, SYSUTCDATETIME())
  `, {
    actorId: { type: sql.Int, value: Number(actorId) },
  });
  return {
    total: Number(result.recordset?.[0]?.Cnt || 0),
    actorEffectiveRows: Number(result.recordset?.[0]?.ActorEffectiveRows || 0),
    impersonatedEffectiveRows: Number(result.recordset?.[0]?.ImpersonatedEffectiveRows || 0),
  };
}

async function main() {
  const steps = [];
  const { actor, target } = await loadSmokeUsers();
  const actorToken = tokenFor(actor);

  async function step(name, fn) {
    const started = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, status: 'PASS', ms: Date.now() - started, detail });
    } catch (error) {
      steps.push({ name, status: 'FAIL', ms: Date.now() - started, message: error.message, detail: error.detail });
      throw error;
    }
  }

  await step('health', async () => {
    const res = await request('/health');
    assert(res.ok && res.body?.ok === true, 'Health endpoint failed', res);
    return { http: res.status, sqlserver: res.body.db?.sqlserver, mysql: res.body.db?.mysql, ms: res.ms };
  });

  await step('auth guard rejects missing token', async () => {
    const res = await request('/auth/me');
    assert(res.status === 401, 'Expected /auth/me without token to return 401', res);
    return { http: res.status, ms: res.ms };
  });

  await step('auth me accepts signed token', async () => {
    const res = await request('/auth/me', { token: actorToken });
    assert(res.ok && Number(res.body?.id) === Number(actor.Id), 'Expected /auth/me to return actor user', res);
    return { http: res.status, role: res.body.role, ms: res.ms };
  });

  await step('access-as candidates', async () => {
    const res = await request('/auth/access-as/candidates', { token: actorToken });
    assert(res.ok && Array.isArray(res.body), 'Expected Access As candidates array', res);
    assert(res.body.some((u) => Number(u.Id ?? u.id) === Number(target.Id)), 'Expected selected target in Access As candidates', {
      targetId: target.Id,
      candidateCount: res.body.length,
    });
    return { http: res.status, candidateCount: res.body.length, ms: res.ms };
  });

  let accessToken;
  await step('start access-as', async () => {
    const res = await request('/auth/access-as', {
      method: 'POST',
      token: actorToken,
      body: JSON.stringify({ userId: Number(target.Id) }),
    });
    assert(res.ok && res.body?.accessToken, 'Expected Access As token', res);
    assert(Number(res.body.user?.id) === Number(target.Id), 'Expected effective user to be target', res.body?.user);
    assert(Number(res.body.user?.actorId) === Number(actor.Id), 'Expected actor id to stay real user', res.body?.user);
    assert(res.body.user?.isImpersonating === true, 'Expected impersonation flag', res.body?.user);
    accessToken = res.body.accessToken;
    return { http: res.status, effectiveRole: res.body.user.role, actorRole: res.body.user.actorRole, ms: res.ms };
  });

  await step('access-as me uses effective user', async () => {
    const res = await request('/auth/me', { token: accessToken });
    assert(res.ok, 'Expected /auth/me with Access As token to pass', res);
    assert(Number(res.body?.id) === Number(target.Id), 'Expected effective user in /auth/me', res.body);
    assert(Number(res.body?.actorId) === Number(actor.Id), 'Expected real actor in /auth/me', res.body);
    return { http: res.status, effectiveRole: res.body.role, isImpersonating: res.body.isImpersonating, ms: res.ms };
  });

  await step('master goods/transports', async () => {
    const goods = await request('/master/goods', { token: accessToken });
    const transports = await request('/master/transports', { token: accessToken });
    assert(goods.ok && Array.isArray(goods.body), 'Expected goods array', goods);
    assert(transports.ok && Array.isArray(transports.body), 'Expected transports array', transports);
    return { goods: goods.body.length, goodsMs: goods.ms, transports: transports.body.length, transportsMs: transports.ms };
  });

  await step('so stats/list', async () => {
    const stats = await request('/so/stats?bust=1', { token: accessToken });
    const list = await request('/so?page=1&limit=5', { token: accessToken });
    assert(stats.ok && typeof stats.body?.total === 'number', 'Expected SO stats total', stats);
    assert(list.ok && Array.isArray(list.body?.data), 'Expected paginated SO list', list);
    return { total: stats.body.total, listRows: list.body.data.length, statsMs: stats.ms, listMs: list.ms };
  });

  await step('quotation list includes native WINSpeed docs', async () => {
    const res = await request('/quotation', { token: accessToken });
    assert(res.ok && Array.isArray(res.body), 'Expected quotation list array', res);
    const docNos = new Set(res.body.map((q) => q.WinspeedQuoteNo || q.quoteNo || q.QuoteNo));
    assert(docNos.has('QU6907-00001') && docNos.has('QU6907-00002'), 'Expected native quotation samples in list', Array.from(docNos).slice(0, 10));
    return { count: res.body.length, hasPending: docNos.has('QU6907-00001'), hasAccepted: docNos.has('QU6907-00002'), ms: res.ms };
  });

  await step('stop access-as', async () => {
    const res = await request('/auth/access-as/stop', { method: 'POST', token: accessToken, body: '{}' });
    assert(res.ok && Number(res.body.user?.id) === Number(actor.Id), 'Expected stop to return actor user', res);
    assert(res.body.user?.isImpersonating === false, 'Expected impersonation stopped', res.body?.user);
    return { http: res.status, role: res.body.user.role, ms: res.ms };
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
  await step('audit rows written', async () => {
    const accessRows = await latestAccessAuditCount(actor.Id, target.Id);
    const apiRows = await latestApiAuditCount(actor.Id);
    assert(accessRows >= 2, 'Expected AccessAsAudit START/STOP rows', { accessRows });
    assert(apiRows.total >= 1, 'Expected ApiAuditLog row for Access As API', { apiRows });
    return { accessRows, apiRows };
  });

  console.log(JSON.stringify({
    ok: true,
    baseUrl: API_BASE,
    actor: { id: actor.Id, role: actor.Role, displayName: actor.DisplayName },
    target: { id: target.Id, role: target.Role, displayName: target.DisplayName },
    steps,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    detail: error.detail,
  }, null, 2));
  process.exit(1);
});
