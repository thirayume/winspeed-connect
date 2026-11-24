import { test, expect } from '@playwright/test';

test('Snapshot table shows the stored Bangkok time and unchanged price', async ({page}) => {
  const mutations:string[]=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(request.method()!=='GET')mutations.push(path);
    let json:unknown=[];
    if(path.endsWith('/admin/reset'))json={enabled:false};
    if(path.endsWith('/limits'))json={standard:200,max:300,step:100};
    if(path.endsWith('/customers'))json={items:[],total:0};
    if(path.endsWith('/oct31-prices'))json={items:[{id:1,goodId:1,goodCode:'FIXTURE-SNAPSHOT',goodName:'สินค้าทดสอบ',basePrice:18000,sourceType:'OCT31_SNAPSHOT',capturedAt:'2026-11-23T17:07:58.627+07:00'}]};
    return route.fulfill({headers,json});
  });
  await page.goto('/tests/rebate-feature-gate.html');
  await page.getByRole('button',{name:'เปิดสำหรับทดสอบ',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:'FIXTURE-SNAPSHOT'});
  await expect(row).toContainText('23/11/2569 17:07');
  await expect(row).toContainText('18,000.00');
  await expect(row).not.toContainText('24/11/2569 00:07');
  expect(mutations).toEqual([]);
});

test('legacy history loads only on request and preserves old claims without offering new legacy claims',async({page})=>{
 const requests:string[]=[];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  requests.push(path);
  return route.fulfill({headers,json:path.endsWith('/rebate/claims')?[{Id:1,Status:'APPROVED',ClaimAmt:100,CreatedAt:'2026-11-22',CustName:'Fixture'}]:[]});
 });
 await page.goto('/tests/rebate-feature-gate.html');
 await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้',{exact:true})).toBeVisible();
 expect(requests.filter(p=>p.includes('/rebate/'))).toEqual([]);
 await page.getByRole('button',{name:'ประวัติและคำขอเดิม',exact:true}).click();
 await expect(page.getByText('อนุมัติแล้ว',{exact:true})).toBeVisible();
 await expect(page.getByTestId('open-customer-claim-button')).toHaveCount(0);
 await expect(page.getByTestId('open-claim-dialog-button')).toHaveCount(0);
 expect(requests.filter(p=>p.includes('/rebate-pool/'))).toEqual([]);
});

test('Pool screens do not request Pool APIs until the server feature is present', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push(url.pathname);
    if (url.pathname.endsWith('/admin/reset')) return route.fulfill({ json: { enabled: false }, headers });
    if (url.pathname.endsWith('/limits')) return route.fulfill({ json: { standard: 200, max: 300, step: 100 }, headers });
    if (url.pathname.endsWith('/oct31-prices')) return route.fulfill({ json: { items: [] }, headers });
    if (url.pathname.endsWith('/customers')) return route.fulfill({ json: { items: [], total: 0 }, headers });
    return route.fulfill({ json: [], headers });
  });
  await page.goto('/tests/rebate-feature-gate.html');
  await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้', { exact: true })).toBeVisible();
  await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้ จึงยังไม่สามารถเริ่มยอดใหม่ได้')).toBeVisible();
  await page.waitForTimeout(250);
  expect(requests.filter(p => p.includes('/rebate-pool/'))).toEqual([]);
  await page.getByRole('button', { name: 'เปิดสำหรับทดสอบ' }).click();
  await expect.poll(() => requests.some(p => p.endsWith('/rebate-pool/customers'))).toBe(true);
  expect(requests.filter(p => /\/rebate-pool\/(ledger|alerts)$/.test(p))).toEqual([]);
  await expect(page.getByText('โหลดข้อมูลไม่สำเร็จ', { exact: true })).toHaveCount(0);
  await expect.poll(() => requests.some(p => p.endsWith('/rebate-pool/admin/reset'))).toBe(true);
  await page.getByRole('button', { name: 'ปิดสำหรับทดสอบ', exact: true }).click();
  await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้', { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  const offCount = requests.filter(p => p.includes('/rebate-pool/')).length;
  await page.waitForTimeout(250);
  expect(requests.filter(p => p.includes('/rebate-pool/')).length).toBe(offCount);
});

