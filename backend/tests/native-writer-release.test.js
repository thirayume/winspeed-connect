'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {payload,originals,digest}=require('../services/native-writer-release');
const baseline=require('../services/native-document-metadata.json').triggers;
const base=()=>({database:'dbwins_worldfert9_uat_v3',approverId:1,actorId:2,reason:'Approved isolated release rehearsal with current metadata',sourceRevision:'QA-WORKTREE'});
test('restore rebind accepts only a current copied Production approval, never a new or disabled approval',()=>{
 const {copiedApproval}=require('../services/native-writer-refresh');
 const metadata=require('../services/initial-invoice-metadata').EXPECTED,hash=require('../services/coupon-bridge-hooks').moduleHash;
 const input={database:'dbwins_worldfert9_uat',sourceRevision:'a'.repeat(40),contract:{IsEnabled:1,MetadataHash:metadata,ApprovedById:1,ApprovedActorId:2},
 release:{ReleaseId:'11111111-1111-4111-8111-111111111111',Action:'ENABLE',DatabaseName:'dbwins_worldfert9',ServerName:'R740-SRV\\SQL2008',ModulesHash:hash,ApprovedById:1,ActorId:2},bridge:{Enabled:1,ModulesHash:hash},audit:{sourceRevision:'a'.repeat(40),writerEnabled:true,bridgeEnabled:true}};
 assert.equal(copiedApproval(input).refreshParentReleaseId,input.release.ReleaseId);
 for(const change of [{database:'dbwins_worldfert9'},{contract:{...input.contract,IsEnabled:0}},{release:{...input.release,Action:'DISABLE'}},
  {release:{...input.release,ActorId:3}},{bridge:{Enabled:1,ModulesHash:'other'}},{audit:{...input.audit,sourceRevision:'b'.repeat(40)}},{audit:null}])assert.throws(()=>copiedApproval({...input,...change}));
});
test('v3 refuses new reservations during activation gaps but legacy reads need no bridge query',async()=>{
 const {assertNativeReservationReady}=require('../services/native-writer-availability');
 await assertNativeReservationReady(()=>{throw Error('must not query')},{NATIVE_DOCUMENT_WRITER_VERSION:'legacy'});
 const env={NATIVE_DOCUMENT_WRITER_VERSION:'v3',NATIVE_COUPON_BRIDGE_ENABLED:'true'},hash=require('../services/coupon-bridge-hooks').moduleHash;
 await assertNativeReservationReady(async()=>({recordset:[{TargetReady:1,Enabled:1,ModulesHash:hash}]}),env);
 for(const row of [null,{TargetReady:0,Enabled:1,ModulesHash:hash},{TargetReady:1,Enabled:0,ModulesHash:hash},{TargetReady:1,Enabled:1,ModulesHash:'other'}])
  await assert.rejects(assertNativeReservationReady(async()=>({recordset:row?[row]:[]}),env),{code:'COUPON_NATIVE_WRITER_NOT_READY'});
 await assert.rejects(assertNativeReservationReady(async()=>{throw Error('SQL unavailable')},env),{code:'COUPON_NATIVE_WRITER_NOT_READY'});
});
test('release refuses foreign targets, invented reviewers, missing evidence and uncommitted live revisions',()=>{
 for(const change of [{database:'dbwins_worldfert2'},{database:'master'},{database:'dbwins_worldfert9'},
  {approverId:0},{actorId:1.5},{reason:'short'},{sourceRevision:'HEAD'},{action:'RESET'}])assert.throws(()=>payload({...base(),...change}));
 for(const db of ['dbwins_worldfert9','dbwins_worldfert9_uat'])assert.equal(payload({...base(),database:db,sourceRevision:'a'.repeat(40)}).database,db);
});
test('deactivation recovers the exact original four custom hooks; native fingerprints remain unchanged',()=>{
 const p=payload(base());assert.equal(p.migrations.length,15);assert.equal(p.hooks.length,4);assert.equal(originals().length,4);
 for(const h of p.originalHooks){const b=baseline.find(r=>r[1]===h.name.toLowerCase());assert.equal(digest(h.sql.replace('ALTER TRIGGER ','CREATE TRIGGER ')),b[3]);assert.equal(h.disabled,b[2]);}
 for(let i=0;i<baseline.length;i++)if(!p.hooks.some(h=>h.name.toLowerCase()===baseline[i][1]))assert.deepEqual(p.expected[i],baseline[i]);
 assert.equal(payload(base()).sourceHash,p.sourceHash);
});
