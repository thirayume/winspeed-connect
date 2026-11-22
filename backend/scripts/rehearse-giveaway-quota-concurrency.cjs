'use strict';
// SQL Server 2008 integration rehearsal with concurrent connections. Every test
// row lives in uniquely named global temporary tables; no wf/dbo business row,
// migration ledger, login, switch, or native document is changed.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const EXPECT_DB='dbwins_worldfert9_uat',EXPECT_SERVER='R740-SRV\\SQL2008';
async function run(){
 if(process.env.ALLOW_TEMPDB_QUOTA_REHEARSAL!=='true'||process.env.ONPREM_DB_NAME!==EXPECT_DB||process.env.ONPREM_TARGET_KIND!=='uat')
  throw Object.assign(Error('UAT_TEMPDB_OPT_IN_REQUIRED'),{code:'UAT_TEMPDB_OPT_IN_REQUIRED'});
 const sql=require('mssql'),onprem=require('../onprem-target');
 const service=require('../services/giveaway-quota-loans'),{transactionQuery}=require('../services/rebate-sql');
 const config=onprem.onpremConnectionConfig(process.env,'migration',false);
 const names=Object.fromEntries(['budgets','users','loans','repayments','audit','settings'].map(key=>[key,`##wf_quota_${crypto.randomBytes(10).toString('hex')}_${key}`]));
 const replacements={
  'wf.v_GiveawayBudgetStatus':names.budgets,'wf.GiveawayBudget':names.budgets,'wf.AppUser':names.users,
  'wf.GiveawayQuotaRepayment':names.repayments,'wf.GiveawayQuotaLoan':names.loans,
  'wf.ChangeEvent':names.audit,'wf.SystemSetting':names.settings,
 };
 const rewrite=text=>Object.entries(replacements).reduce((s,[a,b])=>s.split(a).join(b),text)
  // Synthetic users are deliberately independent of operational account IDs.
  .replace(/wf\.fn_UserHasPermission\(u\.Id,'giveaway.borrow'\)/g,'CAST(1 AS bit)')
  .replace(/wf\.fn_UserHasRole\(u\.Id,'(?:MANAGER|C_LEVEL|ADMIN)'\)/g,'CAST(0 AS bit)');
 let owner,pool,fixturesStarted=false;
 try{
  owner=await new sql.ConnectionPool({...config,pool:{min:1,max:1,idleTimeoutMillis:600000}}).connect();
  const target=(await owner.request().query("SELECT DB_NAME() AS DbName,CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName")).recordset[0];
  assert.equal(target.DbName,EXPECT_DB);assert.equal(target.ServerName,EXPECT_SERVER);
  fixturesStarted=true;
  await owner.request().batch(`
   CREATE TABLE ${names.users}(Id int PRIMARY KEY,EmpId varchar(30),PositionCode varchar(30),IsActive bit,MustChangePassword bit);
   INSERT ${names.users} VALUES(11,NULL,NULL,1,0),(22,NULL,NULL,1,0);
   CREATE TABLE ${names.budgets}(Id int PRIMARY KEY,SalesUserId int,GoodId varchar(30),PeriodYear int,Region nvarchar(60),
    BudgetQty decimal(12,2),WithdrawnQty decimal(12,2),RemainingQty AS (BudgetQty-WithdrawnQty),UpdatedAt datetime);
   INSERT ${names.budgets}(Id,SalesUserId,GoodId,PeriodYear,Region,BudgetQty,WithdrawnQty) VALUES
    (101,11,'fixture-good',2569,N'fixture-region',100,0),(202,22,'fixture-good',2569,N'fixture-region',20,0);
   CREATE TABLE ${names.loans}(
    Id int IDENTITY PRIMARY KEY,RequestId varchar(36) UNIQUE,Fingerprint varchar(64),LenderBudgetId int,BorrowerBudgetId int,
    LenderUserId int,BorrowerUserId int,Quantity decimal(12,2),ReturnedQty decimal(12,2) DEFAULT(0),
    Status varchar(12) DEFAULT('PENDING'),Revision int DEFAULT(1),Reason nvarchar(500),RequestedById int,RequesterActorId int,
    RequesterPrimaryId int,RequesterActorPrimaryId int,DecidedById int,DeciderActorId int,ChangedAtUtc datetime,
    CHECK(Quantity>0 AND ReturnedQty>=0 AND ReturnedQty<=Quantity));
   CREATE TABLE ${names.repayments}(RequestId varchar(36) PRIMARY KEY,LoanId int,Fingerprint varchar(64),Quantity decimal(12,2),
    Reason nvarchar(500),UserId int,ActorUserId int,PrimaryUserId int,ActorPrimaryId int);
   CREATE TABLE ${names.audit}(EntityType varchar(50),EntityId varchar(50),Action varchar(50),BeforeJson nvarchar(max),
    AfterJson nvarchar(max),ReasonCode varchar(50),ReasonText nvarchar(500),UserId varchar(50),ActorUserId varchar(50),CreatedAt datetime);
   CREATE TABLE ${names.settings}(SettingKey varchar(100) PRIMARY KEY,SettingValue varchar(100));
   INSERT ${names.settings} VALUES('GIVEAWAY_BORROW_MAX_PCT','100');`);
  pool=await new sql.ConnectionPool({...config,pool:{min:0,max:6,idleTimeoutMillis:30000}}).connect();
  await onprem.assertOnpremPools(pool,pool,{...process.env,DB_OPERATION:'migration'});
  const borrower={sub:22,role:'SALES'},lender={sub:11,role:'SALES'};
  async function txCall(fn,failAudit=false){
   const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
   try{
    await tx.request().query('SET LOCK_TIMEOUT 10000; SET XACT_ABORT ON;');
    const raw=transactionQuery(tx,sql);
    const q=async(text,p)=>{
     if(failAudit&&/INSERT wf.ChangeEvent/.test(text))throw Object.assign(Error('INJECTED_AUDIT_FAILURE'),{code:'INJECTED_AUDIT_FAILURE'});
     return raw(rewrite(text),p);
    };
    const result=await fn(q);await tx.commit();return result;
   }catch(e){try{await tx.rollback();}catch{}throw e;}
  }
  const request=(requestId,quantity)=>txCall(q=>service.requestLoan(q,borrower,{requestId,quantity,
   expectedDatabase:EXPECT_DB,lenderBudgetId:101,borrowerBudgetId:202,reason:'synthetic concurrency rehearsal'},
   {window:{businessDate:'2026-01-01'}}));
  const approve=id=>txCall(q=>service.decideLoan(q,lender,{id,revision:1,action:'approve',expectedDatabase:EXPECT_DB,reason:'synthetic approval'}));
  const repay=(id,requestId,quantity)=>txCall(q=>service.repayLoan(q,borrower,{id,requestId,quantity,expectedDatabase:EXPECT_DB,reason:'synthetic repayment'}));
  const balances=async()=> (await owner.request().query(`SELECT BudgetQty,WithdrawnQty FROM ${names.budgets} ORDER BY Id`)).recordset;
  const reset=()=>owner.request().query(`DELETE ${names.audit};DELETE ${names.repayments};DELETE ${names.loans};UPDATE ${names.budgets} SET BudgetQty=CASE Id WHEN 101 THEN 100 ELSE 20 END,WithdrawnQty=0;`);
  const key=crypto.randomUUID();
  const duplicate=await Promise.all([request(key,'10'),request(key,'10')]);
  assert.equal(new Set(duplicate.map(r=>r.Id)).size,1);assert.deepEqual(duplicate.map(r=>r.replayed).sort(),[false,true]);
  await approve(duplicate[0].Id);
  const returnKey=crypto.randomUUID(),sameReturn=await Promise.all([repay(duplicate[0].Id,returnKey,'4'),repay(duplicate[0].Id,returnKey,'4')]);
  assert.deepEqual(sameReturn.map(r=>r.replayed).sort(),[false,true]);
  assert.deepEqual((await balances()).map(r=>r.BudgetQty),[94,26]);
  await repay(duplicate[0].Id,crypto.randomUUID(),'6');
  assert.deepEqual((await balances()).map(r=>r.BudgetQty),[100,20]);
  console.log('QUOTA_SQL_DUPLICATE_REQUEST_AND_REPAYMENT=PASS');

  await reset();const a=await request(crypto.randomUUID(),'80'),b=await request(crypto.randomUUID(),'80');
  const competing=await Promise.allSettled([approve(a.Id),approve(b.Id)]);
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(competing.find(r=>r.status==='rejected').reason.code,'QUOTA_LOAN_INSUFFICIENT');
  assert.deepEqual((await balances()).map(r=>r.BudgetQty),[20,100]);
  console.log('QUOTA_SQL_COMPETING_APPROVALS=PASS');

  await reset();const c=await request(crypto.randomUUID(),'10');await approve(c.Id);
  const competingReturns=await Promise.allSettled([repay(c.Id,crypto.randomUUID(),'6'),repay(c.Id,crypto.randomUUID(),'6')]);
  assert.equal(competingReturns.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(competingReturns.find(r=>r.status==='rejected').reason.code,'QUOTA_LOAN_RETURN_EXCEEDS_OUTSTANDING');
  assert.deepEqual((await balances()).map(r=>r.BudgetQty),[96,24]);
  await repay(c.Id,crypto.randomUUID(),'4');
  console.log('QUOTA_SQL_COMPETING_RETURNS=PASS');

  await reset();const withdrawalLoan=await request(crypto.randomUUID(),'80');
  const withdrawal=new sql.Transaction(pool);let pendingApproval;
  await withdrawal.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   await withdrawal.request().query(`SET LOCK_TIMEOUT 10000;
    SELECT Id FROM ${names.budgets} WITH(UPDLOCK,HOLDLOCK) WHERE Id=101;
    UPDATE ${names.budgets} SET WithdrawnQty=WithdrawnQty+60 WHERE Id=101;`);
   pendingApproval=approve(withdrawalLoan.Id).then(value=>({value}),error=>({error}));
   const first=await Promise.race([pendingApproval,new Promise(resolve=>setTimeout(()=>resolve('blocked'),150))]);
   assert.equal(first,'blocked');await withdrawal.commit();
   const outcome=await pendingApproval;assert.equal(outcome.error?.code,'QUOTA_LOAN_INSUFFICIENT');
   assert.deepEqual((await balances()).map(r=>[r.BudgetQty,r.WithdrawnQty]),[[100,60],[20,0]]);
  }finally{try{await withdrawal.rollback();}catch{}if(pendingApproval)await pendingApproval;}
  console.log('QUOTA_SQL_WITHDRAWAL_LOCK_SHARED=PASS');

  await reset();const d=await request(crypto.randomUUID(),'10');
  await assert.rejects(txCall(q=>service.decideLoan(q,lender,{id:d.Id,revision:1,action:'approve',expectedDatabase:EXPECT_DB,reason:'audit fault'}),true),{code:'INJECTED_AUDIT_FAILURE'});
  assert.deepEqual((await balances()).map(r=>r.BudgetQty),[100,20]);
  const status=(await owner.request().query(`SELECT Status FROM ${names.loans} WHERE Id=${d.Id}`)).recordset[0].Status;
  assert.equal(status,'PENDING');
  console.log('QUOTA_SQL_AUDIT_FAILURE_ROLLBACK=PASS');
  return {passed:true,cases:5,storage:'temporary tables only'};
 }finally{
  if(pool)await pool.close();
  if(owner){
   try{if(fixturesStarted)for(const name of Object.values(names).reverse())await owner.request().query(`IF OBJECT_ID('tempdb..${name}') IS NOT NULL DROP TABLE ${name};`);}
   finally{await owner.close();}
  }
 }
}
if(require.main===module)run().then(()=>console.log('QUOTA_SQL_CONCURRENCY=PASS')).catch(e=>{
 console.error('QUOTA_SQL_CONCURRENCY=FAIL code='+(/^[A-Z_0-9]+$/.test(e.code||'')?e.code:'REHEARSAL_FAILED'));process.exitCode=1;
});
module.exports={run};
