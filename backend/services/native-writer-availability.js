'use strict';
// Reservation creation must stop while v3 hooks/contracts are deactivated.
// Read-only screens and cancellation remain available for recovery.
async function assertNativeReservationReady(query,env=process.env){
 if(env.NATIVE_DOCUMENT_WRITER_VERSION!=='v3')return;
 const fail=()=>Object.assign(Error('ระบบตั๋วยังไม่พร้อมทำรายการ กรุณาติดต่อผู้ดูแลหรือลองใหม่ภายหลัง'),{code:'COUPON_NATIVE_WRITER_NOT_READY',status:503});
 if(env.NATIVE_COUPON_BRIDGE_ENABLED!=='true')throw fail();
 let row;try{row=(await query(`SELECT wf.fn_IsNativeDocumentTarget() TargetReady,Enabled,ModulesHash
  FROM wf.CouponBridgeContract WITH(HOLDLOCK) WHERE Version='116-BRIDGE-v1'`)).recordset?.[0];}catch{throw fail()}
 if(Number(row?.TargetReady)!==1||Number(row?.Enabled)!==1||row.ModulesHash!==require('./coupon-bridge-hooks').moduleHash)throw fail();
}
module.exports={assertNativeReservationReady};
