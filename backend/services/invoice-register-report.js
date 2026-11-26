'use strict';
// Read the posted invoice once per (SOInvID,ListNo). A trace is a set of references,
// never another financial row. 202 and 106 are deliberately excluded from sales.
const {sql,wfQuery}=require('../db');
const fail=(message)=>Object.assign(Error(message),{status:400,code:'REPORT_FILTER_INVALID'});
function day(v,fallback){const s=String(v||fallback);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw fail('วันที่ไม่ถูกต้อง');return s;}
function filters(p={},now=new Date()){
 const today=require('./so-pickup-policy').getBangkokDateString(now);
 const from=day(p.from,today.slice(0,8)+'01'),to=day(p.to,today);
 if(from>to)throw fail('วันเริ่มต้องไม่เกินวันสิ้นสุด');
 const book=String(p.book||'').toUpperCase();if(!['','J','N'].includes(book))throw fail('เลือกเล่ม J หรือ N');
 const text=k=>{const s=String(p[k]||'').trim();if(s.length>100)throw fail('ตัวกรองยาวเกินกำหนด');return s;};
 return {from,to,book,docFrom:text('docFrom'),docTo:text('docTo'),custCode:text('custCode'),plate:text('plate'),goodCode:text('goodCode'),empCode:text('empCode')};
}
const money=v=>{const n=Math.round(Number(v||0)*100);if(!Number.isSafeInteger(n))throw fail('มูลค่าอยู่นอกช่วงที่รายงานรองรับ');return n;};
function allocate(total,weights){
 const target=money(total),sum=weights.reduce((s,x)=>s+Math.abs(Number(x)||0),0);
 if(!weights.length)return [];
 let used=0;return weights.map((w,i)=>{const n=i===weights.length-1?target-used:sum?Math.round(target*Math.abs(Number(w)||0)/sum):0;used+=n;return n/100;});
}
function normalize(rows){
 const documents=new Map();
 for(const row of rows){const key=String(row.SOInvID);if(!documents.has(key))documents.set(key,[]);documents.get(key).push(row);}
 const result=[];
 for(const lines of documents.values()){
  lines.sort((a,b)=>Number(a.ListNo)-Number(b.ListNo));const h=lines[0],type=Number(h.DocuType);
  if(![107,108,109,110].includes(type))throw Error('UNSUPPORTED_SALES_DOCUMENT_TYPE');
  const sign=type===109?-1:1;
  if(Number(h.Sign)!==sign)throw Object.assign(Error('ทิศทางเอกสารขายไม่ตรงชนิดเอกสาร กรุณาตรวจต้นทาง'),{status:409,code:'SALES_DOCUMENT_SIGN_MISMATCH'});
  const weight=lines.map(l=>l.LineGross),net=allocate((money(h.NetAmnt)-money(h.VATAmnt))/100,weight),vat=allocate(h.VATAmnt,weight),discount=allocate(h.BillDiscAmnt,weight);
  lines.forEach((l,i)=>result.push({...l,DocBook:String(l.DocuNo||'').split(/\d/)[0],
   DocumentKind:{107:'ใบส่งของ',108:'ขายเงินสด',109:l.ReturnType==='G'?'รับคืนสินค้า / ลดหนี้':'ลดหนี้',110:'เพิ่มหนี้'}[type],
   QtyTon:(type===110||type===109&&l.ReturnType!=='G'?0:Number(l.QtyTon||0)*sign),
   Amount:net[i]*sign,VATAmount:vat[i]*sign,InvoiceAmount:(money(net[i])+money(vat[i]))/100*sign,BillDiscount:discount[i]*sign,
   SaleAmount:type===107||type===108?net[i]:0,CreditAmount:type===109&&l.ReturnType!=='G'?net[i]:0,ReturnAmount:type===109&&l.ReturnType==='G'?net[i]:0,DebitAmount:type===110?net[i]:0,
   DetailState:l.ListNo==null?'MISSING_DETAIL':'OK'}));
 }
 return result;
}
const col=(key,label,type='text',sum=false)=>({key,label,type,...(sum?{aggregation:'sum',precision:type==='quantity'?4:2}:{})});
const common=[col('CustCode','รหัสลูกค้า','identifier'),col('CustName','ลูกค้า'),col('DocuNo','เลขที่เอกสาร','identifier'),col('DocuDate','วันที่เอกสาร','date'),col('GoodCode','รหัสสินค้า','identifier'),col('GoodName','สินค้า'),col('QtyTon','จำนวนสุทธิ (ตัน)','quantity',true)];
const dailyColumns=[col('DocBook','ชุดเอกสาร'),...common,col('PricePerTon','ราคาต่อตัน','money'),col('BillDiscount','ส่วนลดท้ายใบจัดสรร','money',true),col('Amount','ยอดสุทธิไม่รวม VAT','money',true),col('VATAmount','VAT','money',true),col('InvoiceAmount','ยอดรวม VAT','money',true),col('CostAmount','ต้นทุนตัดสต็อก','money'),col('GrossProfit','กำไรหลังส่วนลด','money'),col('CostState','สถานะต้นทุน'),col('BookingRefs','ใบจอง / วันที่'),col('SaleRefs','ใบสั่งขาย / วันที่'),col('DebtRefs','ใบตั้งหนี้ / วันที่'),col('TicketRefs','ตั๋วปุ๋ย'),col('SlipRefs','ใบขนย้าย / วันที่'),col('TruckPlates','ทะเบียนรถ'),col('TraceState','ผลจับคู่'),col('DetailState','รายการสินค้า')];
const netColumns=[...common,col('DocumentKind','ประเภท'),col('SaleAmount','ยอดขายหลังส่วนลด','money',true),col('CreditAmount','ลดหนี้ไม่คืนสินค้า','money',true),col('ReturnAmount','รับคืนสินค้า','money',true),col('DebitAmount','เพิ่มหนี้','money',true),col('Amount','ยอดขายสุทธิไม่รวม VAT','money',true),col('VATAmount','VAT สุทธิ','money',true),col('RefNo','เอกสารอ้างอิง','identifier'),col('DetailState','รายการสินค้า')];
async function run(kind,params={},options={}){
 const organization=require('./report-organization-scope').predicate(options.scopes,{empCol:'h.EmpID'},'invoiceOrg');
 const q=options.queryFn||wfQuery,{businessDate}=await(options.readGlobalDataWindow||require('./global-data-window-store').readGlobalDataWindow)();
 const f=filters(params,options.now),daily=kind==='daily-invoice';
 const cap=params.exportAll==='true'?50000:1000;
 if(!daily&&f.book)throw fail('รายงานสุทธิไม่กรองเล่ม J/N เพราะเอกสารปรับปรุงใช้เล่มต่างกัน');
 const inputs={...organization.inputs,from:{type:sql.Date,value:f.from},to:{type:sql.Date,value:f.to},globalStartDate:{type:sql.Date,value:businessDate}};
 inputs.maxDocumentsPlusOne={type:sql.Int,value:cap+1};
 for(const k of ['book','docFrom','docTo','custCode','empCode'])inputs[k]={type:sql.NVarChar(100),value:f[k]};
 const data=(await q(`WITH headers AS (
 SELECT TOP (@maxDocumentsPlusOne) h.* FROM dbo.SOInvHD h
 LEFT JOIN dbo.EMCust c ON c.CustID=h.CustID LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
 WHERE (${organization.sql}) AND h.DocuType IN (${daily?'107':kind==='credit-returns'?'109':'107,108,109,110'}) AND ISNULL(h.DocuStatus,'N')<>'C' AND ISNULL(h.Revflag,'N')<>'Y'
 AND h.DocuDate>=@from AND h.DocuDate<DATEADD(day,1,@to) AND h.DocuDate>=@globalStartDate
 AND (@book='' OR LEFT(h.DocuNo,1)=@book) AND (@docFrom='' OR h.DocuNo>=@docFrom) AND (@docTo='' OR h.DocuNo<=@docTo)
 AND (@custCode='' OR c.CustCode=@custCode) AND (@empCode='' OR e.EmpCode=@empCode)
 ORDER BY h.DocuDate,h.SOInvID)
 SELECT h.SOInvID,h.DocuType,h.Sign,h.ReturnType,h.RefNo,h.NetAmnt,h.VATAmnt,h.BillDiscAmnt,h.DocuNo,
 CONVERT(varchar(10),h.DocuDate,120) DocuDate,c.CustCode,COALESCE(c.CustName,h.CustName) CustName,
 h.EmpID,e.EmpCode,e.EmpName SalesName,
 d.ListNo,g.GoodCode,d.GoodName,d.GoodQty2 QtyTon,d.GoodPrice2 PricePerTon,d.GoodAmnt LineGross
 FROM headers h LEFT JOIN dbo.SOInvDT d ON d.SOInvID=h.SOInvID
 LEFT JOIN dbo.EMCust c ON c.CustID=h.CustID LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
 LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
 ORDER BY h.DocuDate,h.SOInvID,d.ListNo`,inputs)).recordset||[];
 const ids=[...new Set(data.map(r=>Number(r.SOInvID)))],truncated=ids.length>cap;
 const kept=truncated?new Set(ids.slice(0,cap)):new Set(ids);
 let rows=normalize(data.filter(r=>kept.has(Number(r.SOInvID))));
 if(daily&&rows.length){
  // The native wf_report Daily Invoice uses ICStockDetail -> ICCostDetail.PayAmnt,
  // not SOInvDT.GoodCost. Read that same basis separately, preserving the invoice
  // grain. Missing or incomplete costing must not turn into fictitious profit.
  const costs=new Map();
  for(let i=0;i<kept.size;i+=200){
   const batch=[...kept].slice(i,i+200),parameters=Object.fromEntries(batch.map((v,j)=>['i'+j,{type:sql.Int,value:v}]));
   const costRows=(await q(`SELECT s.DocuID SOInvID,s.ListNo,
    COUNT(DISTINCT s.StockDetailID) StockLineCount,
    COUNT(DISTINCT CASE WHEN s.CostFlag='Y' AND c.StockDetailID IS NOT NULL THEN s.StockDetailID END) CostedStockCount,
    SUM(CASE WHEN s.CostFlag='Y' THEN c.PayAmnt ELSE 0 END) CostAmount
    FROM dbo.ICStockDetail s LEFT JOIN dbo.ICCostDetail c ON c.StockDetailID=s.StockDetailID
    WHERE s.DocuID IN (${batch.map((_,j)=>'@i'+j).join(',')}) AND s.DocuType=107 AND s.StockFlag=-1 AND s.GoodID IS NOT NULL AND s.PackGoodID IS NULL
    GROUP BY s.DocuID,s.ListNo`,parameters)).recordset||[];
   for(const c of costRows)costs.set(`${c.SOInvID}:${c.ListNo}`,c);
  }
  rows=rows.map(r=>{const c=costs.get(`${r.SOInvID}:${r.ListNo}`),complete=c&&Number(c.StockLineCount)>0&&Number(c.StockLineCount)===Number(c.CostedStockCount)&&c.CostAmount!=null;
   return {...r,CostAmount:complete?money(c.CostAmount)/100:null,GrossProfit:complete?(money(r.Amount)-money(c.CostAmount))/100:null,CostState:complete?'COSTED':c?'PARTIAL_COST':'NOT_COSTED'};
  });
  const refs=[];
  for(let i=0;i<ids.length&&i<cap;i+=200){
   const batch=ids.slice(i,Math.min(i+200,cap));
   const parameters=Object.fromEntries(batch.map((v,j)=>['i'+j,{type:sql.Int,value:v}]));
   parameters.globalStartDate=inputs.globalStartDate;
   const rr=(await q(`SELECT rd.SOInvID,rd.SOListNo,rd.CouponID,rd.CouponNo,
     rh.RedemtionID,rh.DocuNo SlipNo,CONVERT(varchar(10),rh.DocuDate,120) SlipDate,rh.CarLicense
     FROM dbo.WFRedemtionDT rd JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID=rd.RedemtionID
     WHERE rd.SOInvID IN (${batch.map((_,j)=>'@i'+j).join(',')}) AND rh.DocuDate>=@globalStartDate AND ISNULL(rh.DocuStatus,'N')<>'C'`,parameters)).recordset||[];
   refs.push(...rr);
  }
  const coupons=new Map(),couponIds=[...new Set(refs.map(r=>Number(r.CouponID)).filter(v=>Number.isSafeInteger(v)&&v>0))];
  for(let i=0;i<couponIds.length;i+=200){
   const batch=couponIds.slice(i,i+200),parameters=Object.fromEntries(batch.map((v,j)=>['c'+j,{type:sql.Int,value:v}]));parameters.globalStartDate=inputs.globalStartDate;
   for(const c of (await q(`SELECT cp.CouponID,cp.RefListno,
     CASE WHEN h.DocuDate>=@globalStartDate THEN h.DocuNo END SaleNo,
     CASE WHEN h.DocuDate>=@globalStartDate THEN CONVERT(varchar(10),h.DocuDate,120) END SaleDate,
     CASE WHEN b.DocuDate>=@globalStartDate THEN b.DocuNo END BookingNo,
     CASE WHEN b.DocuDate>=@globalStartDate THEN CONVERT(varchar(10),b.DocuDate,120) END BookingDate,
     CASE WHEN ar.DocuDate>=@globalStartDate THEN ar.DocuNo END DebtNo,
     CASE WHEN ar.DocuDate>=@globalStartDate THEN CONVERT(varchar(10),ar.DocuDate,120) END DebtDate
     FROM dbo.WFCoupon cp LEFT JOIN dbo.SOHD h ON h.SOID=cp.DocuID AND h.DocuType=104
     LEFT JOIN dbo.SODT d ON d.SOID=h.SOID AND d.ListNo=cp.RefListno
     LEFT JOIN dbo.SOHD b ON b.SOID=d.RefSOID AND b.DocuType=103
     LEFT JOIN dbo.SOInvHD ar ON ar.DocuType=202 AND ar.DocuNo=h.DocuNo AND ar.CustID=h.CustID
     WHERE cp.CouponID IN (${batch.map((_,j)=>'@c'+j).join(',')})`,parameters)).recordset||[]){
     const key=Number(c.CouponID);if(!coupons.has(key))coupons.set(key,[]);coupons.get(key).push(c);
   }
  }
  const refsByLine=new Map();
  for(const ref of refs){const key=`${ref.SOInvID}:${ref.SOListNo}`;if(!refsByLine.has(key))refsByLine.set(key,[]);refsByLine.get(key).push(ref);}
  const unique=a=>[...new Set(a.filter(Boolean))].join(', '),dated=(r,n,d)=>r[n]?`${r[n]} (${r[d]||''})`:null;
  rows=rows.map(r=>{
   const lines=refsByLine.get(`${r.SOInvID}:${r.ListNo}`)||[];
   const source=lines.flatMap(x=>coupons.get(Number(x.CouponID))||[]),ambiguous=lines.some(x=>(coupons.get(Number(x.CouponID))||[]).length>1);
   return {...r,BookingRefs:unique(source.map(x=>dated(x,'BookingNo','BookingDate'))),SaleRefs:unique(source.map(x=>dated(x,'SaleNo','SaleDate'))),DebtRefs:unique(source.map(x=>dated(x,'DebtNo','DebtDate'))),
    TicketRefs:unique(lines.map(x=>x.CouponNo)),SlipRefs:unique(lines.map(x=>dated(x,'SlipNo','SlipDate'))),TruckPlates:unique(lines.map(x=>x.CarLicense)),
    TraceState:ambiguous?'AMBIGUOUS':lines.length?'MATCHED':'UNLINKED'};
  });
 }
 rows=rows.filter(r=>(!f.goodCode||r.GoodCode===f.goodCode)&&(!f.plate||String(r.TruckPlates||'').split(', ').includes(f.plate)));
 if(!daily&&f.plate)throw fail('ทะเบียนรถใช้กับ Daily Invoice ซึ่งมีหลักฐานใบขน');
 rows.sort((a,b)=>daily?String(a.DocBook).localeCompare(String(b.DocBook))||String(a.DocuNo).localeCompare(String(b.DocuNo))||Number(a.ListNo)-Number(b.ListNo):String(a.CustCode).localeCompare(String(b.CustCode))||String(a.GoodCode).localeCompare(String(b.GoodCode))||a.DocuDate.localeCompare(b.DocuDate)||Number(a.ListNo)-Number(b.ListNo));
 const costPendingCount=daily?rows.filter(r=>r.CostState!=='COSTED').length:0;
 return {rows,...(daily?{columns:dailyColumns.map(c=>!costPendingCount&&['CostAmount','GrossProfit'].includes(c.key)?{...c,aggregation:'sum',precision:2}:c)}:{}),meta:{isTruncated:truncated,isPartialScope:truncated,voucherLimit:cap,voucherCount:kept.size,filters:f,groupBy:daily?['DocBook','DocuNo']:['CustCode','GoodCode'],dateBasis:'DOCUMENT_DATE',amountBasis:'EXCLUDING_VAT',...(daily?{costBasis:'POSTED_STOCK_PAY_AMOUNT',costPendingCount}:{}),missingDetailCount:rows.filter(r=>r.DetailState!=='OK').length}};
}
module.exports={run,filters,allocate,normalize,dailyColumns,netColumns};
