'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('crypto');
const {validateOperationalMetadataRows}=require('../services/initial-invoice-metadata');
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
