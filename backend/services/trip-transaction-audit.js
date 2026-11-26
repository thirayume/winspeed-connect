'use strict';
const {wfQuery}=require('../db');
const {businessIds}=require('./business-identity');
const {currentActorId,hasColumn}=require('./request-context');
const {logChangeEvent}=require('./policy-contract');

async function requireTripAuditIdentity(user){
  const ids=businessIds(user);
  if(!Number.isSafeInteger(ids.actor)||ids.actor<=0||!Number.isSafeInteger(ids.effective)||ids.effective<=0)
    throw Object.assign(Error('TRIP_AUDIT_IDENTITY_REQUIRED'),{status:401});
  if(ids.actor!==ids.effective && (currentActorId()!==ids.actor || !await hasColumn(wfQuery,'wf.ChangeEvent','ActorUserId')))
    throw Object.assign(Error('TRIP_ACTOR_AUDIT_UNAVAILABLE'),{status:503});
  return ids;
}
async function logTripChange(tx,{tripId,action,before,after,effectiveId,reasonCode='TRIP_LOAD_PLAN'}){
  await logChangeEvent(tx,{entityType:'SALES_TRIP',entityId:String(tripId),action,
    beforeJson:before,afterJson:after,reasonCode,userId:String(effectiveId)});
}
module.exports={requireTripAuditIdentity,logTripChange};
