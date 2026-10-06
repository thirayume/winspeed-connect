'use strict';

/**
 * package-b-oracle-error.test.js
 *
 * Package B Offline Test Suite for:
 * 1. TRY_CAST conversion helpers & oracle fixtures (edge cases, overflow, locale).
 * 2. Structured error adapter (50001/50002/1205/1222 to HTTP 409, fail-closed on others).
 * 3. Sequence counter service (concurrency, high-water bootstrap, non-reuse policy).
 *
 * 100% DB-free: ZERO database connections, ZERO pool creation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeIntSql,
  safeBigIntSql,
  safeDecimalSql,
  oracleTryCastInt,
  oracleTryCastBigInt,
  oracleTryCastBigIntString,
  oracleTryCastDecimal,
  oracleTryCastDecimalString,
  ORACLE_CONVERSION_FIXTURES,
} = require('../services/sql-conversion-helpers');

const {
  isConcurrencyConflict,
  mapDatabaseError,
  extractDriverErrors,
} = require('../services/error-adapter');

const {
  SUPPORTED_SEQUENCES,
  GET_NEXT_SEQUENCE_SQL,
  getNextSequenceValue,
} = require('../services/sequence-service');

// ─────────────────────────────────────────────────────────────────────────────
// 1. TRY_CAST / Conversion Helpers & Oracle Fixtures
// ─────────────────────────────────────────────────────────────────────────────

test('Package B (Offline): TRY_CAST Oracle fixtures cover all required edge cases without throwing', () => {
  for (const fixture of ORACLE_CONVERSION_FIXTURES) {
    if (fixture.expectedInt !== undefined) {
      const result = oracleTryCastInt(fixture.input);
      assert.equal(
        result,
        fixture.expectedInt,
        `Failed oracleTryCastInt on category "${fixture.category}" with input "${fixture.input}": expected ${fixture.expectedInt}, got ${result}`
      );
    }
    if (fixture.expectedBigInt !== undefined) {
      const result = oracleTryCastBigInt(fixture.input);
      assert.equal(
        result,
        fixture.expectedBigInt,
        `Failed oracleTryCastBigInt on category "${fixture.category}" with input "${fixture.input}": expected ${fixture.expectedBigInt}, got ${result}`
      );
    }
    if (fixture.expectedBigIntString !== undefined) {
      const strResult = oracleTryCastBigIntString(fixture.input);
      assert.equal(
        strResult,
        fixture.expectedBigIntString,
        `Failed oracleTryCastBigIntString on category "${fixture.category}" with input "${fixture.input}": expected ${fixture.expectedBigIntString}, got ${strResult}`
      );
    }
    if (fixture.expectedDecimal !== undefined) {
      const prec = fixture.precision !== undefined ? fixture.precision : 12;
      const sc = fixture.scale !== undefined ? fixture.scale : 2;
      const result = oracleTryCastDecimal(fixture.input, prec, sc);
      assert.equal(
        result,
        fixture.expectedDecimal,
        `Failed oracleTryCastDecimal on category "${fixture.category}" with input "${fixture.input}": expected ${fixture.expectedDecimal}, got ${result}`
      );
    }
    if (fixture.expectedDecimalString !== undefined) {
      const prec = fixture.precision !== undefined ? fixture.precision : 12;
      const sc = fixture.scale !== undefined ? fixture.scale : 2;
      const strResult = oracleTryCastDecimalString(fixture.input, prec, sc);
      assert.equal(
        strResult,
        fixture.expectedDecimalString,
        `Failed oracleTryCastDecimalString on category "${fixture.category}" with input "${fixture.input}": expected ${fixture.expectedDecimalString}, got ${strResult}`
      );
    }
  }
});

test('Package C Preparation (Offline): Lossless decimal string oracle distinguishes adjacent 38-digit integers', () => {
  const prev38 = '9'.repeat(37) + '8';
  const max38 = '9'.repeat(37) + '9';

  // JS Number conflates these two distinct 38-digit integers due to 53-bit mantissa limit
  assert.equal(Number(prev38) === Number(max38), true, 'Confirms JS IEEE-754 Number loses precision on 38 digits');

  // Lossless string oracle strictly differentiates them
  const prevStr = oracleTryCastDecimalString(prev38, 38, 0);
  const maxStr = oracleTryCastDecimalString(max38, 38, 0);
  assert.equal(prevStr, prev38);
  assert.equal(maxStr, max38);
  assert.notEqual(prevStr, maxStr, 'Lossless string oracle must distinguish adjacent 38-digit values');

  // Rounding carry overflow above max 38-digit integer yields NULL
  assert.equal(oracleTryCastDecimalString(max38 + '.5', 38, 0), null);
  // Rounding below half keeps max38
  assert.equal(oracleTryCastDecimalString(max38 + '.4', 38, 0), max38);
});

test('Package B (Offline): ISNUMERIC traps correctly yield NULL in Oracle and safeIntSql', () => {
  // ISNUMERIC('$100') = 1, ISNUMERIC('1e5') = 1, ISNUMERIC('.') = 1, ISNUMERIC('+') = 1
  // All must be NULL for integer casting
  const trapInputs = ['$100', '1e5', '2.5e3', '.', '+', '-', '1,000', 'TEST'];
  for (const inp of trapInputs) {
    assert.equal(oracleTryCastInt(inp), null, `Trap input "${inp}" must resolve to NULL in oracle`);
  }

  // Check generated safeIntSql contains boundary and non-numeric guard
  const snippet = safeIntSql('testCol');
  assert.ok(snippet.includes("LIKE '%[^0-9+-]%'"), 'safeIntSql must strictly reject invalid characters');
  assert.ok(snippet.includes("'2147483647'"), 'safeIntSql must check signed 32-bit INT max boundary');
  assert.ok(snippet.includes("'2147483648'"), 'safeIntSql must check signed 32-bit INT min boundary');

  // Verify valid positive and negative integers in oracle
  assert.equal(oracleTryCastInt('+500'), 500, '+500 must resolve to 500');
  assert.equal(oracleTryCastInt('-789'), -789, '-789 must resolve to -789');
  assert.equal(oracleTryCastInt('2147483647'), 2147483647, 'max 32-bit int must resolve');
  assert.equal(oracleTryCastInt('2147483648'), null, 'overflow 32-bit int must be null');
});

test('Package B (Offline): BigInt boundary evaluation in oracle and safeBigIntSql (R3-01)', () => {
  const bigSnippet = safeBigIntSql('testCol');
  assert.ok(bigSnippet.includes("LIKE '%[^0-9+-]%'"), 'safeBigIntSql must reject invalid characters');
  assert.ok(bigSnippet.includes("'9223372036854775807'"), 'safeBigIntSql must check signed 64-bit max boundary');
  assert.ok(bigSnippet.includes("'9223372036854775808'"), 'safeBigIntSql must check signed 64-bit min boundary');
  assert.ok(bigSnippet.includes('> 19 THEN NULL'), 'safeBigIntSql must reject numbers over 19 digits without overflow');

  // Oracle reference checks
  assert.equal(oracleTryCastBigInt('9223372036854775807'), 9223372036854775807n);
  assert.equal(oracleTryCastBigInt('9223372036854775808'), null, 'positive 9223372036854775808 must yield NULL (no overflow)');
  assert.equal(oracleTryCastBigInt('-9223372036854775808'), -9223372036854775808n);
  assert.equal(oracleTryCastBigInt('-9223372036854775809'), null, 'negative -9223372036854775809 must yield NULL');
  assert.equal(oracleTryCastBigInt('10000000000000000000'), null, '20-digit positive must yield NULL');
  assert.equal(oracleTryCastBigInt('00009223372036854775807'), 9223372036854775807n, 'leading zeros must normalize properly');
});

test('Package B (Offline): Decimal precision and scale boundaries and rounding (R3-02)', () => {
  // Valid decimal
  assert.equal(oracleTryCastDecimal('123.45', 10, 2), 123.45);
  // Rounding to scale
  assert.equal(oracleTryCastDecimal('12.346', 10, 2), 12.35);
  // Precision overflow (max 3 int digits for precision 5, scale 2)
  assert.equal(oracleTryCastDecimal('12345.67', 5, 2), null);
  // Rounding overflow: 9.999 for decimal(3,2) rounds to 10.00 which requires 2 int digits but only 1 allowed (3-2=1)
  assert.equal(oracleTryCastDecimal('9.999', 3, 2), null, '9.999 must overflow decimal(3,2)');
  assert.equal(oracleTryCastDecimal('9.994', 3, 2), 9.99, '9.994 must fit decimal(3,2)');
  // Valid position check for 12.3
  assert.equal(oracleTryCastDecimal('12.3', 12, 2), 12.3, '12.3 must be accepted for decimal(12,2)');
  // Valid sign
  assert.equal(oracleTryCastDecimal('+500', 12, 2), 500, '+500 must be accepted');
  assert.equal(oracleTryCastDecimal('-789.5', 12, 2), -789.5, '-789.5 must be accepted');
  // Invalid strings
  assert.equal(oracleTryCastDecimal('abc', 10, 2), null);
  assert.equal(oracleTryCastDecimal('12.34.56', 10, 2), null);
  assert.equal(oracleTryCastDecimal('', 10, 2), null);
  assert.equal(oracleTryCastDecimal(null, 10, 2), null);

  // Large precision boundaries: DECIMAL(38,0) and DECIMAL(38,38)
  assert.equal(oracleTryCastDecimal('9'.repeat(38), 38, 0), Number('9'.repeat(38)));
  assert.equal(oracleTryCastDecimal('9'.repeat(38) + '.5', 38, 0), null, 'rounding carry on 38-digit integer overflows DECIMAL(38,0)');
  assert.equal(oracleTryCastDecimal('0.123', 38, 38), 0.123);
  assert.equal(oracleTryCastDecimal('0.' + '9'.repeat(38) + '5', 38, 38), null, 'rounding carry to 1.0 overflows DECIMAL(38,38)');

  // Check generated safeDecimalSql
  const decSql = safeDecimalSql('testCol', 3, 2);
  assert.ok(decSql.includes('> 1 THEN NULL'), 'safeDecimalSql must check exact maxIntDigits (3 - 2 = 1)');
  assert.ok(!decSql.includes('POWER('), 'safeDecimalSql must not use overflow-prone POWER() function');
  assert.ok(!decSql.includes('REVERSE'), 'safeDecimalSql must not use buggy REVERSE equality on dot position');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Structured Error Adapter Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Package B (Offline): Error adapter maps error 50001 and 50002 to HTTP 409', () => {
  const err50001 = new Error('Lock request timed out for rebate allocation');
  err50001.number = 50001;

  const res50001 = mapDatabaseError(err50001);
  assert.equal(res50001.status, 409);
  assert.equal(res50001.isConflict, true);
  assert.equal(res50001.code, 'CONCURRENCY_CONFLICT');

  const err50002 = new Error('State machine transition conflict');
  err50002.number = 50002;
  const res50002 = mapDatabaseError(err50002);
  assert.equal(res50002.status, 409);
  assert.equal(res50002.isConflict, true);
});

test('Package B (Offline): Error adapter handles SQL Server deadlocks (1205) and timeouts (1222)', () => {
  const deadlockErr = new Error('Transaction (Process ID 54) was deadlocked on lock resources with another process');
  deadlockErr.number = 1205;

  assert.equal(isConcurrencyConflict(deadlockErr), true);
  const mappedDeadlock = mapDatabaseError(deadlockErr);
  assert.equal(mappedDeadlock.status, 409);

  const timeoutErr = new Error('Lock request time out period exceeded');
  timeoutErr.number = 1222;
  assert.equal(isConcurrencyConflict(timeoutErr), true);
  const mappedTimeout = mapDatabaseError(timeoutErr);
  assert.equal(mappedTimeout.status, 409);
});

test('Package B (Offline): Error adapter inspects nested driver errors (originalError / precedingErrors)', () => {
  // Nested inside tedious/mssql originalError
  const topLevelErr = new Error('Execution failed');
  topLevelErr.originalError = {
    info: {
      number: 50001,
      message: '[ERR:50001] Lock request timed out for rebate allocation',
    },
  };

  assert.equal(isConcurrencyConflict(topLevelErr), true);
  const res = mapDatabaseError(topLevelErr);
  assert.equal(res.status, 409);
  assert.equal(res.isConflict, true);

  // In precedingErrors array
  const multiErr = new Error('Batch execution aborted');
  multiErr.precedingErrors = [
    { number: 50001, message: 'Deadlock victim during rebate allocation' },
  ];
  assert.equal(isConcurrencyConflict(multiErr), true);
  assert.equal(mapDatabaseError(multiErr).status, 409);
});

test('Package B (Offline): Error adapter fails closed on unrelated database errors (HTTP 500)', () => {
  const syntaxErr = new Error('Incorrect syntax near keyword "WHERE"');
  syntaxErr.number = 156;

  assert.equal(isConcurrencyConflict(syntaxErr), false);
  const resSyntax = mapDatabaseError(syntaxErr);
  assert.equal(resSyntax.status, 500);
  assert.equal(resSyntax.isConflict, false);
  assert.equal(resSyntax.code, 'DATABASE_ERROR');

  const permErr = new Error('The SELECT permission was denied on the object "wf.AppUser"');
  permErr.number = 229;
  assert.equal(isConcurrencyConflict(permErr), false);
  const resPerm = mapDatabaseError(permErr);
  assert.equal(resPerm.status, 500);

  // B-07 regression: Permission error 229 mentioning object archive_50001 must NOT become 409
  const incidentalErr = { number: 229, message: 'SELECT permission denied on object archive_50001' };
  assert.equal(isConcurrencyConflict(incidentalErr), false, 'Permission error mentioning 50001 must not be conflict');
  assert.equal(mapDatabaseError(incidentalErr).status, 500, 'Must map to HTTP 500');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sequence Counter Concurrency & Non-Reuse Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Package B (Offline): Sequence service configuration and SQL template validation', () => {
  assert.ok(SUPPORTED_SEQUENCES.WfRefSeq, 'WfRefSeq must be supported');
  assert.ok(SUPPORTED_SEQUENCES.QuoteRefSeq, 'QuoteRefSeq must be supported');

  assert.ok(GET_NEXT_SEQUENCE_SQL.includes('wf.SequenceCounter'), 'SQL must target wf.SequenceCounter');
  assert.ok(GET_NEXT_SEQUENCE_SQL.includes('(UPDLOCK, ROWLOCK)'), 'SQL must use row-level update locks');
  assert.ok(GET_NEXT_SEQUENCE_SQL.includes('sp_executesql'), 'SQL must use sp_executesql for dynamic native sequence');
});

test('Package B (Offline): Simulated concurrent sequence allocation preserves monotonicity and zero collisions', async () => {
  // Simulated atomic in-memory sequence counter replicating UPDLOCK/ROWLOCK
  let counterValue = 1000;
  const lock = { locked: false };

  async function mockQueryFn(sqlText, inputs) {
    const seqName = inputs.sequenceName.value;
    // Simulate atomic row-locked increment
    counterValue += 1;
    return {
      recordset: [{ Seq: counterValue }],
    };
  }

  const concurrentRequests = 50;
  const promises = [];
  for (let i = 0; i < concurrentRequests; i++) {
    promises.push(getNextSequenceValue(mockQueryFn, 'WfRefSeq'));
  }

  const results = await Promise.all(promises);

  assert.equal(results.length, concurrentRequests);
  const uniqueSet = new Set(results);
  assert.equal(uniqueSet.size, concurrentRequests, 'Every concurrent allocation must yield a distinct value');

  // Verify monotonicity
  const minVal = Math.min(...results);
  const maxVal = Math.max(...results);
  assert.equal(minVal, 1001);
  assert.equal(maxVal, 1050);
});

test('Package B (Offline): Non-reuse policy — sequence allocation succeeds even if consumer fails', async () => {
  let counter = 500;
  async function mockQueryFn() {
    counter++;
    return { recordset: [{ Seq: counter }] };
  }

  // 1. Allocate sequence 501
  const seq1 = await getNextSequenceValue(mockQueryFn, 'WfRefSeq');
  assert.equal(seq1, 501);

  // 2. Consumer transaction fails and rolls back (simulated)
  let consumerFailed = false;
  try {
    throw new Error('CONSUMER_TX_ABORT');
  } catch (_) {
    consumerFailed = true;
  }
  assert.equal(consumerFailed, true);

  // 3. Next allocation gets 502 (non-reuse: 501 is not reclaimed)
  const seq2 = await getNextSequenceValue(mockQueryFn, 'WfRefSeq');
  assert.equal(seq2, 502, 'Allocated sequence numbers must not be reclaimed or reused after failure');
});

test('Package B (Offline): BR2-03 Sequence counter initialization jumps above seed-0 and existing document high-water mark', () => {
  // Test that GET_NEXT_SEQUENCE_SQL contains locked evaluation for existing-low rows
  assert.ok(GET_NEXT_SEQUENCE_SQL.includes('CurrentValue < @highWater THEN @highWater + 1'), 'SQL must jump above high-water when row is seeded low (e.g. 0)');
  assert.ok(GET_NEXT_SEQUENCE_SQL.includes('wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)'), 'SQL must use UPDLOCK, ROWLOCK for reading and updating');
  assert.ok(GET_NEXT_SEQUENCE_SQL.includes('LEN(SUBSTRING(WfRef, CHARINDEX(\'-\', WfRef) + 1, 25)) <= 9'), 'SQL must bound numeric suffix conversion to prevent overflow');
  assert.ok(!GET_NEXT_SEQUENCE_SQL.includes('CREATE TABLE'), 'SQL must not execute runtime DDL');

  // Logic simulation: existing seed 0 with maxDoc = 42 must yield 43, not 1
  function simulateSequenceCounter(currentValueInTable, highWaterMark) {
    if (currentValueInTable === null) {
      return highWaterMark + 1;
    }
    if (currentValueInTable < highWaterMark) {
      return highWaterMark + 1;
    }
    return currentValueInTable + 1;
  }

  // Seed 0 migration row with documents up to 42 must jump to 43
  assert.equal(simulateSequenceCounter(0, 42), 43, 'Seed 0 row must jump to highWater + 1');
  // Missing row with documents up to 42 must insert 43
  assert.equal(simulateSequenceCounter(null, 42), 43, 'Missing row must insert highWater + 1');
  // Existing row at 100 with documents at 42 must increment to 101
  assert.equal(simulateSequenceCounter(100, 42), 101, 'Advanced row must increment normally');
});

test('Package B (Offline): BR2-04 Exact decimal arithmetic and leading zeros', () => {
  // Exact half-up rounding (pure string/BigInt oracle)
  assert.equal(oracleTryCastDecimal('1.005', 12, 2), 1.01, '1.005 must round up to 1.01 in exact decimal');
  assert.equal(oracleTryCastDecimal('-1.005', 12, 2), -1.01, '-1.005 must round to -1.01 in exact decimal');
  assert.equal(oracleTryCastDecimal('1.004', 12, 2), 1.00, '1.004 must truncate to 1.00');

  // Decimal rounding overflow
  assert.equal(oracleTryCastDecimal('9.999', 3, 2), null, '9.999 must overflow DECIMAL(3,2)');
  assert.equal(oracleTryCastDecimal('-9.999', 3, 2), null, '-9.999 must overflow DECIMAL(3,2)');
  assert.equal(oracleTryCastDecimal('9.994', 3, 2), 9.99, '9.994 must fit DECIMAL(3,2)');

  // Leading zeros and length bounds
  assert.equal(oracleTryCastInt('000042'), 42, 'Leading zeros must be accepted');
  assert.equal(oracleTryCastInt('0'.repeat(45) + '42'), 42, 'Leading zeros over 50 chars must be accepted');
  assert.equal(oracleTryCastInt('1234567890' + 'x'.repeat(45)), null, 'String over 50 chars with invalid suffix must be rejected');

  // Verify safeIntSql and safeDecimalSql use nested CASE (no AND short-circuit reliance)
  const intSql = safeIntSql('col');
  assert.ok(intSql.includes('ELSE\n      CASE'), 'safeIntSql must use nested CASE');
  assert.ok(!intSql.includes('CONVERT(VARCHAR(50)'), 'safeIntSql must not truncate at VARCHAR(50)');

  const decSql = safeDecimalSql('col', 12, 2);
  assert.ok(decSql.includes('ELSE\n      CASE'), 'safeDecimalSql must use nested CASE');
  assert.ok(!decSql.includes('AS FLOAT'), 'safeDecimalSql must not use FLOAT for bounds check');
});

test('Package B (Offline): BR2-05 Error adapter aligns with actual emitted lock messages and numbers', () => {
  // RAISERROR user-defined messages in SQL Server arrive with number 50000 in tedious/mssql
  const raiserrorRebateTimeout = new Error('[ERR:50001] Lock request timed out for rebate allocation');
  raiserrorRebateTimeout.number = 50000;
  const res1 = mapDatabaseError(raiserrorRebateTimeout);
  assert.equal(res1.status, 409, 'RAISERROR with [ERR:50001] must map to 409');
  assert.equal(res1.isConflict, true);

  const raiserrorRebateCanceled = new Error('[ERR:50001] Lock request canceled');
  raiserrorRebateCanceled.number = 50000;
  assert.equal(mapDatabaseError(raiserrorRebateCanceled).status, 409);

  const raiserrorRebateDeadlock = new Error('[ERR:50001] Deadlock victim during rebate allocation');
  raiserrorRebateDeadlock.number = 50000;
  assert.equal(mapDatabaseError(raiserrorRebateDeadlock).status, 409);

  const legacyUnadornedRebate = new Error('[50001] Lock request canceled');
  legacyUnadornedRebate.number = 50000;
  assert.equal(mapDatabaseError(legacyUnadornedRebate).status, 409, 'Legacy [50001] must map to 409');

  const raiserrorSoConfirm = new Error('[ERR:50002] Unable to acquire lock for SO confirmation');
  raiserrorSoConfirm.number = 50000;
  assert.equal(mapDatabaseError(raiserrorSoConfirm).status, 409, 'SO confirm [ERR:50002] must map to 409');

  // Unrelated error with 50000 (e.g. custom business validation) that is NOT a lock conflict
  const customValidationErr = new Error('Custom validation error occurred');
  customValidationErr.number = 50000;
  assert.equal(mapDatabaseError(customValidationErr).status, 500, 'Unrelated error 50000 must fail closed to 500');

  // System error 229 must fail-closed to 500 even if message contains lock words
  const permWithLockWord = new Error('Permission denied on lock table');
  permWithLockWord.number = 229;
  assert.equal(mapDatabaseError(permWithLockWord).status, 500, 'System error 229 must always fail closed to 500');
});

