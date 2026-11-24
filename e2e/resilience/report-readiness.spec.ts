import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
const {dailyColumns:columns}=createRequire(__filename)('../../backend/services/invoice-register-report.js');
const template={templateId:1,templateCode:'QA',templateName:'QA',orientation:'landscape',paperSize:'A3',showPageNumber:true,showSignatures:false,version:1,header:{headerId:1,headerCode:'QA',headerName:'QA',companyNameTh:'บริษัททดสอบ',companyNameEn:'QA',addressTh:'QA',taxId:'QA',version:1}};
const stamp={code:'FM-QA-001',revision:'00',effectiveDate:'2026-11-01'};
const baseLine={CustCode:'0001',CustName:'ลูกค้าทดสอบ',GoodCode:'0002',GoodName:'ปุ๋ยทดสอบ',QtyTon:1,DocuDate:'2026-11-01',PricePerTon:100,BillDiscount:10,VATAmount:0,BookingRefs:'QA-103 (2026-11-01)',SaleRefs:'QA-104 (2026-11-01)',DebtRefs:'QA-202 (2026-11-01)',TicketRefs:'C-QA, D-QA',SlipRefs:'QA-116-1 (2026-11-01), QA-116-2 (2026-11-01)',TruckPlates:'QA-TRUCK-1, QA-TRUCK-2',TraceState:'MATCHED',DetailState:'OK'};
const data={type:'daily-invoice',title:'Daily Invoice',columns,rows:[{...baseLine,DocBook:'J',DocuNo:'J-QA',Amount:90,InvoiceAmount:90,CostAmount:60,GrossProfit:30,CostState:'COSTED'},{...baseLine,DocBook:'N',DocuNo:'N-QA',Amount:70,InvoiceAmount:70,CostAmount:60,GrossProfit:10,CostState:'COSTED'}],isoStamp:stamp,meta:{groupBy:['DocBook','DocuNo'],dateBasis:'DOCUMENT_DATE',filters:{from:'2026-11-01',to:'2026-11-30'}}};
test('a driver-shaped SQL report reaches the screen with typed columns and totals',async({page})=>{
 const reports=createRequire(__filename)('../../backend/routes/reports.js').__testing;
 const key='qa-driver-columns',rows=[{Amount:125.5}];
 Object.defineProperty(rows,'columns',{value:{Amount:{index:0,name:'Amount',type:'Decimal'}}});
 reports.REPORTS[key]={title:'QA SQL report',columns:[{key:'Amount',label:'QA amount',type:'money',aggregation:'sum'}],run:async()=>rows};
 let payload:any;
 try{payload=JSON.parse(JSON.stringify(await reports.runReport(key)));}finally{delete reports.REPORTS[key];}
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(path.endsWith('/reports/types'))return route.fulfill({json:[{key,title:'QA SQL report',category:'finance',available:true}]});
  if(path.endsWith('/template'))return route.fulfill({json:{reportKey:key,template}});
  if(path.endsWith('/reports/'+key))return route.fulfill({json:payload});
  return route.fulfill({json:{}});
 });
 await page.goto('/tests/report-readiness.html?page=reports');
 await expect(page.getByRole('columnheader',{name:'QA amount'})).toBeVisible();
 await expect(page.getByRole('table')).toContainText('125.50');
 await expect(page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true})).toBeEnabled();
 expect(errors).toEqual([]);
});
test('Budget Plan writes region caps and estimates separately, then submits the saved version',async({page})=>{
 let saved:any,version=2;const pending:any={PlanId:1,PreparedBy:1,PreparedActorId:1,AssignedReviewerId:2,AssignedApproverId:3,PeriodYear:2641,Status:'DRAFT',EditVersion:2,lines:[],allocations:[]};
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url()),method=route.request().method();
  if(method==='OPTIONS')return route.fulfill({status:204});
  if(url.pathname.endsWith('/budget/approvers'))return route.fulfill({json:{data:[{Id:2,DisplayName:'QA Manager',CanReview:true},{Id:3,DisplayName:'QA CLevel',CanApprove:true}]}});
  if(url.pathname.endsWith('/budget/plans')&&method==='GET')return route.fulfill({json:{context:{database:'QA_PRIMARY',userId:1,actions:['budget.plan.create','budget.plan.review','budget.plan.approve','settings.manage'],canReadAnnual:true},data:[]}});
  if(url.pathname.endsWith('/budget/plans')&&method==='POST'){saved=route.request().postDataJSON();Object.assign(pending,{Title:saved.title,Channel:saved.channel,document:saved.document,allocations:saved.allocations.map((a:any)=>({Region:a.region,Amount:Number(a.amount)})),lines:saved.lines.map((l:any)=>({ProjectKey:l.projectKey,Region:l.region,Amount:Number(l.amount)}))});return route.fulfill({json:pending});}
  if(url.pathname.endsWith('/submit')){const b=route.request().postDataJSON();expect(b.expectedVersion).toBe(version);pending.Status='PENDING';pending.EditVersion=++version;return route.fulfill({json:pending});}
  return route.fulfill({json:{}});
 });
 await page.goto('/tests/report-readiness.html');
 await page.getByLabel('เลือกปีงบประมาณ',{exact:true}).fill('2641');await page.getByRole('button',{name:'แผนใหม่',exact:true}).click();
 await page.getByRole('button',{name:'+ เพิ่มวงเงินภาค',exact:true}).click();await page.getByLabel('ภาควงเงิน 1',{exact:true}).fill('QA North');await page.getByLabel('วงเงิน 1',{exact:true}).fill('1000');
 await page.getByLabel('ผู้ตรวจสอบ (Manager)',{exact:true}).selectOption('2');await page.getByLabel('ผู้อนุมัติ (C_Level)',{exact:true}).selectOption('3');await page.getByRole('button',{name:'2. ข้อมูลโครงการ',exact:true}).click();await page.getByLabel('ชื่อโครงการ',{exact:true}).fill('QA project');await page.getByLabel('วงเงินโครงการ',{exact:true}).fill('500');await page.getByRole('button',{name:'4. ประมาณการค่าใช้จ่าย',exact:true}).click();await page.getByRole('button',{name:'+ เพิ่มรายการ',exact:true}).click();
 await page.getByLabel('region บรรทัด 1',{exact:true}).fill('QA North');await page.getByLabel('category บรรทัด 1',{exact:true}).fill('1.1');await page.getByLabel('itemName บรรทัด 1',{exact:true}).fill('QA bag');await page.getByLabel('quantity บรรทัด 1',{exact:true}).fill('10');await page.getByLabel('unitPrice บรรทัด 1',{exact:true}).fill('11');await expect(page.getByLabel('amount บรรทัด 1',{exact:true})).toHaveValue('110.00');
 await page.getByLabel('เหตุผลบันทึกงบประมาณ').fill('QA create');await page.getByRole('button',{name:'บันทึกร่าง',exact:true}).click();
 await expect.poll(()=>saved).toBeTruthy();expect(saved.allocations[0].amount).toBe('1000');expect(saved.lines[0].amount).toBe('110.00');
 await expect(page.getByLabel('เลือกปีงบประมาณ',{exact:true})).toHaveValue('2641');
 await page.getByLabel('เหตุผลการดำเนินการ').fill('QA submit');await page.getByRole('button',{name:'ยื่นตรวจสอบ',exact:true}).click();await expect(page.getByText(/รุ่น 3/)).toBeVisible();await expect(page.getByRole('button',{name:'ตรวจสอบและส่งอนุมัติ',exact:true})).toHaveCount(0);
 await page.screenshot({path:'test-results/report-readiness/budget-plan.png',fullPage:true});
});
test('a legacy CE plan opens with the correct BE year in the form and list filter',async({page})=>{
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(url.pathname.endsWith('/budget/approvers'))return route.fulfill({json:{data:[]}});
  if(url.pathname.endsWith('/budget/plans/1'))return route.fulfill({json:{PlanId:1,PreparedBy:1,PeriodYear:2026,Channel:'ทั่วไป',Title:'QA CE plan',Status:'DRAFT',EditVersion:1,allocations:[],lines:[]}});
  return route.fulfill({json:{context:{database:'QA_PRIMARY',userId:1,actions:['budget.plan.create','budget.plan.review','budget.plan.approve','settings.manage'],canReadAnnual:true},data:[{planId:1,periodYear:2026,title:'QA CE plan',channel:'ทั่วไป',status:'DRAFT'}]}});
 });
 await page.goto('/tests/report-readiness.html');await page.getByLabel('เลือกปีงบประมาณ',{exact:true}).fill('2569');await page.getByRole('button',{name:'เปิดแผน 1',exact:true}).click();await page.getByRole('button',{name:'แก้ไขแผน / โครงการ',exact:true}).click();await expect(page.getByLabel('ปีแผน',{exact:true})).toHaveValue('2569');await expect(page.getByLabel('เลือกปีงบประมาณ',{exact:true})).toHaveValue('2569');
});
test('assigned reviewer sees the reviewed state after a successful API response',async({page})=>{
 const plan={PlanId:1,PreparedBy:2,AssignedReviewerId:1,AssignedApproverId:3,PeriodYear:2569,Channel:'ทั่วไป',Title:'QA review',Status:'PENDING',EditVersion:1,ReviewedAt:null as string|null,allocations:[],lines:[]};
 let release!:()=>void;const loading=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(path.endsWith('/review')){plan.ReviewedAt='2026-11-23T10:00:00Z';plan.EditVersion++;return route.fulfill({json:plan});}
  if(path.endsWith('/plans/1')){await loading;return route.fulfill({json:plan});}
  if(path.endsWith('/approvers'))return route.fulfill({json:{data:[]}});
  return route.fulfill({json:{context:{database:'QA_PRIMARY',userId:1,actions:['budget.plan.create','budget.plan.review','budget.plan.approve','settings.manage'],canReadAnnual:true},data:[{planId:1,periodYear:2569,title:'QA review',channel:'ทั่วไป',status:'PENDING'}]}});
 });
 await page.goto('/tests/report-readiness.html');await page.getByRole('button',{name:'เปิดแผน 1',exact:true}).click();await expect(page.getByRole('button',{name:'เปิดแผน 1',exact:true})).toBeDisabled();release();await expect(page.getByLabel('เหตุผลการดำเนินการ')).toBeEnabled();await page.getByLabel('เหตุผลการดำเนินการ').fill('QA review');await page.getByRole('button',{name:'ตรวจสอบและส่งอนุมัติ',exact:true}).click();await expect(page.getByRole('button',{name:'ตรวจสอบและส่งอนุมัติ',exact:true})).toHaveCount(0);await expect(page.getByText(/รุ่น 2/)).toBeVisible();
});
test('Daily Invoice sends combined filters, groups J/N and prints the configured ISO on A3',async({page})=>{
 const queries:string[]=[];
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key:'daily-invoice',title:'Daily Invoice',category:'finance',available:true}]});
  if(url.pathname.endsWith('/template'))return route.fulfill({json:{reportKey:'daily-invoice',template}});
  if(url.pathname.endsWith('/reports/daily-invoice')){queries.push(url.search);return route.fulfill({json:data});}
  return route.fulfill({json:{}});
 });
 await page.goto('/tests/report-readiness.html?page=reports');await expect(page.getByTestId('report-group')).toHaveCount(2);
 await page.getByLabel('รหัสลูกค้า',{exact:true}).fill('0001');await page.getByLabel('ทะเบียนรถ',{exact:true}).fill('QA-TRUCK');await page.getByLabel('ชุดเอกสาร Invoice').selectOption('J');await page.getByTitle('รีเฟรชข้อมูล',{exact:true}).click();
 await expect.poll(()=>queries.at(-1)).toContain('custCode=0001');expect(queries.at(-1)).toContain('plate=QA-TRUCK');expect(queries.at(-1)).toContain('book=J');
 await page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true}).click();await expect(page.getByTestId('report-iso-stamp')).toContainText('FM-QA-001 Rev.00');
 expect(await page.locator('style').last().textContent()).toContain('size: A3 landscape');
 await expect(page.locator('.report-page')).toContainText('QA-116-2');await expect(page.locator('.report-page')).toContainText('QA-TRUCK-2');
 await page.emulateMedia({media:'print'});
 const sizes=await page.locator('.report-page table').evaluateAll(tables=>tables.map(t=>({scroll:t.scrollWidth,width:t.clientWidth,container:t.parentElement!.clientWidth})));
 expect(sizes.every(t=>t.scroll<=t.width+2&&t.width<=t.container+2)).toBe(true);
 await page.screenshot({path:'test-results/report-readiness/daily-invoice-print.png',fullPage:true});
});
test('Admin saves an ISO stamp together with publication and ordering',async({page})=>{
 let body:any;await page.route('**/api/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204});if(route.request().method()==='PUT'){body=route.request().postDataJSON();return route.fulfill({json:{ok:true}});}return route.fulfill({json:{config:{order:['daily-invoice'],visibility:{'daily-invoice':true}},reports:[{key:'daily-invoice',title:'Daily Invoice',category:'finance',available:true,enabled:true,orderIndex:0}]}});});
 await page.goto('/tests/report-readiness.html?page=catalog');await page.getByLabel('ISO code daily-invoice').fill('FM-QA-001');await page.getByLabel('ISO revision daily-invoice').fill('00');await page.getByLabel('ISO effective date daily-invoice').fill('01/11/2569');await page.getByLabel('ISO effective date daily-invoice').press('Tab');await page.getByRole('button',{name:'บันทึกการจัดเรียง & เปิด/ปิด',exact:true}).click();await expect.poll(()=>body).toBeTruthy();expect(body.isoStamps['daily-invoice']).toEqual(stamp);
 await page.screenshot({path:'test-results/report-readiness/report-catalog-iso.png',fullPage:true});
});
test('Budget approval prints its three workflow signatories without warehouse signature duplicates',async({page})=>{
 await page.goto('/tests/report-readiness.html?page=approval');const print=page.locator('.report-page');
 await expect(print.getByText('ผู้จัดทำ',{exact:true})).toHaveCount(1);await expect(print.getByText('ผู้ตรวจสอบ',{exact:true})).toHaveCount(1);await expect(print.getByText('ผู้อนุมัติ',{exact:true})).toHaveCount(1);await expect(print.getByText('พนักงานคลังสินค้า',{exact:true})).toHaveCount(0);await expect(print).toContainText('23:12');
 await page.screenshot({path:'test-results/report-readiness/budget-approval-print.png',fullPage:true});
});

test('long annual estimate keeps physical PDF pages, row numbers and ISO stamps aligned',async({page})=>{
 const regions=Array.from({length:9},(_,i)=>'ภาคทดสอบ '+(i+1));
 const annual={type:'budget-annual-estimate',title:'QA ประมาณการรายปี',columns:[{key:'ItemName',label:'รายการ',type:'text'},...regions.map((label,i)=>({key:'Region'+i,label,type:'money',aggregation:'sum'})),{key:'Amount',label:'รวม',type:'money',aggregation:'sum'}],rows:Array.from({length:80},(_,i)=>({ItemName:'QA-'+String(i+1).padStart(3,'0')+' กระสอบส่งเสริมการขาย',...Object.fromEntries(regions.map((_,j)=>['Region'+j,100])),Amount:900})),isoStamp:stamp,meta:{periodFrom:'2026-01-01',periodTo:'2026-12-31',basis:'APPROVED_PLANS_ONLY',budgetSummary:regions.map(region=>({region,allocatedAmount:10000,estimatedAmount:8000}))}};
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key:annual.type,title:annual.title,category:'finance',available:true}]});if(url.pathname.endsWith('/template'))return route.fulfill({json:{reportKey:annual.type,template}});if(url.pathname.endsWith('/reports/'+annual.type))return route.fulfill({json:annual});return route.fulfill({json:{}});});
 await page.goto('/tests/report-readiness.html?page=reports');await page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true}).click();await page.evaluate(()=>document.fonts.ready);await page.emulateMedia({media:'print'});
 await expect.poll(async()=>page.locator('.report-page').evaluateAll(pages=>pages.every(p=>p.getBoundingClientRect().height<=1064))).toBe(true);
 const pages=await page.locator('.report-page').count(),rows=page.locator('[data-report-rows] tbody > tr');await expect(rows).toHaveCount(80);
 for(let i=0;i<80;i++)await expect(rows.nth(i).locator('td').first()).toHaveText(String(i+1));
 await expect(page.getByTestId('report-iso-stamp')).toHaveCount(pages);
 const pdf=await page.pdf({path:'test-results/report-readiness/annual-long.pdf',preferCSSPageSize:true,printBackground:true});
 expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length).toBe(pages);
});

