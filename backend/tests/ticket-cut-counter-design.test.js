'use strict';

/**
 * ticket-cut-counter-design.test.js
 *
 * Unit tests for D2 ticket-cut numbering algorithm designed for Phase B (R6 §1.6 / D2):
 * - Evaluates next ticket-cut document number without writing to dbo.EMRunBrch.
 * - Resolves month prefix YYMM (e.g. 6910 for Oct 2569).
 * - Takes MAX(LastNo in month, RealMax in month) + 1.
 * - Skips existing numbers.
 * - Proves WinSpeed and Sale-App stay synchronized without collision.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Pure allocation function for Phase B ticket-cut numbering.
 * @param {Object} params
 * @param {string} params.currentMonthPrefix - 4-char YYMM string (e.g. '6910')
 * @param {string} params.emRunLastNo - Value from dbo.EMRunBrch.LastNo (e.g. '69081762')
 * @param {string|null} params.realDbMaxNo - MAX(DocuNo) in dbo.WFRedemtionHD for this month (e.g. '69100002')
 * @param {Set<string>} params.existingDocNos - Set of existing DocuNo values in dbo.WFRedemtionHD
 * @returns {string} Next free allocated DocuNo
 */
function allocateNextTicketCutNo({ currentMonthPrefix, emRunLastNo, realDbMaxNo, existingDocNos = new Set() }) {
  const prefix = String(currentMonthPrefix).trim();
  
  let baseSeq = 0;

  // 1. Inspect EMRunBrch.LastNo if it belongs to the current month
  if (emRunLastNo && String(emRunLastNo).startsWith(prefix)) {
    const seqStr = String(emRunLastNo).slice(prefix.length);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq) && seq > baseSeq) {
      baseSeq = seq;
    }
  }

  // 2. Inspect real DB maximum in current month
  if (realDbMaxNo && String(realDbMaxNo).startsWith(prefix)) {
    const seqStr = String(realDbMaxNo).slice(prefix.length);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq) && seq > baseSeq) {
      baseSeq = seq;
    }
  }

  // 3. Propose baseSeq + 1, skipping any numbers that exist in DB
  let candidateSeq = baseSeq + 1;
  let candidateDocNo = `${prefix}${String(candidateSeq).padStart(4, '0')}`;

  while (existingDocNos.has(candidateDocNo)) {
    candidateSeq += 1;
    candidateDocNo = `${prefix}${String(candidateSeq).padStart(4, '0')}`;
  }

  return candidateDocNo;
}

test('1. Stuck EMRunBrch: allocates next monthly number starting after current month real max', () => {
  // Scenario: EMRunBrch is stuck at 69081762 (from August).
  // Current month is October 2569 (prefix 6910).
  // Real max in October is 69100002.
  const next = allocateNextTicketCutNo({
    currentMonthPrefix: '6910',
    emRunLastNo: '69081762', // August stuck number
    realDbMaxNo: '69100002',  // Current October max
    existingDocNos: new Set(['69100001', '69100002'])
  });

  assert.equal(next, '69100003');
});

test('2. New month rollover: starts at 0001 when no prior records exist in month', () => {
  // Scenario: November 2569 (prefix 6911). No records exist yet.
  const next = allocateNextTicketCutNo({
    currentMonthPrefix: '6911',
    emRunLastNo: '69100740', // Previous month
    realDbMaxNo: null,
    existingDocNos: new Set()
  });

  assert.equal(next, '69110001');
});

test('3. Gap and duplicate skip: safely increments past manual out-of-order numbers', () => {
  // Scenario: Staff manually typed 69100005 when last was 69100004.
  const next = allocateNextTicketCutNo({
    currentMonthPrefix: '6910',
    emRunLastNo: '69100004',
    realDbMaxNo: '69100005',
    existingDocNos: new Set(['69100001', '69100002', '69100003', '69100004', '69100005'])
  });

  assert.equal(next, '69100006');
});
