'use strict';
// Owner25Oct2026: WH/Account request; manager approves others. WH/Account
// may approve their own request, using the actual person during Access As.
const CREATORS=Object.freeze(['WAREHOUSE','ACCOUNTING']);
const REVIEWERS=Object.freeze(['MANAGER','C_LEVEL','ADMIN']);
function mayCreate(role){return CREATORS.includes(role);}
function decision({role,actorId,requesterActorId}){
 const self=Number.isSafeInteger(actorId)&&actorId>0&&actorId===requesterActorId;
 return {allowed:REVIEWERS.includes(role)||(self&&CREATORS.includes(role)),selfApproval:self};
}
module.exports={CREATORS,REVIEWERS,mayCreate,decision};
