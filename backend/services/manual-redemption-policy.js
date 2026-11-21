'use strict';
// Owner25Oct2026: WH/Account request; manager approves others. WH/Account
// may approve their own request, using the actual person during Access As.
const CREATORS=Object.freeze(['WAREHOUSE','ACCOUNTING']);
const REVIEWERS=Object.freeze(['MANAGER','C_LEVEL','ADMIN']);
const any=(role,allowed)=>(Array.isArray(role)?role:[role]).some(r=>allowed.includes(r));
// Owner, 21 Nov 2026: ADMIN, the highest role, may request, approve its own request (an exception included) and apply.
function mayCreate(role){return any(role,CREATORS)||any(role,['ADMIN']);}
function decision({role,actorId,requesterActorId}){
 const self=Number.isSafeInteger(actorId)&&actorId>0&&actorId===requesterActorId;
 return {allowed:any(role,REVIEWERS)||(self&&any(role,CREATORS)),selfApproval:self};
}
const mayApproveOwnException=role=>any(role,['ADMIN']);
module.exports={CREATORS,REVIEWERS,mayCreate,decision,mayApproveOwnException};
