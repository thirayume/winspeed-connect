'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const h = require('./helpers/route-harness.cjs');
let state, failAudit, race;
const db = h.installDbStub(({kind,text,inputs}) => {
  if (/SELECT PasswordHash FROM wf\.AppUser/.test(text)) return [{ PasswordHash: state.hash }];
  if (/SELECT Id, Username, DisplayName, Role, RoleCode/.test(text)) return [{Id:7,Username:'test',Role:'SALES',IsActive:1,AuthVersion:0}];
  if (/UPDATE wf\.AppUser/.test(text)) {
    assert.equal(kind,'tx');
    if (/PasswordHash=@ph/.test(text)) { if (race || inputs.oldHash !== state.hash) return {rowsAffected:[0]}; state.hash=inputs.ph; }
    else if (/SignatureFile=@sig/.test(text)) state.signature=inputs.sig;
    else state.phone=inputs.p;
    return {rowsAffected:[1]};
  }
  if (/INSERT INTO wf\.AdminChangeAudit/.test(text)) { assert.equal(kind,'tx'); if(failAudit) throw Error('AUDIT_FAILED'); state.audits.push(inputs); return {rowsAffected:[1]}; }
  return [];
});
db.stub.wfTransaction = async fn => {const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const router=require('../routes/auth');
async function call(method,path,opts={}) {
  const layer=router.stack.find(x=>x.route?.path===path && x.route.methods[method]);
  const req={body:opts.body||{},user:opts.user||{sub:7,actorSub:7},file:opts.file,tokenPayload:opts.tokenPayload};
  const res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await layer.route.stack.at(-1).handle(req,res);return res;
}
async function reset(){state={hash:await bcrypt.hash('oldSecret',4),phone:'before',signature:'old.png',audits:[]};failAudit=false;race=false;}
test('profile update and actor/effective audit commit with no personal values in audit',async()=>{
  await reset();const r=await call('put','/profile',{body:{phone:'private'},user:{sub:7,actorSub:9}});
  assert.equal(r.code,200);assert.equal(state.phone,'private');assert.equal(state.audits[0].actor,9);assert.equal(state.audits[0].target,'7');assert.ok(!JSON.stringify(state.audits).includes('private'));
});
for (const [method,path,options,key] of [
  ['put','/profile',{body:{phone:'changed'}},'phone'],
  ['post','/profile/signature',{file:{filename:'new.png'}},'signature'],
  ['put','/profile/password',{body:{oldPassword:'oldSecret',newPassword:'newSecret'}},'hash'],
]) test(`${path} rolls back when audit fails`,async()=>{
  await reset();const before=state[key];failAudit=true;const r=await call(method,path,options);
  assert.equal(r.code,500);assert.equal(state[key],before);assert.equal(state.audits.length,0);
});
test('signature change records only action and identities',async()=>{
  await reset();const r=await call('post','/profile/signature',{file:{filename:'private.png'}});
  assert.equal(r.code,200);assert.equal(state.signature,'private.png');assert.ok(!JSON.stringify(state.audits).includes('private.png'));
});
test('password change commits and audit excludes both passwords and hashes',async()=>{
  await reset();const oldHash=state.hash;const r=await call('put','/profile/password',{body:{oldPassword:'oldSecret',newPassword:'newSecret'}});
  assert.equal(r.code,200);assert.ok(await bcrypt.compare('newSecret',state.hash));
  for(const value of ['oldSecret','newSecret',oldHash,state.hash])assert.ok(!JSON.stringify(state.audits).includes(value));
});
test('password change detects concurrent replacement and rejects impersonation',async()=>{
  await reset();race=true;let r=await call('put','/profile/password',{body:{oldPassword:'oldSecret',newPassword:'newSecret'}});
  assert.equal(r.code,409);assert.equal(state.audits.length,0);
  race=false;r=await call('put','/profile/password',{body:{oldPassword:'oldSecret',newPassword:'newSecret'},user:{sub:7,actorSub:9}});
  assert.equal(r.code,403);assert.equal(state.audits.length,0);
});
test('wrong password does not update or audit; new token preserves verified database claim',async()=>{
  await reset();const original=state.hash;
  let r=await call('put','/profile/password',{body:{oldPassword:'wrong',newPassword:'newSecret'}});
  assert.equal(r.code,401);assert.equal(state.hash,original);assert.equal(state.audits.length,0);
  r=await call('put','/profile/password',{body:{oldPassword:'oldSecret',newPassword:'newSecret'},tokenPayload:{db:'reviewed-db'}});
  assert.equal(r.code,200);assert.equal(jwt.verify(r.body.accessToken,require('../middleware/auth').SECRET).db,'reviewed-db');
});
