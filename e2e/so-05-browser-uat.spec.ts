import { test, expect, type Page } from '@playwright/test';
import { login, logout, openSidebar, waitForUiIdle } from './helpers';

const SALES_USER = 'emp-00002';
const SALES_NAME = 'เกษร  ดีบรรเจิด';
const MANAGER_USER = 'emp-00021';
const MANAGER_NAME = 'จักรพงษ์';

async function saveSODialog(page: Page) {
  const saveBtn = page.getByRole('button', { name: 'บันทึกการจัดรถ' });
  await expect(saveBtn).toBeVisible({ timeout: 5000 });
  await saveBtn.click();

  const okBtn = page.locator('div.fixed.z-\\[99999\\] button:has-text("ตกลง")').first();

  // 1. If pre-flight appConfirm pops up (e.g. 0-baht or new truck warning), click "ตกลง"
  if (await okBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await okBtn.click();
    await page.waitForTimeout(300);
  }
  // Check if second pre-flight appConfirm pops up
  if (await okBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await okBtn.click();
    await page.waitForTimeout(300);
  }

  // 2. Wait for createSO network response alert (e.g. "✓ สร้างกลุ่มบิลสำเร็จ" or "⚠ มีรายการที่ราคาต่ำกว่า NET")
  await expect(okBtn).toBeVisible({ timeout: 25_000 });
  await okBtn.click();
  await page.waitForTimeout(500);

  // 3. Verify CreateSODialog has closed
  await expect(page.getByRole('heading', { name: 'เพิ่มบิลในทริป' })).toBeHidden({ timeout: 10_000 });
}

