'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const authPath=require.resolve('../middleware/auth');
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{
 requireAuth:(req,_res,next)=>{req.user={sub:1,role:'ADMIN'};next();},
 requireCapability:()=> (_req,_res,next)=>next(),
}};
let books,events,failAudit,priced,lines;
const db=h.installDbStub(({kind,text,inputs})=>{
 assert.equal(kind,'tx','status workflow must use a single transaction');
 if(/SELECT Id, Status, EffectiveMonth FROM wf\.CostBook/.test(text)) {
  const book=books.find(b=>b.Id===inputs.id);return book?[{...book}]:[];
 }
 if(/SELECT Id, Status, Name FROM wf\.CostBook/.test(text)) {
  const book=books.find(b=>b.Id===inputs.id);return book?[{...book}]:[];
 }
 if(/SELECT Id, Status FROM wf\.CostBook/.test(text)) {
  const book=books.find(b=>b.Id===inputs.id);return book?[{...book}]:[];
 }
 if(/SELECT Id FROM wf\.CostBookLine WITH/.test(text))return lines.filter(l=>l.CostBookId===inputs.cbId&&l.GoodId===inputs.gid).map(l=>({Id:l.Id}));
 if(/DELETE FROM wf\.CostBookLine/.test(text)){lines=lines.filter(l=>l.CostBookId!==inputs.id);return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.CostBookLine/.test(text)){lines.push({Id:12,CostBookId:inputs.cbId,GoodId:inputs.gid,CostPrice:inputs.cp});return {rowsAffected:[1]};}
 if(/UPDATE wf\.CostBookLine/.test(text)){
  const line=lines.find(l=>l.Id===inputs.lineId&&(!inputs.cbId||l.CostBookId===inputs.cbId));
  if(!line)return {rowsAffected:[0]};line.CostPrice=inputs.cp;return {rowsAffected:[1]};
 }
 if(/UPDATE wf\.CostBook SET UpdatedAt/.test(text))return {rowsAffected:[1]};
 if(/COUNT\(\*\) AS cnt FROM wf\.CostBookLine/.test(text)) return [{cnt:priced}];
 if(/SELECT Id FROM wf\.CostBook WITH/.test(text))return books.filter(b=>b.Status==='ACTIVE'&&b.EffectiveMonth===inputs.em&&b.Id!==inputs.id).map(b=>({Id:b.Id}));
 if(/UPDATE wf\.CostBook SET Status = 'ARCHIVED'/.test(text)){books.find(b=>b.Id===inputs.oldId).Status='ARCHIVED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.CostBook SET Status = @s/.test(text)){books.find(b=>b.Id===inputs.id).Status=inputs.s;return {rowsAffected:[1]};}
 if(/UPDATE wf\.CostBook\s+SET Name = @name/.test(text)){books.find(b=>b.Id===inputs.id).Name=inputs.name;return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.CostBookAudit/.test(text)) {if(failAudit===true||failAudit===inputs.a)throw Error('simulated audit failure');events.push({id:inputs.id,action:inputs.a,from:inputs.f,to:inputs.t});return {rowsAffected:[1]};}
 throw Error('Unexpected SQL: '+text);
});
db.stub.wfTransaction=async fn=>{const before=structuredClone({books,events,lines});try{return await fn(db.tx);}catch(e){books=before.books;events=before.events;lines=before.lines;throw e;}};
let app;
test.before(async()=>{app=await h.startApp([['/api/costbook','../../routes/costbook']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{books=[{Id:1,Name:'Original',Status:'APPROVED',EffectiveMonth:'2026-11'},{Id:2,Name:'Old',Status:'ACTIVE',EffectiveMonth:'2026-11'}];lines=[{Id:11,CostBookId:1,GoodId:'100',CostPrice:10}];events=[];failAudit=false;priced=1;});
test('activation records both the activation and the automatically archived predecessor',async()=>{
 const r=await app.call('POST','/api/costbook/1/activate',{body:{}});
 assert.equal(r.status,200);assert.equal(books[0].Status,'ACTIVE');assert.equal(books[1].Status,'ARCHIVED');
 assert.deepEqual(events.map(e=>[e.id,e.action]),[[2,'ARCHIVE'],[1,'ACTIVATE']]);
});
test('failed audit rolls back both status changes',async()=>{
 failAudit=true;const r=await app.call('POST','/api/costbook/1/activate',{body:{}});
 assert.equal(r.status,500);assert.equal(books[0].Status,'APPROVED');assert.equal(books[1].Status,'ACTIVE');assert.deepEqual(events,[]);
});
test('failure of the final audit rolls back the earlier archive and its audit',async()=>{
 failAudit='ACTIVATE';const r=await app.call('POST','/api/costbook/1/activate',{body:{}});
 assert.equal(r.status,500);assert.equal(books[0].Status,'APPROVED');assert.equal(books[1].Status,'ACTIVE');assert.deepEqual(events,[]);
});
test('activation without priced items leaves status and audit untouched',async()=>{
 priced=0;const r=await app.call('POST','/api/costbook/1/activate',{body:{}});
 assert.equal(r.status,400);assert.equal(books[0].Status,'APPROVED');assert.equal(books[1].Status,'ACTIVE');assert.deepEqual(events,[]);
});
test('stale workflow state does not apply or audit an invalid transition',async()=>{
 books[0].Status='ARCHIVED';const r=await app.call('POST','/api/costbook/1/approve',{body:{}});
 assert.equal(r.status,409);assert.equal(books[0].Status,'ARCHIVED');assert.deepEqual(events,[]);
});
test('header edit and audit commit together; audit failure restores the header',async()=>{
 failAudit='UPDATE_HEADER';
 const failed=await app.call('PUT','/api/costbook/1',{body:{name:'Changed'}});
 assert.equal(failed.status,500);assert.equal(books[0].Name,'Original');assert.deepEqual(events,[]);
 failAudit=false;
 const result=await app.call('PUT','/api/costbook/1',{body:{name:'Changed'}});
 assert.equal(result.status,200);assert.equal(books[0].Name,'Changed');assert.equal(events[0].action,'UPDATE_HEADER');
});
for(const [method,path,body,action] of [
 ['PATCH','/api/costbook/1/lines/11',{costPrice:20},'EDIT_LINE'],
 ['POST','/api/costbook/1/lines/item',{goodId:'100',costPrice:20},'EDIT_LINE'],
 ['POST','/api/costbook/1/lines/item',{goodId:'101',costPrice:20},'ADD_LINE'],
 ['POST','/api/costbook/1/lines',{lines:[{goodId:'101',costPrice:20}]},'EDIT_LINES'],
]) {
 test(`${method} ${path} rolls back cost lines when audit fails`,async()=>{
  const before=structuredClone(lines);failAudit=action;
  assert.equal((await app.call(method,path,{body})).status,500);
  assert.deepEqual(lines,before);assert.deepEqual(events,[]);
  failAudit=false;assert.equal((await app.call(method,path,{body})).status,200);
  assert.equal(events.at(-1).action,action);
 });
}
test('archived costlists reject line changes before modifying lines or audit',async()=>{
 books[0].Status='ARCHIVED';const before=structuredClone(lines);
 assert.equal((await app.call('PATCH','/api/costbook/1/lines/11',{body:{costPrice:20}})).status,400);
 assert.deepEqual(lines,before);assert.deepEqual(events,[]);
});
