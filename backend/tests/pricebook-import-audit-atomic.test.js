'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
let state,failAudit=false,failFloor=false;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(text.includes('FROM dbo.EMSetPriceHD hd')) return [{SetPriceID:2,DocuNo:'TEST',BeginDate:new Date('2026-11-01'),EndDate:new Date('2026-11-30')}];
 if(text.includes('FROM dbo.EMSetPriceDT dt')) return [{SetPriceID:2,ListNo:1,GoodId:'11',GoodName:'Synthetic',Unit:'ton',Price:20}];
 if(text.includes('FROM dbo.EMCust c WITH (UPDLOCK,HOLDLOCK)'))return [{ok:1}];
 if(text.includes('FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id'))return [{Id:5,Status:'DRAFT',EffectiveFrom:'2026-11-01'}];
 if(text.includes('INSERT INTO wf.PriceBookSpecialPrice')){assert.equal(kind,'tx');state.special++;return [{Id:6}];}
 if(text.includes('FROM wf.PriceBookSpecialPrice WHERE Id=@id'))return [{Id:6,PriceBookId:5,CustId:'123',GoodId:'11',RequestedPrice:20,ApprovedPrice:null,RequestedBy:28,ApprovedBy:null,ApprovedAt:null}];
 if(text.includes('INSERT INTO wf.PriceBook (Name')){assert.equal(kind,'tx');state.book++;return [{Id:5}];}
 if(text.includes('INSERT INTO wf.PriceBookLine')){assert.equal(kind,'tx');state.lines++;return {rowsAffected:[1]};}
 if(text.includes('INSERT INTO wf.PriceBookAudit')){assert.equal(kind,'tx');state.audits.push(inputs);return {rowsAffected:[1]};}
 if(text.includes('INSERT INTO wf.ChangeEvent')){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAIL');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const sync=require.resolve('../services/pricebook-winspeed-sync');const real=require(sync);require.cache[sync].exports={...real,hasSyncColumns:async()=>false,assertNoPriceOverlap:async({queryFn})=>{assert.equal(typeof queryFn,'function');}};
const cost=require.resolve('../services/cost-authority');const realCost=require(cost);require.cache[cost].exports={...realCost,assertPricesAboveCost:async({queryFn})=>{assert.equal(typeof queryFn,'function');state.floor++;if(failFloor)throw Object.assign(Error('PRICE_BELOW_MIN_THRESHOLD'),{status:409});}};
let app;test.before(async()=>{app=await h.startApp([['/api/pricebook','../../routes/pricebook']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={special:0,book:0,lines:0,audits:[],events:[],floor:0};failAudit=false;failFloor=false;});
test('import rolls back all records when actor audit fails and records mapped identities on success',async()=>{
 failAudit=true;let r=await app.call('POST','/api/pricebook/sync-from-winspeed',{body:{setPriceIds:[2]}});assert.equal(r.status,500);assert.equal(state.book,0);assert.equal(state.lines,0);assert.equal(state.audits.length,0);
 failAudit=false;r=await app.call('POST','/api/pricebook/sync-from-winspeed',{body:{setPriceIds:[2]}});assert.equal(r.status,200);assert.equal(state.book,1);assert.equal(state.lines,1);assert.equal(state.events[0].user,'28');assert.equal(state.events[0].actor,'37');
});
test('direct active import checks the cost floor before writes',async()=>{
 failFloor=true;let r=await app.call('POST','/api/pricebook/sync-from-winspeed',{body:{setPriceIds:[2],status:'ACTIVE'}});assert.equal(r.status,409);assert.equal(state.book,0);
 failFloor=false;r=await app.call('POST','/api/pricebook/sync-from-winspeed',{body:{setPriceIds:[2],status:'ACTIVE'}});assert.equal(r.status,200);assert.equal(state.floor,1);
});
test('special request and both audit records commit or roll back together',async()=>{
 const body={custId:'123',goodId:'11',requestedPrice:20};failAudit=true;let r=await app.call('POST','/api/pricebook/5/special',{body});assert.equal(r.status,500);assert.equal(state.special,0);assert.equal(state.audits.length,0);
 failAudit=false;r=await app.call('POST','/api/pricebook/5/special',{body});assert.equal(r.status,200);assert.equal(state.special,1);assert.equal(state.events[0].actor,'37');assert.equal(state.audits[0].u,28);assert.equal(JSON.parse(state.events[0].after).special.RequestedPrice,20);
});
