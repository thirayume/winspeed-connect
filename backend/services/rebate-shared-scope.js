'use strict';
const { approvalIdentity } = require('./approval-identity');
const { businessIds } = require('./business-identity');
const { getVisibleScope, scopeFilter } = require('./visible-scope');

// Both identities of an Access As session must independently have scope.
async function sharedRebateScopeFilter(user, scopeReader = getVisibleScope) {
  const identity = approvalIdentity(user);
  const business = businessIds(user);
  const effective = scopeFilter(await scopeReader(user), { empCol: 'SalesEmpId', prefix: 'rcv' });
  if (!identity.impersonating) return effective;
  const mapped = user.identityMapping;
  const actorUser = { ...user, sub: identity.actorId, id: identity.actorId, actorSub: identity.actorId,
    actorId: identity.actorId, isImpersonating: false, role: user.actorRole, roles: user.actorRoles,
    permissions: user.actorPermissions, disabledActions: user.actorDisabledActions,
    identityMapping: mapped ? { ...mapped, primaryActorUserId: identity.actorId, primaryEffectiveUserId: identity.actorId,
      businessActorUserId: business.actor, businessEffectiveUserId: business.actor } : undefined };
  const actor = scopeFilter(await scopeReader(actorUser), { empCol: 'SalesEmpId', prefix: 'rca' });
  return { sql: `(${effective.sql}) AND (${actor.sql})`, inputs: { ...effective.inputs, ...actor.inputs } };
}
module.exports = { sharedRebateScopeFilter };
