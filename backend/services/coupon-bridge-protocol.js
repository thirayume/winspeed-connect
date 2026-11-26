'use strict';
function directEnabled(env=process.env){return env.NATIVE_COUPON_BRIDGE_DIRECT_ENABLED==='true';}
function selected(env=process.env){
 if(!directEnabled(env))return require('./coupon-bridge-hooks');
 if(env.NATIVE_COUPON_BRIDGE_ENABLED!=='true'||env.NATIVE_DOCUMENT_WRITER_VERSION!=='v3')throw Error('IP_METADATA_UNSUPPORTED');
 return require('./native-116-direct-hooks');
}
function verifyOrder(rows,env=process.env){
 if(!directEnabled(env))return;
 for(const order of require('./native-116-direct-hooks').orders){
  const found=rows.filter(r=>String(r.name).toLowerCase()===order.name.toLowerCase());
  const field=order.event==='DELETE'?'FirstDelete':'LastInsert';
  if(found.length!==1||![1,true].includes(found[0][field]))throw Error('IP_METADATA_UNSUPPORTED');
 }
}
async function verifyDirectContract(q,env=process.env){
 if(!directEnabled(env))return;
 const rows=(await q(`SELECT Enabled,ModulesHash,wf.fn_Native116HooksReady() HooksReady,CASE WHEN NULLIF(ProgramName,N'') IS NOT NULL AND DATALENGTH(LoginSid)>0
  AND ApprovedById>0 AND ApprovedAtUtc IS NOT NULL THEN 1 ELSE 0 END PolicyPinned
  FROM wf.Native116Contract WITH(HOLDLOCK) WHERE Version='NATIVE-116-DIRECT-v1'`)).recordset||[];
 if(rows.length!==1||Number(rows[0].Enabled)!==1||Number(rows[0].PolicyPinned)!==1||Number(rows[0].HooksReady)!==1
  ||rows[0].ModulesHash!==require('./native-116-direct-hooks').moduleHash)throw Error('IP_METADATA_UNSUPPORTED');
}
module.exports={directEnabled,selected,verifyOrder,verifyDirectContract};
