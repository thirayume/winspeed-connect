'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let currentUser={sub:1,role:'ADMIN'}, windowUnavailable=false, reconcileCalls=0;
const authPath=require.resolve('../middleware/auth');
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{
  requireAuth:(req,_res,next)=>{req.user=currentUser;next();},
  requireCapability:()=> (_req,_res,next)=>next(), requireRole:()=> (_req,_res,next)=>next(),
}};
const db=h.installDbStub(({text,inputs})=>{
  if (/FROM wf\.PriceBook WHERE Id=@id/.test(text)) return [{Id:inputs.id,Name:'active',Status:'ACTIVE'}];
  if (/FROM wf\.CostBook WHERE Id = @id/.test(text)) return [{Id:inputs.id,Name:'active',Status:'ACTIVE'}];
  if (/FROM wf\.PriceBookLine l|FROM wf\.CostBookLine l/.test(text)) return [{Id:7}];
  if (/FROM wf\.(PriceBookAudit|CostBookAudit) a/.test(text)) {
    const events=[{Action:'OLD',At:new Date('2025-12-31T16:59:59Z')},{Action:'NEW',At:new Date('2025-12-31T17:00:00Z')}];
    return events.filter(event=>event.At >= inputs.globalStartUtc);
  }
  return [];
});
const windowPath=require.resolve('../services/global-data-window-store');
require.cache[windowPath].exports.readGlobalDataWindow=async()=>{
  if(windowUnavailable)throw new Error('unavailable');
  return require('../services/data-window').boundaries('2026-01-01');
};
const syncPath=require.resolve('../services/pricebook-winspeed-sync');
require.cache[syncPath]={id:syncPath,filename:syncPath,loaded:true,exports:{
  hasSyncColumns:async()=>false,reconcileFromWinSpeed:async()=>{reconcileCalls++;},
}};
let app;
test.before(async()=>{app=await h.startApp([['/api/pricebook','../../routes/pricebook'],['/api/costbook','../../routes/costbook']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{currentUser={sub:1,role:'ADMIN'};windowUnavailable=false;reconcileCalls=0;db.calls.length=0;});

for(const [path,table] of [['pricebook','PriceBookAudit'],['costbook','CostBookAudit']]) {
  test(`${path} keeps current master and lines while hiding pre-cutoff audit`,async()=>{
    const result=await app.call('GET',`/api/${path}/1`);
    assert.equal(result.status,200);assert.equal(result.body.Status,'ACTIVE');assert.equal(result.body.lines.length,1);
    assert.deepEqual(result.body.audit.map(x=>x.Action),['NEW']);
    const audit=db.calls.find(c=>c.text.includes(`FROM wf.${table} a`));
    assert.match(audit.text,/a\.At >= @globalStartUtc/);
    assert.equal(audit.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  });
}
test('failed global policy prevents price reconciliation and audit exposure',async()=>{
  windowUnavailable=true;
  assert.equal((await app.call('GET','/api/pricebook/1')).status,503);
  assert.equal((await app.call('GET','/api/costbook/1')).status,503);
  assert.equal(reconcileCalls,0);
  assert.ok(!db.calls.some(c=>/FROM wf\.(PriceBookAudit|CostBookAudit)/.test(c.text)));
});
test('CostBook denies Access As unless both real and effective users have cost permission',async()=>{
  currentUser={sub:1,role:'ADMIN',isImpersonating:true,actorRole:'SALES',actorRoles:['SALES']};
  assert.equal((await app.call('GET','/api/costbook/1')).status,403);
  assert.ok(!db.calls.some(c=>/FROM wf\.CostBook/.test(c.text)));
  currentUser={sub:1,role:'ADMIN',isImpersonating:true,actorRole:'MANAGER',actorRoles:['MANAGER']};
  assert.equal((await app.call('GET','/api/costbook/1')).status,200);
  currentUser={sub:1,role:'ADMIN',isImpersonating:true,actorRole:'MANAGER',actorRoles:['MANAGER'],actorPermissions:[]};
  assert.equal((await app.call('GET','/api/costbook/1')).status,403);
});
