'use strict';

// Decision rules only. This module does not fetch evidence, change balances,
// authorize a request or expose an endpoint. The caller must lock the source
// rows and recheck their fingerprint and the active reset generation before
// saving a decision in the same transaction.
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
function instant(value) {
  if (value == null || value === '') fail('REBATE_EVIDENCE_TIME_REQUIRED');
  if (!(value instanceof Date)) {
    const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!m) fail('REBATE_EVIDENCE_TIME_INVALID');
    const [, y, mo, d, h, mi, s, zone, , zh, zm] = m;
    const calendar = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (Number(y) < 1000 || calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() !== Number(mo) - 1 ||
        calendar.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 ||
        (zone !== 'Z' && (Number(zh) > 14 || Number(zm) > 59 || (Number(zh) === 14 && Number(zm) !== 0)))) {
      fail('REBATE_EVIDENCE_TIME_INVALID');
    }
  }
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) fail('REBATE_EVIDENCE_TIME_INVALID');
  return result;
}
function positiveId(value) { return Number.isSafeInteger(value) && value > 0; }

function reviewEvidence({ evidence, currentFingerprint, currentSourceIssues, resetAtUtc, occurredAtUtc, serverNowUtc, reason, reviewer, decision, mayVerify } = {}) {
  if (mayVerify !== true) fail('REBATE_EVIDENCE_PERMISSION_REQUIRED');
  if (!evidence || evidence.status !== 'HELD') fail('REBATE_EVIDENCE_NOT_HELD');
  if (!/^[a-f0-9]{64}$/.test(String(evidence.sourceFingerprint || '')) ||
      evidence.sourceFingerprint !== currentFingerprint) fail('REBATE_EVIDENCE_SOURCE_CHANGED');
  if (!Number.isSafeInteger(evidence.revision) || evidence.revision < 1) fail('REBATE_EVIDENCE_REVISION_INVALID');
  if (!reviewer || !['primaryId', 'businessId', 'actorPrimaryId', 'actorBusinessId'].every(key => positiveId(reviewer[key]))) {
    fail('REBATE_EVIDENCE_IDENTITY_REQUIRED');
  }
  const explanation = typeof reason === 'string' ? reason.trim() : '';
  if (explanation.length < 1 || explanation.length > 1000) fail('REBATE_EVIDENCE_REASON_REQUIRED');
  if (decision !== 'VERIFY' && decision !== 'REJECT') fail('REBATE_EVIDENCE_DECISION_INVALID');
  if (decision === 'REJECT') return { status: 'REJECTED', reviewReason: explanation, reviewer, expectedRevision: evidence.revision };
  // The caller must derive tons from a verified native unit, not from a form.
  // Unresolved source linkage or units stay held until a dedicated correction
  // workflow can prove and audit the conversion.
  const tons = String(evidence.quantityTon ?? '');
  if (!Array.isArray(currentSourceIssues) || currentSourceIssues.length !== 0 ||
      !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(tons) || Number(tons) <= 0) {
    fail('REBATE_EVIDENCE_SOURCE_INCOMPLETE');
  }
  const reset = instant(resetAtUtc);
  const occurred = instant(occurredAtUtc);
  const now = instant(serverNowUtc);
  // The owner requested *after*, not at-or-after, the confirmation instant.
  if (occurred <= reset) fail('REBATE_EVIDENCE_BEFORE_RESET');
  if (occurred > now) fail('REBATE_EVIDENCE_IN_FUTURE');
  return { status: 'MANUALLY_VERIFIED', occurredAtUtc: new Date(occurred), reviewReason: explanation,
    reviewer, expectedRevision: evidence.revision };
}

module.exports = { reviewEvidence, parseEvidenceInstant: instant };
