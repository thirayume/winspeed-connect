import {test,expect} from '@playwright/test';
test('native recovery waits for connection closure, reviews both balances and clears stale/session proof',async({page})=>{
 let open=true,writes=0;
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/native116/queue'))return route.fulfill({json:{items:[{stageId:'qa-stage',docuNo:'QA-116',docuDate:'2026-11-27',connectionOpen:open?1:0}]}});
  if(p.endsWith('/native116/inspect'))return route.fulfill({json:{stageId:'qa-stage',fingerprint:open?'open':'closed',docuNo:'QA-116',docuDate:'2026-11-27',connectionOpen:open,restoreExisting:true,coupons:[{couponId:1,couponNo:'QA-C',currentBalance:'0.95',restoreBalance:'0.90'},{couponId:2,couponNo:'QA-D',currentBalance:'1.10',restoreBalance:'1.00'}]}});
  if(p.endsWith('/native116/restore')){writes++;const body=route.request().postDataJSON();expect(body.fingerprint).toBe('closed');expect(body.reason).toBe('ตรวจหลักฐานก่อนคืนสภาพ');return route.fulfill({status:409,json:{code:'ND_PREVIEW_STALE'}});}
  return route.fulfill({json:{items:[]}});
 });
 await page.goto('/tests/coupon-bridge.html');
 const panel=page.getByRole('region',{name:'กู้รายการ WinSpeed ค้าง'});
 await panel.getByRole('button',{name:'ตรวจรายการค้าง WinSpeed'}).click();
 await expect(panel.getByText('DocuDate: 27/11/2569 พ.ศ.')).toBeVisible();
 await panel.getByRole('button',{name:'ตรวจภาพล่าสุดก่อนกู้'}).click();
 await expect(panel.getByText('QA-C · ยอดปัจจุบัน 0.95 → คืนเป็น 0.90 ตัน')).toBeVisible();
 await expect(panel.getByText('QA-D · ยอดปัจจุบัน 1.10 → คืนเป็น 1.00 ตัน')).toBeVisible();
 await panel.getByLabel('เหตุผลกู้รายการ WinSpeed').fill('ตรวจหลักฐานก่อนคืนสภาพ');
 await expect(panel.getByRole('button',{name:'ยืนยันคืนสภาพก่อนเริ่มรายการ'})).toBeDisabled();expect(writes).toBe(0);
 open=false;await panel.getByRole('button',{name:'ตรวจภาพล่าสุดก่อนกู้'}).click();
 await panel.getByRole('button',{name:'ยืนยันคืนสภาพก่อนเริ่มรายการ'}).click();
 await expect(panel.getByRole('status')).toContainText('ข้อมูลเปลี่ยนแล้ว');expect(writes).toBe(1);
 await expect(panel.getByRole('button',{name:'ยืนยันคืนสภาพก่อนเริ่มรายการ'})).toHaveCount(0);
 await panel.getByRole('button',{name:'ตรวจภาพล่าสุดก่อนกู้'}).click();
 await page.getByRole('button',{name:'Change session'}).click();
 await expect(panel.getByRole('button',{name:'ยืนยันคืนสภาพก่อนเริ่มรายการ'})).toHaveCount(0);
});
