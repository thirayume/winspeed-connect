'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
h.installDbStub(()=>[]);
const scope=require('../services/visible-scope'),context=require('../services/request-context');
const people=[{Id:1,EmpId:'101',PositionCode:'EXEC-SALES'},{Id:2,EmpId:'102',PositionCode:'MGR-EAST'},{Id:3,EmpId:'103',PositionCode:'SALE-EAST'},{Id:4,EmpId:'104',PositionCode:'MGR-WEST'},{Id:5,EmpId:'105',PositionCode:'SALE-WEST'},{Id:6,EmpId:'106',PositionCode:null}];
const parents={'EXEC-SALES':null,'MGR-EAST':'EXEC-SALES','SALE-EAST':'MGR-EAST','MGR-WEST':'EXEC-SALES','SALE-WEST':'MGR-WEST'};
const below=p=>Object.keys(parents).filter(k=>parents[k]===p).flatMap(k=>[k,...below(k)]);
async function q(text,inputs={}){
 const p=inputs.pos?.value??inputs.pos,id=inputs.id?.value??inputs.id,b=inputs.branch?.value??inputs.branch;
 if(text.includes('SELECT Id, EmpId, PositionCode'))return {recordset:people.filter(u=>u.Id===id).map(u=>({...u}))};
 if(text.includes(';WITH permitted'))return {recordset:[p,...below(p)].includes(b)?[{PositionCode:b}]:[]};
 if(text.includes(';WITH budgetBranches'))return {recordset:[p,...below(p)].map(PositionCode=>({PositionCode}))};
 if(text.includes(';WITH tree'))return {recordset:people.filter(u=>text.includes('(u.PositionCode=@pos')?u.PositionCode===p||below(p).includes(u.PositionCode):u.Id===id||below(p).includes(u.PositionCode))};
 if(text.includes('FROM wf.OrgPosition'))return {recordset:Object.hasOwn(parents,p)?[{PositionCode:p,IsActive:1,RecordScope:'ORG'}]:[]};
 return {recordset:[]};
}
test('manager+approver is limited to own sales branch; executives use their descendants',async()=>{
 const east=await scope.getVisibleScope({sub:2,role:'MANAGER',roles:['MANAGER','APPROVER']},q,{includePositions:true});assert.equal(east.all,false);assert.deepEqual(east.userIds,[2,3]);
 const executive=await scope.getVisibleScope({sub:1,role:'C_LEVEL'},q);assert.equal(executive.all,false);assert.deepEqual(executive.userIds,[1,2,3,4,5]);
 assert.deepEqual(east.positionCodes,['MGR-EAST','SALE-EAST']);
 const unplaced=await scope.getVisibleScope({sub:6,role:'MANAGER'},q);assert.equal(unplaced.all,false);assert.deepEqual(unplaced.userIds,[6]);
});
test('annual branch visibility uses positions even when the maker is an administrator; legacy rows keep owner rules',()=>{
 const {visible,predicate}=require('../services/budget-record-scope');
 const east={all:false,userIds:[2,3],empIds:['102','103'],positionCodes:['MGR-EAST','SALE-EAST']};
 assert.equal(visible([east],{BranchPositionCode:'SALE-EAST',PreparedBy:99}),true);
 assert.equal(visible([east],{BranchPositionCode:'SALE-WEST',PreparedBy:2}),false);
 assert.equal(visible([east],{PreparedBy:3}),true);
 assert.equal(visible([east],{PreparedBy:99}),false);
 assert.equal(visible([east,{all:false,userIds:[4],positionCodes:['SALE-WEST']}],{BranchPositionCode:'SALE-EAST',PreparedBy:2}),false);
 const filter=predicate([east]);assert.match(filter.sql,/BranchPositionCode IS NULL AND/);assert.ok(Object.values(filter.inputs).some(p=>p.value==='SALE-EAST'));
});
test('vacant descendant branches remain visible without exposing peers personal records',async()=>{
 parents['VACANT-EAST']='MGR-EAST';try{const s=await scope.getVisibleScope({sub:2,role:'MANAGER'},q,{includePositions:true});assert.ok(s.positionCodes.includes('VACANT-EAST'));assert.deepEqual(s.userIds,[2,3]);}finally{delete parents['VACANT-EAST'];}
});
test('branch selector narrows legitimate scope and rejects a sibling branch',async()=>{
 await context.runWithUser({sub:2,orgBranch:'SALE-EAST'},async()=>{const s=await scope.getVisibleScope({sub:2,role:'MANAGER'},q);assert.deepEqual(s.userIds,[3]);});
 await context.runWithUser({sub:2,orgBranch:'SALE-WEST'},async()=>{await assert.rejects(scope.getVisibleScope({sub:2,role:'MANAGER'},q),e=>e.status===403);});
});
test('unknown scope and other-salesperson quota fail closed',async()=>{
 assert.equal(scope.scopeFilter(null,{userCol:'OwnerId'}).sql,'1=0');assert.equal(scope.inScope(null,{userId:1}),false);
 assert.equal(await scope.canViewSalesUser({sub:2,role:'MANAGER'},5,q),false);assert.equal(await scope.canViewSalesUser({sub:2,role:'MANAGER'},3,q),true);
});

test('selecting my own position never expands access to another person sharing it',async()=>{
 people.push({Id:7,EmpId:'107',PositionCode:'MGR-EAST'});
 try{await context.runWithUser({sub:2,orgBranch:'MGR-EAST'},async()=>{
  const s=await scope.getVisibleScope({sub:2,role:'MANAGER'},q);assert.deepEqual(s.userIds,[2,3]);
 });}finally{people.pop();}
});

test('no budget scope cannot turn into an empty SQL predicate',()=>{
 const {predicate,visible}=require('../services/budget-record-scope');
 assert.match(predicate([]).sql,/1=0/);assert.equal(visible([],{PreparedBy:2}),false);
});

test('Access As never lends the effective administrator scope to an actor from another branch',async()=>{
 const s=await scope.getVisibleScope({sub:1,actorSub:2,role:'ADMIN',actorRole:'MANAGER',isImpersonating:true},q);
 assert.equal(s.all,false);assert.deepEqual(s.userIds,[2,3]);
 const empty=await scope.getVisibleScope({sub:4,actorSub:2,role:'MANAGER',actorRole:'MANAGER',isImpersonating:true},q);
 assert.deepEqual(empty.userIds,[]);assert.deepEqual(empty.empIds,[]);
});
test('territory forms normalize province spelling and reject duplicates or stale shape',()=>{
 const {validate}=require('../services/organization-territories');
 const form={code:'PROMO-1',name:'Promotion',type:'PROMOTION',ownerUserId:3,expectedRevision:1,provinces:['จ.หนองบังลำภู','ศรีสะเกษม']};
 assert.deepEqual(validate(form).provinces,['หนองบัวลำภู','ศรีสะเกษ']);
 assert.throws(()=>validate({...form,provinces:['ศรีสะเกษ','ศรีสะเกษม']}));assert.throws(()=>validate({...form,ownerUserId:0}));
});
test('document sort accepts only reviewed fields and directions',()=>{
 const {documentOrder}=require('../services/document-list-order');assert.equal(documentOrder({sortBy:'docuNo',sortDirection:'asc'}),"COALESCE(NULLIF(q.ImportedDocuNo,''),q.WfRef) ASC,q.Id ASC");
 assert.throws(()=>documentOrder({sortBy:'DocuNo;DELETE'}));assert.throws(()=>documentOrder({sortDirection:'anything'}));
});
