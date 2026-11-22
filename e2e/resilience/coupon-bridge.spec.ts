import {test,expect} from '@playwright/test';
test('bridge disabled renders no action and issues no Pool/bridge request',async({page})=>{
 let requests=0;await page.route('**/api/**',route=>{requests++;return route.fulfill({json:{}});});
 await page.goto('/tests/coupon-bridge.html?off=1');
 await expect(page.getByRole('button',{name:'Change session'})).toBeVisible();
 await expect(page.getByRole('button',{name:'โหลดคิวล่าสุด'})).toHaveCount(0);expect(requests).toBe(0);
});
test('recovery requires fresh proof and a second confirmation; session changes clear the proof',async({page})=>{
 let changes=0,reads=0;
 await page.route('**/api/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname.endsWith('/bridge/queue')){reads++;return route.fulfill({json:{items:[{PermitId:'fixture-permit',CustId:2,DocuNo:null,State:'STARTED',Operation:'E',opening:true}]}});}
  const body=route.request().postDataJSON();
  if(body.fingerprint==='fresh'){changes++;return route.fulfill({json:{completed:true}});}
  return route.fulfill({json:{reviewRequired:true,fingerprint:'fresh',lines:[{couponNo:'C-FIXTURE',beforeQty:'0.20',afterQty:'0.10'}]}});
 });
 await page.goto('/tests/coupon-bridge.html');expect(reads).toBe(0);
 await page.getByRole('button',{name:'โหลดคิวล่าสุด'}).click();
 await page.getByLabel('เหตุผลตรวจใบอนุญาต').fill('ตรวจหลักฐานและกู้ใบขนตามแผน');
 await page.getByRole('button',{name:'ตรวจแผนกู้ใบขน'}).click();
 await expect(page.getByText('C-FIXTURE · 0.20 → 0.10 ตัน')).toBeVisible();expect(changes).toBe(0);
 await page.getByRole('button',{name:'ยืนยันตามหลักฐานล่าสุด'}).click();
 await expect(page.getByText('ดำเนินการแล้ว กรุณาโหลดคิวและตรวจยอดอีกครั้ง')).toBeVisible();expect(changes).toBe(1);
 await page.getByRole('button',{name:'Change session'}).click();
 await expect(page.getByText('บันทึกไม่ครบ — ยอดยังพัก',{exact:false})).toHaveCount(0);
});
test('legacy adoption never also publishes a native edit, and changed quantities invalidate review',async({page})=>{
 let adopted=0,published=0;
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/adopt')){adopted++;return route.fulfill({json:{adopted:true}});}
  if(p.endsWith('/publish')){published++;return route.fulfill({json:{permitId:'new'}});}
  return route.fulfill({json:{fingerprint:'checked',registered:adopted>0,opening:false,
   plan:{lines:[{couponId:3,couponNo:'C-FIXTURE',before:'0.20',after:'0.10',nativeBefore:'0.40'}]}}});
 });
 await page.goto('/tests/coupon-bridge.html');
 await page.getByLabel('เลขใบขน').fill('900000001');
 await page.getByLabel('เหตุผลแผน WinSpeed').fill('ปรับจำนวนตามหลักฐานการขนจริง');
 await page.getByRole('button',{name:'ตรวจแผนล่าสุด'}).click();
 await page.getByRole('button',{name:'ตรวจรับหลักฐานเอกสารเดิม'}).click();expect(adopted).toBe(1);expect(published).toBe(0);
 await page.getByRole('button',{name:'ตรวจแผนล่าสุด'}).click();
 await expect(page.getByRole('button',{name:'อนุมัติแผนสำหรับ WinSpeed'})).toBeVisible();
 await page.getByLabel('C-FIXTURE · จำนวนใหม่ (ตัน)').fill('0.05');
 await expect(page.getByRole('button',{name:'อนุมัติแผนสำหรับ WinSpeed'})).toHaveCount(0);expect(published).toBe(0);
});
test('a late native bill response cannot restore another Access As session data',async({page})=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});let started=false;
 await page.route('**/api/**',async route=>{
  started=true;await wait;
  return route.fulfill({json:{soid:1,docuNo:'PRIVATE-OLD-SESSION',custId:2,approvalNo:null,today:'2026-01-01',credit:null,
   gross:'0',discount:'0',tax:'0',amount:'0',orderLines:[],deliveries:[],coupons:[],requests:[],cuts:[],permissions:{}}});
 });
 await page.goto('/tests/coupon-bridge.html');
 await page.getByRole('button',{name:'ขอตัดตั๋ว / บันทึกใบขน (116)'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await expect.poll(()=>started).toBeTruthy();
 await page.getByRole('button',{name:'Change session'}).click();release();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('PRIVATE-OLD-SESSION',{exact:false})).toHaveCount(0);
});
