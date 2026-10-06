'use strict';
const {sql,wfQuery}=require('../db');
const {normalizeDateString}=require('./so-pickup-policy');
async function getConfirmationReplay(req) {
  if (!/^\d+$/.test(String(req.params.id))) return null;
  const draftId=Number(req.params.id);
  if (!Number.isSafeInteger(draftId)||draftId>2147483647) return null;
  const row=(await wfQuery(
    'SELECT SOID,WfRef,SalesUserId,EnteredByUserId,PickupDueDate,PickupDueType,ConfirmedAt,PickupPolicySnapshotId FROM wf.SalesOrderExt WHERE SourceDraftId=@id',
    {id:{type:sql.Int,value:draftId}})).recordset[0];
  if (!row) return null;
  if (req.user.role==='SALES' && ![row.SalesUserId,row.EnteredByUserId].some(id=>id!=null&&Number(id)===Number(req.user.sub))) {
    throw Object.assign(new Error('ไม่สามารถดูผลการยืนยันของผู้ใช้อื่น'),{status:403});
  }
  return {id:row.SOID,docuNo:row.WfRef,status:'CONFIRMED',
    pickupDueDate:normalizeDateString(row.PickupDueDate,{isWallClock:true}),
    pickupDueType:row.PickupDueType||'DEFAULT',confirmedAt:row.ConfirmedAt,
    pickupPolicySnapshotId:row.PickupPolicySnapshotId,replayed:true};
}
module.exports={getConfirmationReplay};
