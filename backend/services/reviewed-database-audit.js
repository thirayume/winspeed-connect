'use strict';
// A durable authorization-attempt record is required before a reviewed
// cross-database read can reach its handler. A separate async response log
// may follow; status 102 identifies this record as an admitted attempt, not
// the eventual HTTP result.
const { businessIds } = require('./business-identity');

async function recordReviewedReadAttempt(req, primaryDatabase, businessDatabase, db = require('../db')) {
  const mapping = req.user?.identityMapping;
  const ids = businessIds(req.user);
  const actor = Number(req.user?.actorSub);
  const effective = Number(req.user?.sub);
  const route = String(req.originalUrl || '').split('?')[0];
  if (req.method !== 'GET' || !route.startsWith('/api/') || !primaryDatabase || !businessDatabase ||
      !mapping || !mapping.identityServer || !mapping.businessServer ||
      !Number.isSafeInteger(actor) || actor < 1 || !Number.isSafeInteger(effective) || effective < 1 ||
      !ids.actor || !ids.effective) {
    throw Object.assign(new Error('REVIEWED_AUDIT_INVALID'), { code: 'REVIEWED_AUDIT_INVALID' });
  }
  const { sql } = db;
  return db.runWithTarget('onprem', () => db.wfQuery(`INSERT INTO wf.ApiAuditLog
    (ActorUserId, EffectiveUserId, Method, Path, StatusCode, DurationMs, CreatedAt,
     IdentityDatabase, BusinessDatabase, BusinessActorUserId, BusinessEffectiveUserId, IdentityServer, BusinessServer)
    VALUES (@actor, @effective, @method, @path, 102, 0, SYSUTCDATETIME(),
      @identityDatabase, @businessDatabase, @businessActor, @businessEffective, @identityServer, @businessServer)`, {
    actor: { type: sql.Int, value: actor }, effective: { type: sql.Int, value: effective },
    method: { type: sql.NVarChar(12), value: req.method }, path: { type: sql.NVarChar(500), value: route.slice(0,500) },
    identityDatabase: { type: sql.NVarChar(128), value: primaryDatabase },
    businessDatabase: { type: sql.NVarChar(128), value: businessDatabase },
    businessActor: { type: sql.Int, value: ids.actor }, businessEffective: { type: sql.Int, value: ids.effective },
    identityServer: { type: sql.NVarChar(128), value: String(mapping.identityServer) },
    businessServer: { type: sql.NVarChar(128), value: String(mapping.businessServer) },
  }), primaryDatabase);
}
module.exports = { recordReviewedReadAttempt };
