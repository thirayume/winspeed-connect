'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let user,visible,state;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text))return [{Id:Number(inputs.id),EmpId:null,PositionCode:null}];
 if(/FROM dbo\.EMCust c WITH \(UPDLOCK,HOLDLOCK\)/.test(text))return visible?[{ok:1}]:[];
 if(/FROM wf\.PriceBook WITH \(UPDLOCK,HOLDLOCK\)/.test(text))return [{Id:5,Status:'DRAFT',EffectiveFrom:'2026-01-01'}];
 if(/INSERT INTO wf\.PriceBookSpecialPrice/.test(text)){state.requested=true;return [{Id:6}];}
 if(/FROM wf\.PriceBookSpecialPrice sp WITH \(UPDLOCK,HOLDLOCK\)/.test(text))return visible?[{Id:6,PriceBookId:5,CustId:'123',GoodId:null,RequestedBy:3,RequestedPrice:20,ApprovedPrice:null,ApprovedBy:null,ApprovedAt:null,BookStatus:'DRAFT'}]:[];
 if(/UPDATE wf\.PriceBookSpecialPrice SET ApprovedPrice/.test(text)){state.approved=true;return {rowsAffected:[1]};}
 if(/FROM wf\.PriceBookSpecialPrice WHERE Id=@id/.test(text))return [{Id:6,PriceBookId:5,CustId:'123',GoodId:null,RequestedBy:3,RequestedPrice:20,ApprovedPrice:state.approved?15:null,ApprovedBy:state.approved?2:null,ApprovedAt:null}];
 if(/FROM wf\.PriceBookSpecialPrice sp/.test(text))return visible?[{Id:6,CustId:'123'}]:[];
 if(/INSERT INTO wf\.PriceBookAudit/.test(text))return {rowsAffected:[1]};
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
let app;test.before(async()=>{app=await h.startApp([['/api/pricebook','../../routes/pricebook']]);});test.after(async()=>app.close());
test.beforeEach(()=>{user={sub:2,id:2,actorSub:10,role:'SALES',roles:['SALES'],actorRole:'SALES',actorRoles:['SALES'],isImpersonating:true};visible=true;state={requested:false,approved:false,events:[]};db.calls.length=0;});
function scoped(q){assert.ok(q);assert.match(q.text,/ISNULL\(c\.BillEmp,0\)=0 AND ISNULL\(cx\.SalespersonUserId,0\)=0/);assert.equal(q.inputs.customerScope0U0,2);assert.equal(q.inputs.customerScope1U0,10);}
test('special request list applies both customer scopes and retains unassigned customers',async()=>{
 let r=await app.call('GET','/api/pricebook/5/special');assert.equal(r.status,200);assert.equal(r.body.length,1);scoped(db.calls.find(c=>/WHERE sp\.PriceBookId = @id/.test(c.text)));
 visible=false;r=await app.call('GET','/api/pricebook/5/special');assert.deepEqual(r.body,[]);
});
test('special request refuses hidden customer before writing; audit records actual price snapshot',async()=>{
 const body={custId:'123',requestedPrice:20};visible=false;let r=await app.call('POST','/api/pricebook/5/special',{body});assert.equal(r.status,404);assert.equal(state.requested,false);scoped(db.calls.find(c=>/FROM dbo\.EMCust c WITH \(UPDLOCK,HOLDLOCK\)/.test(c.text)));
 visible=true;r=await app.call('POST','/api/pricebook/5/special',{body});assert.equal(r.status,200);assert.equal(state.requested,true);assert.equal(JSON.parse(state.events[0].after).special.RequestedPrice,20);
});
test('special approval refuses hidden customer and audits before/after when allowed',async()=>{
 visible=false;let r=await app.call('PATCH','/api/pricebook/special/6',{body:{approvedPrice:15}});assert.equal(r.status,404);assert.equal(state.approved,false);scoped(db.calls.find(c=>/FROM wf\.PriceBookSpecialPrice sp WITH/.test(c.text)));
 visible=true;r=await app.call('PATCH','/api/pricebook/special/6',{body:{approvedPrice:15}});assert.equal(r.status,200);assert.equal(state.approved,true);
 assert.equal(JSON.parse(state.events[0].before).special.ApprovedPrice,null);assert.equal(JSON.parse(state.events[0].after).special.ApprovedPrice,15);
});
