'use strict';
const {sql}=require('../db');
const {input}=require('./native-document-source');
const {fail,id}=require('./native-document-plan');
async function currentProof(q,nativeId){
 const row=(await q(`DECLARE @h nvarchar(max),@l nvarchar(max);EXEC wf.sp_CouponBridgePhysical @n,@h OUTPUT,@l OUTPUT;
  SELECT b.NativeId,b.State,b.Revision,b.HeaderProof,b.LineProof,@h AS CurrentHeader,@l AS CurrentLines,
   CASE WHEN EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@n
    AND ReleasedAtUtc IS NULL AND State<>'CANCELLED') THEN 1 ELSE 0 END AS Pending
  FROM(SELECT @n AS Id)x LEFT JOIN wf.CouponBridgeDocument b WITH(UPDLOCK,HOLDLOCK) ON b.NativeId=x.Id`,
  {n:input(sql.Int,id(nativeId))})).recordset?.[0];
 if(!row)fail('ND_CUT_PROOF_REQUIRED');
 if(row.Pending)fail('ND_CUT_BRIDGE_REVIEW_REQUIRED');
 if(row.NativeId&&(row.State!=='ACTIVE'||row.HeaderProof!==row.CurrentHeader||row.LineProof!==row.CurrentLines))fail('ND_CUT_DIVERGED');
 return row.NativeId?row:null;
}
module.exports={currentProof};
