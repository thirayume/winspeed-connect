'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewEvidence } = require('../services/rebate-evidence-policy');

const fingerprint = 'a'.repeat(64);
const base = () => ({ evidence: { status: 'HELD', sourceFingerprint: fingerprint, revision: 1, quantityTon: '1.000' },
  currentFingerprint: fingerprint, currentSourceIssues: [], resetAtUtc: '2026-11-13T12:00:00.000Z',
  occurredAtUtc: '2026-11-13T12:00:00.001Z', serverNowUtc: '2026-11-13T13:00:00.000Z', reason: 'Verified signed delivery and actual scale-out',
  reviewer: { primaryId: 1, businessId: 3, actorPrimaryId: 2, actorBusinessId: 4 }, decision: 'VERIFY', mayVerify: true });
function rejects(input, code) { assert.throws(() => reviewEvidence(input), e => e.code === code); }

test('manual verification records both identities and requires an event strictly after reset', () => {
  const input = base();
  const result = reviewEvidence(input);
  assert.equal(result.status, 'MANUALLY_VERIFIED');
  assert.equal(result.occurredAtUtc.toISOString(), input.occurredAtUtc);
  assert.deepEqual(result.reviewer, input.reviewer);
  input.occurredAtUtc = input.resetAtUtc;
  rejects(input, 'REBATE_EVIDENCE_BEFORE_RESET');
});
test('stale evidence, role permission, missing identities and missing reason fail closed', () => {
  let input = base(); input.currentFingerprint = 'b'.repeat(64); rejects(input, 'REBATE_EVIDENCE_SOURCE_CHANGED');
  input = base(); input.mayVerify = false; rejects(input, 'REBATE_EVIDENCE_PERMISSION_REQUIRED');
  input = base(); input.reviewer.actorBusinessId = null; rejects(input, 'REBATE_EVIDENCE_IDENTITY_REQUIRED');
  input = base(); input.reason = '  '; rejects(input, 'REBATE_EVIDENCE_REASON_REQUIRED');
  input = base(); input.evidence.status = 'MANUALLY_VERIFIED'; rejects(input, 'REBATE_EVIDENCE_NOT_HELD');
  input = base(); input.evidence.revision = 0; rejects(input, 'REBATE_EVIDENCE_REVISION_INVALID');
});
test('reject retains identities and reason, and never creates an eligible event', () => {
  const input = base(); input.decision = 'REJECT'; input.occurredAtUtc = null;
  const result = reviewEvidence(input);
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.occurredAtUtc, undefined);
  assert.deepEqual(result.reviewer, input.reviewer);
});
test('verification requires valid source times and an explicit decision', () => {
  let input = base(); input.occurredAtUtc = null; rejects(input, 'REBATE_EVIDENCE_TIME_REQUIRED');
  input = base(); input.resetAtUtc = 'bad'; rejects(input, 'REBATE_EVIDENCE_TIME_INVALID');
  input = base(); input.occurredAtUtc = '2026-11-13T12:30:00'; rejects(input, 'REBATE_EVIDENCE_TIME_INVALID');
  input = base(); input.occurredAtUtc = '2026-02-30T12:00:00Z'; rejects(input, 'REBATE_EVIDENCE_TIME_INVALID');
  input = base(); input.occurredAtUtc = '2026-11-13T12:00:00+14:01'; rejects(input, 'REBATE_EVIDENCE_TIME_INVALID');
  input = base(); input.serverNowUtc = '2026-11-13T12:00:00.000Z'; rejects(input, 'REBATE_EVIDENCE_IN_FUTURE');
  input = base(); input.decision = 'AUTO'; rejects(input, 'REBATE_EVIDENCE_DECISION_INVALID');
});
test('an unresolved unit, missing native mapping or unknown tonnage cannot earn Rebate', () => {
  let input = base(); input.currentSourceIssues = ['UNIT_UNCONFIRMED']; rejects(input, 'REBATE_EVIDENCE_SOURCE_INCOMPLETE');
  input = base(); input.currentSourceIssues = undefined; rejects(input, 'REBATE_EVIDENCE_SOURCE_INCOMPLETE');
  input = base(); input.evidence.quantityTon = null; rejects(input, 'REBATE_EVIDENCE_SOURCE_INCOMPLETE');
  input = base(); input.evidence.quantityTon = '0'; rejects(input, 'REBATE_EVIDENCE_SOURCE_INCOMPLETE');
  input = base(); input.evidence.quantityTon = '1.0001'; rejects(input, 'REBATE_EVIDENCE_SOURCE_INCOMPLETE');
});
