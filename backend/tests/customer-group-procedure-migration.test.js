'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../migrations/216_customer_group_audit_procs.sql'),'utf8');
test('customer group procedures are idempotent and require an existing transaction',()=>{
 for(const name of ['Create','Update','Delete']){assert.match(sql,new RegExp("OBJECT_ID\\('wf\\.sp_CustomerGroup"+name+"',\\s*'P'\\) IS NULL"));assert.match(sql,new RegExp('ALTER PROCEDURE wf\\.sp_CustomerGroup'+name));}
 assert.equal((sql.match(/IF @@TRANCOUNT=0/g)||[]).length,3);assert.doesNotMatch(sql,/\bGRANT\b/i);
});
test('delete checks inactive customers and native references under locks',()=>{
 const part=sql.slice(sql.indexOf('ALTER PROCEDURE wf.sp_CustomerGroupDelete'));
 for(const table of ['EMCust','EMSetPriceHD','EMEmpApprovCreditCustGroup'])assert.match(part,new RegExp('FROM dbo\\.'+table+' WITH \\(UPDLOCK,HOLDLOCK\\)'));
 assert.doesNotMatch(part,/Inactive/);assert.match(part,/IF @Blocked>0 RETURN/);
});
test('update preserves native group ID and avoids cascade keys',()=>{
 const part=sql.slice(sql.indexOf('ALTER PROCEDURE wf.sp_CustomerGroupUpdate'),sql.indexOf("IF OBJECT_ID('wf.sp_CustomerGroupDelete'"));
 const update=part.match(/UPDATE dbo\.EMCustGroup SET([\s\S]*?)WHERE CustGroupID=@Id/);assert.ok(update);assert.doesNotMatch(update[1],/CustGroupID\s*=/);
});