test('multipage Daily Invoice keeps transport references and ISO on physical pages',async({page})=>{
 const many={...data,rows:Array.from({length:14},(_,i)=>({...data.rows[0],DocBook:i<7?'J':'N',DocuNo:'QA-INVOICE-'+String(i+1).padStart(3,'0')}))};
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key:many.type,title:many.title,category:'finance',available:true}]});if(url.pathname.endsWith('/template'))return route.fulfill({json:{reportKey:many.type,template}});if(url.pathname.endsWith('/reports/'+many.type))return route.fulfill({json:many});return route.fulfill({json:{}});});
 await page.goto('/tests/report-readiness.html?page=reports');await page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true}).click();await page.evaluate(()=>document.fonts.ready);await page.emulateMedia({media:'print'});
 await expect.poll(async()=>page.locator('.report-page').evaluateAll(pages=>pages.every(p=>p.getBoundingClientRect().height<=1064))).toBe(true);
 const pages=await page.locator('.report-page').count();expect(pages).toBeGreaterThan(1);await expect(page.getByTestId('report-iso-stamp')).toHaveCount(pages);
 const print=page.locator('.report-print-area');for(let i=1;i<=14;i++)await expect(print).toContainText('QA-INVOICE-'+String(i).padStart(3,'0'));
 await expect(print).toContainText('QA-116-2');await expect(print).toContainText('QA-TRUCK-2');
 const pdf=await page.pdf({path:'test-results/report-readiness/daily-multipage.pdf',preferCSSPageSize:true,printBackground:true});expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length).toBe(pages);
});

