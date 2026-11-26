'use strict';
// Loan counterparties are a minimal trading directory, not permission to read
// their bills/customers. Sales may find peers under their nearest active lead;
// managers/executives keep their own descendant scope, including Access As.
const {businessIds,actorPerspective}=require('./business-identity');
const {getVisibleScope,inScope}=require('./visible-scope');
const {hasRole}=require('./role-capabilities');
const {sql}=require('../db');
async function one(q,user){
 const own=await getVisibleScope(user,q);
 if(own.all||hasRole(user,'ADMIN','MANAGER','C_LEVEL','APPROVER'))return own;
 const id=businessIds(user).effective;
 if(!id)return {all:false,userIds:[],empIds:[]};
 const rows=(await q(`;WITH leads AS (
  SELECT p.ReportsTo PositionCode,0 Depth FROM wf.AppUser u WITH(HOLDLOCK) JOIN wf.OrgPosition p WITH(HOLDLOCK)
   ON p.PositionCode=u.PositionCode AND p.IsActive=1 WHERE u.Id=@loanUser AND u.IsActive=1
  UNION ALL SELECT p.ReportsTo,l.Depth+1 FROM wf.OrgPosition p WITH(HOLDLOCK) JOIN leads l ON p.PositionCode=l.PositionCode WHERE p.IsActive=1 AND l.Depth<31
 ), nearest AS (
  SELECT TOP 1 l.PositionCode FROM leads l JOIN wf.OrgPosition p WITH(HOLDLOCK) ON p.PositionCode=l.PositionCode AND p.IsActive=1
  WHERE EXISTS(SELECT 1 FROM wf.AppUser m WITH(HOLDLOCK) JOIN wf.vUserRole r ON r.UserId=m.Id JOIN wf.RoleProfile rp WITH(HOLDLOCK) ON rp.Code=r.RoleCode
   WHERE m.PositionCode=l.PositionCode AND m.IsActive=1 AND m.MustChangePassword=0 AND rp.BaseRole IN('MANAGER','C_LEVEL','ADMIN'))
  ORDER BY l.Depth
 ), team AS (
  SELECT PositionCode FROM nearest
  UNION ALL SELECT p.PositionCode FROM wf.OrgPosition p WITH(HOLDLOCK) JOIN team t ON p.ReportsTo=t.PositionCode WHERE p.IsActive=1
 ) SELECT u.Id FROM wf.AppUser u WITH(HOLDLOCK) WHERE u.IsActive=1 AND u.PositionCode IN(SELECT PositionCode FROM team) OPTION(MAXRECURSION 32)`,
 {loanUser:{type:sql.Int,value:id}})).recordset||[];
 return {all:false,userIds:[...new Set([id,...rows.map(r=>Number(r.Id)).filter(n=>Number.isSafeInteger(n)&&n>0)])],empIds:[]};
}
async function counterpartyScopes(q,user){
 const actual=actorPerspective(user);
 return [await one(q,user),...(actual===user?[]:[await one(q,actual)])];
}
async function requireCounterparty(q,user,owner){
 if(!(await counterpartyScopes(q,user)).every(s=>inScope(s,{userId:Number(owner)})))
  throw Object.assign(Error('QUOTA_LOAN_COUNTERPARTY_OUTSIDE_BRANCH'),{status:403,code:'QUOTA_LOAN_COUNTERPARTY_OUTSIDE_BRANCH'});
}
async function requireSuperiorOverride(q,user,owner,coOwner=null){
 const ids=businessIds(user);
 for(const [id,p] of [[ids.effective,user],[ids.actor,actorPerspective(user)]]){
  if(Number(id)===Number(owner)||hasRole(p,'ADMIN'))continue;
  if(!await require('./organization-approval').isSuperior(q,id,owner)||(coOwner!==null&&!await require('./organization-approval').isSuperior(q,id,coOwner)))
   throw Object.assign(Error('QUOTA_LOAN_APPROVER_OUTSIDE_CHAIN'),{status:403,code:'QUOTA_LOAN_APPROVER_OUTSIDE_CHAIN'});
 }
}
module.exports={counterpartyScopes,requireCounterparty,requireSuperiorOverride};
