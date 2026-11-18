import { test, expect } from '@playwright/test';

// Owner, 18 Nov 2026: goods, goods groups and giveaways can be added, changed and deleted from Sale-App; the
// server writes WinSpeed through wf procedures (migration 248). This checks what the screens send.
const goods = [
  { GoodID: '31013', GoodCode: '7-20101200BB', GoodName: '20-10-12 เชิงผสม', GoodGroupID: 1003, GoodGroupName: 'ปุ๋ยสูตร บรรจุกระสอบ', Inactive: 'A', BagPerTon: 20, WeightKgPerBag: 50 },
];
const groups = [
  { GoodGroupID: 1003, GoodGroupCode: '7', GoodGroupName: 'ปุ๋ยสูตร บรรจุกระสอบ', GoodsCount: 121 },
  { GoodGroupID: 1005, GoodGroupCode: '10', GoodGroupName: 'ส่งเสริมการขาย', GoodsCount: 98 },
];
const units = [{ GoodUnitID: 1002, GoodUnitCode: 'ตัน', GoodUnitName: 'ตัน' }, { GoodUnitID: 3004, GoodUnitCode: 'ชิ้น', GoodUnitName: 'ชิ้น' }];

test('add a good with unit and template, refuse deleting a used one, add a giveaway', async ({ page }) => {
  const sent: { method: string; path: string; body: any }[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api/, '');
    if (req.method() !== 'GET') sent.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null });
    if (path === '/master/goods' && req.method() === 'GET') return route.fulfill({ json: goods });
    if (path === '/master/good-groups' && req.method() === 'GET') return route.fulfill({ json: groups });
    if (path === '/master/good-units') return route.fulfill({ json: units });
    if (path === '/master/goods' && req.method() === 'POST') return route.fulfill({ status: 201, json: { GoodID: 31105, GoodCode: 'NEW-1', GoodName: 'ปุ๋ยใหม่', GoodGroupID: 1003 } });
    if (path === '/master/goods/31013/permanent') return route.fulfill({ status: 409, json: { message: 'ลบไม่ได้ เพราะสินค้านี้ถูกใช้แล้วในใบสั่งจองหรือใบสั่งขายใน WinSpeed ให้ใช้ "งดจำหน่าย" แทน' } });
    if (path === '/master/giveaways') return route.fulfill({ status: 201, json: { GoodID: 31106, GoodCode: 'PM00023', GoodName: 'เสื้อทดสอบ', GoodGroupID: 1005 } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/master-goods.html');
  await expect(page.getByText('7-20101200BB')).toBeVisible();

  await page.getByTitle('เพิ่มสินค้าใหม่').click();
  await page.getByPlaceholder('เช่น 7-15151500BB, 1-46000000BB').fill('NEW-1');
  await page.getByPlaceholder('เช่น 15-15-15 เชิงผสม ตรารถเกษตร').fill('ปุ๋ยใหม่');
  await page.getByLabel('หน่วยนับหลัก').selectOption('1002');
  await page.getByLabel('สินค้าต้นแบบ').selectOption('31013');
  await page.getByRole('button', { name: /บันทึก|สร้างสินค้า/ }).last().click();
  await expect.poll(() => sent.find(s => s.method === 'POST' && s.path === '/master/goods')?.body).toMatchObject({
    GoodCode: 'NEW-1', GoodName: 'ปุ๋ยใหม่', GoodGroupID: 1003, MainGoodUnitID: 1002, TemplateGoodID: 31013,
  });
  await page.getByRole('button', { name: 'ตกลง' }).last().click().catch(() => undefined);

  await page.getByLabel('ลบถาวร 7-20101200BB').click();
  await page.getByRole('button', { name: /ยืนยัน|ตกลง/ }).last().click();
  await expect(page.getByText(/ลบไม่ได้ เพราะสินค้านี้ถูกใช้แล้วในใบสั่งจองหรือใบสั่งขายใน WinSpeed/)).toBeVisible();
  await page.getByRole('button', { name: 'ตกลง' }).last().click().catch(() => undefined);

  await page.getByRole('button', { name: 'Giveaways tab' }).click();
  await page.getByTitle('เพิ่มของแถมใหม่').click();
  await page.getByPlaceholder('เว้นว่าง ระบบตั้งรหัส PM ถัดไปให้').waitFor();
  await page.locator('input').filter({ hasNot: page.getByPlaceholder('เว้นว่าง ระบบตั้งรหัส PM ถัดไปให้') }).and(page.locator('[required]')).first().fill('เสื้อทดสอบ');
  await page.getByLabel('หน่วยนับของแถม').selectOption('3004');
  await page.getByRole('button', { name: /บันทึก|สร้าง/ }).last().click();
  await expect.poll(() => sent.find(s => s.path === '/master/giveaways')?.body).toMatchObject({ GoodName: 'เสื้อทดสอบ', MainGoodUnitID: 3004 });
});
