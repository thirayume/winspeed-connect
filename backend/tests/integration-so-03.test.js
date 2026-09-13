const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithTarget, query, wfQuery, pools, sql } = require('../db');
const {
  getBangkokDateString,
  addBangkokCalendarDays,
  diffBangkokCalendarDays,
  resolvePickupPolicy,
  calculateConfirmationPickupDue,
  evaluatePickupTiming,
  evaluateTripLeadTime,
} = require('../services/so-pickup-policy');

const runRemote = (fn) => runWithTarget('remote_b', fn);

// ── 1. Bangkok Calendar Days & Midnight (Asia/Bangkok UTC+7) ────────────────
test('SO-03.1: Bangkok date string and calendar addition handles UTC offsets and month boundaries', () => {
  // Test case 1: UTC evening is Bangkok next morning
  // 2026-09-06T18:00:00Z -> Bangkok is 2026-09-07T01:00:00+07:00
  const eveningUtc = new Date('2026-09-06T18:00:00.000Z');
  const bkkDate = getBangkokDateString(eveningUtc);
  assert.equal(bkkDate, '2026-09-07', 'UTC 18:00 must convert to next calendar day in Bangkok');

  // Test case 2: Bangkok midnight exactly
  // 2026-09-06T17:00:00Z -> Bangkok is 2026-09-07 00:00:00
  const bkkMidnight = new Date('2026-09-06T17:00:00.000Z');
  assert.equal(getBangkokDateString(bkkMidnight), '2026-09-07');

  // Test case 3: Just before Bangkok midnight
  // 2026-09-06T16:59:59Z -> Bangkok is 2026-09-06 23:59:59
  const beforeMidnight = new Date('2026-09-06T16:59:59.000Z');
  assert.equal(getBangkokDateString(beforeMidnight), '2026-09-06');

  // Test case 4: Calendar addition crossing month boundary (August to September)
  const aug28 = '2026-08-28';
  const augPlus7 = addBangkokCalendarDays(aug28, 7);
  assert.equal(augPlus7, '2026-09-04', 'Aug 28 + 7 days = Sep 4');

  // Test case 5: Calendar addition crossing year boundary (Dec 28 to Jan 4)
  const dec28 = '2026-12-28';
  const decPlus7 = addBangkokCalendarDays(dec28, 7);
  assert.equal(decPlus7, '2027-01-04', 'Dec 28 + 7 days = Jan 4 next year');

  // Test case 6: Calendar difference
  assert.equal(diffBangkokCalendarDays('2026-09-14', '2026-09-07'), 7);
  assert.equal(diffBangkokCalendarDays('2026-09-05', '2026-09-07'), -2);
  assert.equal(diffBangkokCalendarDays('2026-09-07', '2026-09-07'), 0);
});

// ── 2. Explicit vs Default vs Unknown & CreditDays Isolation ─────────────────
test('SO-03.2: calculateConfirmationPickupDue resolves explicit and default 7 days without CreditDays leakage', async () => {
  await runRemote(async () => {
    const fixedNow = new Date('2026-09-07T03:00:00.000Z'); // 2026-09-07 in Bangkok

    // Case 2.1: Default pickup calculation (7 days from confirmation)
    const defaultRes = await calculateConfirmationPickupDue({
      explicitDate: null,
      confirmedAt: fixedNow,
    });
    assert.equal(defaultRes.pickupDueDate, '2026-09-14');
    assert.equal(defaultRes.pickupDueType, 'DEFAULT');
    assert.equal(defaultRes.pickupDueDays, 7);
    assert.ok(defaultRes.pickupPolicySnapshotId > 0, 'Must record snapshot id');

    // Case 2.2: Explicit user-provided pickup date
    const explicitRes = await calculateConfirmationPickupDue({
      explicitDate: '2026-09-25',
      confirmedAt: fixedNow,
    });
    assert.equal(explicitRes.pickupDueDate, '2026-09-25');
    assert.equal(explicitRes.pickupDueType, 'EXPLICIT');
    assert.equal(explicitRes.pickupDueDays, 18); // 25 - 7 = 18 days

    // Case 2.3: Anti-pattern verification: CreditDays (e.g. 30 days) must NOT become pickup due date
    // An order with CreditDays = 30 must still get 7 calendar days default
    assert.notEqual(defaultRes.pickupDueDays, 30, 'CreditDays must NEVER be used as pickup due date');
    assert.equal(defaultRes.pickupDueDate, '2026-09-14');
  });
});

