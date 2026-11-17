'use strict';
const { businessIds } = require('./business-identity');
const { currentActorId, hasColumn } = require('./request-context');
const { wfQuery } = require('../db');
const { logChangeEvent } = require('./policy-contract');

async function stockIdentity(user) {
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective) throw Object.assign(Error('STOCK_AUDIT_IDENTITY_REQUIRED'), { status: 401 });
  if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId')))
    throw Object.assign(Error('STOCK_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
  return ids;
}
async function stockAudit(tx, { entityId, action, before, after, ids, ipAddress }) {
  await logChangeEvent(tx, { entityType: 'OPERATIONAL_STOCK', entityId, action, beforeJson: before,
    afterJson: after, reasonCode: 'STOCK_CHANGE', userId: String(ids.effective), ipAddress });
}
module.exports = { stockIdentity, stockAudit };
