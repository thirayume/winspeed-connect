'use strict';
// Retire only exact IDs/usernames recorded by our closed private QA runs.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {assertQaProfile,assertQaAccess}=require('./native-v3-qa-profile.cjs');
assertQaProfile();const db=require('../db');
async function run(){
 await db.pools().ready;await assertQaAccess(db.wfQuery);
 const reviewer=JSON.parse(fs.readFileSync('/review-state/bootstrap.json','utf8')),users=[];
 for(const dir of fs.readdirSync('/review-state').filter(n=>/^loop-r740v3-\d{8}-\d{2}$/.test(n))){
  const state=JSON.parse(fs.readFileSync(path.join('/review-state',dir,'state.json'),'utf8'));
  const fixture=JSON.parse(fs.readFileSync(path.join('/review-state',dir,'fixtures.json'),'utf8'));
  assert.equal(state.closed,true);assert.equal(fixture.run,state.run);
  for(const [key,u] of Object.entries(fixture.users)){
   assert.equal(u.username,'uat-loop-'+fixture.run.toLowerCase()+'-'+key);
   assert(Number.isSafeInteger(u.id)&&u.id>0);assert.equal(u.password,undefined);
   users.push(u);
  }
 }
 assert.equal(new Set(users.map(u=>u.id)).size,users.length);
 let changed=0;
 await db.wfTransaction(async tx=>{
  const q=require('../services/rebate-sql').transactionQuery(tx,db.sql);
  for(const u of users){
   const row=(await q('SELECT IsActive,PasswordHash FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id AND Username=@name',{id:u.id,name:u.username})).recordset;
   assert.equal(row.length,1);assert.equal(row[0].IsActive,false);
   if(row[0].PasswordHash==='!CLOSED_UAT_LOOP!')continue;
   const result=await q("UPDATE wf.AppUser SET PasswordHash='!CLOSED_UAT_LOOP!' WHERE Id=@id AND Username=@name AND IsActive=0",{id:u.id,name:u.username});
   assert.equal(result.rowsAffected[0],1);
   await q(`INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
    VALUES('QA_TEST_USER',@id,'RETIRE','QA_CLEANUP','Removed retired loop credential hash; no staff account changed',@u,@u)`,
    {id:String(u.id),u:String(reviewer.userId)});
   changed++;
  }
 });
 console.log('QA_CLOSED_TEST_USER_HASHES_REMOVED='+changed+' EXACT_OWNED_USERS='+users.length);
}
run().catch(e=>{console.error('QA_USER_RETIREMENT_FAILED '+e.message);process.exitCode=1;}).finally(()=>db.closeAll());
