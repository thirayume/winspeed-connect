'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authorizationHoldsAvailable,resolveHoldPolicy,heldReservationExpirySql,assertNoActiveAuthorization,assertCarrierHasNoActiveAuthorization,assertBeneficiaryHasNoActiveAuthorization}=require('../services/coupon-authorization-hold');
const marker='NATIVE_HOLD_SCHEMA_V1';
const legacy={...require('./helpers/coupon-bridge-metadata').absent,NativeHoldSchemaState:marker,Ledger220:0,HeaderVisible:0,LineVisible:0,SchemaSelect:1};
const current={...require('./helpers/coupon-bridge-metadata').absent,NativeHoldSchemaState:marker,Ledger220:1,HeaderVisible:1,LineVisible:1,SchemaSelect:1,HeaderSelect:1,LineSelect:1};
const legacyEvidence={EvidenceSchemaState:'NATIVE_CUT_EVIDENCE_SCHEMA_V1',Ledger223:0,EvidenceVisible:0,SchemaSelect:1};
const currentEvidence={...legacyEvidence,Ledger223:1,EvidenceVisible:1,EvidenceSelect:1};
const query=row=>async()=>({recordset:[row]});
test('a started bridge keeps an expired reservation held across every expiry predicate',()=>{
 const sql=heldReservationExpirySql('cr',{auth:true,evidence:true,bridge:true},true);
 assert.match(sql,/ExpiresAt>GETUTCDATE\(\) OR wf\.fn_CouponBridgeReservationHeld\(cr.Id\)=1/);
 assert.match(sql,/CouponNativeCutEvidence/);
});
test('legacy and migrated databases select their correct hold policy',async()=>{
 assert.equal(await authorizationHoldsAvailable(query(legacy)),false);
 assert.equal(await authorizationHoldsAvailable(query(current)),true);
 assert.doesNotMatch(heldReservationExpirySql('cr',false),/CouponNative/);
 assert.match(heldReservationExpirySql('cr',true,true),/ReservationId=cr\.Id AND ah\.State='ACTIVE'/);
 assert.match(heldReservationExpirySql('cr',true,true),/UPDLOCK,HOLDLOCK/);
});
test('active authorization blocks reservation, carrier and beneficiary mutation even after expiry',async()=>{
 const calls=[];let active=true;
 const tx={request(){return {input(){return this;},async query(text){calls.push(text);return text.includes('NATIVE_HOLD_SCHEMA_V1')?{recordset:[current]}:text.includes('NATIVE_CUT_EVIDENCE_SCHEMA_V1')?{recordset:[legacyEvidence]}:require('./helpers/native-hold-legacy.cjs')(text)??(text.includes('SELECT Id FROM wf.CouponReservation')?{recordset:[{Id:123}]}:{recordset:active?[{ActiveNativeAuthorization:1}]:[]});}};}};
 for(const fn of [()=>assertNoActiveAuthorization(tx,123),()=>assertCarrierHasNoActiveAuthorization(tx,'55','QA'),()=>assertBeneficiaryHasNoActiveAuthorization(tx,'1','2')])
  await assert.rejects(fn(),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD',status:409});
 for(const sql of calls.filter(x=>x.includes('AS ActiveNativeAuthorization'))){assert.match(sql,/UPDLOCK,HOLDLOCK/);assert.doesNotMatch(sql,/ExpiresAt/);}
 assert.ok(calls.filter(sql=>sql.includes('SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK)')).length>=3);
 assert.ok(calls.some(sql=>/NULLIF\(@doc,''\) IS NOT NULL AND cr\.CarrierDocuNo=@doc/.test(sql)));
 active=false;await assertNoActiveAuthorization(tx,123);await assertCarrierHasNoActiveAuthorization(tx,'55','QA');
});
test('evidence holds reservation even when its authorization is no longer active',async()=>{
 const calls=[];
 const tx={request(){return {input(){return this;},async query(text){calls.push(text);
  if(text.includes('NATIVE_HOLD_SCHEMA_V1'))return {recordset:[current]};
  if(text.includes('NATIVE_CUT_EVIDENCE_SCHEMA_V1'))return {recordset:[currentEvidence]};
  const legacySchema=require('./helpers/native-hold-legacy.cjs')(text);
  if(legacySchema)return legacySchema;
  if(text.includes('SELECT Id FROM wf.CouponReservation'))return {recordset:[{Id:123}]};
  return {recordset:[{ActiveNativeAuthorization:1}]};
 }};}};
 for(const fn of [()=>assertNoActiveAuthorization(tx,123),()=>assertCarrierHasNoActiveAuthorization(tx,'55','QA'),()=>assertBeneficiaryHasNoActiveAuthorization(tx,'1','2')])
  await assert.rejects(fn(),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD'});
 for(const text of calls.filter(x=>x.includes('AS ActiveNativeAuthorization')))assert.match(text,/OR EXISTS \(SELECT 1 FROM wf\.CouponNativeCutEvidence/);
 const policy=await resolveHoldPolicy(async text=>({recordset:[text.includes('NATIVE_HOLD_SCHEMA_V1')?current:currentEvidence]}));
 assert.match(heldReservationExpirySql('cr',policy,true),/wf\.CouponNativeCutEvidence/);
 await assert.rejects(resolveHoldPolicy(async text=>({recordset:[text.includes('NATIVE_HOLD_SCHEMA_V1')?legacy:currentEvidence]})),{code:'COUPON_AUTH_HOLD_SCHEMA_UNAVAILABLE'});
});
test('partial, hidden, inaccessible and inconsistent schema fails closed',async()=>{
 for(const row of [{...legacy,SchemaSelect:0},{...legacy,HeaderVisible:1},
  {...current,Ledger220:0},{...current,LineVisible:0},{...current,HeaderSelect:0},
  {...legacy,Ledger220:null},{...legacy,HeaderVisible:null},{...legacy,LineVisible:null},
  {...legacy,Ledger220:''},{...legacy,Ledger220:undefined},{...legacy,Ledger220:false},null])
  await assert.rejects(authorizationHoldsAvailable(query(row)),{code:'COUPON_AUTH_HOLD_SCHEMA_UNAVAILABLE',status:503});
 await assert.rejects(authorizationHoldsAvailable(async()=>{throw Error('denied');}),{code:'COUPON_AUTH_HOLD_SCHEMA_UNAVAILABLE'});
 assert.throws(()=>heldReservationExpirySql('cr;DROP',true),TypeError);
});
test('a carrier or beneficiary with no reservations does not require authorization schema access',async()=>{
 const calls=[];
 const tx={request(){return {input(){return this;},async query(text){calls.push(text);if(text.includes('NATIVE_HOLD_SCHEMA_V1'))throw Error('schema unavailable');return {recordset:[]};}};}};
 await assertCarrierHasNoActiveAuthorization(tx,'55','');
 await assertBeneficiaryHasNoActiveAuthorization(tx,'1','2');
 assert.equal(calls.length,2);assert.ok(calls.every(text=>/UPDLOCK,HOLDLOCK/.test(text)));
 await assert.rejects(assertCarrierHasNoActiveAuthorization(tx,'',''),{message:'COUPON_CARRIER_INVALID'});
});