for(const key of ['ar-receipt-history','cq-cheque-register','sales-target-comparison'])test(key+' filters and native context survive screen and print',async({page})=>{
 const finance=createRequire(__filename)('../../backend/services/native-finance-reports.js');
 const targets=createRequire(__filename)('../../backend/services/sales-target-report.js');
 const note=key==='cq-cheque-register'?'สถานะ ณ วันที่ 2026-10-31 จากประวัติ WinSpeed':key==='ar-receipt-history'?'หนึ่งแถวต่อเอกสารรับชำระ':'ไม่มีเป้าหรือเป้าซ้ำจะแสดงค่าว่าง';
 const columns=key==='cq-cheque-register'?finance.chequeColumns:key==='ar-receipt-history'?finance.receiptColumns:targets.columns;
 const row=key==='cq-cheque-register'?{RowKind:'ยอดยกมา (ไม่แสดงเลขเอกสารเดิม)',ChequeAmount:100,UnreplacedAmount:80,OpenAmount:80,Status:'เช็คฝาก',ChequeCount:1}:key==='ar-receipt-history'?{ReceiptNo:'RC-QA',CustCode:'0001',Amount:123.45}:{EmpCode:'0001',SalesName:'QA',ActualTon:1,ActualAmt:100,TargetAmt:null,AchievedPct:null,TargetState:'ยังไม่กำหนดงวดเป้า'};
 let request:URL|undefined;const payload={type:key,title:'QA '+key,columns,rows:[row],isoStamp:stamp,meta:{notes:[note]}};
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key,title:payload.title,category:'finance',available:true}]});
  if(url.pathname.endsWith('/template'))return route.fulfill({json:{reportKey:key,template}});
  if(url.pathname.endsWith('/reports/'+key)){request=url;return route.fulfill({json:payload});}
  return route.fulfill({json:{}});
 });
 await page.goto('/tests/report-readiness.html?page=reports');await expect(page.getByText(note,{exact:true})).toBeVisible();
 if(key==='cq-cheque-register'){await page.getByLabel('เลขที่เช็ค',{exact:true}).fill('0007');await page.getByLabel('รหัสธนาคาร',{exact:true}).fill('001');await page.getByLabel('สถานะเช็ค ณ วันสิ้นสุด').selectOption('ALL');}
 else if(key==='ar-receipt-history'){await page.getByLabel('รหัสลูกค้า',{exact:true}).fill('0001');await page.getByLabel('ประเภทรับชำระ').selectOption('DEBT');}
 else {await page.getByLabel('รหัสฝ่ายขาย',{exact:true}).fill('0001');await expect(page.getByRole('table')).toContainText('ยังไม่กำหนดงวดเป้า');}
 await page.getByRole('button',{name:'รีเฟรชข้อมูล',exact:true}).click();
 await expect.poll(()=>request?.searchParams.get(key==='cq-cheque-register'?'chequeNo':key==='ar-receipt-history'?'custCode':'empCode')).toBe(key==='cq-cheque-register'?'0007':'0001');
 if(key==='cq-cheque-register')expect(request?.searchParams.get('status')).toBe('ALL');
 if(key==='ar-receipt-history')expect(request?.searchParams.get('receiptType')).toBe('DEBT');
 expect(request?.searchParams.has('book')).toBe(false);
 await page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true}).click();await expect(page.locator('.report-print-area')).toContainText(note);await expect(page.getByTestId('report-iso-stamp')).toHaveCount(1);
 const fits=await page.locator('[data-report-rows]').evaluate(table=>table.scrollWidth<=table.clientWidth+1);expect(fits).toBe(true);
 await page.screenshot({path:'test-results/report-readiness/'+key+'.png',fullPage:true});
});

