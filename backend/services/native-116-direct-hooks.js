'use strict';
// Candidate direct protocol. Installation is a privileged, reviewed release
// operation; importing this module never installs/enables a database hook.
const {createHash}=require('crypto');
const head='RedemtionID,DocuNo,DocuDate,CardNo,IssueName,CarLicense,SaveEmpID,IssueEmpID,AppvEmpID,SumGoodQty,IsCheckAll';
const detail='Listno,CouponID,CouponNo,GoodID,InveID,LocaID,GoodUnitID,CONVERT(decimal(18,4),GoodPrice) AS GoodPrice,CONVERT(decimal(18,4),GoodQty) AS GoodQty,IsCheck';
const wrap=(name,table,event,body)=>`ALTER TRIGGER dbo.${name} ON dbo.${table} AFTER ${event} AS
BEGIN
 SET NOCOUNT ON;
 BEGIN TRY
 IF wf.fn_Native116RecoveryWriter()=1 RETURN;
 ${body}
 END TRY
 BEGIN CATCH
  DECLARE @error nvarchar(2048);SET @error=ERROR_MESSAGE();
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('%s',16,1,@error);
 END CATCH;
END;`;
const balances=`IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID WHERE i.RemaQty IS NULL OR d.RemaQty IS NULL)
 BEGIN RAISERROR('BRIDGE_NATIVE_BALANCE_UNKNOWN',16,1);RETURN;END;
 DECLARE @changes xml;
 SET @changes=(SELECT i.CouponID AS [@couponId],CONVERT(decimal(18,4),d.RemaQty) AS [@before],CONVERT(decimal(18,4),i.RemaQty) AS [@after]
  FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID WHERE i.RemaQty<>d.RemaQty FOR XML PATH('row'),ROOT('changes'),TYPE);`;
