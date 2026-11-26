'use strict';
const db=require('../db'),{businessIds}=require('./business-identity');
const canonicalProvince=value=>String(value||'').trim().replace(/^(จังหวัด|จ\.)\s*/,'').replace(/^หนองบังลำภู$/,'หนองบัวลำภู').replace(/^ศรีสะเกษม$/,'ศรีสะเกษ');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function validate(input){
 const code=String(input.code||'').trim().toUpperCase(),name=String(input.name||'').trim(),type=input.type;
 const owner=Number(input.ownerUserId),revision=Number(input.expectedRevision);
 const provinces=Array.isArray(input.provinces)?input.provinces.map(canonicalProvince):[];
 if(!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)||!name||name.length>100||!['SALE','PROMOTION'].includes(type)||
   !Number.isSafeInteger(owner)||owner<=0||!Number.isSafeInteger(revision)||revision<0||provinces.length>77||
   provinces.some(p=>!p||p.length>50||/[\u0000-\u001f<>]/.test(p))||new Set(provinces).size!==provinces.length)
   fail('ข้อมูลเขตพื้นที่ไม่ถูกต้อง');
 if(input.active!==false&&!provinces.length)fail('กรุณาเลือกจังหวัดรับผิดชอบ');
 return {code,name,type,owner,revision,provinces,active:input.active!==false};
}
async function list(user){
 const scopes=await require('./secondary-budget-report-access').businessScopes(user);
 const filters=scopes.map((scope,i)=>require('./visible-scope').scopeFilter(scope,{userCol:'t.OwnerUserId',prefix:'territory'+i}));
 const filter={sql:filters.map(f=>'('+f.sql+')').join(' AND '),inputs:Object.assign({},...filters.map(f=>f.inputs))};
 const rows=(await db.wfQuery(`SELECT t.*,u.DisplayName OwnerName,e.EmpCode,e.EmpName,p.Province
  FROM wf.SalesTerritory t JOIN wf.AppUser u ON u.Id=t.OwnerUserId LEFT JOIN dbo.EMEmp e ON e.EmpID=u.EmpId
  LEFT JOIN wf.SalesTerritoryProvince p ON p.TerritoryCode=t.TerritoryCode WHERE ${filter.sql}
  ORDER BY t.TerritoryType,t.TerritoryCode,p.Province`,filter.inputs)).recordset||[];
 const map=new Map();for(const row of rows){if(!map.has(row.TerritoryCode))map.set(row.TerritoryCode,{...row,provinces:[]});if(row.Province)map.get(row.TerritoryCode).provinces.push(row.Province);}
 return [...map.values()].map(({Province,...r})=>r);
}
async function save(user,input){
 const ids=businessIds(user);if(ids.actor!==ids.effective||user.isImpersonating||!require('./role-capabilities').hasRole(user,'ADMIN'))fail('เฉพาะ ADMIN เท่านั้นที่จัดสรรพื้นที่ได้',403);
 const value=validate(input),reason=String(input.reason||'').trim();if(reason.length<10||reason.length>500)fail('ระบุเหตุผลอย่างน้อย 10 ตัวอักษร');
 return db.wfTransaction(async tx=>{
  const q=async(text,values={})=>{const r=tx.request();for(const [k,v]of Object.entries(values))r.input(k,typeof v==='number'?db.sql.Int:typeof v==='boolean'?db.sql.Bit:db.sql.NVarChar(db.sql.MAX),v);return r.query(text);};
  const policy=(await q("SELECT wf.fn_UserHasPermission(@id,'users.manage') Allowed",{id:ids.effective})).recordset?.[0];if(Number(policy?.Allowed)!==1)fail('สิทธิ์เปลี่ยนแล้ว กรุณาโหลดใหม่',403);
  const before=(await q('SELECT * FROM wf.SalesTerritory WITH(UPDLOCK,HOLDLOCK)')).recordset||[];
  const old=before.find(t=>t.TerritoryCode===value.code);
  if((old?Number(old.Revision):0)!==value.revision)fail('พื้นที่เปลี่ยนแล้ว กรุณาโหลดใหม่',409);
  const owner=(await q(`SELECT u.Id FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMEmp e WITH(HOLDLOCK) ON e.EmpID=u.EmpId
   WHERE u.Id=@id AND u.IsActive=1 AND e.EmpStatus='1' AND wf.fn_UserHasPermission(u.Id,'so.create')=1`,{id:value.owner})).recordset||[];
  if(owner.length!==1)fail('ผู้รับผิดชอบต้องมีบัญชีที่เปิดใช้งานและผูก Employee ที่ถูกต้อง',409);
  const provinceRows=(await q('SELECT * FROM wf.SalesTerritoryProvince WITH(UPDLOCK,HOLDLOCK)')).recordset||[];
  if(value.active&&provinceRows.some(p=>p.TerritoryCode!==value.code&&value.provinces.includes(p.Province)&&before.some(t=>t.TerritoryCode===p.TerritoryCode&&t.TerritoryType===value.type&&t.IsActive)))
   fail('จังหวัดซ้ำกับเขตที่เปิดใช้งานประเภทเดียวกัน กรุณาถอดจากเขตเดิมก่อน',409);
  if(old)await q(`UPDATE wf.SalesTerritory SET TerritoryName=@name,TerritoryType=@type,OwnerUserId=@owner,IsActive=@active,Revision=Revision+1,UpdatedAt=GETUTCDATE(),UpdatedBy=@actor WHERE TerritoryCode=@code`,{name:value.name,type:value.type,owner:value.owner,active:value.active,actor:ids.effective,code:value.code});
  else await q(`INSERT wf.SalesTerritory(TerritoryCode,TerritoryName,TerritoryType,OwnerUserId,IsActive,UpdatedBy) VALUES(@code,@name,@type,@owner,@active,@actor)`,{code:value.code,name:value.name,type:value.type,owner:value.owner,active:value.active,actor:ids.effective});
  await q('DELETE wf.SalesTerritoryProvince WHERE TerritoryCode=@code',{code:value.code});
  for(const province of value.provinces)await q('INSERT wf.SalesTerritoryProvince(TerritoryCode,Province) VALUES(@code,@province)',{code:value.code,province});
  await q(`INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,BeforeJson,AfterJson)
   VALUES('SALES_TERRITORY',@code,'SAVE','ORGANIZATION_TERRITORY',@reason,@actorText,@actorText,@before,@after)`,{
   code:value.code,reason,actorText:String(ids.effective),before:JSON.stringify(old?{...old,provinces:provinceRows.filter(p=>p.TerritoryCode===value.code).map(p=>p.Province)}:null),after:JSON.stringify({...value,revision:value.revision+1})});
  return {ok:true,code:value.code,revision:value.revision+1};
 },{isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});
}
module.exports={canonicalProvince,validate,list,save};