test.describe.serial('SO-05 Browser UAT on Hostinger Test', () => {
  test.setTimeout(180_000);

  const fixtureTag = `UAT_${Date.now().toString(36)}`;
  const truckPlateA = `70-${Math.floor(1000 + Math.random() * 9000)}`;

  test('1. Verify deployed version and environment on Hostinger Test', async ({ page, request }) => {
    // Check API health
    const healthRes = await request.get('https://api-test.thirayu.online/api/health');
    expect(healthRes.ok()).toBeTruthy();
    const health = await healthRes.json();
    expect(health.version).toBe('2.0.0');
    expect(health.db.sqlserver).toBe('up');

    // Check Frontend HTML bundle
    await page.goto('https://test.thirayu.online/');
    await expect(page.locator('#root')).toBeVisible();
    await page.screenshot({ path: 'test-results/uat-01-login-screen.png' });
  });

  test('2. Sales creates two draft trips without vehicle on the same day (distinct identity check)', async ({ page }) => {
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // ── Trip 1 ──
    const createBtn = page.getByRole('button', { name: 'สร้างบิล' });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // In TripSetupModal: Verify NO customer/credit fields exist at Trip level
    await expect(page.getByText('ข้อมูลการจัดส่ง (Trip)')).toBeVisible();
    await expect(page.getByPlaceholder('ค้นหาชื่อลูกค้าเริ่มต้น (ถ้ามี)...')).toHaveCount(0);

    // Leave truck plate empty ("ยังไม่ระบุรถ")
    const remarkInput = page.getByPlaceholder('ระบุหมายเหตุสำหรับทริปนี้ (ถ้ามี)...');
    await remarkInput.fill(`Trip 1 ${fixtureTag}`);
    await page.getByRole('button', { name: 'ยืนยันและเริ่มจัดออร์เดอร์' }).click();

    // In CreateSODialog for Trip 1: Select customer in Bill 1
    await expect(page.getByText('เพิ่มบิลในทริป')).toBeVisible();
    const custSearchInput = page.getByPlaceholder('ค้นหารหัสหรือชื่อลูกค้า...');
    await expect(custSearchInput).toBeVisible();
    await custSearchInput.fill('บริษัท');
    await page.waitForTimeout(600);
    const firstCustOption = page.locator('.max-h-48 > div').first();
    await expect(firstCustOption).toBeVisible();
    await firstCustOption.click();

    // Add a product
    const productBtn1 = page.locator('button:has(.line-clamp-2)').first();
    await expect(productBtn1).toBeVisible();
    await productBtn1.click();

    // Submit Trip 1
    await saveSODialog(page);

    // Reload page and navigate to Sales to reset in-memory activeTrip context cleanly
    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // ── Trip 2 (on same day, also without truck) ──
    const createBtn2 = page.getByRole('button', { name: 'สร้างบิล' });
    await expect(createBtn2).toBeVisible({ timeout: 10_000 });
    await createBtn2.click();
    await expect(page.getByText('ข้อมูลการจัดส่ง (Trip)')).toBeVisible();
    const remarkInput2 = page.getByPlaceholder('ระบุหมายเหตุสำหรับทริปนี้ (ถ้ามี)...');
    await remarkInput2.fill(`Trip 2 ${fixtureTag}`);
    await page.getByRole('button', { name: 'ยืนยันและเริ่มจัดออร์เดอร์' }).click();

    // In CreateSODialog for Trip 2: Select customer in Bill 1
    await expect(page.getByText('เพิ่มบิลในทริป')).toBeVisible();
    const custSearchInput2 = page.getByPlaceholder('ค้นหารหัสหรือชื่อลูกค้า...');
    await expect(custSearchInput2).toBeVisible();
    await custSearchInput2.fill('บริษัท');
    await page.waitForTimeout(600);
    await page.locator('.max-h-48 > div').first().click();

    // Add product
    const productBtn2 = page.locator('button:has(.line-clamp-2)').first();
    await expect(productBtn2).toBeVisible();
    await productBtn2.click();

    // Submit Trip 2
    await saveSODialog(page);

    // Refresh and verify both trips persist with distinct identities
    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    const unassignedCards = page.locator('.rounded-2xl', { hasText: 'ยังไม่ระบุรถ' });
    await expect(unassignedCards.first()).toBeVisible({ timeout: 15_000 });
    const count = await unassignedCards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: 'test-results/uat-02-trip1-created.png' });
  });

  test('3. Multi-bill multi-customer context in same trip & field isolation', async ({ page }) => {
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // Reload page to ensure clean active trip state
    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // Create a trip with a designated truck
    const createBtn = page.getByRole('button', { name: 'สร้างบิล' });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await expect(page.getByText('ข้อมูลการจัดส่ง (Trip)')).toBeVisible();

    const truckInput = page.getByPlaceholder('เช่น กจ70-4088 (เว้นว่างได้สำหรับ Draft Trip)');
    await truckInput.fill(truckPlateA);
    await page.getByPlaceholder('ระบุหมายเหตุสำหรับทริปนี้ (ถ้ามี)...').fill(`MultiBill ${fixtureTag}`);
    await page.getByRole('button', { name: 'ยืนยันและเริ่มจัดออร์เดอร์' }).click();

    // Now in CreateSODialog
    await expect(page.getByText('เพิ่มบิลในทริป')).toBeVisible();

    // Verify Header does NOT contain any single customer name or credit
    const dialogHeader = page.locator('.bg-\\[\\#0C447C\\] p');
    const headerText = await dialogHeader.textContent();
    expect(headerText).toContain(truckPlateA);
    expect(headerText).not.toContain('ลูกค้า:');

    // ── Bill 1 ──
    const custSearch1 = page.getByPlaceholder('ค้นหารหัสหรือชื่อลูกค้า...');
    await custSearch1.fill('บริษัท');
    await page.waitForTimeout(600);
    const custItems = page.locator('.max-h-48 > div');
    await custItems.nth(0).click();

    // Set Credit for Bill 1 to 30 days
    const creditInput = page.locator('div:has-text("เครดิต(วัน):") input[type="number"]').first();
    await creditInput.fill('30');

    // Add product to Bill 1 (use product with announced price: 12-4-26)
    const goodSearch1 = page.getByPlaceholder('ค้นหาสินค้า (ชื่อ, รหัส)...');
    await goodSearch1.fill('12-4-26');
    await page.waitForTimeout(600);
    await page.locator('button:has(.line-clamp-2)').first().click();

    // ── Bill 2 (Different Customer) ──
    const addBillBtn = page.getByRole('button', { name: 'เพิ่มบิลในรถคันนี้' });
    await expect(addBillBtn).toBeVisible();
    await addBillBtn.click();

    // Bill 2 is now active
    const custSearch2 = page.getByPlaceholder('ค้นหารหัสหรือชื่อลูกค้า...');
    await custSearch2.fill('บริษัท');
    await page.waitForTimeout(600);
    const custItems2 = page.locator('.max-h-48 > div');
    await expect(custItems2.nth(1)).toBeVisible();
    await custItems2.nth(1).click();

    // Set Credit for Bill 2 to 60 days
    await creditInput.fill('60');

    // Add product to Bill 2
    await goodSearch1.fill('12-4-26');
    await page.waitForTimeout(600);
    await page.locator('button:has(.line-clamp-2)').first().click();

    // ── Check Field Isolation between Bills ──
    // Switch to Bill 1
    await page.locator('.hidden.lg\\:flex span', { hasText: /^บิลที่ 1/ }).click();
    await expect(creditInput).toHaveValue('30');
    // Change Bill 1 credit to 15
    await creditInput.fill('15');

    // Switch back to Bill 2
    await page.locator('.hidden.lg\\:flex span', { hasText: /^บิลที่ 2/ }).click();
    // Verify Bill 2 credit is still 60 (isolated from Bill 1's edit)
    await expect(creditInput).toHaveValue('60');

    // Save the multi-bill trip
    await saveSODialog(page);

    await page.screenshot({ path: 'test-results/uat-03-multibill-saved.png' });
  });

  test('4. Selective confirmation -> Atomic residual split (-R) check', async ({ page }) => {
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // Find the multi-bill trip created with truckPlateA
    const tripCard = page.locator('.rounded-2xl', { hasText: truckPlateA }).first();
    await expect(tripCard).toBeVisible({ timeout: 15_000 });
    
    // Open TripSummaryModal
    const manageBtn = tripCard.getByRole('button', { name: 'จัดการทริป' });
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    // In TripSummaryModal:
    const modalHeader = page.locator('.fixed.inset-0.z-50 h2');
    await expect(modalHeader).toBeVisible();
    // Must show TripCode and vehicle
    expect(await modalHeader.textContent()).toContain(truckPlateA);

    // Verify Customer Count display: "2 จุดหมาย / ลูกค้า" (not a single customer name)
    await expect(page.getByText(/ลูกค้า 2 ราย|2 จุดหมาย/).first()).toBeVisible();

    // Verify button says "แก้ไขข้อมูลเที่ยวรถ"
    await expect(page.getByRole('button', { name: 'แก้ไขข้อมูลเที่ยวรถ' }).first()).toBeVisible();

    // Verify selective confirmation summary
    const billCheckboxes = page.locator('input[type="checkbox"].w-4.h-4');
    const checkboxCount = await billCheckboxes.count();
    expect(checkboxCount).toBeGreaterThanOrEqual(2);

    // Uncheck Bill 2 to confirm ONLY Bill 1
    await billCheckboxes.nth(1).uncheck();

    // Verify selected summary label
    await expect(page.getByText('ที่เลือกยืนยัน (1 บิล):')).toBeVisible();

    // Confirm partial trip:
    page.on('dialog', dialog => dialog.accept());

    const confirmBtn = page.locator('button', { hasText: 'ยืนยัน 1 บิลที่เลือก (แยกบิลตกค้าง -R)' });
    await expect(confirmBtn).toBeVisible();

    // Intercept confirm network response to get exact residualTripCode and IDs
    const [confirmResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/confirm') && res.request().method() === 'POST', { timeout: 25_000 }),
      confirmBtn.click()
    ]);
    const confirmData = await confirmResponse.json();
    const parentTripId = confirmData.tripId;
    const residualTripId = confirmData.residualTripId;
    const residualTripCode = confirmData.residualTripCode;

    expect(parentTripId).toBeDefined();
    expect(residualTripId).toBeDefined();
    expect(residualTripCode).toMatch(/-R/);

    // Dismiss in-app success alert if shown
    const okBtn = page.locator('div.fixed.z-\\[99999\\] button:has-text("ตกลง")').first();
    if (await okBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
      await okBtn.click();
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/uat-04-tripsummary-modal.png' });

    // Refresh and assert residual trip and parent trip state on UI
    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // Filter by truck plate to isolate the target fixture
    const searchInput = page.getByPlaceholder('ค้นหา ลูกค้า / WfRef...');
    await searchInput.fill(truckPlateA);
    await page.waitForTimeout(600);

    // Parent trip card: must be CONFIRMED with truckPlateA (and not residual -R)
    const parentCard = page.locator('.rounded-2xl', { hasText: truckPlateA }).filter({ hasNotText: '-R' }).first();
    await expect(parentCard).toBeVisible({ timeout: 15_000 });
    await expect(parentCard).toContainText(/ยืนยันแล้ว|รอจัดส่ง|CONFIRMED/);

    // Residual trip card: must be DRAFT with residualTripCode
    const residualCard = page.locator('.rounded-2xl', { hasText: residualTripCode }).first();
    await expect(residualCard).toBeVisible({ timeout: 15_000 });
    await expect(residualCard).toContainText(/ร่าง|DRAFT/);

    // Open residual trip card to verify Bill 2 is preserved
    await residualCard.getByRole('button', { name: 'จัดการทริป' }).click();
    const residualModalHeader = page.locator('.fixed.inset-0.z-50 h2');
    await expect(residualModalHeader).toBeVisible();
    expect(await residualModalHeader.textContent()).toContain(residualTripCode);
    await expect(page.getByText(/รวมบิล 1 ใบ/)).toBeVisible();
    // Close modal
    await page.locator('.fixed.inset-0.z-50 button:has(svg)').first().click();
  });

  test('5. Manager price approval workflow: Below-announced price -> Approval in UI -> Sales reflection', async ({ page }) => {
    // ── Phase 1: Sales creates a bill with price below announced ──
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    const createBtn = page.getByRole('button', { name: 'สร้างบิล' });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    const truckPlateApproval = `70-${Math.floor(1000 + Math.random() * 9000)}`;
    const truckInput = page.getByPlaceholder('เช่น กจ70-4088 (เว้นว่างได้สำหรับ Draft Trip)');
    await truckInput.fill(truckPlateApproval);
    await page.getByPlaceholder('ระบุหมายเหตุสำหรับทริปนี้ (ถ้ามี)...').fill(`ApprovalTest ${fixtureTag}`);
    await page.getByRole('button', { name: 'ยืนยันและเริ่มจัดออร์เดอร์' }).click();

    // Select customer
    const custSearchInput = page.getByPlaceholder('ค้นหารหัสหรือชื่อลูกค้า...');
    await custSearchInput.fill('บริษัท');
    await page.waitForTimeout(600);
    await page.locator('.max-h-48 > div').first().click();

    // Add product (with announced price: 12-4-26)
    const goodSearchApproval = page.getByPlaceholder('ค้นหาสินค้า (ชื่อ, รหัส)...');
    await goodSearchApproval.fill('12-4-26');
    await page.waitForTimeout(600);
    const productBtn = page.locator('button:has(.line-clamp-2)').first();
    await expect(productBtn).toBeVisible();
    await productBtn.click();

    // Enter a price far below announced to force approval requirement (e.g. 500 THB/ton)
    const priceInput = page.locator('span:has-text("฿/ตัน") + input').first();
    await expect(priceInput).toBeVisible();
    await priceInput.fill('500');

    // Submit with below-announced price warning and capture created fixture identity
    const [createRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/so') && res.request().method() === 'POST', { timeout: 25_000 }),
      saveSODialog(page)
    ]);
    const createData = await createRes.json();
    const targetWfRef = createData.wfRef || (createData.wfRefs && createData.wfRefs[0]);
    const targetSoId = createData.id || (createData.ids && createData.ids[0]);
    expect(createData.needsApproval).toBe(true);

    // Logout from Sales
    await logout(page);

    // ── Phase 2: Manager logs in and approves the price request in UI ──
    await login(page, MANAGER_USER, MANAGER_NAME);
    await openSidebar(page, 'คำขอแก้ไข');
    await expect(page.getByRole('heading', { name: 'คำขอแก้ไขหลังยืนยัน / Hold รถ' })).toBeVisible();

    // Switch to tab "ขออนุมัติราคาต่ำกว่าประกาศ"
    const priceTabBtn = page.getByRole('button', { name: 'ขออนุมัติราคาต่ำกว่าประกาศ' });
    await expect(priceTabBtn).toBeVisible();
    await priceTabBtn.click();
    await waitForUiIdle(page);
    await page.waitForTimeout(1000);

    // Locate SPECIFICALLY the pending price approval card matching our fixture (FAIL if not found)
    const searchTarget = targetWfRef || `SO #${targetSoId}`;
    const specificApprovalCard = page.locator('.space-y-2 > div', { hasText: searchTarget });
    await expect(specificApprovalCard).toBeVisible({ timeout: 25_000 });

    const approveBtn = specificApprovalCard.getByRole('button', { name: 'อนุมัติราคา', exact: true });
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();

    const confirmApproveBtn = specificApprovalCard.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true });
    await expect(confirmApproveBtn).toBeVisible({ timeout: 10_000 });
    await confirmApproveBtn.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/uat-05-manager-approval-screen.png' });

    // ── Phase 3: Sales logs back in and verifies the order now has APPROVED status ──
    await logout(page);
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    await page.reload();
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // Find the trip card created with truckPlateApproval
    const pendingTripCard = page.locator('.rounded-2xl', { hasText: truckPlateApproval }).first();
    await expect(pendingTripCard).toBeVisible({ timeout: 15_000 });
    await pendingTripCard.getByRole('button', { name: 'จัดการทริป' }).click();

    // Assert price approval badge is APPROVED
    await expect(page.getByText('✓ อนุมัติราคาแล้ว')).toBeVisible({ timeout: 15_000 });
  });
});
