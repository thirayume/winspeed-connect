'use strict';
const db=require('../db');
const {filters:invoiceFilters}=require('./invoice-register-report');
const col=(key,label,type='text',sum=false)=>({key,label,type,...(sum?{aggregation:'sum',precision:type==='integer'?0:2}:{})});
const receiptColumns=[col('ReceiptNo','เลขที่รับชำระ','identifier'),col('ReceiptDate','วันที่รับชำระ','date'),col('ReceiptKind','ชนิดเอกสาร'),col('CustCode','รหัสลูกค้า','identifier'),col('CustName','ลูกค้า'),col('EmpCode','รหัสพนักงาน','identifier'),col('Amount','ยอดรับชำระตามเอกสาร','money',true),col('CashAmount','เงินสด','money',true),col('TransferAmount','โอนธนาคาร','money',true),col('ChequeAmount','เช็ครับ','money',true),col('CardAmount','บัตร','money',true),col('WithholdingAmount','ภาษีหัก ณ ที่จ่าย','money',true),col('DiscountAmount','ส่วนลดจ่าย','money',true),col('AdvanceAmount','ตัดเงินล่วงหน้า','money',true),col('OtherAmount','ชำระอื่น','money',true),col('RefDocNo','เอกสารตัดหนี้ / วันที่'),col('ChequeRefs','เช็คอ้างอิง'),col('PostedGL','ลงบัญชีแล้ว')];
const chequeColumns=[col('RowKind','ประเภทแถว'),col('ReceiptNo','เอกสารรับเช็ค','identifier'),col('ReceiptDate','วันที่รับเช็ค','date'),col('ChequeNo','เลขที่เช็ค','identifier'),col('ChequeDate','วันที่หน้าเช็ค','date'),col('CustCode','รหัสลูกค้า','identifier'),col('CustName','ลูกค้า'),col('BankCode','รหัสธนาคาร','identifier'),col('BankName','ธนาคาร'),col('ChequeAmount','จำนวนเงินหน้าเช็ค','money',true),col('UnreplacedAmount','ยอดหลังเปลี่ยนเช็ค ณ วันสิ้นสุด','money',true),col('OpenAmount','ยอดยังไม่ผ่าน / ไม่ยกเลิก','money',true),col('StatusCode','รหัสสถานะ'),col('Status','สถานะ ณ วันสิ้นสุด'),col('LastMoveNo','เอกสารเคลื่อนไหวล่าสุด','identifier'),col('LastMoveDate','วันที่เคลื่อนไหว','date'),col('ChequeCount','จำนวนเช็ค','integer',true)];
const statuses={H:'เช็คในมือ',S:'ขายลดเช็ค',B:'เช็คฝาก',R:'เช็คคืน',C:'ยกเลิกเช็ค',P:'เช็คผ่าน'};
const invalid=m=>Object.assign(Error(m),{status:400,code:'REPORT_FILTER_INVALID'});
function filter(params,now){
 const f=invoiceFilters(params,now),text=k=>{const v=String(params[k]||'').trim();if(v.length>100)throw invalid('ตัวกรองยาวเกินกำหนด');return v;};
 return {...f,chequeNo:text('chequeNo'),bankCode:text('bankCode'),status:String(params.status||'OPEN').toUpperCase(),receiptType:String(params.receiptType||'ALL').toUpperCase()};
}
function inputs(f,businessDate,cap){
 const p={from:{type:db.sql.Date,value:f.from},to:{type:db.sql.Date,value:f.to},globalStartDate:{type:db.sql.Date,value:businessDate},cap:{type:db.sql.Int,value:cap+1}};
 for(const k of ['docFrom','docTo','custCode','empCode','chequeNo','bankCode','status','receiptType'])p[k]={type:db.sql.NVarChar(100),value:f[k]};return p;
}
async function receipts(params={},options={}){
 const query=options.queryFn||db.wfQuery,{businessDate}=await(options.readGlobalDataWindow||require('./global-data-window-store').readGlobalDataWindow)();
 const f=filter(params,options.now),cap=params.exportAll==='true'?50000:1000;
 if(!['ALL','DEBT','CASH'].includes(f.receiptType))throw invalid('ประเภทรับชำระไม่ถูกต้อง');
 const p=inputs(f,businessDate,cap);
 const all=(await query(`/* NATIVE_RECEIPT_HEADERS */ SELECT TOP (@cap) h.ARReceID,h.PostID,
 h.DocuNo ReceiptNo,CONVERT(varchar(10),h.DocuDate,120) ReceiptDate,h.DocuType,
 c.CustCode,c.CustName,e.EmpCode,h.ReceAmnt Amount,h.CashAmnt CashAmount,h.TransBookAmnt TransferAmount,
 h.CheqReceAmnt ChequeAmount,h.CardAmnt CardAmount,h.TaxAmnt WithholdingAmount,h.DiscPayAmnt DiscountAmount,
 h.AdvnAmnt AdvanceAmount,h.OthrPayAmnt OtherAmount,h.PostGL PostedGL
 FROM dbo.ARReceHD h LEFT JOIN dbo.EMCust c ON c.CustID=h.CustID LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
 WHERE h.DocuType IN(206,108) AND ISNULL(h.DocuStatus,'N')<>'C'
 AND h.DocuDate>=@from AND h.DocuDate<DATEADD(day,1,@to) AND h.DocuDate>=@globalStartDate
 AND (@receiptType='ALL' OR (@receiptType='DEBT' AND h.DocuType=206) OR (@receiptType='CASH' AND h.DocuType=108))
 AND (@docFrom='' OR h.DocuNo>=@docFrom) AND (@docTo='' OR h.DocuNo<=@docTo)
 AND (@custCode='' OR c.CustCode=@custCode) AND (@empCode='' OR e.EmpCode=@empCode)
 ORDER BY h.DocuDate,h.ARReceID`,p)).recordset||[];
 const truncated=all.length>cap,rows=all.slice(0,cap).map(r=>({...r,ReceiptKind:Number(r.DocuType)===206?'รับชำระหนี้ (206)':'รับจากขายสด (108)',RefDocNo:'',ChequeRefs:''}));
 // Preserve one financial row per receipt. Invoice allocations and cheque
 // applications are independent many-to-many traces, never joined to headers.
 for(let start=0;start<rows.length;start+=200){
  const batch=rows.slice(start,start+200),pp={globalStartDate:p.globalStartDate};
  const ids=batch.map((r,i)=>{pp['r'+i]={type:db.sql.Int,value:Number(r.ARReceID)};return '@r'+i;});
  const refs=(await query(`/* NATIVE_RECEIPT_REFERENCES */ SELECT d.ARReceID,
   CASE WHEN s.DocuDate>=@globalStartDate THEN s.DocuNo ELSE NULL END RefNo,
   CASE WHEN s.DocuDate>=@globalStartDate THEN CONVERT(varchar(10),s.DocuDate,120) ELSE NULL END RefDate,
   CASE WHEN s.SOInvID IS NULL THEN 'MISSING_SOURCE' WHEN s.DocuDate<@globalStartDate THEN 'BEFORE_START' ELSE 'VISIBLE' END RefState
   FROM dbo.ARReceDT d LEFT JOIN dbo.SOInvHD s ON s.SOInvID=d.SOInvID WHERE d.ARReceID IN(${ids.join(',')})`,pp)).recordset||[];
  const cp={globalStartDate:p.globalStartDate},posts=batch.filter(r=>Number(r.PostID)>0).map((r,i)=>{cp['p'+i]={type:db.sql.Int,value:Number(r.PostID)};return '@p'+i;});
  const cheques=posts.length?(await query(`/* NATIVE_RECEIPT_CHEQUES */ SELECT l.FromID,c.CheqID,
   CASE WHEN c.DocuDate>=@globalStartDate THEN c.CheqNo ELSE NULL END ChequeNo,
   CASE WHEN c.DocuDate<@globalStartDate THEN 'BEFORE_START' ELSE 'VISIBLE' END RefState
   FROM dbo.CQCheqList l JOIN dbo.CQCheq c ON c.CheqID=l.CheqID
   WHERE c.CheqType='1' AND c.CheqCard='1' AND c.DocuType='C' AND l.FromID IN(${posts.join(',')})`,cp)).recordset||[]:[];
  for(const r of batch){
   r.RefDocNo=[...new Set(refs.filter(x=>Number(x.ARReceID)===Number(r.ARReceID)).map(x=>x.RefNo?`${x.RefNo} (${x.RefDate})`:x.RefState==='BEFORE_START'?'อ้างอิงก่อนวันเริ่มข้อมูล':'ไม่พบต้นทาง'))].join(', ');
   r.ChequeRefs=[...new Map(cheques.filter(x=>Number(x.FromID)===Number(r.PostID)).map(x=>[x.CheqID,x.ChequeNo||'เช็คก่อนวันเริ่มข้อมูล'])).values()].join(', ');
   delete r.ARReceID;delete r.PostID;
  }
 }
 return {columns:receiptColumns,rows,meta:{filters:{from:f.from,to:f.to,docFrom:f.docFrom,docTo:f.docTo,custCode:f.custCode,empCode:f.empCode,receiptType:f.receiptType},dateBasis:'RECEIPT_DOCUMENT_DATE',isTruncated:truncated,isPartialScope:truncated,voucherLimit:cap,voucherCount:rows.length,notes:['หนึ่งแถวต่อเอกสารรับชำระ ไม่คูณยอดตามจำนวนบิลหรือเช็คอ้างอิง','รวมรับชำระหนี้ 206 และรับจากขายสด 108; ไม่รวม 106 คืนรีเบท','ยอดรับชำระและช่องทางชำระแสดงตามเอกสาร WinSpeed ไม่ใช่ยอดขายหรือยอดคงเหลือลูกหนี้']}};
}
async function cheques(params={},options={}){
 const query=options.queryFn||db.wfQuery,{businessDate}=await(options.readGlobalDataWindow||require('./global-data-window-store').readGlobalDataWindow)();
 const f=filter(params,options.now),cap=params.exportAll==='true'?50000:1000;
 if(!['ALL','OPEN',...Object.keys(statuses)].includes(f.status))throw invalid('สถานะเช็คไม่ถูกต้อง');
 const p=inputs(f,businessDate,cap);
 const data=(await query(`/* NATIVE_CHEQUE_AS_OF */ WITH moves AS (
 SELECT d.CheqID,h.CheqStat,h.DocuNo,h.DocuDate,
 ROW_NUMBER() OVER(PARTITION BY d.CheqID ORDER BY h.DocuDate DESC,h.CheqMoveID DESC,d.ListNo DESC) rn
 FROM dbo.CQCheqMoveDT d JOIN dbo.CQCheqMoveHD h ON h.CheqMoveID=d.CheqMoveID
 WHERE h.CheqType='1' AND d.DocuStatus='N' AND h.DocuDate<DATEADD(day,1,@to)),
 changes AS (SELECT d.CheqID,SUM(ISNULL(d.CheqRemaAmnt,0)) Replaced
 FROM dbo.CQCheqChangeDT d JOIN dbo.CQCheqChangeHD h ON h.CheqChangeID=d.CheqChangeID
 WHERE h.DocuDate<DATEADD(day,1,@to) GROUP BY d.CheqID),
 snapshot AS (SELECT c.CheqID,c.DocuDate,c.DocuNo,c.CheqNo,c.CheqDate,cu.CustCode,
 COALESCE(c.CustVendorName,cu.CustName) CustName,b.BankCode,b.BankName,c.CheqAmnt ChequeAmount,
 c.CheqAmnt-ISNULL(ch.Replaced,0) UnreplacedAmount,COALESCE(m.CheqStat,'H') StatusCode,
 CASE WHEN m.DocuDate>=@globalStartDate THEN m.DocuNo ELSE NULL END LastMoveNo,
 CASE WHEN m.DocuDate>=@globalStartDate THEN CONVERT(varchar(10),m.DocuDate,120) ELSE NULL END LastMoveDate
 FROM dbo.CQCheq c LEFT JOIN dbo.EMCust cu ON cu.CustID=c.CustID LEFT JOIN dbo.EMBank b ON b.BankID=c.BankID
 LEFT JOIN moves m ON m.CheqID=c.CheqID AND m.rn=1 LEFT JOIN changes ch ON ch.CheqID=c.CheqID
 WHERE c.CheqType='1' AND c.CheqCard='1' AND c.DocuType='C' AND c.DocuDate<DATEADD(day,1,@to)
 AND (@custCode='' OR cu.CustCode=@custCode) AND (@bankCode='' OR b.BankCode=@bankCode)
 AND (@chequeNo='' OR c.CheqNo=@chequeNo) AND (@docFrom='' OR c.DocuNo>=@docFrom) AND (@docTo='' OR c.DocuNo<=@docTo)),
 selected AS (SELECT * FROM snapshot WHERE (@status='ALL' OR (@status='OPEN' AND StatusCode NOT IN('P','C')) OR StatusCode=@status)),
 detail AS (SELECT TOP (@cap) 'DETAIL' RowKind,DocuNo ReceiptNo,CONVERT(varchar(10),DocuDate,120) ReceiptDate,
 CheqNo ChequeNo,CONVERT(varchar(10),CheqDate,120) ChequeDate,CustCode,CustName,BankCode,BankName,
 ChequeAmount,UnreplacedAmount,StatusCode,LastMoveNo,LastMoveDate,1 ChequeCount,CASE WHEN UnreplacedAmount<0 OR UnreplacedAmount IS NULL THEN 1 ELSE 0 END InvalidAmountCount
 FROM selected WHERE DocuDate>=@from AND DocuDate>=@globalStartDate ORDER BY DocuDate,CheqID)
 SELECT * FROM detail UNION ALL
 SELECT 'OPENING',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,SUM(ChequeAmount),SUM(UnreplacedAmount),StatusCode,NULL,NULL,COUNT(*),SUM(CASE WHEN UnreplacedAmount<0 OR UnreplacedAmount IS NULL THEN 1 ELSE 0 END)
 FROM selected WHERE DocuDate<@from OR DocuDate<@globalStartDate GROUP BY StatusCode`,p)).recordset||[];
 const details=data.filter(r=>r.RowKind==='DETAIL').sort((a,b)=>String(a.ReceiptDate||'').localeCompare(String(b.ReceiptDate||''))||String(a.ReceiptNo||'').localeCompare(String(b.ReceiptNo||''))||String(a.ChequeNo||'').localeCompare(String(b.ChequeNo||''))),truncated=details.length>cap;
 let unknown=0,invalidAmount=0;
 const rows=[...data.filter(r=>r.RowKind==='OPENING'),...details.slice(0,cap)].map(r=>{
  const code=String(r.StatusCode||'').trim();if(!statuses[code])unknown+=Number(r.ChequeCount||1);
  const invalid=Number(r.InvalidAmountCount||0)>0||Number(r.UnreplacedAmount)<0;
  if(invalid)invalidAmount+=Number(r.InvalidAmountCount||r.ChequeCount||1);
  return {...r,RowKind:r.RowKind==='OPENING'?'ยอดยกมา (ไม่แสดงเลขเอกสารเดิม)':'รายการในช่วง',Status:statuses[code]||`ไม่รู้จักสถานะ (${code})`,OpenAmount:!statuses[code]||invalid?null:['P','C'].includes(code)?0:Number(r.UnreplacedAmount||0)};
 });
 return {columns:chequeColumns.map(c=>(unknown||invalidAmount)&&c.key==='OpenAmount'?(({aggregation,...rest})=>rest)(c):c),rows,meta:{filters:{from:f.from,to:f.to,custCode:f.custCode,bankCode:f.bankCode,chequeNo:f.chequeNo,status:f.status,docFrom:f.docFrom,docTo:f.docTo},dateBasis:'CHEQUE_AS_OF',isTruncated:truncated,isPartialScope:truncated||unknown>0||invalidAmount>0,voucherLimit:cap,voucherCount:Math.min(details.length,cap),unknownStatusCount:unknown,invalidAmountCount:invalidAmount,notes:[`สถานะและยอดหลังเปลี่ยนเช็ค ณ วันที่ ${f.to} จากประวัติ WinSpeed ไม่ใช้สถานะปัจจุบันย้อนทับอดีต`,'เช็คก่อนวันเริ่มช่วงหรือก่อนวันเริ่มข้อมูลรวมเป็นยอดยกมาโดยไม่เปิดเลขเอกสารเดิม','ยอดหลังเปลี่ยนเช็คหักจำนวนที่เปลี่ยนถึงวันสิ้นสุด; ยอดยังไม่ผ่านไม่รวมเช็คผ่านหรือยกเลิก',...(invalidAmount?['พบยอดเช็คหลังเปลี่ยนที่ติดลบหรือไม่สมบูรณ์ จึงเว้นยอดคงค้างและไม่สรุปรวมช่องนั้น']:[]),...(unknown?['พบรหัสสถานะที่ยังไม่รู้จัก จึงเว้นยอดคงค้างและไม่สรุปรวมช่องนั้น']:[])]}};
}
module.exports={receipts,cheques,receiptColumns,chequeColumns,statuses,filter};
