'use strict';
const {scopeFilter}=require('./visible-scope');
function predicate(scopes,columns,prefix='reportOrg'){
 if(scopes===undefined)return {sql:'1=1',inputs:{}}; // internal trusted callers
 const checked=Array.isArray(scopes)&&scopes.length?scopes:[{all:false,userIds:[],empIds:[]}];
 const filters=checked.map((s,i)=>scopeFilter(s,{...columns,prefix:prefix+i}));
 return {sql:filters.map(f=>'('+f.sql+')').join(' AND '),inputs:Object.assign({},...filters.map(f=>f.inputs))};
}
// Markers are authored in report SQL, never in request parameters. Each union
// branch is filtered before aggregation, TOP or pagination.
function compile(source,scopes){
 let n=0;const inputs={};
 const text=source.replace(/\/\*ORG_SCOPE:([a-zA-Z][a-zA-Z0-9_.]*|-):([a-zA-Z][a-zA-Z0-9_.]*|-)\*\//g,(_m,u,e)=>{
  if([u,e].some(c=>c!=='-'&&!/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)?$/.test(c))||u==='-'&&e==='-')throw Object.assign(Error('REPORT_SCOPE_MARKER_INVALID'),{status:503});
  const f=predicate(scopes,{userCol:u==='-'?null:u,empCol:e==='-'?null:e},'reportOrg'+n+++'_');Object.assign(inputs,f.inputs);return f.sql;
 });
 if(text.includes('/*ORG_SCOPE:'))throw Object.assign(Error('REPORT_SCOPE_MARKER_INVALID'),{status:503});
 return {sql:text,inputs,count:n};
}
module.exports={predicate,compile};
