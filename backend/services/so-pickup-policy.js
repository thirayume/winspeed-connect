/**
 * so-pickup-policy.js — Pickup Due Date Policy, Weighing Timing Evaluator & Lead Time Rules (SO-03 / C1-C4)
 *
 * Rules:
 *  - Bangkok calendar days (Asia/Bangkok, UTC+7) without DST.
 *  - Default 7 calendar days from SO confirmation timestamp.
 *  - Types: EXPLICIT (user provided), DEFAULT (policy based), UNKNOWN (unresolved).
 *  - Strict Date Validation: rejects non-existent dates like '2026-02-30'.
 *  - Normalized Date Contracts: handles SQL DATE, Date objects, UTC timestamps, and WINSpeed local time without double-offsetting.
 *  - Timing Evaluation: EARLY (delta < 0), ON_TIME (delta == 0), LATE (delta > 0), UNKNOWN (missing fact).
 *  - Coherent Snapshot: reads policy values directly from the effective SnapshotJson of that SnapshotId.
 *  - Strict Mode: OFF (warn & audit), ON (block command in app authority).
 *  - Lead-time Evaluator: default 1 day for trip scheduling.
 *  - NEVER substitute CreditDays for PickupDueDate!
 */

const { getEffectivePolicySnapshot } = require('./policy-contract');

const BANGKOK_TIMEZONE = 'Asia/Bangkok';
const BANGKOK_OFFSET_HOURS = 7;

/**
 * Validate strictly that a string is a valid Gregorian calendar date (YYYY-MM-DD).
 * Rejects invalid dates like '2026-02-30', '2026-04-31', '2026-13-01'.
 */
function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}

/**
 * Normalize an input (string, Date, SQL date, timestamp) to a canonical YYYY-MM-DD Bangkok calendar date.
 * Options:
 *  - isWallClock: true if the value is from WINSpeed / local SQL (no timezone offset adjustment)
 */
function normalizeDateString(val, { isWallClock = false } = {}) {
  if (!val) return null;

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return isValidDateString(trimmed) ? trimmed : null;
    }
    // If it is an ISO string or formatted string
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    val = d;
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;

    // If it's a WINSpeed SQL DATETIME (local wall-clock already) or SQL DATE (midnight UTC):
    if (isWallClock || val.toISOString().slice(11, 19) === '00:00:00') {
      const isoDate = val.toISOString().slice(0, 10);
      return isValidDateString(isoDate) ? isoDate : null;
    }

    // Otherwise it's a true UTC instant (e.g. confirmation timestamp, Date.now()):
    // Convert to Bangkok time (UTC+7)
    const bkk = new Date(val.getTime() + BANGKOK_OFFSET_HOURS * 60 * 60 * 1000);
    const isoDate = bkk.toISOString().slice(0, 10);
    return isValidDateString(isoDate) ? isoDate : null;
  }

  return null;
}

/**
 * Get Bangkok calendar date string (YYYY-MM-DD) from UTC date.
 */
function getBangkokDateString(date = new Date()) {
  return normalizeDateString(date, { isWallClock: false });
}

/**
 * Add N calendar days to a Bangkok date string (YYYY-MM-DD).
 */
function addBangkokCalendarDays(bkkDateStr, days) {
  const norm = normalizeDateString(bkkDateStr, { isWallClock: true });
  if (!norm || !isValidDateString(norm)) return null;

  const numDays = Number(days);
  if (!Number.isFinite(numDays)) return null;

  const [y, m, d] = norm.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + numDays));
  const res = dt.toISOString().slice(0, 10);
  return isValidDateString(res) ? res : null;
}

/**
 * Calculate difference in calendar days: actualDate - dueDate.
 * Both inputs can be string or Date object.
 */
function diffBangkokCalendarDays(actualDate, dueDate) {
  const actualStr = normalizeDateString(actualDate, { isWallClock: true });
  const dueStr = normalizeDateString(dueDate, { isWallClock: true });

  if (!actualStr || !dueStr || !isValidDateString(actualStr) || !isValidDateString(dueStr)) {
    return null;
  }

  const [y1, m1, d1] = actualStr.split('-').map(Number);
  const [y2, m2, d2] = dueStr.split('-').map(Number);
  const utcA = Date.UTC(y1, m1 - 1, d1);
  const utcB = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utcA - utcB) / (24 * 60 * 60 * 1000));
}

/**
 * Resolve active pickup policy settings and snapshot (C3).
 * Values (defaultDays, strictMode, leadTimeDays) are extracted directly from
 * the effective SnapshotJson matching snapshotId.
 * Accepts optional asOfDate parameter for clock-controlled testing.
 */
async function resolvePickupPolicy(asOfDate = null) {
  let snapshot = null;
  try {
    snapshot = await getEffectivePolicySnapshot('SYSTEM_POLICY', asOfDate);
  } catch (err) {
    // Lookup failure handling (C3):
    // If targeted asOfDate failed, attempt current snapshot
    if (asOfDate) {
      try {
        snapshot = await getEffectivePolicySnapshot('SYSTEM_POLICY', null);
      } catch (innerErr) {
        // Fall through to system default fallback
      }
    }
  }

  if (!snapshot) {
    return {
      defaultDays: 7,
      strictMode: false,
      leadTimeDays: 1,
      snapshotId: null,
      revisionNumber: null,
      effectiveFrom: null,
      effectiveTo: null,
      settings: {},
      isFallback: true,
    };
  }

  const snapJson = typeof snapshot.SnapshotJson === 'string'
    ? JSON.parse(snapshot.SnapshotJson)
    : (snapshot.SnapshotJson || {});

  const defaultDays = Number(snapJson.PICKUP_DUE_DEFAULT_DAYS) !== undefined && !isNaN(Number(snapJson.PICKUP_DUE_DEFAULT_DAYS))
    ? Number(snapJson.PICKUP_DUE_DEFAULT_DAYS)
    : 7;
  const strictMode = String(snapJson.PICKUP_STRICT_MODE) === 'true';
  const leadTimeDays = Number(snapJson.PICKUP_LEAD_TIME_DAYS) !== undefined && !isNaN(Number(snapJson.PICKUP_LEAD_TIME_DAYS))
    ? Number(snapJson.PICKUP_LEAD_TIME_DAYS)
    : 1;

  return {
    defaultDays,
    strictMode,
    leadTimeDays,
    snapshotId: snapshot.SnapshotId,
    revisionNumber: snapshot.RevisionNumber,
    effectiveFrom: snapshot.EffectiveFrom,
    effectiveTo: snapshot.EffectiveTo,
    settings: snapJson,
  };
}

