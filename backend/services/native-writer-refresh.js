'use strict';
const {UAT,PRODUCTION}=require('./native-document-target');
const {payload}=require('./native-writer-release');
const hooks=require('./coupon-bridge-hooks'),{EXPECTED}=require('./initial-invoice-metadata');
function copiedApproval({database,sourceRevision,contract,release,bridge,audit,native116,expectedDirect}){
 const direct=audit?.native116Policy?.enabled===true;
 if((audit?.native116Policy&&typeof audit.native116Policy.enabled!=='boolean')||(expectedDirect!==undefined&&expectedDirect!==direct))throw Error('NATIVE_REFRESH_APPROVAL_UNAVAILABLE');
 const selected=direct?require('./native-116-direct-hooks'):hooks;
 if(database!==UAT||!contract||!release||!bridge||Number(contract.IsEnabled)!==1||contract.MetadataHash!==EXPECTED
  ||release.Action!=='ENABLE'||release.DatabaseName!==PRODUCTION||release.ServerName!=='R740-SRV\\SQL2008'
  ||release.ModulesHash!==selected.moduleHash||Number(bridge.Enabled)!==1||bridge.ModulesHash!==selected.moduleHash
  ||contract.ApprovedById!==release.ApprovedById||contract.ApprovedActorId!==release.ActorId
  ||!/^[a-f0-9-]{36}$/i.test(String(release.ReleaseId||''))||audit?.sourceRevision!==sourceRevision
  ||audit?.writerEnabled!==true||audit?.bridgeEnabled!==true)throw Error('NATIVE_REFRESH_APPROVAL_UNAVAILABLE');
 if(direct&&(!native116||Number(native116.Enabled)!==1||native116.ModulesHash!==selected.moduleHash||Number(native116.HooksReady)!==1||native116.ProgramName!==audit.native116Policy.programName
  ||String(native116.LoginSidHex||'').toLowerCase()!==audit.native116Policy.loginSidHex
  ||Number(native116.ApprovedById)!==Number(release.ApprovedById)))throw Error('NATIVE_REFRESH_APPROVAL_UNAVAILABLE');
 if(!direct&&Number(native116?.Enabled)===1)throw Error('NATIVE_REFRESH_APPROVAL_UNAVAILABLE');
 const p=payload({database,sourceRevision,action:'ENABLE',approverId:Number(release.ApprovedById),actorId:Number(release.ActorId),
  reason:'UAT restore rebind of copied approved Production release; current source and native metadata reverified',
  directNative116:direct,...(direct?{nativeProgramName:native116.ProgramName,nativeLoginSidHex:native116.LoginSidHex}: {})});
 return {...p,refreshParentReleaseId:release.ReleaseId};
}
module.exports={copiedApproval};
