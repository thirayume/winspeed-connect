'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let records=[],failRead=false;
const db=h.installDbStub(({text,inputs})=>{
 if(/DB_NAME\(\)/.test(text))return [{DatabaseName:'fixture'}];
 if(/FROM wf.GiveawayQuotaLoan l/.test(text)){
  if(failRead)throw Error('private SQL diagnostic');
  assert.match(text,/loanBorrower0U0/);assert.match(text,/loanLender0U0/);
  assert.equal(inputs.start.toISOString(),'2025-12-31T17:00:00.000Z');
  assert.match(text,/@before IS NULL OR l.Id<@before/);
  return records;
 }
 if(/SELECT Id, EmpId, PositionCode/.test(text))return [{Id:11,PositionCode:null}];
 return [];
},{activeUserIds:[11]});
const service=require('../services/giveaway-quota-loans');
const calls=[];let auditFailure=false,transactionOptions=[];
for(const name of ['requestLoan','decideLoan','repayLoan'])service[name]=async(q,user,input)=>{
 calls.push({name,user,input});await q('SELECT DB_NAME() AS DatabaseName');
 if(auditFailure)throw Object.assign(Error('private audit table failure'),{status:503});
 return {id:3,status:'PENDING'};
};
db.stub.wfTransaction=async(fn,options)=>{transactionOptions.push(options);return fn(db.tx);};
let app;
test.before(async()=>{app=await h.startApp([['/api/giveaway','../../routes/giveaway']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{records=[];failRead=false;auditFailure=false;calls.length=0;transactionOptions=[];db.calls.length=0;});
const user={sub:11,role:'SALES'};

test('quota routes require authentication and the borrow capability',async()=>{
 assert.equal((await app.call('POST','/api/giveaway/quota-loans/requests',{body:{}})).status,401);
 assert.equal((await app.call('POST','/api/giveaway/quota-loans/requests',{user:{sub:11,role:'WAREHOUSE'},body:{}})).status,403);
 assert.equal(calls.length,0);
});

test('all quota mutations run in SERIALIZABLE and route IDs override the body',async()=>{
 for(const [path,name] of [['requests','requestLoan'],['3/decision','decideLoan'],['3/repay','repayLoan']]){
  const result=await app.call('POST',`/api/giveaway/quota-loans/${path}`,{user,body:{id:999,quantity:'1',expectedDatabase:'fixture'}});
  assert.equal(result.status,200);assert.equal(calls.at(-1).name,name);
  assert.equal(calls.at(-1).input.id,path==='requests'?undefined:'3');
  assert.equal(transactionOptions.at(-1).isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);
 }
 assert.equal(db.calls.filter(c=>/DB_NAME\(\)/.test(c.text)).every(c=>c.kind==='tx'),true);
});

test('database and audit diagnostics are sanitized rather than leaking private details',async()=>{
 auditFailure=true;
 const result=await app.call('POST','/api/giveaway/quota-loans/requests',{user,body:{}});
 assert.equal(result.status,503);assert.equal(result.body.code,'QUOTA_LOAN_UNAVAILABLE');
 assert.doesNotMatch(JSON.stringify(result.body),/private|audit table/);
 failRead=true;
 assert.equal((await app.call('GET','/api/giveaway/quota-loans',{user})).status,503);
});

test('older open loans retain repayment rights while history is masked; pages expose a cursor',async()=>{
 records=Array.from({length:101},(_,i)=>({Id:200-i,Status:'APPROVED',Revision:1,Quantity:10,ReturnedQty:4,
  LenderUserId:12,BorrowerUserId:11,LenderName:'Lender fixture',BorrowerName:'Borrower fixture',
  GoodName:'Good fixture',Reason:'hidden old reason',CreatedAtUtc:new Date('2025-12-01T00:00:00Z')}));
 const result=await app.call('GET','/api/giveaway/quota-loans',{user});
 assert.equal(result.status,200);assert.equal(result.body.items.length,100);assert.equal(result.body.nextCursor,101);
 assert.equal(result.body.items[0].reason,null);assert.equal(result.body.items[0].isOpening,true);
 assert.equal(result.body.items[0].outstanding,6);assert.equal(result.body.items[0].canRepay,true);
 assert.equal(result.body.items[0].canDecide,false);
 const next=await app.call('GET','/api/giveaway/quota-loans?before=101',{user});assert.equal(next.status,200);
 assert.equal(db.calls.filter(c=>/FROM wf.GiveawayQuotaLoan l/.test(c.text)).at(-1).inputs.before,101);
 assert.equal((await app.call('GET','/api/giveaway/quota-loans?before=-1',{user})).status,400);
});
