/**
 * native-gl-linkage.js
 *
 * Authoritative shared native GL linkage service for WinSpeed.
 * Used by BOTH reconciliation (backend/routes/recon.js)
 * and GL sales journal reports (backend/routes/reports.js).
 *
 * Rules:
 *  1. Typed identity: FromID = SOInvHD.PostID AND FromFlag = CAST(SOInvHD.DocuType AS VARCHAR(10))
 *  2. 1-to-1 cardinality per Invoice (evaluate all active candidates, no premature early-exit)
 *  3. Strict integer minor-units currency precision: |Dr - Cr| === 0 cents.
 *     Any diff >= 1 satang (0.01) is a discrepancy.
 *  4. Missing, null, NaN or non-finite sums must NOT be coerced to 0 or treated as balanced.
 *  5. Genuine all-zero sales journals (0.00 Dr / 0.00 Cr) are treated as invalid.
 *  6. Contradictory evidence (balanced + discrepant, or unconfirmed status) is explicitly AMBIGUOUS.
 */

const SHARED_GL_INVOICE_JOIN_SQL = `
  LEFT JOIN dbo.SOInvHD inv WITH (NOLOCK)
    ON inv.PostID = gl.FromID
   AND gl.FromFlag = CAST(inv.DocuType AS VARCHAR(10))
`;

/**
 * Parses financial minor units (cents / satang).
 * Returns null if missing, null, undefined, or non-finite (prevents false zero-coercion).
 */