const specs=[
 ['WF_CouponNativeConsume','WFCoupon','UPDATE',`IF wf.fn_Native116BalanceWriter()=1 RETURN;
 ${balances}
 DECLARE @handled int;EXEC @handled=wf.sp_Native116ObserveBalance @changes;
 IF @handled=1 RETURN;
 EXEC wf.sp_CouponBridgeObserve 'B',NULL,NULL,@changes;`],
 ['WF_CouponReservationGuard','WFCoupon','UPDATE',`${balances}
 EXEC wf.sp_Native116Floor @changes;
 EXEC wf.sp_CouponBridgeFloor @changes;`],
 ...[['WF_CouponNativeEditHeadHook','WFRedemtionHD','H',head,'head'],['WF_CouponNativeEditDetailHook','WFRedemtionDT','D',detail,'line']].map(([name,table,kind,columns,tag])=>[
  name,table,'INSERT,UPDATE,DELETE',`DECLARE @id int,@before xml,@after xml,@handled int;
  ${kind==='H'?`IF EXISTS(SELECT 1 FROM inserted WHERE DocuType IS NULL OR DocuType<>116 OR DocuStatus IS NULL OR DocuStatus='C')
   OR EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.RedemtionID=i.RedemtionID WHERE i.DocuType<>d.DocuType OR d.DocuType IS NULL)
  BEGIN RAISERROR('NATIVE_116_TYPE_OR_STATUS_CHANGE_REQUIRES_REVIEW',16,1);RETURN;END;`:''}
  IF(SELECT COUNT(*) FROM(SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted)x)>1
  BEGIN
   IF NOT EXISTS(SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM inserted EXCEPT SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM deleted)
    AND NOT EXISTS(SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM deleted EXCEPT SELECT ${kind==='H'?'':'RedemtionID,'}${columns} FROM inserted)
   BEGIN
    DECLARE document_fences CURSOR LOCAL FAST_FORWARD FOR SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted;
    OPEN document_fences;FETCH NEXT FROM document_fences INTO @id;
    WHILE @@FETCH_STATUS=0 BEGIN EXEC wf.sp_Native116DocumentFence @id;FETCH NEXT FROM document_fences INTO @id;END;
    CLOSE document_fences;DEALLOCATE document_fences;RETURN;
   END;
   RAISERROR('BRIDGE_MULTI_DOCUMENT_STATEMENT_REQUIRES_REVIEW',16,1);RETURN;
  END;
  SELECT @id=RedemtionID FROM(SELECT RedemtionID FROM inserted UNION SELECT RedemtionID FROM deleted)x;
  IF @id IS NULL RETURN;
  SET @before=(SELECT ${columns} FROM deleted ORDER BY ${kind==='H'?'RedemtionID':'Listno'} FOR XML RAW('${tag}'),TYPE);
  SET @after=(SELECT ${columns} FROM inserted ORDER BY ${kind==='H'?'RedemtionID':'Listno'} FOR XML RAW('${tag}'),TYPE);
  IF ISNULL(CONVERT(nvarchar(max),@before),N'')<>ISNULL(CONVERT(nvarchar(max),@after),N'')
  BEGIN
   ${kind==='H'?`DECLARE @fullBefore xml,@fullAfter xml;
   SET @fullBefore=(SELECT ${head},DocuType,DocuStatus FROM deleted FOR XML RAW('head'),TYPE);
   SET @fullAfter=(SELECT ${head},DocuType,DocuStatus FROM inserted FOR XML RAW('head'),TYPE);
   EXEC @handled=wf.sp_Native116ObserveHead @id,@fullBefore,@fullAfter;`:'EXEC @handled=wf.sp_Native116ObserveDetail @id;'}
   IF @handled=1 RETURN;
  END;
  EXEC wf.sp_Native116DocumentFence @id;
  EXEC wf.sp_CouponBridgeObserve '${kind}',@id,@before,@after;`]),
 ['WF_Native116AuditHook','SMAudit','INSERT',`IF wf.fn_Native116Eligible()<>1 RETURN;
 DECLARE @stage uniqueidentifier,@audit int;
 SELECT @stage=StageId FROM wf.Native116Stage WHERE State='PENDING' AND wf.fn_Native116StageOwned(StageId)=1;
 IF @stage IS NULL OR NOT EXISTS(SELECT 1 FROM inserted WHERE audit_screen=2098003052) RETURN;
 IF(SELECT COUNT(*) FROM inserted WHERE audit_screen=2098003052)<>1
 BEGIN RAISERROR('NATIVE_116_AUDIT_AMBIGUOUS',16,1);RETURN;END;
 SELECT @audit=audit_id FROM inserted WHERE audit_screen=2098003052;
 INSERT wf.Native116AuditContext(SessionId,StageId,NativeAuditId) VALUES(@@SPID,@stage,@audit);
 EXEC wf.sp_CouponNative116Admit @stage,@audit;
 DELETE wf.Native116AuditContext WHERE SessionId=@@SPID AND StageId=@stage AND NativeAuditId=@audit;`],
];
// Keep the exact previously reviewed direct protocol available only to the
// release planner. An upgrade may replace these five known hooks, never drift.
const previousDefinitions=specs.map(([name,table,event,body])=>({name,table,sql:wrap(name,table,event,body)}));
const definitions=previousDefinitions.map(d=>d.name!=='WF_Native116AuditHook'?d:{...d,sql:d.sql.replace(
 "IF @stage IS NULL OR NOT EXISTS(SELECT 1 FROM inserted WHERE audit_screen=2098003052) RETURN;",
 `IF NOT EXISTS(SELECT 1 FROM inserted WHERE audit_screen=2098003052) RETURN;
 IF @stage IS NULL
 BEGIN
  -- WinSpeed may continue to its audit/print after an earlier statement failed.
  -- A save audit without an observed save must fail visibly, never look complete.
  IF EXISTS(SELECT 1 FROM inserted WHERE audit_screen=2098003052 AND RTRIM(audit_action) IN('I','U','D'))
  BEGIN RAISERROR('NATIVE_116_SAVE_NOT_RECORDED_REOPEN_DOCUMENT',16,1);RETURN;END;
  RETURN;
 END;`)});
const orders=[{name:'WF_CouponNativeEditHeadHook',event:'DELETE',order:'First'},{name:'WF_Native116AuditHook',event:'INSERT',order:'Last'}];
const digest=s=>createHash('sha256').update(s.replace(/^ALTER TRIGGER /,'CREATE TRIGGER ').replace(/\r\n/g,'\n')).digest('hex');
const hashDefinitions=values=>digest(JSON.stringify({definitions:values.map(d=>[d.table.toLowerCase(),d.name.toLowerCase(),digest(d.sql)]),orders}));
const moduleHash=hashDefinitions(definitions);
function fingerprints(baseline,values){
 const rows=baseline.map(row=>{const d=values.find(d=>d.table.toLowerCase()===row[0]&&d.name.toLowerCase()===row[1]);return d?[row[0],row[1],0,digest(d.sql)]:row;});
 for(const d of values)if(!rows.some(r=>r[0]===d.table.toLowerCase()&&r[1]===d.name.toLowerCase()))rows.push([d.table.toLowerCase(),d.name.toLowerCase(),0,digest(d.sql)]);
 return rows.sort((a,b)=>a[0]+'|'+a[1]<b[0]+'|'+b[1]?-1:a[0]+'|'+a[1]>b[0]+'|'+b[1]?1:0);
}
const expectedTriggers=baseline=>fingerprints(baseline,definitions);
const previous=Object.freeze({definitions:previousDefinitions,orders,moduleHash:hashDefinitions(previousDefinitions),expectedTriggers:baseline=>fingerprints(baseline,previousDefinitions)});
module.exports={definitions,orders,moduleHash,expectedTriggers,previous};
