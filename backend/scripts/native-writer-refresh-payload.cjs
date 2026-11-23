'use strict';
// Read-only proof after restore, before UAT workflow resumes. No cross-DB query.
const {UAT}=require('../services/native-document-target');
if(process.env.ONPREM_DB_NAME!==UAT||process.env.ONPREM_TARGET_KIND!=='uat'||process.env.ONPREM_SWITCHABLE_DATABASES!==UAT)
 throw Error('NATIVE_REFRESH_UAT_ONLY');
const db=require('../db'),{copiedApproval}=require('../services/native-writer-refresh');
(async()=>{
 await db.pools().ready;
 await require('../services/initial-invoice-metadata').verifyOperationalMetadata(db.wfQuery,null,{env:{NATIVE_COUPON_BRIDGE_ENABLED:'true'}});
 const contract=(await db.wfQuery("SELECT IsEnabled,MetadataHash,ApprovedById,ApprovedActorId FROM wf.NativeWriterContract WHERE DatabaseName='dbwins_worldfert9' AND ServerName='R740-SRV\\SQL2008' AND PolicyVersion='NATIVE-DOCUMENTS-v3'")).recordset?.[0];
 const release=(await db.wfQuery("SELECT TOP 1 * FROM wf.NativeWriterRelease WHERE DatabaseName='dbwins_worldfert9' ORDER BY CreatedAtUtc DESC,ReleaseId DESC")).recordset?.[0];
 const bridge=(await db.wfQuery("SELECT Enabled,ModulesHash FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1'")).recordset?.[0];
 const events=release?(await db.wfQuery("SELECT AfterJson FROM wf.ChangeEvent WHERE EntityType='NATIVE_WRITER_RELEASE' AND EntityId=@id",{id:{type:db.sql.VarChar(36),value:String(release.ReleaseId)}})).recordset:[];
 if(events.length!==1)throw Error('NATIVE_REFRESH_SOURCE_AUDIT_REQUIRED');
 const audit=JSON.parse(events[0].AfterJson);
 const p=copiedApproval({database:UAT,sourceRevision:process.argv[2],contract,release,bridge,audit});
 console.log('NATIVE_REFRESH_PAYLOAD_BASE64='+Buffer.from(JSON.stringify(p)).toString('base64'));
})().catch(()=>{console.error('NATIVE_REFRESH_PROOF_FAILED');process.exitCode=1}).finally(()=>db.closeAll());
