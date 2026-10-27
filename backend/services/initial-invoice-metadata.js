'use strict';
const {createHash}=require('crypto');
const EXPECTED='1bdd47a6ee4e84662ed0b1979d32a628ac720fd6745e5839a0afb4b1987f6c8a';
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
function metadataFingerprint(rows){
 if(!Array.isArray(rows)||rows.length!==26)throw Error('IP_METADATA_UNSUPPORTED');
 const parts=rows.map(r=>{
  if(typeof r.TableName!=='string'||typeof r.name!=='string'||typeof r.definition!=='string'
   ||!r.definition||![false,0].includes(r.is_disabled))throw Error('IP_METADATA_UNSUPPORTED');
  return [r.TableName.toLowerCase(),r.name.toLowerCase(),0,hash(r.definition)];
 }).sort((a,b)=>(a[0]+'|'+a[1])<(b[0]+'|'+b[1])?-1:1);
 if(new Set(parts.map(r=>r[0]+'|'+r[1])).size!==26)throw Error('IP_METADATA_UNSUPPORTED');
 return hash(JSON.stringify(parts));
}
function validateMetadata(rows,expected=EXPECTED){if(metadataFingerprint(rows)!==expected)throw Error('IP_METADATA_UNSUPPORTED');}
async function verifyInvoiceMetadata(q){
 const rows=(await q('EXEC wf.usp_ReadInitialInvoiceMetadata')).recordset||[];
 validateMetadata(rows);
}
module.exports={metadataFingerprint,validateMetadata,verifyInvoiceMetadata,EXPECTED};
