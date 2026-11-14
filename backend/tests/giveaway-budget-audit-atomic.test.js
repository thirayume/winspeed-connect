'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let user;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id:authPath, filename:authPath, loaded:true, exports:{
  requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},
  requireCapability:()=> (_req,_res,next)=>next(), requireRole:()=> (_req,_res,next)=>next(),
} };
let rows, audits, failAudit, missingWrite, duplicateBudget;
const db = h.installDbStub(({kind,text,inputs}) => {
  if (/COL_LENGTH\('wf\.GiveawayBudget'/.test(text)) return [{Len:50}];
  if (/COL_LENGTH\('wf\.ChangeEvent'/.test(text)) return [{HasCol:1}];
  if (/SELECT Id FROM wf\.GiveawayBudget WITH \(UPDLOCK,HOLDLOCK\) WHERE Id=@id/.test(text)) { assert.equal(kind,'tx'); return rows.filter(row=>row.Id===inputs.id).map(row=>({Id:row.Id})); }
  if (/SELECT TOP 2 Id FROM wf\.GiveawayBudget WITH \(UPDLOCK,HOLDLOCK\)/.test(text)) { assert.equal(kind,'tx'); return rows.filter(row=>row.Region===inputs.rg).slice(0,2).map(row=>({Id:row.Id})); }
  if (/SELECT TOP 1 Id FROM wf\.GiveawayBudget WITH \(UPDLOCK,HOLDLOCK\)/.test(text)) { assert.equal(kind,'tx'); return duplicateBudget ? [{Id:999}] : []; }
  if (/FROM wf\.v_GiveawayBudgetStatus v JOIN wf\.GiveawayBudget b ON b.Id=v.Id WHERE v.Id\s*=\s*@id/.test(text)) return rows.length ? [{...rows[0], EditVersion:rows[0].EditVersion || '0000000000000001', WithdrawnQty:0,RemainingQty:rows[0].BudgetQty}] : [];
  if (/FROM wf\.v_GiveawayBudgetStatus WHERE/.test(text)) return [];
  if (/INSERT INTO wf\.GiveawayBudget/.test(text)) { assert.equal(kind,'tx'); rows.push({Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:inputs.bq}); return [{Id:777}]; }
  if (/UPDATE wf\.GiveawayBudget/.test(text)) { assert.equal(kind,'tx'); if(missingWrite)return {rowsAffected:[0]}; rows[0].BudgetQty=inputs.bq; return {rowsAffected:[1]}; }
  if (/DELETE FROM wf\.GiveawayBudget/.test(text)) { assert.equal(kind,'tx'); if(missingWrite)return {rowsAffected:[0]}; rows=[]; return {rowsAffected:[1]}; }
  if (/INSERT INTO wf\.ChangeEvent/.test(text)) { assert.equal(kind,'tx'); if(failAudit) throw Error('TEST_AUDIT_FAILED'); audits.push({...inputs}); return {rowsAffected:[1]}; }
  return [];
});
db.stub.wfTransaction=async fn=>{const before=structuredClone({rows,audits});try{return await fn(db.tx);}catch(e){rows=before.rows;audits=before.audits;throw e;}};
let app;
test.before(async()=>{app=await h.startApp([['/api/giveaway','../../routes/giveaway']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{user={sub:1,actorSub:1,role:'ADMIN'};rows=[];audits=[];failAudit=false;missingWrite=false;duplicateBudget=false;});
for(const [method,url,body,setup] of [
  ['POST','/api/giveaway/budgets',{region:'TEST',brand:'X',itemName:'Y',budgetQty:12},false],
  ['PUT','/api/giveaway/budgets/777',{budgetQty:12},true],
  ['DELETE','/api/giveaway/budgets/777',{},true],
]) test(`${method} budget and audit commit or roll back together`,async()=>{
  if(setup) rows=[{Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10}];
  const before=structuredClone(rows); if(setup) body.expectedToken=require('../routes/giveaway').__testing.budgetEditToken({...rows[0],EditVersion:rows[0].EditVersion || '0000000000000001',WithdrawnQty:0}); failAudit=true;
  assert.equal((await app.call(method,url,{body})).status,500);
  assert.deepEqual(rows,before);assert.deepEqual(audits,[]);
  failAudit=false;
  assert.equal((await app.call(method,url,{body})).status,200);
  assert.equal(audits.length,1);
});
for(const [method,url,body] of [['PUT','/api/giveaway/budgets/777',{budgetQty:12}],['DELETE','/api/giveaway/budgets/777',{}]])
  test(`${method} does not audit a row removed before the write`,async()=>{
    rows=[{Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10}];body.expectedToken=require('../routes/giveaway').__testing.budgetEditToken({...rows[0],EditVersion:rows[0].EditVersion || '0000000000000001',WithdrawnQty:0});missingWrite=true;
    assert.equal((await app.call(method,url,{body})).status,409);assert.deepEqual(audits,[]);
  });
test('budget audit retains business actor and effective identity when acting as another user',async()=>{
  user={sub:8,actorSub:63,role:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:63,businessEffectiveUserId:17,businessActorUserId:31}};
  const r=await app.call('POST','/api/giveaway/budgets',{body:{region:'TEST',brand:'X',itemName:'Y',budgetQty:12}});
  assert.equal(r.status,200);assert.equal(audits[0].userId,'17');assert.equal(audits[0].actorUserId,'31');
});
test('changing a budget onto an existing key fails without updating or auditing',async()=>{
  rows=[{Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10}];duplicateBudget=true;
  const r=await app.call('PUT','/api/giveaway/budgets/777',{body:{budgetQty:12,expectedToken:require('../routes/giveaway').__testing.budgetEditToken({...rows[0],EditVersion:rows[0].EditVersion || '0000000000000001',WithdrawnQty:0})}});
  assert.equal(r.status,409);assert.equal(rows[0].BudgetQty,10);assert.deepEqual(audits,[]);
});
test('duplicate create fails without overwriting the existing budget',async()=>{
  rows=[{Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10}];
  const r=await app.call('POST','/api/giveaway/budgets',{body:{region:'TEST',brand:'X',itemName:'Y',budgetQty:12}});
  assert.equal(r.status,409);assert.equal(rows[0].BudgetQty,10);assert.deepEqual(audits,[]);
});
test('stale edit and delete reject without overwriting a newer budget',async()=>{
  rows=[{Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10}];
  const token=require('../routes/giveaway').__testing.budgetEditToken({...rows[0],EditVersion:rows[0].EditVersion || '0000000000000001',WithdrawnQty:0});
  assert.equal((await app.call('PUT','/api/giveaway/budgets/777',{body:{budgetQty:12,expectedToken:token}})).status,200);
  assert.equal((await app.call('PUT','/api/giveaway/budgets/777',{body:{budgetQty:15,expectedToken:token}})).status,409);
  assert.equal((await app.call('DELETE','/api/giveaway/budgets/777?force=true',{body:{expectedToken:token}})).status,409);
  assert.equal(rows[0].BudgetQty,12); assert.equal(audits.length,1);
  assert.equal((await app.call('PUT','/api/giveaway/budgets/777',{body:{budgetQty:15}})).status,428);
});
test('a withdrawal changes the edit token even if the configured budget is unchanged',()=>{
  const { budgetEditToken }=require('../routes/giveaway').__testing;
  const row={Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10,WithdrawnQty:0,EditVersion:'0000000000000001'};
  assert.notEqual(budgetEditToken(row),budgetEditToken({...row,WithdrawnQty:1}));
});

test('version changes detect a change followed by an exact value reversal',()=>{const {budgetEditToken}=require('../routes/giveaway').__testing;const row={Id:777,Region:'TEST',PeriodYear:2026,Brand:'X',ItemName:'Y',BudgetQty:10,WithdrawnQty:0,EditVersion:'0000000000000001'};assert.notEqual(budgetEditToken(row),budgetEditToken({...row,EditVersion:'0000000000000003'}));});
