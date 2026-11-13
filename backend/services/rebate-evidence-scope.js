'use strict';
const { actorPerspective }=require('./business-identity');
const { getVisibleScope,inScope }=require('./visible-scope');
const { isValidStartDate }=require('./data-window');
function notFound(){throw Object.assign(new Error('REBATE_EVIDENCE_NOT_FOUND'),{code:'REBATE_EVIDENCE_NOT_FOUND',status:404});}

// Call after locking the 116 source, inside the same business transaction.
async function assertEvidenceScope(query,user,source,{startDate,getScope=getVisibleScope}={}) {
  if(typeof query!=='function' || !isValidStartDate(startDate))notFound();
  // A 116 can be backdated yet physically shipped after the reset. The
  // financial decision checks the event time; the display layer redacts old
  // document details rather than discarding that possible opening balance.
  const header=(await query(`SELECT RedemtionID FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK)
    WHERE RedemtionID=@redemptionId AND DocuType=116`,
  {redemptionId:source.redemptionId})).recordset || [];
  if(header.length!==1)notFound();
  const effective=await getScope(user,query),actor=await getScope(actorPerspective(user),query);
  if(effective.all&&actor.all)return;
  const id=Number(source.sourceSOID);
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)notFound();
  const owner=(await query(`SELECT EmpID FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
    WHERE SOID=@sourceSOID AND DocuType=104`,{sourceSOID:id})).recordset || [];
  if(owner.length!==1 || !inScope(effective,{empId:owner[0].EmpID}) || !inScope(actor,{empId:owner[0].EmpID}))notFound();
}
module.exports={assertEvidenceScope};
