'use strict';
// A QA-only opt-in, never imported by the production server or Compose kit.
const {QA,SERVER}=require('../services/native-document-target');
const FLAGS=Object.freeze(['REBATE_POOL_103_ENABLED','REBATE_CONVERSION_ENABLED',
 'REBATE_CONVERSION_APPROVAL_ENABLED','REBATE_RESET_ADMIN_ENABLED',
 'REBATE_RESET_FENCE_AUDIT_COMPLETE','REBATE_EVIDENCE_DISCOVERY_ENABLED','REBATE_TICKET_PREVIEW_ENABLED']);
function assertQaProfile(env=process.env){
 if(env.DB_MODE!=='onprem'||env.ONPREM_TARGET_KIND!=='uat'||env.ONPREM_EXPECTED_SERVERNAME!==SERVER
  ||env.ONPREM_DB_NAME!==QA||env.ONPREM_SWITCHABLE_DATABASES!==QA
  ||env.DISABLE_BACKGROUND_WORKERS!=='true'||env.ONPREM_CONNECTION_PROFILES_DISABLE!=='true')
  throw Error('QA_RUNTIME_ISOLATION_REQUIRED');
 const rebate=env.QA_NATIVE_REBATE_PROFILE==='on';
 if(env.QA_NATIVE_REBATE_PROFILE&&!['off','on'].includes(env.QA_NATIVE_REBATE_PROFILE))
  throw Error('QA_REBATE_PROFILE_INVALID');
 const active=Object.entries(env).filter(([k,v])=>k.startsWith('REBATE_')&&v==='true').map(([k])=>k);
 if(!rebate&&active.length)throw Error('QA_REBATE_PROFILE_REQUIRED');
 const treatment=env.REBATE_TICKET_REDEMPTION_TREATMENT;
 if(rebate&&(env.REBATE_RESET_DATABASES!==QA||![QA+':ZERO',QA+':DISCOUNT'].includes(treatment)
  ||FLAGS.some(k=>env[k]!=='true')||active.some(k=>!FLAGS.includes(k))))
  throw Error('QA_REBATE_TARGETS_OR_FLAGS_INVALID');
 return Object.freeze({database:QA,rebate,treatment:rebate?treatment.split(':')[1]:null,backgroundWorkers:false});
}
async function assertQaAccess(query){
 const row=(await query(`SELECT DB_NAME() AS DbName,HAS_DBACCESS('dbwins_worldfert9') AS MainAccess,
  HAS_DBACCESS('dbwins_worldfert2') AS CompanyAccess,HAS_DBACCESS('dbwins_worldfert9_uat') AS UatAccess,
  IS_SRVROLEMEMBER('sysadmin') AS IsSysadmin,IS_MEMBER('db_owner') AS IsOwner`)).recordset?.[0];
 if(!row||row.DbName!==QA||[row.MainAccess,row.CompanyAccess,row.UatAccess,row.IsSysadmin,row.IsOwner].some(v=>v!==0))
  throw Error('QA_ACCESS_NOT_ISOLATED');
}
module.exports={FLAGS,assertQaProfile,assertQaAccess};