/**
 * Calculate pickup due date for an SO at confirmation (C2, C3, C4).
 */
async function calculateConfirmationPickupDue({ explicitDate, confirmedAt = new Date() }) {
  const policy = await resolvePickupPolicy(confirmedAt);
  const confirmedAtDate = confirmedAt instanceof Date ? confirmedAt : new Date(confirmedAt);
  const confirmedBkkStr = getBangkokDateString(confirmedAtDate);

  if (explicitDate) {
    const explicitStr = normalizeDateString(explicitDate, { isWallClock: true });

    if (explicitStr) {
      return {
        pickupDueDate: explicitStr,
        pickupDueType: 'EXPLICIT',
        confirmedAt: confirmedAtDate,
        pickupPolicySnapshotId: policy.snapshotId,
        pickupDueDays: diffBangkokCalendarDays(explicitStr, confirmedBkkStr),
        policy,
      };
    }
  }

  if (policy.defaultDays > 0) {
    const dueStr = addBangkokCalendarDays(confirmedBkkStr, policy.defaultDays);
    return {
      pickupDueDate: dueStr,
      pickupDueType: 'DEFAULT',
      confirmedAt: confirmedAtDate,
      pickupPolicySnapshotId: policy.snapshotId,
      pickupDueDays: policy.defaultDays,
      policy,
    };
  }

  return {
    pickupDueDate: null,
    pickupDueType: 'UNKNOWN',
    confirmedAt: confirmedAtDate,
    pickupPolicySnapshotId: policy.snapshotId,
    pickupDueDays: null,
    policy,
  };
}

/**
 * Evaluate actual weigh-in / weigh-out timing against PickupDueDate (C2).
 * Correctly handles Date objects, SQL DATE, string dates, and Bangkok midnight.
 */
function evaluatePickupTiming(actualDate, dueDate) {
  const actualStr = normalizeDateString(actualDate, { isWallClock: true });
  const dueStr = normalizeDateString(dueDate, { isWallClock: true });

  if (!actualStr || !dueStr) {
    return {
      status: 'UNKNOWN',
      deltaDays: null,
      actualDate: actualStr || null,
      dueDate: dueStr || null,
      provenance: 'MISSING',
    };
  }

  const delta = diffBangkokCalendarDays(actualStr, dueStr);
  if (delta === null) {
    return {
      status: 'UNKNOWN',
      deltaDays: null,
      actualDate: actualStr,
      dueDate: dueStr,
      provenance: 'UNKNOWN',
    };
  }

  let status = 'ON_TIME';
  if (delta < 0) status = 'EARLY';
  else if (delta > 0) status = 'LATE';

  return {
    status,
    deltaDays: delta,
    actualDate: actualStr,
    dueDate: dueStr,
    provenance: 'WINSPEED_WGHD',
  };
}

/**
 * Evaluate trip scheduling lead-time against policy.
 */
function evaluateTripLeadTime(scheduledDate, leadTimeDays = 1, strictMode = false, now = new Date()) {
  const currentBkk = getBangkokDateString(now);
  const scheduledBkk = normalizeDateString(scheduledDate, { isWallClock: true });

  if (!scheduledBkk) {
    return {
      valid: false,
      blocked: strictMode,
      error: 'ไม่ได้ระบุวันนัดหมายรถเข้ารับสินค้า หรือรูปแบบวันที่ไม่ถูกต้อง',
    };
  }

  const earliestAllowedBkk = addBangkokCalendarDays(currentBkk, leadTimeDays);
  const delta = diffBangkokCalendarDays(scheduledBkk, earliestAllowedBkk);

  const isCompliant = delta >= 0;

  if (!isCompliant) {
    const msg = `การนัดหมายรถต้องมี Lead Time อย่างน้อย ${leadTimeDays} วัน (เร็วที่สุดที่นัดได้: ${earliestAllowedBkk})`;
    return {
      valid: false,
      blocked: strictMode,
      leadTimeDays,
      scheduledDate: scheduledBkk,
      earliestAllowedDate: earliestAllowedBkk,
      error: msg,
      warning: !strictMode ? msg : null,
    };
  }

  return {
    valid: true,
    blocked: false,
    leadTimeDays,
    scheduledDate: scheduledBkk,
    earliestAllowedDate: earliestAllowedBkk,
  };
}

module.exports = {
  BANGKOK_TIMEZONE,
  isValidDateString,
  normalizeDateString,
  getBangkokDateString,
  addBangkokCalendarDays,
  diffBangkokCalendarDays,
  resolvePickupPolicy,
  calculateConfirmationPickupDue,
  evaluatePickupTiming,
  evaluateTripLeadTime,
};
