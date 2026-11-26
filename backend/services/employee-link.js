'use strict';
async function validateEmployeeLink(tx,userId,empId,expected,checkExpected=false){
 const {sql}=require('../db');
 const id=empId==null||empId===''?null:Number(empId);
 if(id!=null&&(!/^\d+$/.test(String(empId))||!Number.isSafeInteger(id)||id<=0||id>2147483647))throw Object.assign(Error('รหัส Employee ไม่ถูกต้อง'),{status:400});
 const r=tx.request();r.input('user',sql.Int,userId||null);r.input('emp',sql.Int,id);r.input('expected',sql.NVarChar(20),expected==null?null:String(expected));r.input('checkExpected',sql.Bit,checkExpected);
 try{await r.query('EXEC wf.sp_ValidateEmployeeLink @user,@emp,@expected,@checkExpected');}
 catch(e){if(/EMPLOYEE_/.test(String(e.message)))throw Object.assign(Error('Employee ไม่มีอยู่ ถูกผูกบัญชีอื่น หรือการจับคู่เปลี่ยนแล้ว กรุณาโหลดใหม่'),{status:409});throw e;}
}
module.exports={validateEmployeeLink};
