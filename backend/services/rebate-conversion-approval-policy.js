'use strict';
// Policy only: callers still need transactional reservation, reset fences,
// verified shipment evidence and an atomic audit before exposing a writer.
const { approvalIdentity } = require('./approval-identity');
const { businessIds, actorPerspective } = require('./business-identity');
const { hasPermission } = require('./role-capabilities');
function fail(code, status) { throw Object.assign(new Error(code), { code, status }); }
function authorizeConversionAction(user, action) {
  if (!['REQUEST', 'APPROVE', 'REJECT'].includes(action)) fail('REBATE_CONVERSION_ACTION_INVALID', 400);
  const identity = approvalIdentity(user), business = businessIds(user);
  if (!business.actor || !business.effective) fail('IDENTITY_BINDING_INVALID', 409);
  const permission = action === 'REQUEST' ? 'rebate.conversion.request' : 'rebate.conversion.approve';
  const actor = actorPerspective(user);
  if (!hasPermission(user, permission) || !hasPermission(actor, permission))
    fail('REBATE_CONVERSION_PERMISSION_REQUIRED', 403);
  // The owner permits the requester to approve their own request. Always
  // preserve both identity namespaces, including Access As.
  return { actorPrimaryId: identity.actorId, effectivePrimaryId: identity.effectiveId,
    actorBusinessId: business.actor, effectiveBusinessId: business.effective };
}
function nextConversionRequestStatus(status, action) {
  if (status !== 'PENDING' || !['APPROVE', 'REJECT', 'CANCEL'].includes(action))
    fail('REBATE_CONVERSION_TRANSITION_INVALID', 409);
  return action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CANCELLED';
}
module.exports = { authorizeConversionAction, nextConversionRequestStatus };
