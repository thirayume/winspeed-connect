import { test, expect } from '@playwright/test';

test('BeneficiaryAdminPage: Full lifecycle mocked browser test', async ({ page }) => {
  const errors: string[] = [];
  const writes: any[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let mockBeneficiaries: any[] = [
    {
      Id: 1,
      OwnerCustId: '1141',
      OwnerCustCode: '0342001',
      OwnerCustName: 'ร้านสุวรรณภัณฑ์',
      BeneficiaryCustId: '16002',
      BeneficiaryCustCode: '0342001-1',
      BeneficiaryCustName: 'คุณจันทิมา แก้วมณี',
      EffectiveFrom: null,
      EffectiveTo: null,
      Scope: 'ALL',
      Reason: 'โควตาสมาชิกสหกรณ์ประจำปี 2569',
      Status: 'ACTIVE',
      CreatedBy: 1,
      CreatedAt: '2026-10-03T00:00:00.000Z',
      UpdatedAt: null,
      RevokedAt: null,
      RevokedBy: null,
      RevokeReason: null
    }
  ];

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    if (url.includes('/api/coupons/beneficiaries')) {
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockBeneficiaries)
        });
      }
      if (method === 'POST') {
        const body = req.postDataJSON();
        writes.push({ type: 'GRANT', body });
        const newGrant = {
          Id: 2,
          OwnerCustId: body.ownerCustId,
          OwnerCustCode: '0342001',
          OwnerCustName: 'ร้านสุวรรณภัณฑ์',
          BeneficiaryCustId: body.beneficiaryCustId,
          BeneficiaryCustCode: '0342001-2',
          BeneficiaryCustName: 'สุวรรณภัณฑ์(เลย)',
          EffectiveFrom: body.effectiveFrom || null,
          EffectiveTo: body.effectiveTo || null,
          Scope: 'ALL',
          Reason: body.reason,
          Status: 'ACTIVE',
          CreatedBy: 1,
          CreatedAt: new Date().toISOString()
        };
        mockBeneficiaries.push(newGrant);
        return route.fulfill({ status: 200, json: { id: 2, status: 'ACTIVE' } });
      }
      if (method === 'DELETE') {
        const body = req.postDataJSON() || {};
        writes.push({ type: 'REVOKE', url, body });
        const id = Number(url.split('/').pop());
        const target = mockBeneficiaries.find((b) => b.Id === id);
        if (target) {
          target.Status = 'REVOKED';
          target.RevokeReason = body.reason || 'Revoked';
        }
        return route.fulfill({ status: 200, json: { id, status: 'REVOKED' } });
      }
    }

    if (url.includes('/api/master/customers')) {
      if (url.includes('q=0342001-')) {
        return route.fulfill({
          status: 200,
          json: [
            { CustID: '16002', CustCode: '0342001-1', CustName: 'คุณจันทิมา แก้วมณี' },
            { CustID: '47015', CustCode: '0342001-2', CustName: 'สุวรรณภัณฑ์(เลย)' }
          ]
        });
      }
      if (url.includes('q=0342001')) {
        return route.fulfill({
          status: 200,
          json: [
            { CustID: '1141', CustCode: '0342001', CustName: 'ร้านสุวรรณภัณฑ์' }
          ]
        });
      }
      return route.fulfill({ status: 200, json: [] });
    }

    return route.continue();
  });

  // Navigate to harness
  await page.goto('http://localhost:5173/test-harnesses/beneficiary-admin.html');

  // 1. Verify Page Title
  await expect(page.getByRole('heading', { name: 'จัดการสิทธิ์ตั๋วร่วม (Shared Ticket Beneficiaries)' })).toBeVisible();

  // 2. Verify Initial Table State
  await expect(page.getByText('คุณจันทิมา แก้วมณี')).toBeVisible();
  await expect(page.getByText('โควตาสมาชิกสหกรณ์ประจำปี 2569')).toBeVisible();

  // 3. Search and Select Root Customer
  const rootInput = page.getByPlaceholder('ค้นหาด้วยชื่อหรือรหัสลูกค้า');
  await rootInput.fill('0342001');
  await page.waitForTimeout(400); // debounce

  const rootDropdownItem = page.getByText('ร้านสุวรรณภัณฑ์').first();
  await rootDropdownItem.click();

  // 4. Verify Root Customer Selected Badge
  await expect(page.getByText('รหัส: 0342001 (CustID: 1141)')).toBeVisible();

  // 5. Verify Prefix-matching Suggestions Loaded
  await expect(page.getByText('รายชื่อแนะนำตามรหัสลูกค้า (Code Prefix Suggestions):')).toBeVisible();
  await expect(page.getByText('สุวรรณภัณฑ์(เลย)')).toBeVisible();

  // 6. Select Member checkbox (47015)
  const memberCheckbox = page.locator('label').filter({ hasText: 'สุวรรณภัณฑ์(เลย)' }).locator('input[type="checkbox"]');
  await memberCheckbox.check();

  // 7. Click Submit Grant
  const grantButton = page.getByRole('button', { name: /ยืนยันการมอบสิทธิ์ตั๋วร่วม \(1 สมาชิก\)/ });
  await expect(grantButton).toBeEnabled();
  await grantButton.click();

  // Verify Grant API write
  await expect.poll(() => writes.some((w) => w.type === 'GRANT')).toBe(true);
  const grantWrite = writes.find((w) => w.type === 'GRANT');
  expect(grantWrite.body.ownerCustId).toBe('1141');
  expect(grantWrite.body.beneficiaryCustId).toBe('47015');

  // 8. Test Revoke
  const revokeButton = page.locator('tr').filter({ hasText: 'คุณจันทิมา แก้วมณี' }).getByRole('button', { name: 'ถอนสิทธิ์' });
  await revokeButton.click();

  // Modal appears
  await expect(page.getByRole('heading', { name: 'ยืนยันการถอนสิทธิ์ตั๋วร่วม' })).toBeVisible();
  const reasonInput = page.getByPlaceholder('เช่น ยกเลิกการเป็นสมาชิกสหกรณ์');
  await reasonInput.fill('ลาออกจากการเป็นสมาชิกสหกรณ์');

  const confirmRevokeBtn = page.getByRole('button', { name: 'ยืนยันการถอนสิทธิ์' });
  await confirmRevokeBtn.click();

  // Verify Revoke API write
  await expect.poll(() => writes.some((w) => w.type === 'REVOKE')).toBe(true);
  const revokeWrite = writes.find((w) => w.type === 'REVOKE');
  expect(revokeWrite.body.reason).toBe('ลาออกจากการเป็นสมาชิกสหกรณ์');

  expect(errors).toEqual([]);
});
