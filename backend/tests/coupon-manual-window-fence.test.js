'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const storePath=require.resolve('../services/global-data-window-store');
require.cache[storePath]={id:storePath,filename:storePath,loaded:true,exports:{KEY:'GLOBAL_DATA_START_DATE'}};
let database='primary_test', settings=[{SettingValue:'2026-01-01'}], docs=[{RedemtionID:7}];
const db=h.installDbStub(({text})=>{
  if(text.includes('DB_NAME()'))return [{DatabaseName:database}];
  if(text.includes('FROM wf.SystemSetting'))return settings;
  if(text.includes('FROM dbo.WFRedemtionHD'))return docs;
  throw Error('UNEXPECTED_QUERY');
});
db.stub.DEFAULT_TARGET='onprem';
process.env.ONPREM_DB_NAME='primary_test';
const {validateManualSettlementWindow}=require('../services/coupon-manual-window-fence');
const ctx={window:{businessDate:'2026-01-01'},redemptionId:7,couponId:9};
test.beforeEach(()=>{database='primary_test';settings=[{SettingValue:'2026-01-01'}];docs=[{RedemtionID:7}];db.calls.length=0;});

test('locks the primary window and verifies the 116 against its date and coupon',async()=>{
  await validateManualSettlementWindow(db.tx,ctx);
  const setting=db.calls.find(c=>c.text.includes('FROM wf.SystemSetting'));
  const doc=db.calls.find(c=>c.text.includes('FROM dbo.WFRedemtionHD'));
  assert.match(setting.text,/UPDLOCK,HOLDLOCK/);
  assert.equal(setting.inputs.key,'GLOBAL_DATA_START_DATE');
  assert.match(doc.text,/DocuType=116 AND h\.DocuDate>=@start/);
  assert.match(doc.text,/ISNULL\(LTRIM\(RTRIM\(h\.DocuStatus\)\),''\) IN \('N','Y'\)/);
  assert.match(doc.text,/d\.CouponID=@couponId/);
  assert.equal(doc.inputs.start,'2026-01-01');
});

test('changed, invalid, duplicate or unavailable setting fails closed',async()=>{
  settings=[{SettingValue:'2026-02-01'}];
  await assert.rejects(validateManualSettlementWindow(db.tx,ctx),{code:'DATA_WINDOW_CHANGED'});
  settings=[{SettingValue:'not-a-date'}];
  await assert.rejects(validateManualSettlementWindow(db.tx,ctx),{code:'DATA_WINDOW_UNAVAILABLE'});
  settings=[{SettingValue:'2026-01-01'},{SettingValue:'2026-01-01'}];
  await assert.rejects(validateManualSettlementWindow(db.tx,ctx),{code:'DATA_WINDOW_UNAVAILABLE'});
  await assert.rejects(validateManualSettlementWindow(db.tx,{...ctx,window:null}),{code:'DATA_WINDOW_UNAVAILABLE'});
});

test('default date works when the setting row does not exist',async()=>{
  settings=[];
  await validateManualSettlementWindow(db.tx,ctx);
});

test('secondary target and a missing or changed 116 are refused',async()=>{
  database='secondary_test';
  await assert.rejects(validateManualSettlementWindow(db.tx,ctx),{code:'MANUAL_SETTLEMENT_PRIMARY_REQUIRED'});
  database='primary_test';docs=[];
  await assert.rejects(validateManualSettlementWindow(db.tx,ctx),{code:'REDEMPTION_OUTSIDE_DATA_WINDOW'});
});
