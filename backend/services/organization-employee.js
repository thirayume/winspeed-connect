'use strict';
const bad=(message,status=400)=>Object.assign(Error(message),{status});
function code(value){const s=String(value||'').trim().toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]{0,24}$/.test(s))throw bad('รหัส Employee ไม่ถูกต้อง');return s;}
async function read(db,employeeCode,q=db.wfQuery){
 const rows=(await q(`SELECT e.EmpID,e.EmpCode,e.EmpName,e.EmpTitle,e.EmpHead,e.EmpStatus,e.EmpType,h.EmpCode HeadCode,
  CONVERT(nvarchar(max),(SELECT e.EmpID,e.EmpCode,e.EmpName,e.EmpTitle,e.EmpHead,e.EmpStatus,e.EmpType FOR XML RAW('employee'),TYPE)) ExpectedSnapshot
  FROM dbo.EMEmp e LEFT JOIN dbo.EMEmp h ON h.EmpID=e.EmpHead WHERE UPPER(RTRIM(e.EmpCode))=@code`,{code:{type:db.sql.VarChar(25),value:code(employeeCode)}})).recordset||[];
 if(rows.length>1)throw bad('รหัส Employee ซ้ำใน WinSpeed ต้องตรวจแก้ก่อน',409);
 return rows[0]||null;
}
async function save(db,user,input){
 const {businessIds}=require('./business-identity'),ids=businessIds(user);
 if(ids.actor!==ids.effective||user.isImpersonating||!require('./role-capabilities').hasRole(user,'ADMIN'))throw bad('เฉพาะ ADMIN ที่ใช้บัญชีตนเองเท่านั้น',403);
 const employeeCode=code(input.code),name=String(input.name||'').trim(),title=String(input.title||'').trim(),headCode=input.headCode?code(input.headCode):null,reason=String(input.reason||'').trim();
 if(!name||name.length>100||title.length>50||reason.length<10||reason.length>500||typeof input.expectedSnapshot!=='string'||input.expectedSnapshot.length>10000)throw bad('ข้อมูล Employee หรือเหตุผลไม่ครบถ้วน');
 const database=String(db.getDbName?.()||require('./active-database').primaryDatabase()||'');
 if(!database||String(input.expectedDatabase||'').toLowerCase()!==database.toLowerCase())throw bad('ฐานข้อมูลเปลี่ยน กรุณาโหลดใหม่',409);
 return db.wfTransaction(async tx=>{
  const q=require('./promotion-budget').query(tx,db.sql);
  const before=await read(db,employeeCode,q);
  const r=tx.request();for(const [key,type,value]of [
   ['code',db.sql.VarChar(25),employeeCode],['name',db.sql.NVarChar(100),name],['title',db.sql.NVarChar(50),title||null],['headCode',db.sql.VarChar(25),headCode],
   ['expected',db.sql.NVarChar(db.sql.MAX),input.expectedSnapshot],['create',db.sql.Bit,input.create===true],['actor',db.sql.Int,ids.actor],['reason',db.sql.NVarChar(500),reason]
  ])r.input(key,type,value);
  try{await r.query('DECLARE @saved int;EXEC wf.sp_OrganizationSaveEmployee @code,@name,@title,@headCode,@expected,@create,@actor,@reason,@saved OUTPUT;SELECT @saved EmployeeId');}
  catch(e){if(/EMPLOYEE_/.test(String(e.message)))throw bad('Employee เปลี่ยนแล้ว รหัสซ้ำ หัวหน้าไม่ถูกต้อง หรือสิทธิ์ไม่พร้อม กรุณาโหลดและตรวจใหม่',409);throw e;}
  if(input.syncLinkedName===true){
   const linked=(await q('SELECT Id,DisplayName FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE EmpId=CONVERT(varchar(20),@emp)',{emp:{type:db.sql.Int,value:(await read(db,employeeCode,q)).EmpID}})).recordset||[];
   for(const row of linked){
    await q('UPDATE wf.AppUser SET DisplayName=@name WHERE Id=@id',{name:{type:db.sql.NVarChar(100),value:name},id:{type:db.sql.Int,value:row.Id}});
    await require('./policy-contract').logChangeEvent(tx,{entityType:'USER',entityId:row.Id,action:'SYNC_EMPLOYEE_NAME',beforeJson:{DisplayName:row.DisplayName},afterJson:{DisplayName:name},reasonCode:'ORGANIZATION_EMPLOYEE',reasonText:reason,userId:ids.effective});
   }
  }
  const after=await read(db,employeeCode,q);
  return {data:after,created:!before,database};
 },{isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});
}
module.exports={read,save,code};
