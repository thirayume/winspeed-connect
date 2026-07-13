const { sql, wfQuery, getTarget } = require('../db');

const apiAuditReady = new Map();

async function hasApiAuditTable() {
  const target = getTarget();
  if (apiAuditReady.has(target)) return apiAuditReady.get(target);
  try {
    const result = await wfQuery(`SELECT OBJECT_ID('wf.ApiAuditLog', 'U') AS ObjectId`);
    apiAuditReady.set(target, Boolean(result.recordset?.[0]?.ObjectId));
  } catch {
    apiAuditReady.set(target, false);
  }
  return apiAuditReady.get(target);
}

function shouldAudit(req, res, auditPath) {
  if (!req.user) return false;
  if (!String(auditPath || '').startsWith('/api/')) return false;
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return false;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  return res.statusCode >= 400;
}

function apiAudit() {
  return (req, res, next) => {
    const startedAt = Date.now();
    const auditPath = req.originalUrl || req.url || req.path;
    res.on('finish', () => {
      if (!shouldAudit(req, res, auditPath)) return;

      hasApiAuditTable()
        .then((ready) => {
          if (!ready) return null;
          const actorId = Number(req.user.actorSub || req.user.actorId || req.user.sub || req.user.id);
          const effectiveId = Number(req.user.sub || req.user.id);
          return wfQuery(
            `INSERT INTO wf.ApiAuditLog
              (ActorUserId, EffectiveUserId, Method, Path, StatusCode, DurationMs, IpAddress, UserAgent, CreatedAt)
             VALUES
              (@actorUserId, @effectiveUserId, @method, @path, @statusCode, @durationMs, @ipAddress, @userAgent, SYSUTCDATETIME())`,
            {
              actorUserId: { type: sql.Int, value: Number.isFinite(actorId) ? actorId : null },
              effectiveUserId: { type: sql.Int, value: Number.isFinite(effectiveId) ? effectiveId : null },
              method: { type: sql.NVarChar(12), value: req.method },
              path: { type: sql.NVarChar(500), value: auditPath },
              statusCode: { type: sql.Int, value: res.statusCode },
              durationMs: { type: sql.Int, value: Math.max(0, Date.now() - startedAt) },
              ipAddress: { type: sql.NVarChar(80), value: req.ip || null },
              userAgent: { type: sql.NVarChar(500), value: req.get('user-agent') || null },
            }
          );
        })
        .catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[api-audit]', error.message);
          }
        });
    });
    next();
  };
}

module.exports = apiAudit;
