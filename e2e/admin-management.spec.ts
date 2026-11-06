import { test, expect } from '@playwright/test';

const users = Array.from({ length: 7 }, (_, i) => ({
  Id: i + 1,
  Username: i === 0 ? 'fixture-admin' : `fixture-${i}`,
  DisplayName: i === 0 ? 'ผู้ดูแลทดสอบ' : `พนักงานทดสอบ ${i}`,
  Role: i === 0 ? 'ADMIN' : 'SALES',
  IsActive: i !== 6,
  EmpId: null,
  EmpCode: null,
}));
const roles = ['SALES', 'ADMIN'].map((Code) => ({
  Code,
  Name: Code,
  BaseRole: Code,
  disabledActions: [],
  Revision: 0,
}));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/users')) data = users;
    else if (path.endsWith('/admin-management/roles'))
      data = {
        roles,
        actions: {
          'so.create': ['SALES', 'ADMIN'],
          'quotation.create': ['SALES', 'ADMIN'],
          'users.manage': ['ADMIN'],
        },
        menus: { sales: ['SALES', 'ADMIN'] },
        editable: ['so.create', 'quotation.create', 'users.manage'],
      };
    else if (path.includes('/admin-management/roles/')) data = { ok: true };
    else if (path.endsWith('/users/batch'))
      data = { ok: true, count: route.request().postDataJSON().ids.length, credentials: [] };
    else if (path.endsWith('/readiness-signoff'))
      data = {
        database: 'FIXTURE_UAT',
        topics: [
          {
            code: 'SALES',
            title: 'ผูกพนักงานและเข้าใช้ครั้งแรก',
            team: 'ฝ่ายขาย + IT',
            hint: 'บันทึกผลทดสอบ',
            current: null,
          },
        ],
      };
    else if (path.endsWith('/system-settings')) data = { raw: {}, settings: {}, currentRevision: 1 };
    else if (path.endsWith('/auth/databases')) data = { canSetSystem: false };
    await route.fulfill({ json: data });
  });
  await page.goto('/test-harnesses/admin-management.html');
});

test('active default, inactive opt-in and five-user batch preserves exact selection', async ({ page }) => {
  await expect(page.getByText('@fixture-5', { exact: true })).toBeVisible();
  await expect(page.getByText('@fixture-6', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('เลือก fixture-admin', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ผลตรวจรับงาน', exact: true })).toHaveCount(0);
  await page.getByLabel('แสดง Active + Inactive').check();
  await expect(page.getByText('@fixture-6', { exact: true })).toBeVisible();
  await page.getByLabel('แสดง Active + Inactive').uncheck();
  for (let i = 1; i <= 5; i++) await page.getByLabel(`เลือก fixture-${i}`, { exact: true }).check();
  await page.getByRole('button', { name: 'จัดการที่เลือก (5)', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('คำสั่ง', { exact: true }).selectOption('clear-line');
  await expect(dialog.getByRole('button', { name: 'ยืนยันดำเนินการ' })).toBeDisabled();
  await dialog.getByLabel('ตรวจรายชื่อและยืนยันคำสั่งนี้แล้ว').check();
  const request = page.waitForRequest((r) => r.url().endsWith('/users/batch'));
  await dialog.getByRole('button', { name: 'ยืนยันดำเนินการ' }).click();
  expect((await request).postDataJSON()).toMatchObject({ ids: [2, 3, 4, 5, 6], action: 'clear-line' });
  await expect(dialog.getByRole('status')).toHaveText('สำเร็จ 5 คน');
  await dialog.getByRole('button', { name: 'ปิดผลลัพธ์' }).click();
  await page.screenshot({ path: 'test-results/admin-management/users-desktop.png' });
});

test('create custom role with restricted permissions and show inherited limits', async ({ page }) => {
  await page.getByRole('button', { name: 'roles', exact: true }).click();
  await page.getByRole('button', { name: 'เพิ่ม Role', exact: true }).click();
  await page.getByLabel('รหัส Role', { exact: true }).fill('SALES');
  await expect(page.getByRole('button', { name: 'บันทึก Role', exact: true })).toBeDisabled();
  // A conflicting name must not lock the input, so the operator can correct it.
  await page.getByLabel('รหัส Role', { exact: true }).fill('SALES_TRAINING');
  await page.getByLabel('ชื่อ Role', { exact: true }).fill('ฝ่ายขายฝึกอบรม');
  await page.getByRole('checkbox', { name: /สร้างใบเสนอราคา/ }).uncheck();
  await expect(page.getByRole('checkbox', { name: /จัดการผู้ใช้/ })).toBeDisabled();
  const request = page.waitForRequest((r) => r.method() === 'PUT');
  await page.getByRole('button', { name: 'บันทึก Role', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    code: 'SALES_TRAINING',
    baseRole: 'SALES',
    disabledActions: ['quotation.create'],
  });
  await expect(page.getByRole('status')).toContainText('บันทึก Role แล้ว');
  await page.getByRole('button', { name: 'เพิ่ม Role', exact: true }).click();
  await page.screenshot({ path: 'test-results/admin-management/roles-desktop.png' });
});

test('App Settings keeps readiness input on tab changes and fits mobile', async ({ page }) => {
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.getByRole('tab', { name: 'ผลตรวจรับงาน', exact: true }).click();
  const reviewer = page.getByLabel('ผู้รับรอง', { exact: true });
  await reviewer.fill('ผู้ทดสอบ');
  await page.getByRole('tab', { name: 'ตั้งค่านโยบายระบบ', exact: true }).click();
  await page.getByRole('tab', { name: 'ผลตรวจรับงาน', exact: true }).click();
  await expect(reviewer).toHaveValue('ผู้ทดสอบ');
  await page.screenshot({ path: 'test-results/admin-management/settings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/admin-management/settings-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'users', exact: true }).click();
  await expect(page.getByLabel('แสดง Active + Inactive')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/admin-management/users-mobile.png' });
});