function parseMinorUnits(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

function toCents(val) {
  const cents = parseMinorUnits(val);
  return cents !== null ? cents : 0;
}

/**
 * Match GL candidate headers to a single invoice
 */
function matchGlToInvoice(invoice, glHeaders = []) {
  const postID = invoice.PostID != null ? String(invoice.PostID) : null;
  const docuType = invoice.DocuType != null ? String(invoice.DocuType) : null;
  const docuNo = invoice.DocuNo ? String(invoice.DocuNo).trim() : null;

  if (!postID || !docuType) {
    return {
      status: 'MISSING_INVOICE_TYPED_IDENTITY',
      matches: [],
      matchedGL: null,
      cancelled: [],
      discrepancy: []
    };
  }

  // 1. Filter candidates by typed identity: FromID === PostID AND FromFlag === DocuType
  const candidates = glHeaders.filter(g => {
    const fromID = g.FromID != null ? String(g.FromID) : null;
    const fromFlag = g.FromFlag != null ? String(g.FromFlag) : null;
    const matchType = fromID === postID && fromFlag === docuType;
    return matchType;
  });

  const cancelled = [];
  const active = [];
  const unknownStatus = [];

  for (const g of candidates) {
    if (g.DocuStatus === 'C') {
      cancelled.push(g);
    } else if (g.DocuStatus === 'N') {
      active.push(g);
    } else {
      unknownStatus.push(g);
    }
  }

  const balancedActive = [];
  const discrepancyActive = [];
  const invalidActive = [];

  for (const g of active) {
    const lines = Number(g.LineCount) || 0;
    const drCents = parseMinorUnits(g.SumDebit);
    const crCents = parseMinorUnits(g.SumCredit);
    const invalidLineCount = Number(g.InvalidLineCount) || 0;
    const hasInvalidAmount = Boolean(g.HasInvalidAmount) || invalidLineCount > 0;

    if (lines === 0) {
      invalidActive.push({ ...g, reason: 'EMPTY_HEADER_NO_LINES', lineCount: 0 });
    } else if (drCents === null || crCents === null || hasInvalidAmount) {
      invalidActive.push({ ...g, reason: 'MISSING_OR_NON_FINITE_AMOUNTS', lineCount: lines });
    } else if (drCents === 0 && crCents === 0) {
      invalidActive.push({ ...g, reason: 'ZERO_AMOUNT_JOURNAL', lineCount: lines });
    } else {
      const diff = Math.abs(drCents - crCents);
      if (lines >= 2 && diff === 0) {
        balancedActive.push({ ...g, diffCents: 0, lineCount: lines, drCents, crCents });
      } else {
        discrepancyActive.push({ ...g, diffCents: diff, lineCount: lines, drCents, crCents });
      }
    }
  }

  // If there are unknown status candidates alongside active/cancelled, evidence is unconfirmed
  if (unknownStatus.length > 0) {
    return {
      status: 'UNKNOWN_STATUS_CANDIDATE',
      matchedGL: null,
      matches: [],
      cancelled,
      discrepancy: [...discrepancyActive, ...invalidActive],
      unknownStatus
    };
  }

  // If active candidates contain invalid / null amounts, evidence is incomplete/discrepant
  if (invalidActive.length > 0) {
    const status = balancedActive.length > 0 ? 'AMBIGUOUS_CONTRADICTORY' : 'DISCREPANCY';
    return {
      status,
      matchedGL: null,
      matches: [],
      cancelled,
      discrepancy: [...discrepancyActive, ...invalidActive]
    };
  }

  // Multiple active candidates (cardinality violation / ambiguous)
  if (active.length > 1) {
    let status;
    if (balancedActive.length > 1 && discrepancyActive.length === 0) {
      status = 'AMBIGUOUS';
    } else if (balancedActive.length > 0 && discrepancyActive.length > 0) {
      status = 'AMBIGUOUS_CONTRADICTORY';
    } else {
      status = 'DISCREPANCY';
    }
    return {
      status,
      matchedGL: null,
      matches: balancedActive,
      cancelled,
      discrepancy: discrepancyActive
    };
  }

  // Exactly 1 active candidate
  if (active.length === 1) {
    if (balancedActive.length === 1) {
      return {
        status: 'VERIFIED',
        matchedGL: balancedActive[0],
        matches: balancedActive,
        cancelled,
        discrepancy: []
      };
    }
    return {
      status: 'DISCREPANCY',
      matchedGL: null,
      matches: [],
      cancelled,
      discrepancy: discrepancyActive
    };
  }

  // 0 active candidates
  if (cancelled.length > 0) {
    return {
      status: 'CANCELLED_GL',
      matchedGL: null,
      matches: [],
      cancelled,
      discrepancy: []
    };
  }

  if (invoice.PostGL === 'Y') {
    return {
      status: 'FLAGGED_BUT_NO_GL',
      matchedGL: null,
      matches: [],
      cancelled: [],
      discrepancy: []
    };
  }

  return {
    status: 'UNPOSTED',
    matchedGL: null,
    matches: [],
    cancelled: [],
    discrepancy: []
  };
}

/**
 * Evaluate aggregate GL status for an SO across its active invoices
 */
function evaluateSoGlStatus(activeInvoices = [], glHeaders = []) {
  if (!activeInvoices.length) {
    return {
      verifiedGlStatus: 'NO_GL',
      matchedGL: null,
      glDocuDate: null,
      perInvoice: []
    };
  }

  const perInvoice = activeInvoices.map(inv => ({
    invoice: inv,
    ...matchGlToInvoice(inv, glHeaders)
  }));

  // Check uniqueness of matched GL entries across invoices
  const verifiedMatches = perInvoice.filter(p => p.status === 'VERIFIED' && p.matchedGL);
  const matchedGlIds = new Set();
  let duplicateGlIdFound = false;
  for (const v of verifiedMatches) {
    const id = String(v.matchedGL.GLID);
    if (matchedGlIds.has(id)) {
      duplicateGlIdFound = true;
      break;
    }
    matchedGlIds.add(id);
  }

  const hasContradictionOrAmbiguity = perInvoice.some(p => 
    ['AMBIGUOUS', 'AMBIGUOUS_CONTRADICTORY', 'UNKNOWN_STATUS_CANDIDATE', 'DISCREPANCY'].includes(p.status)
  );

  let verifiedGlStatus;
  let matchedGL = verifiedMatches.length > 0 ? verifiedMatches[0].matchedGL : null;

  if (duplicateGlIdFound || hasContradictionOrAmbiguity) {
    // Multiple invoices matched to the exact same GL header, or ambiguous/contradictory evidence
    verifiedGlStatus = 'INCONSISTENT';
  } else if (verifiedMatches.length === activeInvoices.length) {
    // All invoices verified with 1-to-1 cardinality
    const allFlaggedY = activeInvoices.every(i => i.PostGL === 'Y');
    if (!allFlaggedY) {
      // Contradiction between native flag and real GL
      verifiedGlStatus = 'INCONSISTENT';
    } else {
      verifiedGlStatus = 'VERIFIED_GL';
    }
  } else if (verifiedMatches.length > 0) {
    verifiedGlStatus = 'PARTIAL_GL';
  } else {
    // 0 verified matches
    if (perInvoice.some(p => p.status === 'FLAGGED_BUT_NO_GL')) {
      verifiedGlStatus = 'FLAGGED_BUT_NO_GL';
    } else if (perInvoice.some(p => p.status === 'CANCELLED_GL')) {
      verifiedGlStatus = 'INCONSISTENT';
    } else if (activeInvoices.every(i => i.PostGL === 'N')) {
      verifiedGlStatus = 'UNPOSTED_GL';
    } else {
      verifiedGlStatus = 'NO_GL';
    }
  }

  // glDocuDate: strictly null if not VERIFIED_GL
  const glDocuDate = (verifiedGlStatus === 'VERIFIED_GL' && matchedGL)
    ? (matchedGL.JournalDate || null)
    : null;

  return {
    verifiedGlStatus,
    matchedGL,
    glDocuDate,
    perInvoice
  };
}

/**
 * Shared evaluation for GL Journal reports
 * Ensures consistency with reconciliation without multiplying header lines
 */
function evaluateJournalHeader(glHeader, glLines = [], matchedInvoices = [], allGlCandidates = null) {
  const lines = glLines || [];
  let sumDrCents = 0;
  let sumCrCents = 0;
  let hasInvalidAmount = false;

  for (const l of lines) {
    const dr = parseMinorUnits(l.Debit != null ? l.Debit : l.DrAmnt);
    const cr = parseMinorUnits(l.Credit != null ? l.Credit : l.CrAmnt);
    if (dr === null || cr === null) {
      hasInvalidAmount = true;
    } else {
      sumDrCents += dr;
      sumCrCents += cr;
    }
  }

  const lineCount = lines.length;
  const isZeroAmounts = sumDrCents === 0 && sumCrCents === 0;
  const diffCents = Math.abs(sumDrCents - sumCrCents);
  const isBalanced = !hasInvalidAmount && !isZeroAmounts && lineCount >= 2 && diffCents === 0;
  const balanceStatus = isBalanced ? 'สมดุล (Balanced)' : 'ไม่สมดุล (Unbalanced)';

  let postingStatus;
  let refInvoiceNo = '-';

  if (glHeader.DocuStatus === 'C') {
    postingStatus = 'ยกเลิก (Cancelled)';
    if (matchedInvoices.length === 1) {
      refInvoiceNo = matchedInvoices[0].DocuNo || '-';
    } else if (matchedInvoices.length > 1) {
      refInvoiceNo = matchedInvoices.map(i => i.DocuNo).join(', ');
    }
  } else if (matchedInvoices.length === 0) {
    if (glHeader.DocuStatus === 'N') {
      postingStatus = isBalanced ? 'ลงบัญชีแล้ว (ไม่พบใบกำกับอ้างอิง)' : 'ไม่สมดุล (Unbalanced)';
    } else {
      postingStatus = `สถานะ ${glHeader.DocuStatus} (Unconfirmed)`;
    }
  } else if (matchedInvoices.length === 1) {
    const inv = matchedInvoices[0];
    refInvoiceNo = inv.DocuNo || '-';

    const currentCandidate = {
      ...glHeader,
      LineCount: lineCount,
      SumDebit: sumDrCents / 100,
      SumCredit: sumCrCents / 100,
      InvalidLineCount: hasInvalidAmount ? 1 : 0,
      HasInvalidAmount: hasInvalidAmount
    };

    const candidates = Array.isArray(allGlCandidates) && allGlCandidates.length > 0
      ? allGlCandidates
      : [currentCandidate];

    const match = matchGlToInvoice(inv, candidates);

    if (!isBalanced || hasInvalidAmount) {
      postingStatus = 'ไม่สมดุล (Unbalanced)';
    } else if (['AMBIGUOUS', 'AMBIGUOUS_CONTRADICTORY'].includes(match.status)) {
      postingStatus = 'กำกวมหลายใบสำคัญ (Ambiguous Multiple GLs)';
    } else if (match.status === 'VERIFIED') {
      if (inv.PostGL !== 'Y') {
        postingStatus = 'ไม่สอดคล้อง (Inconsistent GL)';
      } else {
        postingStatus = 'ลงบัญชีแล้ว (Posted)';
      }
    } else {
      postingStatus = 'ไม่สอดคล้อง (Inconsistent GL)';
    }
  } else {
    // Multiple invoices referencing the same GL header
    refInvoiceNo = matchedInvoices.map(i => i.DocuNo).join(', ');
    postingStatus = 'กำกวมหลายใบกำกับ (Ambiguous Multiple Invoices)';
  }

  return {
    isBalanced,
    balanceStatus,
    postingStatus,
    refInvoiceNo,
    sumDebit: sumDrCents / 100,
    sumCredit: sumCrCents / 100,
    diffCents
  };
}

module.exports = {
  SHARED_GL_INVOICE_JOIN_SQL,
  parseMinorUnits,
  toCents,
  matchGlToInvoice,
  evaluateSoGlStatus,
  evaluateJournalHeader
};
