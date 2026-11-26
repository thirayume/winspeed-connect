'use strict';
// Positive Access As fixtures model a real team lead acting for a descendant.
// Disjoint peers are separately tested as an empty intersection.
function ownershipHierarchy(text,inputs,{employee=true}={}){
 const id=Number(inputs.id),pos=inputs.pos;
 const parentToChild={47:34,17:8,10:2};
 const ids=[...new Set([...Object.keys(parentToChild).map(Number),...Object.values(parentToChild)])];
 const code=n=>ids.includes(Number(n))?'QA-OWNER-'+n:null;
 const row=n=>({Id:Number(n),EmpId:employee?Number(n)+1000:null,PositionCode:code(n)});
 if(text.includes('SELECT Id, EmpId, PositionCode FROM wf.AppUser'))return [row(id)];
 if(text.includes('SELECT PositionCode,ReportsTo,RecordScope,IsActive'))return [{PositionCode:pos,RecordScope:'ORG',IsActive:1}];
 if(text.includes(';WITH tree AS')){const owner=Number(String(pos).replace('QA-OWNER-',''));return [row(owner),...(parentToChild[owner]?[row(parentToChild[owner])]:[])];}
 if(text.includes(';WITH budgetBranches')){const owner=Number(String(pos).replace('QA-OWNER-',''));return [code(owner),code(parentToChild[owner])].filter(Boolean).map(PositionCode=>({PositionCode}));}
 return undefined;
}
module.exports={ownershipHierarchy};
