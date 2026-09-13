import { test, expect, type Page } from '@playwright/test';
import { login, logout, openSidebar, api, waitForUiIdle } from './helpers';

const SALES_USER = 'emp-00002';
const SALES_NAME = 'เกษร  ดีบรรเจิด';
const WAREHOUSE_USER = 'emp-00047';
const WAREHOUSE_NAME = 'วัชริน ';
const MANAGER_USER = 'emp-00021';
const MANAGER_NAME = 'จักรพงษ์';

test.describe.serial('SO-06 & SO-07 Hostinger Test Real Browser UAT', () => {
  test.setTimeout(180_000);

  const fixtureTag = `UAT_${Date.now().toString(36)}`;
  const truckPlate = `70-${String(Date.now()).slice(-4)}`;
  let testTripId: number;
  let testTripCode: string;
  let testSoId: number;
  let testActiveSoId: number;

  test('1. Environment Health and Sales Portal Trip & Load Plan Setup', async ({ page, request }) => {
    // 1.1 Verify Hostinger Test API Health & DB Connection
    const healthRes = await request.get('https://api-test.thirayu.online/api/health');
    expect(healthRes.ok()).toBeTruthy();
    const health = await healthRes.json();
    expect(health.version).toBe('2.0.0');
    expect(health.db.sqlserver).toBe('up');

    // 1.2 Sales logs in via real UI on Hostinger Test
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // 1.3 Create Trip with trailer vehicle resolving authoritative 36t limit (18t main + 18t trailer)
    const tripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: {
        transRegistration: truckPlate,
        truck: truckPlate,
        truckTypeId: 'trailer',
        remark: `UAT SO-07 Hostinger ${fixtureTag}`
      }
    });
    expect(tripRes.status).toBe(200);
    testTripId = Number(tripRes.body.tripId || tripRes.body.id);
    testTripCode = tripRes.body.tripCode || `TRIP-${testTripId}`;
    expect(testTripId).toBeGreaterThan(0);

    // 1.4 Create Sales Order with 2 goods lines in this trip
    const soRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1001',
        custName: `ลูกค้าทดสอบ UAT ${fixtureTag}`,
        tripId: testTripId,
        truckPlate: truckPlate,
        lines: [
          {
            goodId: '1002',
            goodCode: '1-0000600100CAR',
            goodName: 'กระสอบ 0-0-60 ผง รถเกษตร',
            qtyTon: 18.000,
            qtyBag: 360,
            pricePerTon: 16000
          },
          {
            goodId: '1003',
            goodCode: '1-0000600200CAR',
            goodName: 'กระสอบ 0-0-60 เม็ด ตรารถเกษตร',
            qtyTon: 18.000,
            qtyBag: 360,
            pricePerTon: 15000
          }
        ]
      },
      expectedStatuses: [200, 201]
    });
    testSoId = Number(soRes.body.id);
    expect(testSoId).toBeGreaterThan(0);

    // 1.5 Execute transactional load plan command: allocating 18t to Mother and 18t to Trailer
    const planRes = await api<any>(page, `/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 1,
        lines: [
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 18.000,
            childQty: 0.000
          },
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 2,
            loadSequence: 2,
            masterQty: 0.000,
            childQty: 18.000
          }
        ],
        reason: 'จัดสินค้าตัวแรกขึ้นแม่ 18 ตัน และตัวที่สองขึ้นลูก 18 ตัน'
      },
      expectedStatuses: [200]
    });
    expect(planRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');
    expect(planRes.body.loadPlanRevision).toBe(2);

    await page.screenshot({ path: 'test-results/so07-01-sales-loadplan.png' });
  });

  test('2. Warehouse Reviews Load Plan in UI and Clicks Real Acknowledgement Button', async ({ page }) => {
    // 2.1 Warehouse logs in
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);

    // 2.2 Navigate to "ขาย" (Sales Portal) via Sidebar
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    // 2.3 Wait for search input, fill unique truckPlate and filter
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await searchInput.fill(truckPlate);
    await page.waitForTimeout(1000);
    await waitForUiIdle(page);

    // 2.4 Find and click "จัดการทริป" to open TripSummaryModal
    const manageTripBtn = page.locator(`div:has-text("${truckPlate}")`).locator('button:has-text("จัดการทริป")').first();
    await expect(manageTripBtn).toBeVisible({ timeout: 15_000 });
    await manageTripBtn.click();
    await page.waitForTimeout(1000);

    // 2.5 Verify Load Plan Card is displayed with mother/trailer details
    const loadPlanHeader = page.locator('h3:has-text("แผนการจัดของขึ้นรถ & การรับทราบของฝ่ายคลัง")');
    await expect(loadPlanHeader).toBeVisible({ timeout: 10_000 });

    // Verify Mother & Trailer columns are rendered
    await expect(page.locator('th:has-text("ตัวแม่ (ตัน)")')).toBeVisible();
    await expect(page.locator('th:has-text("ตัวลูก (ตัน)")')).toBeVisible();

    // Verify Real Warehouse Acknowledgement button is visible
    const ackButton = page.locator('[data-testid="btn-warehouse-ack-loadplan"]');
    await expect(ackButton).toBeVisible({ timeout: 5000 });
    await expect(ackButton).toContainText('คลังรับทราบแผนจัดของ (Revision 2)');

    // 2.6 Click the REAL button to acknowledge load plan
    await ackButton.click();
    await page.waitForTimeout(1000);

    // 2.7 Verify status updates to WAREHOUSE_ACK in the UI
    const ackStatusBadge = page.locator('text=คลังรับทราบแผนแล้ว');
    await expect(ackStatusBadge).toBeVisible({ timeout: 10_000 });

    // Verify acknowledgement timestamp text is displayed
    await expect(page.locator('text=คลังรับทราบล่าสุดเมื่อ:')).toBeVisible();

    await page.screenshot({ path: 'test-results/so07-02-warehouse-ack.png' });
  });

  test('3. Sales Re-edits Plan; Warehouse sees Real Alert Banner and Re-acknowledges', async ({ page }) => {
    // 3.1 Sales logs back in and re-edits load plan (Revision becomes 3)
    await login(page, SALES_USER, SALES_NAME);

    const reEditRes = await api<any>(page, `/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 2,
        lines: [
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 10.000,
            childQty: 8.000
          },
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 2,
            loadSequence: 2,
            masterQty: 8.000,
            childQty: 10.000
          }
        ],
        reason: 'ปรับสมดุลน้ำหนักแม่/ลูกใหม่'
      },
      expectedStatuses: [200]
    });
    expect(reEditRes.body.loadPlanRevision).toBe(3);
    expect(reEditRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');

    // 3.2 Warehouse logs in to inspect the trip
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await searchInput.fill(truckPlate);
    await page.waitForTimeout(1000);
    await waitForUiIdle(page);

    const manageTripBtn = page.locator(`div:has-text("${truckPlate}")`).locator('button:has-text("จัดการทริป")').first();
    await expect(manageTripBtn).toBeVisible({ timeout: 15_000 });
    await manageTripBtn.click();
    await page.waitForTimeout(1000);

    // 3.3 Verify the re-acknowledgement alert banner is visible in the UI
    const reAckAlert = page.locator('text=แผนจัดของถูกแก้ไขโดยฝ่ายขาย — ต้องให้ฝ่ายคลังรับทราบใหม่ (Revision 3)');
    await expect(reAckAlert).toBeVisible({ timeout: 10_000 });

    // 3.4 Verify the real button now prompts for Revision 3 and click it
    const reAckButton = page.locator('[data-testid="btn-warehouse-ack-loadplan"]');
    await expect(reAckButton).toBeVisible({ timeout: 5000 });
    await expect(reAckButton).toContainText('คลังรับทราบแผนจัดของ (Revision 3)');

    await page.screenshot({ path: 'test-results/so07-03-warehouse-reack-alert.png' });

    // Click real button on screen to re-acknowledge
    await reAckButton.click();
    await page.waitForTimeout(1000);

    // Verify alert is cleared and status is WAREHOUSE_ACK
    await expect(reAckAlert).toBeHidden({ timeout: 5000 });
    await expect(page.locator('text=คลังรับทราบแผนแล้ว')).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/so07-03-warehouse-reack-confirmed.png' });
  });

  test('4. Confirm Trip, Picking, Loading, and Authoritative Shipping Gate', async ({ page }) => {
    // 4.1 Manager approves price discount if needed
    await login(page, MANAGER_USER, MANAGER_NAME);
    const aprList = await api<any>(page, `/edit-requests/price-approvals?soId=${testSoId}`);
    const pendingList = (aprList.body?.data || []).filter((a: any) => Number(a.soId) === testSoId && a.status === 'PENDING');
    for (const apr of pendingList) {
      await api<any>(page, `/edit-requests/price-approvals/${apr.id}/approve`, {
        method: 'PATCH',
        data: { note: 'Approved for Hostinger browser UAT' },
        expectedStatuses: [200]
      });
    }

    // 4.2 Sales confirms the trip
    await logout(page);
    await login(page, SALES_USER, SALES_NAME);
    const pickupDate = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];
    await api<any>(page, `/trips/${testTripId}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [testSoId],
        transRegistration: truckPlate,
        pickupDueDate: pickupDate
      },
      expectedStatuses: [200]
    });

    // Determine active SOID after confirmation
    const planAfterConfirm = await api<any>(page, `/trips/${testTripId}/loading-plan`);
    const confirmedMember = (planAfterConfirm.body?.plan || []).find((m: any) => m.memberKind === 'CONFIRMED');
    testActiveSoId = confirmedMember ? Number(confirmedMember.memberId) : testSoId;

    // 4.3 Warehouse marks PICKING and LOADED
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);
    await api<any>(page, `/so/${testActiveSoId}/picking`, { method: 'PATCH', expectedStatuses: [200] });
    await api<any>(page, `/so/${testActiveSoId}/load`, { method: 'PATCH', expectedStatuses: [200] });

    // 4.4 Attempt shipping as Warehouse without scale event -> Verify 400 Bad Request
    const noEventRes = await api<any>(page, `/so/${testActiveSoId}/ship`, {
      method: 'PATCH',
      data: { weighOutWeight: 36000, tareKg: 14000 },
      expectedStatuses: [400]
    });
    expect(noEventRes.body.message).toContain('ไม่พบประวัติการชั่งจริงจากเครื่องชั่ง');

    // 4.5 Manager executes authorized exception via REAL UI button clicks with photo & >=10 char reason
    await logout(page);
    await login(page, MANAGER_USER, MANAGER_NAME);

    // Navigate to 'ขาย' (Sales Portal) and open TripSummaryModal for this trip
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await searchInput.fill(truckPlate);
    await page.waitForTimeout(1000);
    await waitForUiIdle(page);

    const manageTripBtn = page.locator(`div:has-text("${truckPlate}")`).locator('button:has-text("จัดการทริป")').first();
    await expect(manageTripBtn).toBeVisible({ timeout: 15_000 });
    await manageTripBtn.click();
    await page.waitForTimeout(1000);

    // Click genuine button to open QuickShipModal
    const tripShipBtn = page.locator('[data-testid="btn-trip-ship"]');
    await expect(tripShipBtn).toBeVisible({ timeout: 10_000 });
    await tripShipBtn.click();
    await page.waitForTimeout(1000);

    // Fill weights in QuickShipModal (gross 50,000 kg, tare 14,000 kg -> net 36,000 kg = 36 tonnes)
    const inputGross = page.locator('[data-testid="input-ship-gross"]');
    await expect(inputGross).toBeVisible({ timeout: 10_000 });
    await inputGross.fill('50000');

    const inputTare = page.locator('[data-testid="input-ship-tare"]');
    await inputTare.fill('14000');

    // Toggle managerial override checkbox
    const checkOverride = page.locator('[data-testid="checkbox-manual-override"]');
    await expect(checkOverride).toBeVisible({ timeout: 5000 });
    await checkOverride.check();

    // Fill override reason (minimum 10 chars) and photo evidence URL
    const inputReason = page.locator('[data-testid="input-override-reason"]');
    await expect(inputReason).toBeVisible({ timeout: 5000 });
    await inputReason.fill('เครื่องชั่งโรง 1 อยู่ระหว่างตรวจเช็คประจำปี ใช้แท่นชั่งสะพานกลาง');

    const inputPhoto = page.locator('[data-testid="input-override-photo"]');
    await expect(inputPhoto).toBeVisible({ timeout: 5000 });
    await inputPhoto.fill('https://img.thirayu.online/scale_ticket_uat.jpg');

    // Click REAL submit button to complete shipping
    const confirmShipBtn = page.locator('[data-testid="btn-confirm-ship"]');
    await expect(confirmShipBtn).toBeEnabled({ timeout: 5000 });
    await confirmShipBtn.click();

    // Verify modal closes and shipment completes
    await expect(inputGross).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    // 4.6 Verify order is SHIPPED in database and UI after full page reload
    await page.reload();
    await waitForUiIdle(page);

    const verifyRes = await api<any>(page, `/so/${testActiveSoId}`);
    expect(verifyRes.body.status).toBe('SHIPPED');

    await page.screenshot({ path: 'test-results/so07-04-shipping-complete.png' });
  });
});
