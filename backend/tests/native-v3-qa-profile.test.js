'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {FLAGS,assertQaProfile,assertQaAccess}=require('../scripts/native-v3-qa-profile.cjs');
const {QA,SERVER}=require('../services/native-document-target');
const base=()=>({DB_MODE:'onprem',ONPREM_TARGET_KIND:'uat',ONPREM_EXPECTED_SERVERNAME:SERVER,
 ONPREM_DB_NAME:QA,ONPREM_SWITCHABLE_DATABASES:QA,DISABLE_BACKGROUND_WORKERS:'true',ONPREM_CONNECTION_PROFILES_DISABLE:'true'});
const on=()=>({...base(),QA_NATIVE_REBATE_PROFILE:'on',REBATE_RESET_DATABASES:QA,
 REBATE_TICKET_REDEMPTION_TREATMENT:QA+':ZERO',...Object.fromEntries(FLAGS.map(k=>[k,'true']))});
test('QA default stays Rebate-off; reviewed profile pins all Rebate operations to one isolated database',()=>{
 assert.equal(assertQaProfile(base()).rebate,false);assert.equal(assertQaProfile(on()).rebate,true);
 assert.equal(assertQaProfile({...on(),REBATE_TICKET_REDEMPTION_TREATMENT:QA+':DISCOUNT'}).treatment,'DISCOUNT');
 assert.throws(()=>assertQaProfile({...base(),REBATE_POOL_103_ENABLED:'true'}),/PROFILE_REQUIRED/);
});
test('QA profile rejects live databases, profiles, workers, partial or unknown activation',()=>{
 for(const change of [{ONPREM_DB_NAME:'dbwins_worldfert9'},{ONPREM_SWITCHABLE_DATABASES:QA+',dbwins_worldfert2'},
  {ONPREM_EXPECTED_SERVERNAME:'elsewhere'},{ONPREM_TARGET_KIND:'production'},{DB_MODE:'remote_b'},
  {ONPREM_CONNECTION_PROFILES_DISABLE:'false'},{DISABLE_BACKGROUND_WORKERS:'false'},
  {REBATE_RESET_DATABASES:QA+',dbwins_worldfert9'},{REBATE_RESET_DATABASES:'*'},
  {REBATE_TICKET_REDEMPTION_TREATMENT:'dbwins_worldfert9:DISCOUNT'},{REBATE_POOL_103_ENABLED:'false'},
  {REBATE_UNREVIEWED_ENABLED:'true'},{QA_NATIVE_REBATE_PROFILE:'ON'}])
  assert.throws(()=>assertQaProfile({...on(),...change}),undefined,JSON.stringify(change));
});
test('QA actual principal must have no live access and no server/database ownership',async()=>{
 const good={DbName:QA,MainAccess:0,CompanyAccess:0,UatAccess:0,IsSysadmin:0,IsOwner:0};
 const query=row=>async()=>({recordset:[row]});
 await assertQaAccess(query(good));
 for(const key of ['MainAccess','CompanyAccess','UatAccess','IsSysadmin','IsOwner']){
  await assert.rejects(assertQaAccess(query({...good,[key]:1})),/QA_ACCESS_NOT_ISOLATED/);
  await assert.rejects(assertQaAccess(query({...good,[key]:null})),/QA_ACCESS_NOT_ISOLATED/);
 }
 await assert.rejects(assertQaAccess(query({...good,DbName:'dbwins_worldfert9'})),/QA_ACCESS_NOT_ISOLATED/);
});
