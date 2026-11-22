'use strict';
// Replace only four existing, disabled Sale-App hooks. Native WinSpeed tI/tU/tD
// definitions and table schemas are never changed. The installer validates the
// entire baseline and rolls back unless every native fingerprint stays equal.
const {createHash}=require('crypto');
const head='RedemtionID,DocuNo,DocuDate,CardNo,IssueName,CarLicense,SaveEmpID,IssueEmpID,AppvEmpID,SumGoodQty,IsCheckAll';
const detail='Listno,CouponID,CouponNo,GoodID,InveID,LocaID,GoodUnitID,CONVERT(decimal(18,4),GoodPrice) AS GoodPrice,CONVERT(decimal(18,4),GoodQty) AS GoodQty,IsCheck';
const wrap=(name,table,event,body)=>`ALTER TRIGGER dbo.${name} ON dbo.${table} AFTER ${event} AS
BEGIN
 SET NOCOUNT ON;
 BEGIN TRY
 ${body}
 END TRY
 BEGIN CATCH
  DECLARE @error nvarchar(2048);SET @error=ERROR_MESSAGE();
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('%s',16,1,@error);
 END CATCH;
END;`;
const balances=`IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
 WHERE i.RemaQty IS NULL OR d.RemaQty IS NULL) BEGIN RAISERROR('BRIDGE_NATIVE_BALANCE_UNKNOWN',16,1);RETURN;END;
 DECLARE @changes xml;
 SET @changes=(SELECT i.CouponID AS [@couponId],CONVERT(decimal(18,4),d.RemaQty) AS [@before],
 CONVERT(decimal(18,4),i.RemaQty) AS [@after] FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
 WHERE i.RemaQty<>d.RemaQty FOR XML PATH('row'),ROOT('changes'),TYPE);`;
const specs=[
 ['WF_CouponNativeConsume','WFCoupon','UPDATE',balances+"\n EXEC wf.sp_CouponBridgeObserve 'B',NULL,NULL,@changes;"],
 ['WF_CouponReservationGuard','WFCoupon','UPDATE',balances+'\n EXEC wf.sp_CouponBridgeFloor @changes;'],
 ...[['WF_CouponNativeEditHeadHook','WFRedemtionHD','H',head,'head'],['WF_CouponNativeEditDetailHook','WFRedemtionDT','D',detail,'line']].map(([name,table,kind,columns,tag])=>[
  name,table,'INSERT,UPDATE,DELETE',`DECLARE @id int,@before xml,@after xml;
  IF(SELECT COUNT(*) FROM(SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted)x)>1
  BEGIN
   -- A grouped 107 updates invoice lifecycle fields on several 116s. Only
   -- unchanged physical facts may pass; multi-document edits remain blocked.
   IF NOT EXISTS(SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM inserted EXCEPT SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM deleted)
    AND NOT EXISTS(SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM deleted EXCEPT SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM inserted) RETURN;
   RAISERROR('BRIDGE_MULTI_DOCUMENT_STATEMENT_REQUIRES_REVIEW',16,1);RETURN;
  END;
  SELECT @id=RedemtionID FROM(SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted)x;
  IF @id IS NULL RETURN;
  SET @before=(SELECT ${columns} FROM deleted ORDER BY ${kind==='H'?'RedemtionID':'Listno'} FOR XML RAW('${tag}'),TYPE);
  SET @after=(SELECT ${columns} FROM inserted ORDER BY ${kind==='H'?'RedemtionID':'Listno'} FOR XML RAW('${tag}'),TYPE);
  EXEC wf.sp_CouponBridgeObserve '${kind}',@id,@before,@after;`]),
];
const definitions=specs.map(([name,table,event,body])=>({name,table,sql:wrap(name,table,event,body)}));
// SQL Server 2008 stores ALTER TRIGGER's definition with CREATE TRIGGER.
const digest=s=>createHash('sha256').update(s.replace(/^ALTER TRIGGER /,'CREATE TRIGGER ').replace(/\r\n/g,'\n')).digest('hex');
const moduleHash=digest(JSON.stringify(definitions.map(d=>[d.table.toLowerCase(),d.name.toLowerCase(),digest(d.sql)])));
function expectedTriggers(baseline){return baseline.map(row=>{
 const changed=definitions.find(d=>d.table.toLowerCase()===row[0]&&d.name.toLowerCase()===row[1]);
 return changed?[row[0],row[1],0,digest(changed.sql)]:row;
});}
module.exports={definitions,moduleHash,expectedTriggers};
