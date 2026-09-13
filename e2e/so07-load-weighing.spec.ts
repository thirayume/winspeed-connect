import { test, expect } from '@playwright/test';
import { login, logout, openSidebar, api, waitForUiIdle } from './helpers';

const SALES_USER = 'emp-00002';
const SALES_NAME = 'เกษร  ดีบรรเจิด';
const WAREHOUSE_USER = 'emp-00047';
const WAREHOUSE_NAME = 'วัชริน ';
const MANAGER_USER = 'emp-00021';
const MANAGER_NAME = 'จักรพงษ์';

test.describe.serial('SO-06 & SO-07 Load Allocation, Vehicle Capacity & Hardened Weighing UAT', () => {
  test.setTimeout(180_000);

  const fixtureTag = `SO07_${Date.now().toString(36)}`;
  let testTripId: number;
  let testSoId: number;
  let testPlanRevision = 1;

  test('1. Verify Stock ATP & Authoritative Vehicle Capacity Resolution', async ({ page }) => {
    await login(page, SALES_USER, SALES_NAME);

    // 1.1 Test Stock ATP API endpoint: separation across warehouses and unit freshness
    const atpResult = await api<any>(page, '/stock/atp');
    expect(atpResult.status).toBe(200);
    expect(Array.isArray(atpResult.body.data)).toBeTruthy();

    if (atpResult.body.data.length > 0) {
      const firstRow = atpResult.body.data[0];
      expect(firstRow).toHaveProperty('goodCode');
      expect(firstRow).toHaveProperty('qtyOnHand');
      expect(firstRow).toHaveProperty('unit');
      expect(firstRow).toHaveProperty('freshness');
      expect(['FRESH', 'STALE', 'UNKNOWN']).toContain(firstRow.freshness);
    }

    // 1.2 Test Authoritative Vehicle Capacity resolution on trips
    // Trailer truck rated capacity is strictly 36t (18t main + 18t trailer), NOT 50t GVW
    const createTripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: {
        truck: '70-9999',
        truckTypeId: 'trailer',
        remark: `Capacity Test ${fixtureTag}`
      }
    });
    expect(createTripRes.status).toBe(200);
    testTripId = Number(createTripRes.body.tripId || createTripRes.body.id);
    expect(testTripId).toBeGreaterThan(0);

    // Verify loading plan capacity resolution
    const planRes = await api<any>(page, `/trips/${testTripId}/loading-plan`);
    expect(planRes.status).toBe(200);
    expect(planRes.body.capacityInfo).toBeDefined();
    expect(planRes.body.capacityInfo.ratedCapacityTon).toBe(36);
    expect(planRes.body.capacityInfo.maxWeightMain).toBe(18);
    expect(planRes.body.capacityInfo.maxWeightTrailer).toBe(18);
    expect(planRes.body.capacityInfo.status).toBe('VERIFIED');
  });

  test('2. Sales creates multi-bill trip and executes transactional Load Plan command', async ({ page }) => {
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // Create a draft SO linked to our test trip
    const createSoRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1001',
        custName: `ลูกค้าทดสอบ ${fixtureTag}`,
        tripId: testTripId,
        truckPlate: '70-9999',
        lines: [
          {
            goodId: '1002',
            goodCode: '1-0000600100CAR',
            goodName: 'กระสอบ 0-0-60 ผง รถเกษตร',
            qtyTon: 20.000,
            qtyBag: 400,
            pricePerTon: 16000
          },
          {
            goodId: '1003',
            goodCode: '1-0000600200CAR',
            goodName: 'กระสอบ 0-0-60 เม็ด ตรารถเกษตร',
            qtyTon: 16.000,
            qtyBag: 320,
            pricePerTon: 15000
          }
        ]
      },
      expectedStatuses: [200, 201]
    });
    testSoId = Number(createSoRes.body.id);
    expect(testSoId).toBeGreaterThan(0);

    // Test rejection of overallocation (e.g. 15 + 10 = 25 != 20)
    const badAllocRes = await api<any>(page, `/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: testPlanRevision,
        lines: [
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 15,
            childQty: 10
          }
        ]
      },
      expectedStatuses: [400]
    });
    expect(badAllocRes.body.message).toContain('ไม่เท่ากับยอดในบิล');

    // Test rejection of negative quantities
    const negAllocRes = await api<any>(page, `/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: testPlanRevision,
        lines: [
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 1,
            loadSequence: 1,
            masterQty: -5,
            childQty: 25
          }
        ]
      },
      expectedStatuses: [400]
    });
    expect(negAllocRes.body.message).toContain('ต้องไม่ติดลบ');

    // Execute valid transactional command with typed line IDs and mother-trailer split
    const validPlanRes = await api<any>(page, `/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: testPlanRevision,
        lines: [
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 10.000,
            childQty: 10.000
          },
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 2,
            loadSequence: 2,
            masterQty: 8.000,
            childQty: 8.000
          }
        ],
        reason: 'จัดแบ่งขึ้นรถแม่และลูกพ่วงอย่างละเท่าๆ กัน'
      },
      expectedStatuses: [200]
    });
    expect(validPlanRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');
    testPlanRevision = validPlanRes.body.loadPlanRevision;
    expect(testPlanRevision).toBe(2);
  });

  test('3. Warehouse reviews and acknowledges load plan; Subsequent Sales edit invalidates Ack', async ({ page }) => {
    // 3.1 Warehouse user logs in and acknowledges load plan
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);
    
    const ackRes = await api<any>(page, `/trips/${testTripId}/load-plan/ack`, {
      method: 'POST',
      data: { expectedPlanRevision: testPlanRevision },
      expectedStatuses: [200]
    });
    expect(ackRes.body.loadPlanStatus).toBe('WAREHOUSE_ACK');
    expect(ackRes.body.warehouseAckAt).toBeDefined();

    // 3.2 Sales logs back in and edits the load plan -> Ack must be automatically invalidated
    await logout(page);
    await login(page, SALES_USER, SALES_NAME);

    const reEditRes = await api<any>(page, `/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: testPlanRevision,
        lines: [
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 12.000,
            childQty: 8.000
          },
          {
            memberKind: 'DRAFT',
            memberId: String(testSoId),
            lineNum: 2,
            loadSequence: 2,
            masterQty: 6.000,
            childQty: 10.000
          }
        ]
      },
      expectedStatuses: [200]
    });
    expect(reEditRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');
    testPlanRevision = reEditRes.body.loadPlanRevision;
    expect(testPlanRevision).toBe(3);

    // Verify trip loading plan state reflects invalidated acknowledgement
    const planCheck = await api<any>(page, `/trips/${testTripId}/loading-plan`);
    expect(planCheck.body.trip.loadPlanStatus).toBe('SALE_CONFIRMED');
    expect(planCheck.body.trip.warehouseAckAt).toBeNull();
  });

  test('4. Hardened Weighing & Shipping Gate: RBAC, missing scale event, and managerial override validation', async ({ page }) => {
    // 4.0 Manager approves discount if pending (SO-05 price gate)
    await login(page, MANAGER_USER, MANAGER_NAME);
    const aprList = await api<any>(page, `/edit-requests/price-approvals?soId=${testSoId}`);
    const pendingList = (aprList.body?.data || []).filter((a: any) => Number(a.soId) === testSoId && a.status === 'PENDING');
    for (const apr of pendingList) {
      await api<any>(page, `/edit-requests/price-approvals/${apr.id}/approve`, {
        method: 'PATCH',
        data: { note: 'Manager approved discount for test trip' },
        expectedStatuses: [200]
      });
    }

    // 4.1 Sales logs in to confirm the trip
    await logout(page);
    await login(page, SALES_USER, SALES_NAME);

    const pickupDate = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];
    await api<any>(page, `/trips/${testTripId}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [testSoId],
        transRegistration: '70-9999',
        pickupDueDate: pickupDate
      },
      expectedStatuses: [200]
    });

    // Retrieve active SOID after conversion to native WINSpeed SO
    const planAfterConfirm = await api<any>(page, `/trips/${testTripId}/loading-plan`);
    const confirmedMember = (planAfterConfirm.body?.plan || []).find((m: any) => m.memberKind === 'CONFIRMED');
    const activeSoId = confirmedMember ? confirmedMember.memberId : testSoId;

    // 4.2 Warehouse logs in to pick and load the goods
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);

    // Advance order from CONFIRMED to PICKING
    await api<any>(page, `/so/${activeSoId}/picking`, {
      method: 'PATCH',
      expectedStatuses: [200]
    });

    // Advance order from PICKING to LOADED
    await api<any>(page, `/so/${activeSoId}/load`, {
      method: 'PATCH',
      expectedStatuses: [200]
    });

    // Attempt 1: Ship with unacknowledged plan (currently SALE_CONFIRMED, not WAREHOUSE_ACK) -> Blocked
    const unackShipRes = await api<any>(page, `/so/${activeSoId}/ship`, {
      method: 'PATCH',
      data: { weighOutWeight: 36000, tareKg: 14000 },
      expectedStatuses: [400]
    });
    expect(unackShipRes.body.message).toContain('ยังไม่ได้รับการยืนยันจากฝ่ายคลัง');

    // Acknowledge revision 3 as Warehouse
    await api<any>(page, `/trips/${testTripId}/load-plan/ack`, {
      method: 'POST',
      data: { expectedPlanRevision: testPlanRevision },
      expectedStatuses: [200]
    });

    // Attempt 2: Warehouse user attempts ship without actual scale event and without override -> Blocked
    const noEventRes = await api<any>(page, `/so/${activeSoId}/ship`, {
      method: 'PATCH',
      data: { weighOutWeight: 36000, tareKg: 14000 },
      expectedStatuses: [400]
    });
    expect(noEventRes.body.message).toContain('ไม่พบประวัติการชั่งจริงจากเครื่องชั่ง');

    // Attempt 3: Non-manager user attempts to execute manual override -> 403 Forbidden
    const unauthOverrideRes = await api<any>(page, `/so/${activeSoId}/ship`, {
      method: 'PATCH',
      data: {
        weighOutWeight: 36000,
        tareKg: 14000,
        isManualOverride: true,
        overrideReason: 'เครื่องชั่งเสีย ชั่งด้วยมือ',
        evidencePhotoUrl: 'https://img.test/manual.jpg'
      },
      expectedStatuses: [403]
    });
    expect(unauthOverrideRes.body.message).toContain('MANAGER');

    // Attempt 4: Manager logs in and executes authorized override with photo evidence and >=10 char reason
    await logout(page);
    await login(page, MANAGER_USER, MANAGER_NAME);

    const authOverrideRes = await api<any>(page, `/so/${activeSoId}/ship`, {
      method: 'PATCH',
      data: {
        weighOutWeight: 36000,
        tareKg: 14000,
        isManualOverride: true,
        overrideReason: 'แท่นชั่งหลักอยู่ระหว่างปรับเทียบประจำปี ชั่งด้วยแท่นสำรองโรง 3',
        evidencePhotoUrl: 'https://img.test/scale_calibration_ticket.jpg',
        overrideApprovedBy: 9999 // Client tries to spoof approver ID
      },
      expectedStatuses: [200]
    });
    expect(authOverrideRes.status).toBe(200);

    // Verify order is now SHIPPED
    const finalSoRes = await api<any>(page, `/so/${activeSoId}`);
    expect(finalSoRes.body.status || finalSoRes.body.Status).toBe('SHIPPED');
  });
});
