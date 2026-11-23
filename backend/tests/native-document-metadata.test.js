'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('crypto');
const {validateOperationalMetadataRows}=require('../services/initial-invoice-metadata');
const fs=require('fs'),path=require('path');
test('operational app uses the fixed metadata reader without direct catalog access',async()=>{
 const {verifyOperationalMetadata}=require('../services/initial-invoice-metadata');const calls=[];
 await assert.rejects(verifyOperationalMetadata(async text=>{calls.push(text);return {recordset:[]};},null,{env:{}}),/IP_METADATA_UNSUPPORTED/);
 assert.deepEqual(calls,['EXEC wf.usp_ReadNativeDocumentMetadata']);
 const up=fs.readFileSync(path.join(__dirname,'../migrations/277_native_writer_metadata_release.sql'),'utf8');
 const body=up.slice(up.indexOf('ALTER PROCEDURE'),up.indexOf('\nGO',up.indexOf('ALTER PROCEDURE')));
 assert.match(body,/WITH EXECUTE AS SELF/);assert.doesNotMatch(body,/sp_executesql|\bEXEC\s*\(|\b(INSERT|UPDATE|DELETE|GRANT)\s/i);
 for(const table of require('../services/native-document-metadata.json').tables)assert(body.includes("OBJECT_ID('dbo."+table+"')"));
 const remap=fs.readFileSync(path.join(__dirname,'../../docs/deploy/r740/sql/r740-uat-principals.sql'),'utf8');
 assert(remap.includes(body.replace(/'/g,"''")));assert.match(remap,/native metadata reader differs/);
 // The SQL catalog retains leading LF; Windows checkouts can put CR in the
 // expected literal. Both must normalize before the exact binary comparison.
 assert.match(remap,/SET @native_expected=REPLACE\(@native_expected,CHAR\(13\),N''\)/);
 assert.match(remap,/WHILE LEFT\(@native_actual,1\)=CHAR\(10\)/);
});
test('operational metadata refuses unreadable, changed, enabled, missing, extra or duplicate triggers',()=>{
 const digest=s=>createHash('sha256').update(s).digest('hex');
 const expected=[['head','native',0,digest('native\nbody')],['coupon','hook',1,digest('disabled hook')]];
 const rows=[{TableName:'HEAD',name:'native',is_disabled:false,definition:'native\r\nbody'},
  {TableName:'coupon',name:'hook',is_disabled:true,definition:'disabled hook'}];
 assert.doesNotThrow(()=>validateOperationalMetadataRows(rows,expected));
 for(const changed of [
  [rows[0]], [...rows,rows[0]], [rows[0],rows[0]],
  [rows[0],{...rows[1],definition:null}], [rows[0],{...rows[1],definition:'changed'}],
  [rows[0],{...rows[1],is_disabled:false}], [rows[0],{...rows[1],name:'other'}],
 ])assert.throws(()=>validateOperationalMetadataRows(changed,expected),/IP_METADATA_UNSUPPORTED/);
});
