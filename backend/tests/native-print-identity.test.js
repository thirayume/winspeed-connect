'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let user;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
 requireAuth:(req,_res,next)=>{req.user=user;next();},
 requireCapability:()=> (_req,_res,next)=>next(),
}};
const db=h.installDbStub(({text,inputs})=>{
 if(/FROM dbo\.SOHD h/.test(text))return [{SOID:7,DocuNo:'I69-00001',DocuDate:'2026-11-14'}];
 if(/FROM dbo\.SODT d$/m.test(text))return [{ListNo:1}];
 if(/INSERT INTO wf\.NativePrintLog/.test(text))return {rowsAffected:[1]};
 if(/FROM wf\.NativePrintLog WHERE/.test(text))return [{count:1}];
 return [];
});
let app;
test.before(async()=>{app=await h.startApp([['/api/native-print','../../routes/native-print']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{db.calls.length=0;user={sub:22,actorSub:17,role:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:22,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};});
test('print log stores mapped effective and actual actor IDs from the business database',async()=>{
 const result=await app.call('POST','/api/native-print/104/I69-00001/printed');
 assert.equal(result.status,200);
 const write=db.calls.find(c=>/INSERT INTO wf\.NativePrintLog/.test(c.text));
 assert.equal(write.inputs.user,34);assert.equal(write.inputs.actor,47);
});
test('inconsistent mapping fails before creating a print log',async()=>{
 user.identityMapping.primaryActorUserId=999;
 const result=await app.call('POST','/api/native-print/104/I69-00001/printed');
 assert.equal(result.status,500);
 assert.ok(!db.calls.some(c=>/INSERT INTO wf\.NativePrintLog/.test(c.text)));
});
