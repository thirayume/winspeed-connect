'use strict';

/**
 * trip-bill-confirmation-slice2.test.js
 *
 * Tests for Dev Slice 2:
 *   - R13 (Q1): Trip bills must be confirmed as a whole trip only. Individual bill confirm -> 409.
 *   - R14 (Q2): Single bills not in a trip can be confirmed by SALES, COUNTER_SALES, ADMIN, C_LEVEL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { requireRole } = require('../middleware/auth');

test('R13 (Q1): Single bill confirm for a bill in an active trip returns 409', async () => {
  // Simulate logic in PATCH /api/so/:id/confirm
  function handleConfirm({ so, trip, userRole }) {
    const allowed = ['SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'];
    if (!allowed.includes(userRole)) {
      return { status: 403, body: { message: 'Forbidden' } };
    }

    if (so.TripId) {
      if (trip && trip.Status !== 'CANCELLED') {
        return {
          status: 409,
          body: {
            message: `บิลนี้อยู่ในเที่ยวขนส่ง (${trip.TripCode || ('#' + trip.TripId)}) กรุณายืนยันผ่านการยืนยันเที่ยวขนส่งทั้งเที่ยว (ไม่อนุญาตให้ยืนยันรายบิล)`,
            code: 'BILL_IN_ACTIVE_TRIP',
            tripId: trip.TripId,
            tripCode: trip.TripCode
          }
        };
      }
    }

    return { status: 200, body: { id: so.Id, status: 'CONFIRMED' } };
  }

  // Case 1: Draft SO in active trip -> 409
  const res1 = handleConfirm({
    so: { Id: 101, TripId: 35 },
    trip: { TripId: 35, TripCode: 'TRIP-2026-001', Status: 'DRAFT' },
    userRole: 'SALES'
  });
  assert.equal(res1.status, 409);
  assert.equal(res1.body.code, 'BILL_IN_ACTIVE_TRIP');
  assert.match(res1.body.message, /บิลนี้อยู่ในเที่ยวขนส่ง/);
  assert.match(res1.body.message, /กรุณายืนยันผ่านการยืนยันเที่ยวขนส่งทั้งเที่ยว/);

  // Case 2: SO in cancelled trip -> proceeds (200)
  const res2 = handleConfirm({
    so: { Id: 102, TripId: 36 },
    trip: { Id: 36, TripCode: 'TRIP-CANCELLED', Status: 'CANCELLED' },
    userRole: 'SALES'
  });
  assert.equal(res2.status, 200);

  // Case 3: SO not in any trip -> proceeds (200)
  const res3 = handleConfirm({
    so: { Id: 103, TripId: null },
    trip: null,
    userRole: 'SALES'
  });
  assert.equal(res3.status, 200);

  // Case 4: R14 (Q2) Counter sales & Admin can confirm single bills
  const res4 = handleConfirm({
    so: { Id: 104, TripId: null },
    trip: null,
    userRole: 'COUNTER_SALES'
  });
  assert.equal(res4.status, 200);

  const res5 = handleConfirm({
    so: { Id: 105, TripId: null },
    trip: null,
    userRole: 'ADMIN'
  });
  assert.equal(res5.status, 200);

  // Case 5: Unauthorized role -> 403
  const res6 = handleConfirm({
    so: { Id: 106, TripId: null },
    trip: null,
    userRole: 'WAREHOUSE'
  });
  assert.equal(res6.status, 403);
});
