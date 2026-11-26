'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let scopes=[{all:false,userIds:[2,3],positionCodes:['MGR-EAST','SALE-EAST','VACANT-EAST']}],calls=[];
h.installDbStub(({text,inputs})=>{
 if(/SELECT p.PositionCode, p.PositionName/.test(text)){calls.push({text,inputs});return [];}
 if(/SELECT Id, EmpId, PositionCode/.test(text))return [{Id:2,EmpId:'102',PositionCode:null}];
 return [];
});
const access=require.resolve('../services/secondary-budget-report-access');require.cache[access]={id:access,filename:access,loaded:true,exports:{businessScopes:async()=>scopes}};
const router=require('../routes/auth');
const handler=router.stack.find(x=>x.route?.path==='/org-positions'&&x.route.methods.get).route.stack.at(-1).handle;
async function read(user={sub:2,role:'MANAGER'}){
 calls=[];const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({user},res);assert.equal(res.code,200);assert.equal(calls.length,1);return calls[0];
}
test('organization map keeps own and vacant descendant positions and scopes assigned counts',async()=>{
 const q=await read();assert.match(q.text,/p\.PositionCode IN \(@orgPosition0P0,@orgPosition0P1,@orgPosition0P2\)/);assert.equal(q.inputs.orgPosition0P2,'VACANT-EAST');assert.match(q.text,/u\.PositionCode = p\.PositionCode AND/);assert.match(q.text,/u\.Id IN \(@directory0U0\)/);assert.equal(q.inputs.directory0U0,2);
});
test('organization map intersects every perspective instead of joining sibling branches',async()=>{
 scopes=[{all:false,positionCodes:['MGR-EAST']},{all:false,positionCodes:['MGR-WEST']}];const q=await read();assert.match(q.text,/WHERE \(p\.PositionCode IN \(@orgPosition0P0\)\) AND \(p\.PositionCode IN \(@orgPosition1P0\)\)/);assert.equal(q.inputs.orgPosition0P0,'MGR-EAST');assert.equal(q.inputs.orgPosition1P0,'MGR-WEST');
});
test('missing organization scope returns no positions; administrator retains the full map',async()=>{
 scopes=[];assert.match((await read()).text,/WHERE \(1=0\)/);
 scopes=[{all:false,positionCodes:[]}];assert.match((await read()).text,/WHERE \(1=0\)/);
 scopes=[{all:true}];const q=await read({sub:9,role:'ADMIN'});assert.doesNotMatch(q.text,/orgPosition|WHERE \(1=0\)/);assert.match(q.text,/u\.PositionCode = p\.PositionCode AND \(1=1\)/);
});