test('evidence review and conversion decisions refresh customer balances without losing the search', async ({ page }) => {
  let balance = 200;
  let overviewReads = 0;
  let decided = false;
  let reviewed = false;
  const legacyRequests: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let json: unknown = [];
    if (/\/rebate-pool\/(ledger|alerts)$/.test(path)) legacyRequests.push(path);
    if (path.endsWith('/rebate-pool/customers')) {
      overviewReads++;
      json = { items: [{ custId: 1, custCode: 'TEST-CUSTOMER', custName: 'ลูกค้าทดสอบ', status: 'ready', balance }], nextAfter: null };
    } else if (path.endsWith('/shipment-evidence/1/review')) {
      reviewed = true; balance = 300; json = { id: 1, status: 'VERIFIED' };
    } else if (path.endsWith('/shipment-evidence')) {
      json = { data: reviewed ? [] : [{ Id: 1, Revision: 1, RedemptionListNo: 1, DocuNo: 'TEST-116',
        DocuDate: '2026-11-22', QuantityTon: 1, HoldReason: 'TIME_UNVERIFIED' }] };
    } else if (path.endsWith('/conversion-requests/1/approve')) {
      decided = true; balance = 100; json = { id: 1, status: 'APPROVED' };
    } else if (path.endsWith('/conversion-requests')) {
      json = { items: decided ? [] : [{ id: 1, custId: 1, custCode: 'TEST-CUSTOMER', status: 'PENDING',
        canDecide: true, canCancel: false, amount: 200 }], database: 'fixture', limit: 50 };
    } else if (path.endsWith('/admin/reset')) json = { enabled: false };
    else if (path.endsWith('/oct31-prices')) json = { items: [] };
    else if (path.endsWith('/limits')) json = { standard: 200, max: 300, step: 100 };
    await route.fulfill({ json, headers });
  });
  await page.goto('/tests/rebate-feature-gate.html');
  await page.getByRole('button', { name: 'เปิดพร้อมสิทธิ์ทดสอบ', exact: true }).click();
  const overview = page.locator('section').filter({ has: page.getByRole('heading', { name: 'กอง Rebate รายลูกค้า' }) });
  await expect(overview.getByText('฿200.00', { exact: true })).toBeVisible();
  await page.getByLabel('ค้นหาลูกค้า', { exact: true }).fill('TEST-CUSTOMER');
  await overview.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(overview.getByText('฿200.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ดูรายการขนส่งที่รอตรวจหลักฐาน' }).click();
  await page.getByRole('button', { name: 'ตรวจหลักฐาน', exact: true }).click();
  await page.getByLabel('เวลาขนส่งจริงตามหลักฐาน (เวลาไทย)').fill('2026-11-22T10:00');
  await page.getByLabel('เหตุผลและเอกสารอ้างอิง').fill('ตรวจหลักฐานซ้อม');
  await page.getByRole('button', { name: 'ยืนยันหลักฐาน', exact: true }).click();
  await expect(overview.getByText('฿300.00', { exact: true })).toBeVisible();
  await expect(page.getByLabel('ค้นหาลูกค้า', { exact: true })).toHaveValue('TEST-CUSTOMER');
  await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await page.getByRole('heading', { name: 'ระบุข้อมูล', exact: true }).locator('..').getByRole('textbox').fill('อนุมัติซ้อม');
  await page.getByRole('button', { name: 'ตกลง', exact: true }).click();
  await page.getByRole('button', { name: 'ตกลง', exact: true }).click();
  await expect(overview.getByText('฿100.00', { exact: true })).toBeVisible();
  const before = overviewReads;
  balance = 50;
  await overview.getByRole('button', { name: 'รีเฟรชยอดลูกค้า', exact: true }).click();
  await expect(overview.getByText('฿50.00', { exact: true })).toBeVisible();
  expect(overviewReads).toBeGreaterThan(before);
  expect(legacyRequests).toEqual([]);
});
