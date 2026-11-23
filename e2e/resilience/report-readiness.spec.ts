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
  if(url.pathname.endsWith('/budget/plans')&&method==='GET')return route.fulfill({json:{data:[]}});
  if(url.pathname.endsWith('/budget/plans')&&method==='POST'){saved=route.request().postDataJSON();return route.fulfill({json:pending});}
  if(url.pathname.endsWith('/submit')){const b=route.request().postDataJSON();expect(b.expectedVersion).toBe(version);pending.Status='PENDING';pending.EditVersion=++version;return route.fulfill({json:pending});}
  return route.fulfill({json:{}});
 });
 await page.goto('/tests/report-readiness.html');
 await page.getByLabel('ปีแผน',{exact:true}).fill('2641');
 await page.getByRole('button',{name:'+ เพิ่มวงเงินภาค',exact:true}).click();await page.getByLabel('ภาควงเงิน 1',{exact:true}).fill('QA North');await page.getByLabel('วงเงิน 1',{exact:true}).fill('1000');
 await page.getByLabel('region บรรทัด 1',{exact:true}).fill('QA North');await page.getByLabel('category บรรทัด 1',{exact:true}).fill('1.1');await page.getByLabel('itemName บรรทัด 1',{exact:true}).fill('QA bag');await page.getByLabel('quantity บรรทัด 1',{exact:true}).fill('10');await page.getByLabel('unitPrice บรรทัด 1',{exact:true}).fill('11');await expect(page.getByLabel('amount บรรทัด 1',{exact:true})).toHaveValue('110.00');
 await page.getByLabel('ผู้ตรวจสอบ (Manager)',{exact:true}).selectOption('2');await page.getByLabel('ผู้อนุมัติ (C_Level)',{exact:true}).selectOption('3');await page.getByLabel('เหตุผลการดำเนินการ').fill('QA create');await page.getByRole('button',{name:'บันทึกร่าง',exact:true}).click();
 await expect.poll(()=>saved).toBeTruthy();expect(saved.allocations[0].amount).toBe('1000');expect(saved.lines[0].amount).toBe('110.00');
 await expect(page.getByLabel('เลือกปีงบประมาณ',{exact:true})).toHaveValue('2641');
 await page.getByLabel('เหตุผลการดำเนินการ').fill('QA submit');await page.getByRole('button',{name:'ยื่นตรวจสอบ',exact:true}).click();await expect(page.getByText(/PENDING · รุ่น 3/)).toBeVisible();await expect(page.getByRole('button',{name:'ตรวจสอบและส่งอนุมัติ',exact:true})).toHaveCount(0);
 await page.screenshot({path:'test-results/report-readiness/budget-plan.png',fullPage:true});
});
test('a legacy CE plan opens with the correct BE year in the form and list filter',async({page})=>{
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(url.pathname.endsWith('/budget/approvers'))return route.fulfill({json:{data:[]}});
  if(url.pathname.endsWith('/budget/plans/1'))return route.fulfill({json:{PlanId:1,PreparedBy:1,PeriodYear:2026,Channel:'ทั่วไป',Title:'QA CE plan',Status:'DRAFT',EditVersion:1,allocations:[],lines:[]}});
  return route.fulfill({json:{data:[{planId:1,periodYear:2026,title:'QA CE plan',channel:'ทั่วไป',status:'DRAFT'}]}});
 });
 await page.goto('/tests/report-readiness.html');await page.getByLabel('เลือกปีงบประมาณ',{exact:true}).fill('2569');await page.getByLabel('เลือกแผน').selectOption('1');await expect(page.getByLabel('ปีแผน',{exact:true})).toHaveValue('2569');await expect(page.getByLabel('เลือกปีงบประมาณ',{exact:true})).toHaveValue('2569');
});
test('assigned reviewer sees the reviewed state after a successful API response',async({page})=>{
 const plan={PlanId:1,PreparedBy:2,AssignedReviewerId:1,AssignedApproverId:3,PeriodYear:2569,Channel:'ทั่วไป',Title:'QA review',Status:'PENDING',EditVersion:1,ReviewedAt:null as string|null,allocations:[],lines:[]};
 let release!:()=>void;const loading=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204});
  if(path.endsWith('/review')){plan.ReviewedAt='2026-11-23T10:00:00Z';plan.EditVersion++;return route.fulfill({json:plan});}
  if(path.endsWith('/plans/1')){await loading;return route.fulfill({json:plan});}
  if(path.endsWith('/approvers'))return route.fulfill({json:{data:[]}});
  return route.fulfill({json:{data:[{planId:1,periodYear:2569,title:'QA review',channel:'ทั่วไป',status:'PENDING'}]}});
 });
 await page.goto('/tests/report-readiness.html');await page.getByLabel('เลือกแผน').selectOption('1');await expect(page.getByLabel('เหตุผลการดำเนินการ')).toBeDisabled();release();await expect(page.getByLabel('เหตุผลการดำเนินการ')).toBeEnabled();await page.getByLabel('เหตุผลการดำเนินการ').fill('QA review');await page.getByRole('button',{name:'ตรวจสอบและส่งอนุมัติ',exact:true}).click();await expect(page.getByRole('button',{name:'ตรวจสอบและส่งอนุมัติ',exact:true})).toHaveCount(0);await expect(page.getByText(/PENDING · รุ่น 2/)).toBeVisible();
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
