const db = require('../db');
const { sql, wfQuery, getTarget } = db;

const apiAuditReady = new Map();

async function hasApiAuditTable() {
  const key = JSON.stringify([getTarget(), db.getDbName?.() || '']);
  if (apiAuditReady.has(key)) return apiAuditReady.get(key);
  try {
    const result = await wfQuery(`SELECT OBJECT_ID('wf.ApiAuditLog', 'U') AS ObjectId,
      COL_LENGTH('wf.ApiAuditLog', 'IdentityDatabase') AS IdentityColumn,
      COL_LENGTH('wf.ApiAuditLog', 'BusinessDatabase') AS BusinessColumn,
      COL_LENGTH('wf.ApiAuditLog', 'BusinessActorUserId') AS BusinessActorColumn,
      COL_LENGTH('wf.ApiAuditLog', 'BusinessEffectiveUserId') AS BusinessEffectiveColumn,
      COL_LENGTH('wf.ApiAuditLog', 'IdentityServer') AS IdentityServerColumn,
      COL_LENGTH('wf.ApiAuditLog', 'BusinessServer') AS BusinessServerColumn`);
    const row = result.recordset?.[0] || {};
    const ready = { table: Boolean(row.ObjectId), provenance: row.IdentityColumn != null && row.BusinessColumn != null,
      mapped: row.BusinessActorColumn != null && row.BusinessEffectiveColumn != null && row.IdentityServerColumn != null && row.BusinessServerColumn != null };
    if (ready.table) apiAuditReady.set(key, ready);
    return ready;
  } catch {
    return { table: false, provenance: false };
  }
}

function shouldAudit(req, res, auditPath) {
  if (!req.user) return false;
  if (!String(auditPath || '').startsWith('/api/')) return false;
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return false;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  // A reviewed cross-database read must be attributable to both identities,
  // even when it succeeds; it can expose data from a separate business DB.
  if (req.identityMappingAudit) return true;
  return res.statusCode >= 400;
}

function apiAudit() {
  return (req, res, next) => {
    const startedAt = Date.now();
    // Do not persist search parameters, which can contain customer data or
    // secrets. The route remains sufficient for the audit trail.
    const auditPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
    res.on('finish', () => {
      if (!shouldAudit(req, res, auditPath)) return;
      const target = getTarget();
      const businessDatabase = req.auditBusinessDatabase || db.getDbName?.() || null;
      const identityDatabase = target === 'onprem' ? require('../services/active-database').primaryDatabase() : db.getDbName?.() || null;
      if (target === 'onprem' && !identityDatabase) {
        console.error('[api-audit] AUDIT_PRIMARY_DATABASE_UNAVAILABLE');
        return;
      }
      const writeAudit = () => hasApiAuditTable()
        .then((ready) => {
          if (!ready.table) {
            console.error('[api-audit] AUDIT_TABLE_UNAVAILABLE');
            return null;
          }
          const actorId = Number(req.user.actorSub || req.user.actorId || req.user.sub || req.user.id);
          const effectiveId = Number(req.user.sub || req.user.id);
          const provenanceColumns = ready.provenance ? ', IdentityDatabase, BusinessDatabase' : '';
          const provenanceValues = ready.provenance ? ', @identityDatabase, @businessDatabase' : '';
          // This is set by trusted server-side identity mapping only, never by
          // request body or token. Until mapping is wired these remain NULL.
          const mapping = req.identityMappingAudit;
          const mappedId = value => Number.isSafeInteger(value) && value > 0 ? value : null;
          const mappingColumns = ready.mapped ? ', BusinessActorUserId, BusinessEffectiveUserId, IdentityServer, BusinessServer' : '';
          const mappingValues = ready.mapped ? ', @businessActorUserId, @businessEffectiveUserId, @identityServer, @businessServer' : '';
          return wfQuery(
            `INSERT INTO wf.ApiAuditLog
              (ActorUserId, EffectiveUserId, Method, Path, StatusCode, DurationMs, IpAddress, UserAgent, CreatedAt${provenanceColumns}${mappingColumns})
             VALUES
              (@actorUserId, @effectiveUserId, @method, @path, @statusCode, @durationMs, @ipAddress, @userAgent, SYSUTCDATETIME()${provenanceValues}${mappingValues})`,
            {
              actorUserId: { type: sql.Int, value: Number.isFinite(actorId) ? actorId : null },
              effectiveUserId: { type: sql.Int, value: Number.isFinite(effectiveId) ? effectiveId : null },
              method: { type: sql.NVarChar(12), value: req.method },
              path: { type: sql.NVarChar(500), value: auditPath },
              statusCode: { type: sql.Int, value: res.statusCode },
              durationMs: { type: sql.Int, value: Math.max(0, Date.now() - startedAt) },
              ipAddress: { type: sql.NVarChar(80), value: req.ip || null },
              userAgent: { type: sql.NVarChar(500), value: req.get('user-agent') || null },
              ...(ready.provenance ? {
                identityDatabase: { type: sql.NVarChar(128), value: identityDatabase },
                businessDatabase: { type: sql.NVarChar(128), value: businessDatabase },
              } : {}),
              ...(ready.mapped ? {
                businessActorUserId: { type: sql.Int, value: mappedId(mapping?.businessActorUserId) },
                businessEffectiveUserId: { type: sql.Int, value: mappedId(mapping?.businessEffectiveUserId) },
                identityServer: { type: sql.NVarChar(128), value: mapping?.identityServer || null },
                businessServer: { type: sql.NVarChar(128), value: mapping?.businessServer || null },
              } : {}),
            }
          );
        })
        .catch(() => {
          // Audit loss must be visible in production. Never log raw driver
          // messages, SQL parameters, customer data, credentials or headers.
          // This is diagnostic only: business transactions still need their
          // own transactional audit and must not rely on this async hook.
          console.error('[api-audit] AUDIT_WRITE_FAILED');
        });
      if (target === 'onprem') db.runWithTarget(target, writeAudit, identityDatabase);
      else writeAudit();
    });
    next();
  };
}

module.exports = apiAudit;
