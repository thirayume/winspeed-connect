'use strict';
const {sql,wfQuery}=require('../db');
const {normalizeDateString}=require('./so-pickup-policy');
const {getVisibleScope,inScope}=require('./visible-scope');
const {actorPerspective}=require('./business-identity');
async function getConfirmationReplay(req) {
  if (!/^\d+$/.test(String(req.params.id))) return null;
  const draftId=Number(req.params.id);
  if (!Number.isSafeInteger(draftId)||draftId>2147483647) return null;
  const {businessDate}=await require('./global-data-window-store').readGlobalDataWindow();
  const rows=(await wfQuery(`SELECT x.SOID,x.WfRef,x.SalesUserId,x.EnteredByUserId,x.PickupDueDate,x.PickupDueType,
      x.ConfirmedAt,x.PickupPolicySnapshotId,CAST(h.EmpID AS VARCHAR(20)) AS OwnerEmpId,
      CASE WHEN h.DocuDate >= @globalStartDate THEN 1 ELSE 0 END AS InDataWindow
    FROM wf.SalesOrderExt x LEFT JOIN dbo.SOHD h ON h.SOID=CASE
      WHEN LTRIM(RTRIM(x.SOID)) <> '' AND LTRIM(RTRIM(x.SOID)) COLLATE Latin1_General_BIN2 NOT LIKE '%[^0-9]%'
        AND (LEN(LTRIM(RTRIM(x.SOID))) <= 9 OR
          (LEN(LTRIM(RTRIM(x.SOID))) = 10 AND LTRIM(RTRIM(x.SOID)) COLLATE Latin1_General_BIN2 <= '2147483647'))
      THEN CAST(LTRIM(RTRIM(x.SOID)) AS INT) ELSE NULL END AND h.DocuType=103
    WHERE x.SourceDraftId=@id`,
    {id:{type:sql.Int,value:draftId},globalStartDate:{type:sql.Date,value:businessDate}})).recordset || [];
  if(rows.length>1) throw Object.assign(new Error('ไม่สามารถยืนยันผลซ้ำที่มีเอกสารต้นทางหลายรายการ'),{status:409});
  const row=rows[0];
  if (!row) return null;
  // An old or missing native booking must not fall through into a fresh
  // confirmation, even if its former draft ID now identifies another row.
  if(Number(row.InDataWindow)!==1) throw Object.assign(new Error('ไม่พบบิลในช่วงข้อมูลที่ใช้งาน'),{status:404});
  const scope=await getVisibleScope(req.user);
  if(!inScope(scope,{userId:row.SalesUserId,empId:row.OwnerEmpId,extraUserIds:[row.EnteredByUserId]}))
    throw Object.assign(new Error('ไม่พบบิลในขอบเขตผู้ใช้งาน'),{status:404});
  const actor=actorPerspective(req.user);
  if(actor!==req.user && !inScope(await getVisibleScope(actor),
    {userId:row.SalesUserId,empId:row.OwnerEmpId,extraUserIds:[row.EnteredByUserId]}))
    throw Object.assign(new Error('ไม่พบบิลในขอบเขตผู้ใช้งาน'),{status:404});
  return {id:row.SOID,docuNo:row.WfRef,status:'CONFIRMED',
    pickupDueDate:normalizeDateString(row.PickupDueDate,{isWallClock:true}),
    pickupDueType:row.PickupDueType||'DEFAULT',confirmedAt:row.ConfirmedAt,
    pickupPolicySnapshotId:row.PickupPolicySnapshotId,replayed:true};
}
module.exports={getConfirmationReplay};
