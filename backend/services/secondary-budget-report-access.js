'use strict';
// Only these reviewed modules may cross the normal secondary-route fence.
// Profiles are loaded by auth, never from JWT claims or request parameters.
const caps=require('./role-capabilities'),identity=require('./business-identity');
const budgetActions=['budget.plan.create','budget.plan.review','budget.plan.approve'];
const error=(code,status=403)=>Object.assign(Error(code),{code,status});
function classify(req){
 const path=String(req.path||''),method=String(req.method||'');
 if(req.baseUrl==='/api/budget'){
  if(method==='GET'&&(/^(\/plans|\/staff|\/customers|\/approvers|\/expenditure)$/.test(path)||/^\/plans\/[1-9]\d*(\/(history|report|export))?$/.test(path)||/^\/reports\/(annual|projects)(\/export)?$/.test(path)))return 'budget-read';
  if(method==='POST'&&path==='/plans'||['PUT','DELETE'].includes(method)&&/^\/plans\/[1-9]\d*$/.test(path)||method==='POST'&&/^\/plans\/[1-9]\d*\/(submit|review|approve|reject|cancel|restore)$/.test(path))return 'budget-write';
 }
 if(req.baseUrl==='/api/reports'&&method==='GET'){
  if(['/types','/catalog-config','/pricelist-periods','/costlist-periods'].includes(path))return 'report-read';
  const match=/^\/([a-z0-9_-]+)(\/(template|export))?$/.exec(path);
  if(match&&Object.hasOwn(require('../routes/reports').__testing.REPORTS,match[1]))return 'report-read';
 }
 return null;
}
function primaryProfile(user){return {...user,identityMapping:undefined,secondaryModuleAccess:undefined};}
function perspectives(user,includeActor=false){
 const users=[user];if(includeActor&&(user?.isImpersonating||(user?.actorSub!=null&&Number(user.actorSub)!==Number(user.sub??user.id))||(user?.actorId!=null&&Number(user.actorId)!==Number(user.sub??user.id)))){const actor=identity.actorPerspective(user);if(actor!==user)users.push(actor);}
 return users.flatMap(u=>{
  if(!u.identityMapping)return [{user:u,database:null}];
  identity.businessIds(u);const access=u.secondaryModuleAccess,target=access?.users?.[Number(u.sub??u.id)];
  if(!target||Number(target.id)!==identity.businessIds(u).effective)throw error('SECONDARY_PROFILE_REQUIRED',503);
  return [{user:primaryProfile(u),database:access.primaryDatabase},{user:target,database:access.targetDatabase}];
 });
}
function hasPermission(user,key){return perspectives(user).every(p=>caps.hasPermission(p.user,key));}
function hasRole(user,...roles){return perspectives(user).every(p=>caps.hasRole(p.user,...roles));}
function mayUseBudget(user){return perspectives(user,true).every(p=>budgetActions.some(a=>caps.hasPermission(p.user,a))||caps.hasRole(p.user,'ACCOUNTING'));}
function canReadAllBudget(user){return perspectives(user).every(p=>['budget.plan.review','budget.plan.approve'].some(a=>caps.hasPermission(p.user,a))||caps.hasRole(p.user,'ACCOUNTING'));}
async function attach(req,primaryDatabase,targetDatabase,db=require('../db')){
 const mapping=req.user.identityMapping,users={};
 for(const [primaryId,targetId]of [[mapping.primaryEffectiveUserId,mapping.businessEffectiveUserId],[mapping.primaryActorUserId,mapping.businessActorUserId]]){
  if(users[primaryId])continue;
  users[primaryId]=await db.runWithTarget('onprem',async()=>{
   const row=(await db.wfQuery('SELECT Id,EmpId,AuthVersion,IsActive FROM wf.AppUser WHERE Id=@id',{id:{type:db.sql.Int,value:targetId}})).recordset?.[0];
   if(!row?.IsActive)throw error('SECONDARY_ACCOUNT_UNAVAILABLE');
   const profile=await require('./role-profiles').sessionProfile({id:targetId,sub:targetId,actorSub:targetId,empId:row.EmpId},{authVersion:row.AuthVersion});
   if(!Array.isArray(profile.roles)||!Array.isArray(profile.permissions))throw error('SECONDARY_PROFILE_REQUIRED',503);
   return profile;
  },targetDatabase);
 }
 req.user.secondaryModuleAccess={primaryDatabase,targetDatabase,users};
 const active=require('./active-database'),themes=await active.getDatabaseThemes();
 if(Object.values(users).some(u=>!active.canAccessDatabase(targetDatabase,u,themes)))throw error('DB_RESTRICTED');
 if(classify(req)?.startsWith('budget-')&&!mayUseBudget(req.user))throw error('BUDGET_PERMISSION_REQUIRED');
 if(classify(req)==='budget-write'){
  if(String(req.body?.expectedDatabase||'').toLowerCase()!==targetDatabase.toLowerCase())throw error('BUDGET_DATABASE_CHANGED',409);
  if(perspectives(req.user,true).some(p=>p.user.mustChangePassword)&&String(process.env.ENFORCE_PASSWORD_CHANGE).toLowerCase()==='true')throw error('PASSWORD_CHANGE_REQUIRED');
 }
}
function context(user,database){const actor=identity.actorPerspective(user);return {database,userId:identity.businessIds(user).effective,actions:[...budgetActions,'settings.manage'].filter(a=>hasPermission(user,a)&&hasPermission(actor,a)),canReadAnnual:canReadAllBudget(user)&&canReadAllBudget(actor)};}
async function allReportScopes(user,db=require('../db')){
 const {getVisibleScope}=require('./visible-scope');
 for(const p of perspectives(user,true)){const scope=p.database?await db.runWithTarget('onprem',()=>getVisibleScope(p.user),p.database):await getVisibleScope(p.user);if(scope.all!==true)return false;}
 return true;
}
// Directory results intersect both identities and both company hierarchies.
// Every translated member needs its own current, reviewed identity binding.
async function businessScopes(user,db=require('../db')){
 const {getVisibleScope}=require('./visible-scope');if(!user.identityMapping)return Promise.all([...new Set([user,identity.actorPerspective(user)])].map(u=>getVisibleScope(u)));
 const result=[],access=user.secondaryModuleAccess,resolver=require('./database-identity-resolver'),repository=resolver.sqlRepository(db,require('../onprem-target').isSwitchableDb);
 for(const u of [...new Set([user,identity.actorPerspective(user)])]){
  const pair=perspectives(u);const scope=await db.runWithTarget('onprem',()=>getVisibleScope(pair[0].user),access.primaryDatabase);
  result.push(await getVisibleScope(pair[1].user));
  if(scope.all)continue;
  const members=[...new Set(scope.userIds.map(Number))];if(members.length>500)throw error('SECONDARY_SCOPE_TOO_LARGE',503);
  const translated=[];
  for(const id of members){try{const m=await resolver.resolveReviewedIdentity({primaryUserId:id,primaryDatabase:access.primaryDatabase,targetDatabase:access.targetDatabase},repository);translated.push(m.targetUserId);}catch(e){if(e.code!=='IDENTITY_BINDING_INVALID')throw e;}}
  const inputs=Object.fromEntries(translated.map((id,i)=>['dir'+i,{type:db.sql.Int,value:id}]));
  const rows=translated.length?(await db.wfQuery('SELECT Id,EmpId FROM wf.AppUser WHERE IsActive=1 AND Id IN ('+translated.map((_,i)=>'@dir'+i).join(',')+')',inputs)).recordset:[];
  result.push({all:false,userIds:rows.map(r=>Number(r.Id)),empIds:rows.map(r=>r.EmpId).filter(v=>v!=null&&v!==''),basis:'REVIEWED_PRIMARY_SCOPE'});
 }
 return result;
}
module.exports={classify,attach,perspectives,hasPermission,hasRole,mayUseBudget,canReadAllBudget,context,allReportScopes,businessScopes};
