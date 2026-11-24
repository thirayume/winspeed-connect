import {test,expect} from '@playwright/test';
const ticket={CouponID:1,CouponNo:'C-QA',DocuNo:'C-QA',CustName:'QA customer',GoodName:'QA fertilizer',TotalQtyTon:5,NativeRemainingQtyTon:3,ReservedQtyTon:1,AvailableQtyTon:2,GoodUnitName:'ตัน',Lifecycle:'ISSUED',BalanceState:'POSITIVE',expiryStatus:'TODAY',expiryDate:'2026-11-24',daysRemaining:0,expirySource:'DEFAULT',ticketLifeDays:90};
async function mock(page:any){
 const requests:URL[]=[];const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message));
 await page.route('**/api/**',async(route:any)=>{
  const url=new URL(route.request().url());requests.push(url);const path=url.pathname;
  if(path.endsWith('/auth/me'))return route.fulfill({json:await page.evaluate(()=>(window as any).ticketFixtureUser)});
  if(path.endsWith('/control-tickets')){const tab=url.searchParams.get('tab'),expiry=url.searchParams.get('expiry');const data=tab==='ALERTS'&&expiry==='EXPIRED'?[]:[ticket];return route.fulfill({json:{data,total:data.length,totalPages:1,page:1,pageSize:25,expiryPolicy:{lifeDays:90,warningDays:30}}});}
  if(path.endsWith('/voucher-summary'))return route.fulfill({json:[{EmpID:7,EmpName:'QA employee',CouponCount:1,CustCount:1,OutstandingTon:3}]});
  if(path.endsWith('/rebate/coupons'))return route.fulfill({json:[{CustID:'2',CustName:'QA customer',CouponCount:1,OutstandingTon:3,EmpID:7,EmpName:'QA employee'}]});
  if(path.endsWith('/rebate/coupons/2'))return route.fulfill({json:[{...ticket,GoodQty:5,RemaQty:3,RedeemedQty:2,SONo:'QA-104',daysLeft:0,isToday:true,beneficiaries:[{beneficiaryCustName:'QA member'}]}]});
  return route.fulfill({json:[]});
 });return {requests,errors};
}
test('one navigation entry unifies expiry and hierarchy, filters on the server and shows native/held/available separately',async({page})=>{
 const {requests,errors}=await mock(page);await page.goto('/tests/ticket-readiness.html');
 await expect(page.getByRole('heading',{name:/ชุดตั๋วคุม/})).toBeVisible();
 await expect(page.getByText('Voucher คงค้าง',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'เตือนอายุตั๋ว',exact:true}).click();
 await expect(page.getByText('หมดอายุวันนี้ (ยังใช้ได้)',{exact:true})).toBeVisible();
 await expect(page.getByText('อายุมาตรฐาน 90 วัน',{exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toContainText('3.00');await expect(page.getByRole('table')).toContainText('1.00');await expect(page.getByRole('table')).toContainText('2.00');
 await page.getByRole('button',{name:'หมดอายุแล้ว',exact:true}).click();await expect(page.getByText('ไม่พบตั๋วคุมในหมวดนี้')).toBeVisible();
 expect(requests.some(u=>u.searchParams.get('expiry')==='EXPIRED'&&u.searchParams.get('page')==='1')).toBeTruthy();
 await page.getByRole('button',{name:'รายชื่อตามสังกัด',exact:true}).click();await page.getByRole('button',{name:/QA employee/}).click();await page.getByRole('cell',{name:'QA customer',exact:true}).click();
 await expect(page.getByText(/สมาชิก: QA member/)).toBeVisible();await expect(page.getByText('หมดอายุวันนี้ (ยังใช้ได้)',{exact:true})).toBeVisible();expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/ticket-readiness/hierarchy.png',fullPage:true});
});
test('old voucher links preserve hierarchy-only permissions and never expose edit/trace or other operational tabs',async({page})=>{
 await mock(page);await page.goto('/tests/ticket-readiness.html?portal=voucher&menus=voucher&role=COUNTER_SALES');
 await expect(page.getByRole('heading',{name:'รายชื่อตามสังกัด',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'คงเหลือพร้อมใช้ (Active)',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'เตือนอายุตั๋ว',exact:true}).click();await expect(page.getByText('C-QA',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Trace',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'อายุ',exact:true})).toHaveCount(0);
 await page.getByText('C-QA',{exact:true}).click();await expect(page.getByText('ออกตั๋วทั้งหมด (ตัน)',{exact:true})).toHaveCount(0);
});
test('control-only permissions do not fetch or expose the customer hierarchy',async({page})=>{
 const {requests}=await mock(page);await page.goto('/tests/ticket-readiness.html?menus=control-ticket&role=WAREHOUSE');
 await expect(page.getByText('C-QA',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'รายชื่อตามสังกัด',exact:true})).toHaveCount(0);
 expect(requests.some(u=>u.pathname.endsWith('/voucher-summary'))).toBeFalsy();
});
test('failed recovery reads show a review message instead of stale balances',async({page})=>{
 await mock(page);await page.route('**/api/master/control-tickets?*',route=>route.fulfill({status:409,json:{code:'COUPON_RECOVERY_REVIEW_REQUIRED'}}));
 await page.goto('/tests/ticket-readiness.html');await expect(page.getByRole('alert')).toContainText('รายการคืนยอดตั๋วอยู่ระหว่างตรวจสอบ');await expect(page.getByRole('table')).toHaveCount(0);
});
test('mobile warning tabs remain operable and the renamed bill menu is distinct',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mock(page);await page.goto('/tests/ticket-readiness.html');
 await page.getByRole('button',{name:'เตือนอายุตั๋ว',exact:true}).click();await expect(page.getByRole('button',{name:'หมดอายุวันนี้',exact:true})).toBeVisible();await page.getByRole('button',{name:'หมดอายุวันนี้',exact:true}).click();
 await expect(page.getByRole('button',{name:'หมดอายุวันนี้',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/ticket-readiness/mobile.png',fullPage:true});
});

test('a late response cannot replace the newly selected tab',async({page})=>{
 await mock(page);let release:()=>void=()=>{};const wait=new Promise<void>(r=>release=r);
 await page.route('**/api/master/control-tickets?*',async route=>{
  const url=new URL(route.request().url());if(url.searchParams.get('tab')==='ACTIVE'){await wait;await route.fulfill({json:{data:[{...ticket,CouponNo:'STALE-QA'}],total:1,totalPages:1}});}else await route.fulfill({json:{data:[ticket],total:1,totalPages:1}});
 });
 await page.goto('/tests/ticket-readiness.html');await page.getByRole('button',{name:'เตือนอายุตั๋ว',exact:true}).click();await expect(page.getByText('C-QA',{exact:true})).toBeVisible();release();
 await expect(page.getByText('STALE-QA',{exact:true})).toHaveCount(0);
});
test('an identity without either menu cannot load ticket data via an old portal',async({page})=>{
 const {requests}=await mock(page);await page.goto('/tests/ticket-readiness.html?portal=voucher&menus=reports&role=APPROVER');
 await expect(page.getByRole('heading',{name:'ชุดตั๋วคุม',exact:true})).toHaveCount(0);
 expect(requests.some(u=>u.pathname.endsWith('/control-tickets')||u.pathname.endsWith('/voucher-summary'))).toBeFalsy();
});
