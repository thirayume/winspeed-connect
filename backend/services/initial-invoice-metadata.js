'use strict';
const {createHash}=require('crypto');
const { FZ8_DATABASE, isInitialNativeUatTarget } = require('./initial-native-uat-target');
const EXPECTED='1bdd47a6ee4e84662ed0b1979d32a628ac720fd6745e5839a0afb4b1987f6c8a';
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
// These fz8-only rehearsal triggers on the shared invoice tables either
// ignore document type 107 or are disabled. Check table, state and definition.
const FZ8_TRIGGERS = new Map([
 ['soinvdt|wf_fz8native202headerdiscount', [true, '551024adea2909643c74f303bd2a80ea9992bcaa6352d408e18c718e5f73b629']],
 ['soinvhd|wf_fz8native202newdiscountheader', [false, '7bf1477f4234a6022212c9625cc902b68e714db1d43b29d07c13caf4f1438864']],
 ['soinvdt|wf_fz8native202discountdetails', [false, '04be4a6ceab299692a080bfd1a994af164bc19ec3427a12ee46a5a1d9aaddd5b']],
]);
// Migrations 226–234 install these WinSpeed hooks disabled. Match the exact
// definitions from the full migration rehearsal and reject an unexpected state.
const DISABLED_HOOKS = new Map([
 ['wfredemtionhd|wf_couponevidenceheaderfence', '10483e95fcf9fa95e4da936d5d2dedf89a3453839f8ea01613e826a488cc176f'],
 ['wfredemtiondt|wf_couponevidencedetailfence', '647a13804f046b554698df918be80fb7033528e48ca8cf5233c3f5689464998f'],
 ['wfredemtiondt|wf_couponevidenceinsertfence', '1448976bac011b0e7f6eb6506c6835e54788a1c0a71ad09645acfc69ddb36470'],
 ['wfredemtiondt|wf_couponprepareevidence', '09dfa171509f8ad030057121f2b8cb293b7006678009a6230156d3e8e2630f88'],
 ['wfredemtionhd|wf_couponnativeeditheadhook', '0229ce490f7812512f1e35217b2f2a23c7bb0fbaabe7f32fa8aff4f366444c55'],
 ['wfredemtiondt|wf_couponnativeeditdetailhook', 'e56dc96b1272d8f1a4445a3e8b9adf097ac18ff048753bee001696d94c12f127'],
]);
function withoutDisabledHooks(rows) {
 const checked = new Set();
 const standard = rows.filter(row => {
  const key = `${String(row.TableName || '').toLowerCase()}|${String(row.name || '').toLowerCase()}`;
  const fingerprint = DISABLED_HOOKS.get(key);
  if (!fingerprint) return true;
  if (checked.has(key) || ![true, 1].includes(row.is_disabled) || typeof row.definition !== 'string'
   || hash(row.definition.replace(/\r\n/g,'\n')) !== fingerprint) throw Error('IP_METADATA_UNSUPPORTED');
  checked.add(key);
  return false;
 });
 if (checked.size !== 0 && checked.size !== DISABLED_HOOKS.size) throw Error('IP_METADATA_UNSUPPORTED');
 return standard;
}
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
function removeReviewedFz8Triggers(rows) {
 if (rows.length === 26) return rows;
 const remaining = new Map(FZ8_TRIGGERS);
 const nativeRows = rows.filter(row => {
  const key = `${row.TableName?.toLowerCase()}|${row.name?.toLowerCase()}`;
  const expected = remaining.get(key);
  if (!expected) return true;
  const [disabled, fingerprint] = expected;
  if (![disabled, Number(disabled)].includes(row.is_disabled)
    || typeof row.definition !== 'string' || hash(row.definition) !== fingerprint) throw Error('IP_METADATA_UNSUPPORTED');
  remaining.delete(key);
  return false;
 });
 if (remaining.size) throw Error('IP_METADATA_UNSUPPORTED');
 return nativeRows;
}
async function verifyInvoiceMetadata(q, target){
 const rows=(await q('EXEC wf.usp_ReadInitialInvoiceMetadata')).recordset||[];
 const isFz8 = target?.DbName === FZ8_DATABASE && isInitialNativeUatTarget(target);
 const nativeRows = withoutDisabledHooks(rows);
 validateMetadata(isFz8 ? removeReviewedFz8Triggers(nativeRows) : nativeRows);
}
module.exports={metadataFingerprint,validateMetadata,verifyInvoiceMetadata,EXPECTED};
