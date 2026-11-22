'use strict';
const {sql}=require('../db');
const {input}=require('./native-document-source');
const {fail}=require('./native-document-plan');
// Validate the native result after its triggers ran, before any receipt can be
// finalized or the caller's transaction committed.
async function verifyNewResult(q,receipt,plan){
 const p={n:input(sql.Int,receipt.NativeId),r:input(sql.VarChar(36),receipt.RequestId),
  gross:input(sql.VarChar(40),plan.gross||'0'),discount:input(sql.VarChar(40),plan.discount||'0'),
  base:input(sql.VarChar(40),plan.taxBase||'0'),tax:input(sql.VarChar(40),plan.tax||'0'),net:input(sql.VarChar(40),plan.net||'0')};
 let valid;
 if(receipt.DocuType===119){
  valid=`EXISTS(SELECT 1 FROM dbo.SOHD h JOIN wf.NativeDocumentReceipt r ON r.NativeId=h.SOID AND r.RequestId=@r
    WHERE h.DocuType=103 AND h.AppvFlag='Y' AND h.AppvDocuNo=r.NativeNo AND h.Appvid IS NOT NULL AND h.AppvDate IS NOT NULL)`;
 }else if(receipt.DocuType===104){
  valid=`EXISTS(SELECT 1 FROM dbo.SOHD h JOIN wf.NativeDocumentReceipt r ON r.NativeId=h.SOID AND r.RequestId=@r
    JOIN dbo.SOInvHD f ON f.SOInvID=r.FinanceId AND f.Docutype=202
    JOIN dbo.VTVAT v ON v.FromID=f.PostID AND v.FromFlag=202
    WHERE h.SOID=@n AND h.DocuType=104 AND h.DocuNo=r.NativeNo AND h.SumGoodAmnt=CONVERT(decimal(18,4),@gross)
     AND h.BillDiscAmnt=CONVERT(decimal(18,4),@discount) AND h.BillAftrDiscAmnt=CONVERT(decimal(18,4),@base)
     AND ISNULL(h.VatAmnt,0)=CONVERT(decimal(18,4),@tax) AND h.NetAmnt=CONVERT(decimal(18,4),@net)
     AND f.DocuNo=h.DocuNo AND f.CustID=h.CustID AND f.ARID=h.CustID AND f.SumGoodAmnt=h.SumGoodAmnt AND f.BillDiscAmnt=h.BillDiscAmnt
     AND f.BillAftrDiscAmnt=h.BillAftrDiscAmnt AND f.VATAmnt=ISNULL(h.VatAmnt,0) AND f.NetAmnt=h.NetAmnt AND f.RemaAmnt=h.NetAmnt
     AND f.CouponFlag='Y' AND f.StockEffc='N' AND v.BaseAmnt=h.BillAftrDiscAmnt AND v.VatAmnt=ISNULL(h.VatAmnt,0)
     AND(SELECT COUNT(*) FROM dbo.VTVAT WHERE FromFlag=202 AND FromID=f.PostID)=1)
    AND NOT EXISTS(SELECT 1 FROM wf.NativeDocumentReceiptLine l
     LEFT JOIN dbo.SODT d ON d.SOID=@n AND d.ListNo=l.NativeLineNo AND d.DocuType=104
     LEFT JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId
     LEFT JOIN dbo.SOInvDT f ON f.SOInvID=${Number(receipt.FinanceId)} AND f.ListNo=l.NativeLineNo
     WHERE l.RequestId=@r AND(d.SOID IS NULL OR c.CouponID IS NULL OR f.SOInvID IS NULL OR d.GoodQty2<>l.Quantity OR d.RemaQty<>l.Quantity
      OR d.GoodAmnt<>l.GrossAmount OR c.DocuID<>@n OR c.RefListno<>l.NativeLineNo OR c.CouponNo<>l.CouponNo OR c.GoodQty<>l.Quantity OR c.RemaQty<>l.Quantity
      OR c.GoodPrice<>d.GoodPrice2 OR c.GoodID<>d.GoodID OR c.SackQty*c.ContainQty<>l.Quantity*1000
      OR f.Docutype<>202 OR f.RefID<>@n OR f.RefListNo<>l.NativeLineNo OR f.GoodAmnt<>l.TaxBase OR f.TotaExcludeAmnt<>l.TaxBase
      OR(SELECT COUNT(*) FROM dbo.WFCoupon x WHERE x.DocuID=@n AND x.RefListno=l.NativeLineNo)<>1))
    AND(SELECT COUNT(*) FROM dbo.SODT WHERE SOID=@n)=(SELECT COUNT(*) FROM wf.NativeDocumentReceiptLine WHERE RequestId=@r)`;
 }else if(receipt.DocuType===116){
  p.total=input(sql.VarChar(40),plan.quantity);
  p.date=input(sql.VarChar(10),plan.docDate);p.receiver=input(sql.NVarChar(100),plan.receiver);p.plate=input(sql.NVarChar(25),plan.plate);
  valid=`EXISTS(SELECT 1 FROM dbo.WFRedemtionHD h JOIN wf.NativeDocumentReceipt r ON r.RequestId=@r
    JOIN wf.AppUser u ON u.Id=r.UserId
    WHERE h.RedemtionID=@n AND h.DocuType=116 AND h.DocuNo=r.NativeNo AND h.SumGoodQty=CONVERT(decimal(18,4),@total)
     AND h.SaveEmpID=CONVERT(int,u.EmpId) AND h.IsCheckAll='Y' AND h.DocuStatus='N'
     AND h.DocuDate=CONVERT(datetime,@date,120) AND h.IssueName=@receiver AND h.CarLicense=@plate)
   AND NOT EXISTS(SELECT 1 FROM wf.NativeDocumentReceiptLine l LEFT JOIN dbo.WFRedemtionDT d ON d.RedemtionID=@n AND d.Listno=l.NativeLineNo
    WHERE l.RequestId=@r AND(d.RedemtionID IS NULL OR d.CouponID<>l.CouponId OR d.CouponNo<>l.CouponNo OR d.GoodQty<>l.Quantity OR d.RemaQty<>l.Quantity
     OR d.IsCheck<>'Y' OR d.PostInv<>'N' OR d.SOInvID IS NOT NULL))
   AND(SELECT COUNT(*) FROM dbo.WFRedemtionDT WHERE RedemtionID=@n)=(SELECT COUNT(*) FROM wf.NativeDocumentReceiptLine WHERE RequestId=@r)`;
  for(const line of plan.lines){
   const r=(await q(`SELECT CONVERT(varchar(40),CONVERT(decimal(18,4),RemaQty)) AS Remaining FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@c`,
    {c:input(sql.Int,line.couponId)})).recordset?.[0];
   const {fixed}=require('./native-document-plan');
   if(!r||fixed(r.Remaining)!==fixed(line.beforeRemaining)-fixed(line.quantity))fail('ND_NATIVE_RESULT_MISMATCH');
  }
 }else{
  p.date=input(sql.VarChar(10),plan.docDate);
  valid=`EXISTS(SELECT 1 FROM dbo.SOInvHD h JOIN wf.NativeDocumentReceipt r ON r.RequestId=@r
    WHERE h.SOInvID=@n AND h.Docutype=107 AND h.DocuNo=r.NativeNo AND h.DocuDate=CONVERT(datetime,@date,120)
     AND h.InvDate=h.DocuDate AND h.ShipDate=h.DocuDate AND h.CreditEndDate=DATEADD(day,h.CreditDays,h.DocuDate)
     AND h.SumGoodAmnt=CONVERT(decimal(18,4),@gross) AND h.BillDiscAmnt=CONVERT(decimal(18,4),@discount)
     AND h.BillAftrDiscAmnt=CONVERT(decimal(18,4),@base) AND h.VATAmnt=CONVERT(decimal(18,4),@tax) AND h.NetAmnt=CONVERT(decimal(18,4),@net)
     AND h.CouponFlag='Y' AND h.StockEffc='Y' AND h.PostGL='N')
   AND NOT EXISTS(SELECT 1 FROM wf.NativeDocumentReceiptLine l
    LEFT JOIN dbo.SOInvDT d ON d.SOInvID=@n AND d.ListNo=l.NativeLineNo
    LEFT JOIN dbo.WFRedemtionDT c ON c.RedemtionID=l.SourceId AND c.Listno=l.SourceLineNo
    LEFT JOIN dbo.ICStockDetail s ON s.DocuID=@n AND s.DocuType=107 AND s.ListNo=l.NativeLineNo
    WHERE l.RequestId=@r AND(d.SOInvID IS NULL OR c.RedemtionID IS NULL OR s.StockDetailID IS NULL OR d.Docutype<>107
     OR d.GoodQty2<>l.Quantity OR d.GoodStockQty<>l.Quantity OR d.GoodAmnt<>l.GrossAmount OR d.TotaExcludeAmnt<>l.TaxBase
     OR c.SOInvID<>@n OR c.SOListNo<>l.NativeLineNo OR c.PostInv<>'Y' OR c.RemaQty<>0
     OR s.GoodID<>d.GoodID OR s.GoodStockQty<>l.Quantity OR s.GoodQty2<>l.Quantity OR s.StockFlag<>-1))
   AND(SELECT COUNT(*) FROM dbo.SOInvDT WHERE SOInvID=@n)=(SELECT COUNT(*) FROM wf.NativeDocumentReceiptLine WHERE RequestId=@r)
   AND(SELECT COUNT(*) FROM dbo.ICStockDetail WHERE DocuID=@n AND DocuType=107)=(SELECT COUNT(*) FROM wf.NativeDocumentReceiptLine WHERE RequestId=@r)`;
 }
 const result=(await q(`SELECT CASE WHEN ${valid} THEN 1 ELSE 0 END AS Valid`,p)).recordset?.[0]?.Valid;
 if(result!==1)fail('ND_NATIVE_RESULT_MISMATCH');
}
module.exports={verifyNewResult};
