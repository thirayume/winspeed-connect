'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {splitBatches}=require('../run_migrations'),{assertNoCrossDbWrite}=require('../safety-validator');
const text=fs.readFileSync(path.join(__dirname,'../migrations/263_native_document_operation_contract.sql'),'utf8');
test('runner accepts only the exact wf operational target predicate, not native writes named in strings',()=>{
 for(const batch of splitBatches(text))assert.doesNotThrow(()=>assertNoCrossDbWrite(batch));
 const fn=splitBatches(text).find(b=>/ALTER FUNCTION wf.fn_IsNativeDocumentTarget/.test(b));
 for(const changed of [fn.replace("RETURN 0;","RETURN 1;"),fn.replace("IsEnabled=1","IsEnabled=0"),fn+"\nUPDATE dbwins_worldfert9.dbo.SOHD SET DocuStatus='C';",
  fn.replace('fn_IsNativeDocumentTarget','fn_Another'),"IF DB_NAME()=N'dbwins_worldfert9' UPDATE dbo.SOHD SET DocuStatus='C';"])
  assert.throws(()=>assertNoCrossDbWrite(changed),/Cross-database write/);
});