for(const key of ['ar-receipt-history','cq-cheque-register'])test(key+' multipage PDF retains references and stays inside paper bounds',async({page})=>{
 const native=createRequire(__filename)('../../backend/services/native-finance-reports.js');
 const payload={type:key,title:'QA financial multipage',columns:key==='ar-receipt-history'?native.receiptColumns:native.chequeColumns,rows:Array.from({length:35},(_,i)=>key==='ar-receipt-history'?{ReceiptNo:'RC-QA-'+i,Amount:10000000.25,CustCode:'0001',CustName:'QA',RefDocNo:'QA-INVOICE (2026-10-01), QA-SECOND (2026-10-02)',ChequeRefs:'0007, 0008',ReceiptKind:'รับชำระหนี้ (206)',PostedGL:'Y'}:{RowKind:'รายการในช่วง',ChequeNo:'0007-'+i,ChequeAmount:10000000.25,UnreplacedAmount:10000000.25,OpenAmount:10000000.25,Status:'เช็คฝาก',ChequeCount:1,LastMoveNo:'QA-MOVE-'+i,LastMoveDate:'2026-10-31'}),isoStamp:stamp,meta:{notes:['QA as-of context']}};
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key,title:payload.title,category:'finance',available:true}]});if(url.pathname.endsWith('/template'))return route.fulfill({json:{reportKey:key,template}});if(url.pathname.endsWith('/reports/'+key))return route.fulfill({json:payload});return route.fulfill({json:{}});});
 await page.goto('/tests/report-readiness.html?page=reports');await page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true}).click();await page.evaluate(()=>document.fonts.ready);await page.emulateMedia({media:'print'});
 await expect.poll(async()=>page.locator('.report-page').evaluateAll(pages=>pages.every(p=>p.getBoundingClientRect().height<=1064))).toBe(true);
 const pages=await page.locator('.report-page').count();expect(pages).toBeGreaterThan(1);await expect(page.getByTestId('report-iso-stamp')).toHaveCount(pages);
 await expect(page.locator('.report-print-area')).toContainText(key==='ar-receipt-history'?'RC-QA-34':'QA-MOVE-34');
 const moneyCells=page.locator('.report-print-area td').filter({hasText:'10,000,000.25'});expect(await moneyCells.count()).toBeGreaterThan(0);expect(await moneyCells.evaluateAll(cells=>cells.every(cell=>{const range=document.createRange();range.selectNodeContents(cell);return range.getClientRects().length===1;}))).toBe(true);
 const pdf=await page.pdf({path:'test-results/report-readiness/'+key+'-multipage.pdf',preferCSSPageSize:true,printBackground:true});expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length).toBe(pages);
});

