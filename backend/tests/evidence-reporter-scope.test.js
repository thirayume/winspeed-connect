/**
 * evidence-reporter-scope.test.js
 *
 * Automated tests for Evidence Reporter execution scope semantics.
 * Adheres to CODEX-PILOT-BOUNDARY-AUDIT-20260920:
 * "Add explicit requested scope and tests so an incomplete requested full release
 * is never relabelled successful focused execution. Keep release requirements intact."
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeEvidenceStatus } = require('../../e2e/evidence-reporter.cjs');

test.describe('Evidence Reporter Scope Semantics', () => {

  test('1. Incomplete FULL_RELEASE run is NEVER relabeled PASSED_FOCUSED', () => {
    // A run was invoked without focusing, but only a partial suite was executed
    const result = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 10, passed: 10, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: false, // Incomplete full suite!
      requestedScope: 'FULL_RELEASE',
    });

    assert.equal(result.status, 'INCOMPLETE_OR_FAILED', 'Incomplete full release must be INCOMPLETE_OR_FAILED');
    assert.notEqual(result.status, 'PASSED_FOCUSED', 'Incomplete full release must NEVER be labeled PASSED_FOCUSED');
    assert.equal(result.complete, false);
  });

  test('2. Complete FULL_RELEASE run achieves PASSED_COMPLETE', () => {
    const result = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 50, passed: 50, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: true,
      requestedScope: 'FULL_RELEASE',
    });

    assert.equal(result.status, 'PASSED_COMPLETE');
    assert.equal(result.complete, true);
  });

  test('3. FULL_RELEASE with skipped or flaky tests fails to achieve PASSED_COMPLETE', () => {
    // Skipped test present
    const resSkipped = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 50, passed: 49, failed: 0, flaky: 0, skipped: 1, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: true,
      requestedScope: 'FULL_RELEASE',
    });
    assert.equal(resSkipped.status, 'INCOMPLETE_OR_FAILED');

    // Flaky test present
    const resFlaky = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 50, passed: 50, failed: 0, flaky: 1, skipped: 0, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: true,
      requestedScope: 'FULL_RELEASE',
    });
    assert.equal(resFlaky.status, 'INCOMPLETE_OR_FAILED');
  });

  test('4. Explicitly requested FOCUSED_SUITE achieves PASSED_FOCUSED when clean', () => {
    const result = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 5, passed: 5, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: false,
      requestedScope: 'FOCUSED_SUITE',
    });

    assert.equal(result.status, 'PASSED_FOCUSED');
    assert.equal(result.complete, false);
  });

  test('5. FOCUSED_SUITE with skipped or flaky tests is marked INCOMPLETE_OR_FAILED', () => {
    const resSkipped = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 5, passed: 4, failed: 0, flaky: 0, skipped: 1, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: false,
      requestedScope: 'FOCUSED_SUITE',
    });
    assert.equal(resSkipped.status, 'INCOMPLETE_OR_FAILED');

    const resFlaky = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 5, passed: 5, failed: 0, flaky: 1, skipped: 0, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: true },
      isFullSuite: false,
      requestedScope: 'FOCUSED_SUITE',
    });
    assert.equal(resFlaky.status, 'INCOMPLETE_OR_FAILED');
  });

  test('6. Unstable source fails both full release and focused pass', () => {
    const result = computeEvidenceStatus({
      resultStatus: 'passed',
      counts: { total: 5, passed: 5, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0 },
      sourceStability: { stable: false }, // Unstable source!
      isFullSuite: false,
      requestedScope: 'FOCUSED_SUITE',
    });

    assert.equal(result.status, 'INCOMPLETE_OR_FAILED');
  });

});