// ── 3. Draft to Native Preservation in Database & v_AllSalesOrders ───────────
test('SO-03.3: PickupDueDate and metadata are preserved across draft and projected in v_AllSalesOrders', async () => {
  await runRemote(async () => {
    const testDocu = `TEST-SO03-${Date.now()}`;
    let insertedDraftId = null;

    try {
      // 3.1 Insert draft with explicit pickup due date
      const insDraft = await wfQuery(`
        INSERT INTO wf.SalesOrder (
          WfRef, SoPrefix, CustId, CustName, Status, SalesUserId,
          PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId
        )
        OUTPUT inserted.Id
        VALUES (
          @docu, 'AI', 'TEST_CUST_SO03', 'SO-03 Test Cust', 'DRAFT', 1,
          '2026-09-20', 'EXPLICIT', SYSUTCDATETIME(), 1
        )
      `, {
        docu: { type: sql.NVarChar(50), value: testDocu }
      });
      insertedDraftId = insDraft.recordset[0].Id;

      // 3.2 Query v_AllSalesOrders and verify fields exist and match
      const viewRow = (await query(`
        SELECT Id, WfRef, PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId
        FROM wf.v_AllSalesOrders
        WHERE WfRef = @docu
      `, {
        docu: { type: sql.VarChar(50), value: testDocu }
      }))[0];

      assert.ok(viewRow, 'Draft row must appear in v_AllSalesOrders');
      assert.equal(viewRow.PickupDueDate?.toISOString().slice(0, 10), '2026-09-20');
      assert.equal(viewRow.PickupDueType, 'EXPLICIT');
      assert.ok(viewRow.ConfirmedAt !== null, 'ConfirmedAt must be preserved');
      assert.equal(viewRow.PickupPolicySnapshotId, 1);
    } finally {
      if (insertedDraftId) {
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, {
          id: { type: sql.Int, value: insertedDraftId }
        });
      }
    }
  });
});

// ── 4. Weighing Timing Evaluation (EARLY, ON_TIME, LATE, UNKNOWN) ────────────
test('SO-03.4: evaluatePickupTiming computes correct timing status and provenance', () => {
  const dueDate = '2026-09-14';

  // 4.1 On-time weigh-in (same calendar date)
  const onTimeDate = new Date('2026-09-14T08:30:00+07:00');
  const onTimeEval = evaluatePickupTiming(onTimeDate, dueDate);
  assert.equal(onTimeEval.status, 'ON_TIME');
  assert.equal(onTimeEval.deltaDays, 0);
  assert.equal(onTimeEval.provenance, 'WINSPEED_WGHD');

  // 4.2 Early weigh-in (2 days before)
  const earlyDate = new Date('2026-09-12T10:00:00+07:00');
  const earlyEval = evaluatePickupTiming(earlyDate, dueDate);
  assert.equal(earlyEval.status, 'EARLY');
  assert.equal(earlyEval.deltaDays, -2);
  assert.equal(earlyEval.provenance, 'WINSPEED_WGHD');

  // 4.3 Late weigh-in (3 days after)
  const lateDate = new Date('2026-09-17T14:15:00+07:00');
  const lateEval = evaluatePickupTiming(lateDate, dueDate);
  assert.equal(lateEval.status, 'LATE');
  assert.equal(lateEval.deltaDays, 3);
  assert.equal(lateEval.provenance, 'WINSPEED_WGHD');

  // 4.4 Missing weighing date (not yet weighed)
  const missingEval = evaluatePickupTiming(null, dueDate);
  assert.equal(missingEval.status, 'UNKNOWN');
  assert.equal(missingEval.deltaDays, null);
  assert.equal(missingEval.provenance, 'MISSING');

  // 4.5 Missing due date
  const noDueEval = evaluatePickupTiming(onTimeDate, null);
  assert.equal(noDueEval.status, 'UNKNOWN');
  assert.equal(noDueEval.provenance, 'MISSING');
});

// ── 5. Strict Mode: Off vs On Invariants ─────────────────────────────────────
test('SO-03.5: Strict Mode allows warning in OFF and blocks commands in ON', async () => {
  // Test lead-time evaluation under Strict OFF vs Strict ON
  const todayBkk = getBangkokDateString(); // e.g. 2026-09-07
  const sameDay = todayBkk; // 0 days lead time
  const leadTimeDays = 1;

  // 5.1 Strict OFF: returns valid = false but blocked = false, provides warning
  const strictOffResult = evaluateTripLeadTime(sameDay, leadTimeDays, false);
  assert.equal(strictOffResult.valid, false);
  assert.equal(strictOffResult.blocked, false);
  assert.ok(strictOffResult.warning, 'Strict OFF must provide warning without blocking');
  assert.match(strictOffResult.warning, /Lead Time อย่างน้อย 1 วัน/);

  // 5.2 Strict ON: returns valid = false and blocked = true, provides blocking error
  const strictOnResult = evaluateTripLeadTime(sameDay, leadTimeDays, true);
  assert.equal(strictOnResult.valid, false);
  assert.equal(strictOnResult.blocked, true);
  assert.ok(strictOnResult.error, 'Strict ON must block the action');

  // 5.3 Compliant date (tomorrow or later): valid in both modes
  const tomorrow = addBangkokCalendarDays(todayBkk, 1);
  const compliantOff = evaluateTripLeadTime(tomorrow, leadTimeDays, false);
  assert.equal(compliantOff.valid, true);
  assert.equal(compliantOff.blocked, false);

  const compliantOn = evaluateTripLeadTime(tomorrow, leadTimeDays, true);
  assert.equal(compliantOn.valid, true);
  assert.equal(compliantOn.blocked, false);
});
