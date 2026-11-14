'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let database='primary',target='onprem';
const db=h.installDbStub(({text})=>/FROM wf\.SystemSetting/.test(text)?[{SettingValue:database==='primary'?'60':'30'}]:[]);
db.stub.getDbName=()=>database;db.stub.getTarget=()=>target;
const {getSettingValue,clearSettingCache}=require('../services/policy-contract');
test('cache isolates database target and clears all entries on policy updates',async()=>{
 clearSettingCache();assert.equal(await getSettingValue('CREDIT_AGING_DEFAULT_DAYS'),60);
 database='secondary';assert.equal(await getSettingValue('CREDIT_AGING_DEFAULT_DAYS'),30);
 database='primary';assert.equal(await getSettingValue('CREDIT_AGING_DEFAULT_DAYS'),60);
 assert.equal(db.calls.length,2);target='LOCAL';assert.equal(await getSettingValue('CREDIT_AGING_DEFAULT_DAYS'),60);assert.equal(db.calls.length,3);
 clearSettingCache();assert.equal(await getSettingValue('CREDIT_AGING_DEFAULT_DAYS'),60);assert.equal(db.calls.length,4);
});
