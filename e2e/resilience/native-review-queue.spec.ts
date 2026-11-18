import { test, expect } from '@playwright/test';

test('queue requires an explicit read, paginates, masks sources and clears after session change', async ({ page }) => {
  let calls=0, holds=0;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.pathname.endsWith('/coupons/native-review/4/hold')){
      holds++;
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({expectedCode:'NATIVE_PARTIAL_APPLIED',note:'รอตรวจหลักฐาน'});
      return route.fulfill({json:{authorizationId:4,code:'NATIVE_PARTIAL_APPLIED',hold:'UNCHANGED'},headers});
    }
    if(url.pathname.endsWith('/coupons/native-review')){
      calls++;
      if(url.searchParams.get('cursor'))return route.fulfill({json:{items:[{authorizationId:2,code:'NATIVE_TRANSACTION_INCOMPLETE',docuNo:null,sourceHidden:true},{authorizationId:4,code:'NATIVE_PARTIAL_APPLIED',docuNo:null,sourceHidden:true}],nextCursor:null},headers});
      return route.fulfill({json:{items:[{authorizationId:1,code:'NATIVE_LINES_CHANGED',docuNo:null,sourceHidden:true},
        {authorizationId:3,code:'NATIVE_SOURCE_REFERENCE_MISMATCH',docuNo:null,sourceHidden:true}],nextCursor:'opaque'},headers});
    }
    return route.fulfill({json:[],headers});
  });
  await page.goto('/tests/native-review-queue.html');
  expect(calls).toBe(0);
  await page.getByRole('button',{name:'โหลดคิวตรวจ'}).click();
  await expect(page.getByText('รายการหรือจำนวนในใบขนเปลี่ยน')).toBeVisible();
  await expect(page.getByText('รายละเอียดต้นทางไม่แสดง')).toHaveCount(2);
  await expect(page.getByText('ข้อมูลใบขนต้นทางไม่ตรงกับเลขอ้างอิง กรุณาตรวจสอบ')).toBeVisible();
  await page.getByRole('button',{name:'โหลดรายการถัดไป'}).click();
  await expect(page.getByText('พบหลักฐานเริ่มตัดตั๋ว แต่รายการยังไม่สมบูรณ์')).toBeVisible();
  await expect(page.getByText('พบหลักฐานว่าบางบรรทัดตัดแล้วและบางบรรทัดยังค้าง กรุณาตรวจสอบ')).toBeVisible();
  const partial=page.locator('li').filter({hasText:'รายการตรวจ #4'});
  await partial.getByRole('button',{name:'บันทึกว่าพักตรวจต่อ'}).click();
  await partial.getByLabel('เหตุผลที่พักตรวจต่อ').fill('รอตรวจหลักฐาน');
  await partial.getByRole('button',{name:'บันทึกผลตรวจ'}).click();
  await expect(page.getByText('บันทึกผลตรวจแล้ว ยอดจองยังคงพักไว้')).toBeVisible();
  expect(holds).toBe(1);
  expect(calls).toBe(2);
  await page.getByRole('button',{name:'Change session'}).click();
  await expect(page.getByText('รายการหรือจำนวนในใบขนเปลี่ยน')).toHaveCount(0);
});

test('an interrupted edit can be resumed and then reviewed for release', async ({ page }) => {
  const editId = '12345678-1234-1234-1234-123456789abc';
  let resumed = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/native-edits/' + editId + '/resume')) {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ reason: 'กู้ใบขนตามแผนที่อนุมัติ' });
      resumed = true;
      return route.fulfill({ headers, json: { editId, resumed } });
    }
    if (url.pathname.endsWith('/coupons/native-review')) {
      const change = resumed ? {
        code: 'NATIVE_EDIT_COMPLETED_REVIEW', releaseId: editId,
        recovery: { restoredQty: '0.5000', settledAfter: '0.5000', openingSourceRestored: '0.0000' },
      } : { code: 'NATIVE_EDIT_INCOMPLETE', resumeId: editId };
      return route.fulfill({
        headers, json: { items: [{ authorizationId: 7, docuNo: null, sourceHidden: true, ...change }], nextCursor: null },
      });
    }
    return route.fulfill({ headers, json: [] });
  });
  await page.goto('/tests/native-review-queue.html');
  await page.getByRole('button', { name: 'โหลดคิวตรวจ' }).click();
  await expect(page.getByRole('button', { name: 'ตรวจและปล่อยยอดพัก' })).toHaveCount(0);
  await page.getByRole('button', { name: 'กู้ใบขนตามแผน', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'ยืนยันกู้ใบขน', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('เหตุผลที่ยืนยันกู้ใบขน').fill('กู้ใบขนตามแผนที่อนุมัติ');
  await confirm.click();
  await expect(page.getByText('กู้ใบขนตามแผนสำเร็จแล้ว', { exact: false })).toBeVisible();
  await expect(page.getByText('คืนยอด 0.5000', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ตรวจและปล่อยยอดพัก' })).toBeVisible();
});
