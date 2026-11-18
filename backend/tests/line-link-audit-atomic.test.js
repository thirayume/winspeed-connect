'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),bcrypt=require('bcrypt'),jwt=require('jsonwebtoken');
const h=require('./helpers/route-harness.cjs');
let state,failAudit;
const db=h.installDbStub(({kind,text,inputs})=>{
  if(kind==='wfQuery'&&text.includes('WHERE Username = @u'))return [{Id:7,Username:'fixture',Role:'SALES',IsActive:state.active,PasswordHash:state.hash}];
  assert.equal(kind,'tx');
  if(text.includes('SELECT IsActive,PasswordHash,LineUserId'))return [{IsActive:state.active,PasswordHash:state.hash,LineUserId:state.line}];
  if(text.includes('SELECT TOP 1 Id FROM wf.AppUser'))return state.other?[{Id:8}]:[];
  if(text.includes('UPDATE wf.AppUser')){state.line=inputs.line;return {rowsAffected:[1]};}
  if(text.includes('INSERT INTO wf.AdminChangeAudit')){if(failAudit)throw Error('AUDIT_FAILURE');state.audit.push(inputs);return {rowsAffected:[1]};}
  throw Error('UNEXPECTED_QUERY');
});
db.stub.wfTransaction=async(fn,opts)=>{assert.equal(opts.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
const {linkLine}=require('../services/line-link-transaction');
function reset(){state={active:true,hash:'password-hash',line:null,other:false,audit:[]};failAudit=false;}
const user={Id:7,PasswordHash:'password-hash'},line={lineUserId:'private-line',lineDisplayName:'private-name',linePictureUrl:'private-picture'};
test('link and audit commit together without LINE or credential values',async()=>{
  reset();await linkLine({user,line});assert.equal(state.line,line.lineUserId);assert.equal(state.audit[0].action,'LINE_LINK');
  assert.ok(!/private-line|private-name|private-picture|password-hash/.test(JSON.stringify(state.audit)));
});
test('audit failure rolls back the link',async()=>{reset();failAudit=true;await assert.rejects(linkLine({user,line}),/AUDIT_FAILURE/);assert.equal(state.line,null);assert.deepEqual(state.audit,[]);});
test('account changes, disabled users, or a conflicting link fail before update',async()=>{
  for(const patch of [{hash:'changed'},{active:false},{line:'another-line'},{other:true}]){reset();Object.assign(state,patch);const prior=structuredClone(state);await assert.rejects(linkLine({user,line}),{status:409});assert.deepEqual(state,prior);}
});
test('real link handler verifies credentials and records audit without exposing LINE details',async()=>{
  reset();state.hash=await bcrypt.hash('fixture-password',4);
  const router=require('../routes/auth'),layer=router.stack.find(x=>x.route?.path==='/line/link'&&x.route.methods.post);
  const token=jwt.sign({purpose:'line-link',...line},require('../middleware/auth').SECRET,{expiresIn:'10m'});
  const req={body:{username:'fixture',password:'fixture-password',lineLinkToken:token}},res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await layer.route.stack.at(-1).handle(req,res);assert.equal(res.code,200);assert.equal(state.line,line.lineUserId);assert.equal(state.audit[0].action,'LINE_LINK');
});
