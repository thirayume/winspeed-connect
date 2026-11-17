import { test, expect } from '@playwright/test';

test('verification distinguishes a present document, an unverified save and a failed check', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/coupons/verify-redemption')) {
      const number = url.searchParams.get('docNo');
      if (number === 'SLOW') { await new Promise(resolve => setTimeout(resolve, 300)); return route.fulfill({ json: { status: 'PRESENT', lineCount: 1 }, headers }); }
      if (number === 'PRESENT') return route.fulfill({ json: { status: 'PRESENT', lineCount: 2 }, headers });
      if (number === 'FAIL') return route.fulfill({ status: 503, json: { message: 'ตรวจใบขนไม่สำเร็จ' }, headers });
      return route.fulfill({ json: { status: 'NOT_VERIFIED' }, headers });
    }
    if (url.pathname.endsWith('/recon/active-books')) return route.fulfill({ json: { books: [], cutsAwaitingInvoice: { account1: 0, account2: 0 }, note: '' }, headers });
    if (url.pathname.endsWith('/recon/account-mismatches')) return route.fulfill({ json: { data: [] }, headers });
    return route.fulfill({ json: [], headers });
  });
  await page.goto('/tests/redemption-verification.html');
  await page.getByRole('button', { name: /กระทบยอดการตัดตั๋วปุ๋ย/ }).click();
  const input=page.getByLabel('เลขใบขน 116');
  const verify=page.getByRole('button',{name:'ตรวจใบขน'});
  await input.fill('PRESENT'); await verify.click();
  await expect(page.getByRole('status')).toContainText('พบใบขน PRESENT และรายละเอียด 2 บรรทัด');
  await input.fill('MISSING'); await verify.click();
  await expect(page.getByRole('status')).toContainText('ยังไม่พบใบขน MISSING ที่ยืนยันได้');
  await expect(page.getByRole('status')).toContainText('ก่อนบันทึกซ้ำ');
  await input.fill('FAIL'); await verify.click();
  await expect(page.getByRole('alert')).toContainText('ตรวจใบขนไม่สำเร็จ');
  await expect(page.getByRole('status')).toHaveCount(0);
  await input.fill('SLOW'); await verify.click(); await input.fill('NEW');
  await page.waitForTimeout(450);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('reviewer selects all document lines and submits one atomic request', async ({ page }) => {
  let documentRequest: any;
  let attempts=0;
  const cuts = [
    { redemptionId:44,couponId:101,couponNo:'D-TEST-1',docuNo:'TEST-116',docuDate:'2026-11-16',goodQty:0.1,reason:'AUTHORITATIVE_LINK_REQUIRED',candidateReservations:[{id:11,remainingReservedQty:0.1}] },
    { redemptionId:44,couponId:102,couponNo:'D-TEST-2',docuNo:'TEST-116',docuDate:'2026-11-16',goodQty:0.2,reason:'AUTHORITATIVE_LINK_REQUIRED',candidateReservations:[{id:12,remainingReservedQty:0.2}] },
  ];
  await page.route('**/api/**', async route => {
    const url=new URL(route.request().url()),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.pathname.endsWith('/coupons/settle-cuts'))return route.fulfill({json:{settledCount:0,settlements:[],unmatched:cuts},headers});
    if(url.pathname.endsWith('/coupons/manual-settle-document')){
      documentRequest=route.request().postDataJSON();attempts++;
      if(attempts===1)return route.fulfill({status:409,json:{message:'ใบขนเปลี่ยน กรุณาตรวจสอบ'},headers});
      return route.fulfill({json:{success:true,redemptionId:44,settlements:[]},headers});
    }
    if(url.pathname.endsWith('/recon/active-books'))return route.fulfill({json:{books:[],cutsAwaitingInvoice:{account1:0,account2:0},note:''},headers});
    if(url.pathname.endsWith('/recon/account-mismatches'))return route.fulfill({json:{data:[]},headers});
    return route.fulfill({json:[],headers});
  });
  await page.goto('/tests/redemption-verification.html');
  await page.getByRole('button',{name:/กระทบยอดการตัดตั๋วปุ๋ย/}).click();
  await page.getByRole('button',{name:/ตรวจการตัดตั๋ว \(Settle Cuts\)/}).click();
  await page.getByRole('button',{name:'ตรวจและจับคู่ทั้งใบ'}).click();
  const dialog=page.getByRole('dialog',{name:'ตรวจหลักฐานและจับคู่ใบขนทั้งใบ'});
  await expect(dialog).toContainText('D-TEST-1');await expect(dialog).toContainText('D-TEST-2');
  const submit=dialog.getByRole('button',{name:'ยืนยันจับคู่ทั้งใบ'});await expect(submit).toBeDisabled();
  await dialog.locator('select').nth(0).selectOption('11');await dialog.locator('select').nth(1).selectOption('12');
  await dialog.locator('textarea').fill('ตรวจหลักฐานทั้งสองบรรทัดแล้ว');await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('ใบขนเปลี่ยน กรุณาตรวจสอบ');
  await expect(dialog.locator('select').nth(0)).toHaveValue('11');await submit.click();
  await expect(dialog).toHaveCount(0);
  expect(documentRequest).toMatchObject({redemptionId:44,items:[{reservationId:'11',couponId:101,qty:0.1},{reservationId:'12',couponId:102,qty:0.2}]});
});