test('Admin creates and edits paper size with the existing audit and version contract',async({page})=>{
 const templates:any[]=[];const writes:any[]=[];
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url()),method=route.request().method();if(method==='OPTIONS')return route.fulfill({status:204});
  if(url.pathname.endsWith('/reports/headers'))return route.fulfill({json:[{HeaderId:1,HeaderCode:'QA',HeaderName:'QA company',IsActive:true,Version:1}]});
  if(url.pathname.endsWith('/catalog-config'))return route.fulfill({json:{reports:[]}});
  if(url.pathname.endsWith('/reports/templates')&&method==='GET')return route.fulfill({json:templates});
  if(url.pathname.endsWith('/reports/templates')&&method==='POST'){const body=route.request().postDataJSON();writes.push(body);templates.push({...body,TemplateId:4,Version:1});return route.fulfill({status:201,json:templates[0]});}
  if(url.pathname.endsWith('/reports/templates/4')&&method==='PUT'){const body=route.request().postDataJSON();writes.push(body);expect(body.expectedVersion).toBe(1);templates[0]={...templates[0],...body,Version:2};return route.fulfill({json:templates[0]});}
  return route.fulfill({json:[]});
 });
 await page.goto('/tests/report-readiness.html?page=templates');await page.getByRole('button',{name:'แม่แบบรายงาน (0)',exact:true}).click();await page.getByRole('button',{name:'เพิ่มแม่แบบใหม่',exact:true}).click();
 await page.getByPlaceholder('เช่น TPL_LOGISTICS_DISPATCH',{exact:true}).fill('TPL_QA_A3');await page.locator('form input[type="text"]').nth(1).fill('QA financial register');
 await page.getByLabel('ขนาดกระดาษรายงาน',{exact:true}).selectOption('A3');await page.getByLabel('ทิศทางกระดาษรายงาน',{exact:true}).selectOption('landscape');await page.getByLabel('แสดงกล่องลายมือชื่อ',{exact:true}).uncheck();
 await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลง',{exact:true}).fill('QA audited A3 financial register');await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].PaperSize).toBe('A3');expect(writes[0].Orientation).toBe('landscape');expect(writes[0].ShowSignatures).toBe(false);
 await page.getByRole('button',{name:'แก้ไขแม่แบบ',exact:true}).click();await expect(page.getByLabel('ขนาดกระดาษรายงาน',{exact:true})).toHaveValue('A3');await page.getByLabel('ขนาดกระดาษรายงาน',{exact:true}).selectOption('Legal');
 await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลง',{exact:true}).fill('QA paper update');await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1].PaperSize).toBe('Legal');expect(writes[1].reason).toBe('QA paper update');
});

