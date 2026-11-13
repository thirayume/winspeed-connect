'use strict';

// Identities are resolved by authentication against the primary database.
function roles(value, fallback) {
  const input=Array.isArray(value)?value:[fallback];
  return [...new Set(input.filter(x=>typeof x==='string').map(x=>x.trim().toUpperCase()).filter(Boolean))];
}

function approvalIdentity(user) {
  const effectiveId=Number(user?.effectiveId ?? user?.effectiveSub ?? user?.sub ?? user?.id);
  const actorId=Number(user?.actorId ?? user?.actorSub ?? effectiveId);
  if(!Number.isSafeInteger(actorId)||actorId<1||!Number.isSafeInteger(effectiveId)||effectiveId<1) throw Object.assign(new Error('INVALID_APPROVAL_IDENTITY'),{code:'INVALID_APPROVAL_IDENTITY'});
  const impersonating=Boolean(user?.isImpersonating || actorId!==effectiveId);
  const effectiveRoles=roles(user?.roles,user?.role);
  // Never fall back to the effective identity when actor roles are unavailable.
  const actorRoles=impersonating?roles(user?.actorRoles,null):effectiveRoles;
  return {actorId,effectiveId,impersonating,actorRoles,effectiveRoles};
}

function bothHaveRole(identity, allowed) {
  const wanted=new Set(roles(allowed,null));
  return identity.effectiveRoles.some(r=>wanted.has(r)) && identity.actorRoles.some(r=>wanted.has(r));
}

function isSubmitter(identity, submitterId) {
  const id=Number(submitterId);
  return Number.isSafeInteger(id) && (id===identity.actorId||id===identity.effectiveId);
}

// For Access As, each identity must qualify in its own right. A regional
// assignment and a privileged role may satisfy the rule for different people.
async function bothQualifyForRegion(identity, allowed, hasRegion) {
  const wanted = new Set(roles(allowed, null));
  const qualifies = (id, assigned) => assigned.some(r => wanted.has(r)) || hasRegion(id);
  if (!await qualifies(identity.actorId, identity.actorRoles)) return false;
  if (identity.actorId === identity.effectiveId) return true;
  return Boolean(await qualifies(identity.effectiveId, identity.effectiveRoles));
}

module.exports={approvalIdentity,bothHaveRole,isSubmitter,bothQualifyForRegion};
