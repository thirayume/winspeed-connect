'use strict';
const { resolveReviewedActorAndEffective, sqlRepository } = require('./database-identity-resolver');
function fail() { throw Object.assign(new Error('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE'), { code: 'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE', status: 503 }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const same = (a,b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function resolveResetBusinessIdentity({ actorId, effectiveId, primaryTarget, target, db }, options = {}) {
  if (![actorId,effectiveId].every(positive) || !primaryTarget || !target || !db) fail();
  const repo = options.repository || sqlRepository(db, options.isSwitchableDb || require('../onprem-target').isSwitchableDb);
  if (same(primaryTarget.name, target.name)) {
    const actor = await repo.readUser(primaryTarget.name, actorId);
    const effective = actorId === effectiveId ? actor : await repo.readUser(primaryTarget.name, effectiveId);
    for (const [result, id] of [[actor, actorId], [effective, effectiveId]]) {
      if (!result?.user || Number(result.user.Id) !== id || !Number(result.user.IsActive) ||
          !same(result.database, primaryTarget.database) || !same(result.server, primaryTarget.expectedServerName)) fail();
    }
    return { businessActorId: actorId, businessEffectiveId: effectiveId };
  }
  let resolved;
  try { resolved = await (options.resolve || resolveReviewedActorAndEffective)({ actorUserId: actorId, effectiveUserId: effectiveId,
    primaryDatabase: primaryTarget.name, targetDatabase: target.name }, repo); } catch (_) { fail(); }
  if (!positive(resolved?.businessActorUserId) || !positive(resolved?.businessEffectiveUserId) ||
      !same(resolved.identityServer, primaryTarget.expectedServerName) || !same(resolved.businessServer, target.expectedServerName)) fail();
  return { businessActorId: resolved.businessActorUserId, businessEffectiveId: resolved.businessEffectiveUserId };
}
module.exports = { resolveResetBusinessIdentity };