test('Budget approval starts with a selection prompt and never requests an invalid plan',async({page})=>{
 let invalid=0;await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key:'budget-plan-approval',title:'คำขออนุมัติงบส่งเสริมการขาย',category:'rebate'}]});if(url.pathname.endsWith('/reports/budget-plan-approval')){invalid++;return route.fulfill({status:400,json:{error:'เลือกเลขแผน'}});}return route.fulfill({json:{}});});
 await page.goto('/tests/report-readiness.html?page=reports');await expect(page.getByRole('heading',{name:'เลือกแผนงบประมาณที่ต้องการพิมพ์'})).toBeVisible();await expect(page.getByRole('button',{name:'Export Excel',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'พิมพ์ / Export PDF',exact:true})).toBeDisabled();expect(invalid).toBe(0);await expect(page.getByText('เกิดข้อผิดพลาดในการโหลดข้อมูล',{exact:true})).toHaveCount(0);
});

for(const key of ['pricelist_sheet','costlist_sheet'])test(key+' comparison, product filters and ordering survive requests and Excel',async({page})=>{
 const periods=[{key:'1',id:1,offset:-2,offsetLabel:'-2',label:'01/11/2569',shortLabel:'01/11',isCurrent:false},{key:'2',id:2,offset:-1,offsetLabel:'-1',label:'02/11/2569',shortLabel:'02/11',isCurrent:false},{key:'3',id:3,offset:0,offsetLabel:'รอบปัจจุบัน',label:'09/11/2569',shortLabel:'09/11',isCurrent:true}];
 let request:URL|undefined,exportRequest:URL|undefined;
 const payload={type:key,title:key,columns:[{key:'GoodCode',label:'รหัสสินค้า',type:'identifier'},{key:'p_0',label:'-2: 01/11',type:'money'},{key:'p_1',label:'-1: 02/11',type:'money'},{key:'p_2',label:'รอบปัจจุบัน: 09/11',type:'money'}],rows:[{GoodCode:'QA-B',p_0:100,p_1:110,p_2:120}],meta:{groups:[{id:'1001',name:'QA Compound'}]}};
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/reports/types'))return route.fulfill({json:[{key,title:key,category:'sales'}]});if(url.pathname.endsWith('-periods'))return route.fulfill({json:{periods}});if(url.pathname.endsWith('/template'))return route.fulfill({json:{reportKey:key,template}});if(url.pathname.endsWith('/export')){exportRequest=url;return route.fulfill({status:500,json:{error:'QA export intercepted'}});}if(url.pathname.endsWith('/reports/'+key)){request=url;return route.fulfill({json:payload});}return route.fulfill({json:{}});});
 await page.goto('/tests/report-readiness.html?page=reports');await expect(page.getByRole('table')).toContainText('QA-B');await page.getByRole('button',{name:'เปรียบเทียบ (-2..+2 รอบ)',exact:true}).click();await expect.poll(()=>request?.searchParams.get('periodIds')).toBe('1,2,3');
 await page.getByLabel('ไม่แสดงสินค้างดขาย',{exact:true}).uncheck();await page.getByLabel('เรียงตารางราคา',{exact:true}).selectOption('group-id');await page.getByLabel('ทิศทางเรียงตารางราคา',{exact:true}).selectOption('desc');await page.getByLabel('กลุ่มสินค้าในตารางราคา',{exact:true}).selectOption('1001');await page.getByLabel('ค้นหาสินค้าในตารางราคา',{exact:true}).fill('QA-B');
 await expect.poll(()=>request?.searchParams.get('search')).toBe('QA-B');expect(request?.searchParams.get('hideSuspended')).toBe('false');expect(request?.searchParams.get('sortBy')).toBe('group-id');expect(request?.searchParams.get('sortDirection')).toBe('desc');expect(request?.searchParams.get('groupId')).toBe('1001');
 await page.getByRole('button',{name:'Export Excel',exact:true}).click();await expect.poll(()=>exportRequest?.searchParams.get('search')).toBe('QA-B');expect(exportRequest?.searchParams.get('periodIds')).toBe('1,2,3');expect(exportRequest?.searchParams.get('hideSuspended')).toBe('false');
});

test('Settings no longer offers the closed acceptance workflow',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/catalog-config')?{reports:[]}:[]}));await page.goto('/tests/report-readiness.html?page=settings');await expect(page.getByRole('tab',{name:'ผลตรวจรับงาน',exact:true})).toHaveCount(0);await expect(page.getByRole('tab',{name:'แม่แบบ & หัวกระดาษรายงาน',exact:true})).toBeVisible();
});
