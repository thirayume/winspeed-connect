'use strict';
const {scopeFilter,inScope}=require('./visible-scope');
const {sql}=require('../db');
function branchPredicate(scopes,column='p.BranchPositionCode',prefix='budgetBranch'){
 const filters=(Array.isArray(scopes)&&scopes.length?scopes:[{}]).map((scope,i)=>{
  if(scope.all===true)return {sql:'1=1',inputs:{}};
  const codes=[...new Set(scope.positionCodes||[])],inputs={};
  const names=codes.map((code,j)=>{const key=prefix+i+'P'+j;inputs[key]={type:sql.VarChar(30),value:code};return '@'+key;});
  return {sql:names.length?`${column} IN (${names.join(',')})`:'1=0',inputs};
 });
 return {sql:filters.map(f=>`(${f.sql})`).join(' AND '),inputs:Object.assign({},...filters.map(f=>f.inputs))};
}
function branchVisible(scopes,code){return !!code&&Array.isArray(scopes)&&scopes.length>0&&scopes.every(s=>s.all===true||(s.positionCodes||[]).includes(code));}
function predicate(scopes,alias='p'){
 const filters=(Array.isArray(scopes)&&scopes.length?scopes:[{}]).map((scope,i)=>{
  if(scope.all===true)return {sql:'1=1',inputs:{}};
  const normalized={userIds:[],empIds:[],...scope};
  const maker=scopeFilter(normalized,{userCol:alias+'.PreparedBy',prefix:'budgetMaker'+i});
  const actor=scopeFilter(normalized,{userCol:alias+'.PreparedActorId',prefix:'budgetActor'+i});
  const branch=branchPredicate([scope],alias+'.BranchPositionCode','budgetPlanBranch'+i);
  return {sql:`((${alias}.BranchPositionCode IS NOT NULL AND ${branch.sql}) OR (${alias}.BranchPositionCode IS NULL AND (${maker.sql} OR ${actor.sql})))`,inputs:{...maker.inputs,...actor.inputs,...branch.inputs}};
 });
 return {sql:filters.map(f=>`(${f.sql})`).join(' AND '),inputs:Object.assign({},...filters.map(f=>f.inputs))};
}
function visible(scopes,plan){
 if(plan.BranchPositionCode)return branchVisible(scopes,plan.BranchPositionCode);
 return Array.isArray(scopes)&&scopes.length>0&&scopes.every(s=>inScope({userIds:[],empIds:[],...s},{userId:plan.PreparedBy})||inScope({userIds:[],empIds:[],...s},{userId:plan.PreparedActorId}));
}
module.exports={predicate,visible,branchPredicate,branchVisible};
