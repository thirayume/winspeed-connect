'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {encodeCursor,decodeCursor}=require('../services/coupon-review-cursor');
const secret='test-secret-at-least-16-characters',user={sub:8,actorSub:9},window='2026-01-01';

test('continuation encrypts hidden positions and binds both identities, database and cutoff',()=>{
 const token=encodeCursor(987654321,user,'onprem:primary',window,secret,1000);
 assert.doesNotMatch(Buffer.from(token,'base64url').toString('utf8'),/987654321/);
 assert.equal(decodeCursor(token,user,'onprem:primary',window,secret,1001),987654321);
 for(const [actor,db,date] of [[{sub:8,actorSub:10},'onprem:primary',window],[user,'onprem:other',window],[user,'onprem:primary','2026-02-01']])
  assert.throws(()=>decodeCursor(token,actor,db,date,secret,1001),{code:'COUPON_REVIEW_CURSOR_INVALID'});
 const raw=Buffer.from(token,'base64url');raw[raw.length-1]^=1;
 assert.throws(()=>decodeCursor(raw.toString('base64url'),user,'onprem:primary',window,secret,1001),{code:'COUPON_REVIEW_CURSOR_INVALID'});
 assert.throws(()=>decodeCursor(token,user,'onprem:primary',window,secret,1000+15*60*1000+1),{code:'COUPON_REVIEW_CURSOR_INVALID'});
 assert.throws(()=>encodeCursor(1,user,'db',window,'dev_secret_change_in_production'),{code:'COUPON_REVIEW_CURSOR_UNAVAILABLE'});
});

const h=require('./helpers/route-harness.cjs');
const auth=require.resolve('../middleware/auth');
let currentUser={sub:8,actorSub:9,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true},capability;
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
 requireAuth:(req,_res,next)=>{req.user=currentUser;next();},
 requireRole:()=>((_req,_res,next)=>next()),
 requireCapability:name=>(req,res,next)=>{capability=name;if(req.user.role==='SALES')return res.status(403).json({});next();},
}};
h.installDbStub(()=>[]);
const service=require('../services/coupon-native-review-queue');
const original=service.listNativeCutReview,originalHold=service.recordNativeReviewHold,oldSecret=process.env.JWT_SECRET;
let app,seen;
test.before(async()=>{
 process.env.JWT_SECRET=secret;
 service.listNativeCutReview=async args=>{seen=args;return {items:[{authorizationId:12,code:'NATIVE_LINES_CHANGED',docuNo:null,sourceHidden:true}],scannedThrough:987654321,scannedCount:10};};
 app=await h.startApp([['/api/coupons','../../routes/coupons']]);
});
test.after(async()=>{service.listNativeCutReview=original;service.recordNativeReviewHold=originalHold;if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;await app.close();});
test('route returns only scoped results and opaque cursor, then passes decrypted position to service',async()=>{
 let response=await app.call('GET','/api/coupons/native-review');
 assert.equal(response.status,200);assert.equal(capability,'coupon.settle');assert.equal(seen.actor,currentUser);
 assert.equal(seen.dataWindow.businessDate,window);assert.equal(seen.afterId,0);
 assert.equal(response.body.scannedThrough,undefined);assert.ok(response.body.nextCursor);
 const cursor=response.body.nextCursor;
 response=await app.call('GET',`/api/coupons/native-review?cursor=${cursor}`);
 assert.equal(response.status,200);assert.equal(seen.afterId,987654321);
 currentUser={...currentUser,actorSub:10};seen=null;
 response=await app.call('GET',`/api/coupons/native-review?cursor=${cursor}`);
 assert.equal(response.status,400);assert.equal(seen,null);
 currentUser={sub:8,actorSub:9,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};
});
test('route rejects users without capability and propagates unavailable audit/schema without results',async()=>{
 currentUser={sub:8,role:'SALES'};seen=null;
 let response=await app.call('GET','/api/coupons/native-review');assert.equal(response.status,403);assert.equal(seen,null);
 currentUser={sub:8,role:'ADMIN'};
 service.listNativeCutReview=async()=>{throw Object.assign(Error('AUDIT_UNAVAILABLE'),{status:503,code:'AUDIT_UNAVAILABLE'});};
 response=await app.call('GET','/api/coupons/native-review');assert.equal(response.status,503);assert.equal(response.body.items,undefined);
});
test('hold route forwards only the authenticated identity and review fields',async()=>{
 currentUser={sub:8,actorSub:9,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};
 service.recordNativeReviewHold=async args=>{seen=args;return {authorizationId:12,code:args.expectedCode,hold:'UNCHANGED'};};
 const response=await app.call('POST','/api/coupons/native-review/12/hold',{body:{expectedCode:'NATIVE_LINES_CHANGED',note:'รอตรวจหลักฐาน',actor:{sub:999}}});
 assert.equal(response.status,200);assert.equal(capability,'coupon.settle');assert.equal(seen.actor,currentUser);
 assert.equal(seen.authorizationId,'12');assert.equal(seen.note,'รอตรวจหลักฐาน');assert.equal(response.body.hold,'UNCHANGED');
 currentUser={sub:8,role:'SALES'};seen=null;
 const denied=await app.call('POST','/api/coupons/native-review/12/hold',{body:{expectedCode:'NATIVE_LINES_CHANGED',note:'รอตรวจหลักฐาน'}});
 assert.equal(denied.status,403);assert.equal(seen,null);
});
test('native edit approval uses the authenticated actor and ignores body identity and cutoff',async()=>{
 const editApproval=require('../services/coupon-native-edit-approval');
 const originalApprove=editApproval.approveNativeEdit;
 try {
  currentUser={sub:8,actorSub:9,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};
  editApproval.approveNativeEdit=async args=>{
   seen=args;
   return {editId:'test-edit',operation:args.operation,lineCount:2};
  };
  const path='/api/coupons/native-edits/12/approval';
  const body={operation:'cancel',reason:'cancel test 116',actor:{sub:99},dataWindow:{businessDate:'1900-01-01'}};
  const approved=await app.call('POST',path,{body});
  assert.equal(approved.status,201);
  assert.equal(capability,'coupon.settle');
  assert.equal(seen.actor,currentUser);
  assert.equal(seen.redemptionId,'12');
  assert.equal(seen.dataWindow.businessDate,window);
  currentUser={sub:8,role:'SALES'};
  seen=null;
  assert.equal((await app.call('POST',path,{body})).status,403);
  assert.equal(seen,null);
 } finally {
  editApproval.approveNativeEdit=originalApprove;
 }
});
