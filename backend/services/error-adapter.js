'use strict';

/**
 * error-adapter.js
 *
 * Structured database error adapter for WorldFert backend.
 * Provides dialect-agnostic business error normalization:
 * - Maps business conflict / lock errors (50001, 50002, 1205, 1222) to HTTP 409
 * - Inspects nested driver errors (tedious/mssql originalError, precedingErrors)
 * - Fails closed on unrelated errors (syntax, connection drop, permissions) -> HTTP 500
 * - Preserves root cause and transaction ownership
 */

const CONFLICT_ERROR_NUMBERS = new Set([
  50001, // Custom application lock / business concurrency conflict
  50002, // Idempotency / state machine transition conflict
  1205,  // SQL Server deadlock victim
  1222,  // SQL Server lock request timeout period exceeded
]);

// Explicit non-conflict system errors that must fail-closed as HTTP 500
const SYSTEM_NON_CONFLICT_NUMBERS = new Set([
  229,   // Permission denied on object
  230,   // Permission denied on column
  207,   // Invalid column name
  208,   // Invalid object name
  245,   // Conversion failed when converting
  8114,  // Error converting data type
  8115,  // Arithmetic overflow error
]);

// Anchored versioned business error markers (e.g. from RAISERROR('[ERR:50001] ...', 16, 1))
const ANCHORED_BUSINESS_PATTERNS = [
  /\[(?:ERR|WF_ERR):50001\]/i,
  /\[(?:ERR|WF_ERR):50002\]/i,
  /\[50001\]/i,
  /\[50002\]/i,
  /\b(?:ERR|WF_ERR):50001\b/i,
  /\b(?:ERR|WF_ERR):50002\b/i,
  /\bWF_ERR_50001\b/i,
  /\bWF_ERR_50002\b/i,
];

// Specific SQL Server lock & concurrency phrases
const GENERIC_LOCK_PATTERNS = [
  /lock request time-?out/i,
  /deadlock victim/i,
  /unable to acquire allocation lock/i,
  /unable to acquire lock/i,
  /concurrency conflict/i,
  /idempotency conflict/i,
];

/**
 * Traverses an error object and all its nested driver errors (tedious / mssql).
 * Returns array of all found error numbers and messages.
 */
function extractDriverErrors(err) {
  if (!err) return [];
  const found = [];
  const visited = new Set();

  function traverse(e) {
    if (!e || typeof e !== 'object' || visited.has(e)) return;
    visited.add(e);

    const num = e.number || e.code || (e.info && e.info.number);
    const msg = e.message || (e.info && e.info.message) || '';

    found.push({
      number: typeof num === 'number' ? num : (parseInt(num, 10) || null),
      message: String(msg),
      original: e,
    });

    if (e.originalError) traverse(e.originalError);
    if (Array.isArray(e.precedingErrors)) {
      e.precedingErrors.forEach(pe => traverse(pe));
    }
    if (Array.isArray(e.errors)) {
      e.errors.forEach(sub => traverse(sub));
    }
  }

  traverse(err);
  return found;
}

/**
 * Checks if the error indicates a business or lock concurrency conflict.
 */
function isConcurrencyConflict(err) {
  if (!err) return false;

  // Direct explicit status
  if (err.status === 409 || err.statusCode === 409) return true;

  const extracted = extractDriverErrors(err);

  // If any error in the chain is an explicit system/permission error, fail closed
  const hasSystemError = extracted.some(item => item.number && SYSTEM_NON_CONFLICT_NUMBERS.has(item.number));
  if (hasSystemError) return false;

  for (const item of extracted) {
    if (item.number && CONFLICT_ERROR_NUMBERS.has(item.number)) {
      return true;
    }
    if (item.message) {
      if (ANCHORED_BUSINESS_PATTERNS.some(pat => pat.test(item.message))) {
        return true;
      }
      if (GENERIC_LOCK_PATTERNS.some(pat => pat.test(item.message))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Maps a database or driver error to structured HTTP response attributes.
 */
function mapDatabaseError(err, defaultMessage = 'เกิดข้อผิดพลาดในการประมวลผล') {
  if (!err) {
    return {
      status: 500,
      message: defaultMessage,
      code: 'UNKNOWN_ERROR',
      isConflict: false,
    };
  }

  // Already structured application error
  if (err.status && typeof err.status === 'number' && err.status >= 400 && err.status < 600) {
    return {
      status: err.status,
      message: err.message || defaultMessage,
      code: err.code || (err.status === 409 ? 'CONCURRENCY_CONFLICT' : 'APPLICATION_ERROR'),
      isConflict: err.status === 409,
    };
  }

  const isConflict = isConcurrencyConflict(err);
  if (isConflict) {
    const rawMsg = err.message || '';
    // Clean prefix like "[50001] " from message if present
    const cleanMsg = rawMsg.replace(/^(\[\d+\]|\d+:\s*)/, '').trim();
    return {
      status: 409,
      message: cleanMsg || 'เกิดข้อขัดแย้งในการทำรายการพร้อมกัน กรุณาลองใหม่อีกครั้ง',
      code: 'CONCURRENCY_CONFLICT',
      isConflict: true,
      originalError: err,
    };
  }

  // Preserve fail-closed safety: arbitrary unknown errors remain 500
  return {
    status: 500,
    message: err.message || defaultMessage,
    code: err.code || 'DATABASE_ERROR',
    isConflict: false,
    originalError: err,
  };
}

module.exports = {
  CONFLICT_ERROR_NUMBERS,
  SYSTEM_NON_CONFLICT_NUMBERS,
  ANCHORED_BUSINESS_PATTERNS,
  GENERIC_LOCK_PATTERNS,
  CONFLICT_MESSAGE_PATTERNS: ANCHORED_BUSINESS_PATTERNS,
  extractDriverErrors,
  isConcurrencyConflict,
  mapDatabaseError,
  toHttpError: mapDatabaseError,
};
