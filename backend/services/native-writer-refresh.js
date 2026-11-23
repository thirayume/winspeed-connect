'use strict';
const {UAT,PRODUCTION}=require('./native-document-target');
const {payload}=require('./native-writer-release');
const hooks=require('./coupon-bridge-hooks'),{EXPECTED}=require('./initial-invoice-metadata');
function copiedApproval({database,sourceRevision,contract,release,bridge,audit}){
 if(database!==UAT||!contract||!release||!bridge||Number(contract.IsEnabled)!==1||contract.MetadataHash!==EXPECTED
  ||release.Action!=='ENABLE'||release.DatabaseName!==PRODUCTION||release.ServerName!=='R740-SRV\\SQL2008'
  ||release.ModulesHash!==hooks.moduleHash||Number(bridge.Enabled)!==1||bridge.ModulesHash!==hooks.moduleHash
  ||contract.ApprovedById!==release.ApprovedById||contract.ApprovedActorId!==release.ActorId
  ||!/^[a-f0-9-]{36}$/i.test(String(release.ReleaseId||''))||audit?.sourceRevision!==sourceRevision
  ||audit?.writerEnabled!==true||audit?.bridgeEnabled!==true)throw Error('NATIVE_REFRESH_APPROVAL_UNAVAILABLE');
 const p=payload({database,sourceRevision,action:'ENABLE',approverId:Number(release.ApprovedById),actorId:Number(release.ActorId),
  reason:'UAT restore rebind of copied approved Production release; current source and native metadata reverified'});
 return {...p,refreshParentReleaseId:release.ReleaseId};
}
module.exports={copiedApproval};
