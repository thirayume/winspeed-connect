'use strict';

// `identityMapping` is produced by trusted auth middleware after it verifies
// both accounts and the reviewed binding. JWT claims and HTTP input must never
// populate it. Without a mapping the existing single-database IDs apply.
function positive(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function businessIds(user) {
  const primaryEffective = positive(user?.sub ?? user?.id);
  const primaryActor = positive(user?.actorSub ?? user?.actorId ?? primaryEffective);
  const map = user?.identityMapping;
  if (!map) return { effective: primaryEffective, actor: primaryActor };
  const effective = positive(map.businessEffectiveUserId);
  const actor = positive(map.businessActorUserId);
  if (!primaryEffective || !primaryActor || !effective || !actor ||
      positive(map.primaryEffectiveUserId) !== primaryEffective || positive(map.primaryActorUserId) !== primaryActor ||
      (primaryEffective === primaryActor) !== (effective === actor)) {
    throw Object.assign(new Error('IDENTITY_BINDING_INVALID'), { code: 'IDENTITY_BINDING_INVALID', status: 409 });
  }
  return { effective, actor };
}

// Build the real actor's perspective for scope checks during Access As. Never
// inherit effective-user roles or permissions for the actor.
function actorPerspective(user) {
  const primaryEffective = positive(user?.sub ?? user?.id);
  const primaryActor = positive(user?.actorSub ?? user?.actorId ?? primaryEffective);
  if (!primaryActor || !primaryEffective) throw Object.assign(new Error('IDENTITY_BINDING_INVALID'), { code: 'IDENTITY_BINDING_INVALID', status: 409 });
  if (!user?.isImpersonating && primaryActor === primaryEffective) return user;
  const ids = businessIds(user);
  const mapped = user.identityMapping;
  return { ...user, sub: primaryActor, id: primaryActor, actorSub: primaryActor, actorId: primaryActor,
    isImpersonating: false, role: user.actorRole, roles: user.actorRoles,
    permissions: user.actorPermissions, disabledActions: user.actorDisabledActions,
    identityMapping: mapped ? { ...mapped, primaryActorUserId: primaryActor, primaryEffectiveUserId: primaryActor,
      businessActorUserId: ids.actor, businessEffectiveUserId: ids.actor } : undefined };
}

module.exports = { businessIds, actorPerspective };
