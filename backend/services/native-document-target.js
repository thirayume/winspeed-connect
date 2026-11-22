'use strict';
const {fail}=require('./native-document-plan');
const POLICY='NATIVE-DOCUMENTS-v3';
const SERVER='R740-SRV\\SQL2008',PRODUCTION='dbwins_worldfert9',UAT='dbwins_worldfert9_uat',QA='dbwins_worldfert9_uat_v3';
function enabled(env=process.env){return env.NATIVE_DOCUMENT_WRITER_VERSION==='v3';}
function validateTarget(record,env=process.env){
 if(!enabled(env))fail('ND_WRITER_DISABLED',503);
 const primary=env.ONPREM_DB_NAME;
 if(env.DB_MODE!=='onprem'||env.ONPREM_EXPECTED_SERVERNAME!==SERVER||![PRODUCTION,UAT,QA].includes(primary)
  ||record?.ServerName!==SERVER||record?.DbName!==primary||record?.IsSysadmin!==0||Number(record?.ContractApproved)!==1)
  fail('ND_TARGET_NOT_READY',503);
 if((primary===PRODUCTION&&env.ONPREM_TARGET_KIND!=='production')||(primary!==PRODUCTION&&env.ONPREM_TARGET_KIND!=='uat'))fail('ND_TARGET_NOT_READY',503);
 if(primary===QA&&(env.ONPREM_SWITCHABLE_DATABASES!==QA||env.ONPREM_CONNECTION_PROFILES_DISABLE!=='true'||env.DISABLE_BACKGROUND_WORKERS!=='true'))
  fail('ND_REHEARSAL_ISOLATION_REQUIRED',503);
 return {server:SERVER,database:primary,policyVersion:POLICY,simulation:primary!==PRODUCTION};
}
async function assertTarget(q,env=process.env){
 if(!enabled(env))fail('ND_WRITER_DISABLED',503);
 const record=(await q(`SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName,DB_NAME() AS DbName,
  IS_SRVROLEMEMBER('sysadmin') AS IsSysadmin,wf.fn_IsNativeDocumentTarget() AS ContractApproved`)).recordset?.[0];
 return validateTarget(record,env);
}
module.exports={POLICY,SERVER,PRODUCTION,UAT,QA,enabled,validateTarget,assertTarget};
