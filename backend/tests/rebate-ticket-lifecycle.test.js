const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TICKET_STATUS,
  AUDIT_TYPE,
  DEFAULT_VALIDITY_DAYS,
  DEFAULT_AGING_LIMIT_DAYS,
  addDays,
  diffDays,
  mapTicketRow,
  mapRedemptionRow,
  mapAuditRow,
  validateCustomerAging,
  assertAgingNotBlocked,
  insertAuditLog,
  issueTicketFromConversion,
  redeemTickets,
  extendExpiredTicket,
  grantAgingOverride,
  expireOverdueTickets,
  getExpiringTickets,
  getCustomerTickets,
} = require('../services/rebate-ticket-service');

/**
 * Lightweight in-memory SQL mock for wf.FertilizerTicket,
 * wf.TicketRedemptionHistory, wf.RebateAuditAndOverrideLog,
 * and dbo.SOInvHD (AR Aging).
 */
function createInMemoryTicketDb(options = {}) {
  const state = {
    tickets: [],
    redemptions: [],
    audits: [],
    sohdRows: options.sohdRows || [],
    nextTicketId: 1,
    nextRedemptionId: 1,
    nextAuditId: 1,
  };

  function pVal(v) {
    return v && typeof v === 'object' && 'value' in v ? v.value : v;
  }

  async function query(sqlText, params = {}) {
    const sql = String(sqlText || '');

    // INSERT INTO wf.FertilizerTicket
    if (/INSERT\s+INTO\s+wf\.FertilizerTicket\b/i.test(sql)) {
      const id = state.nextTicketId++;
      const row = {
        Id: id,
        TicketNo: pVal(params.ticketNo),
        ConversionId: pVal(params.conversionId) ?? null,
        CustId: Number(pVal(params.custId)),
        CustCode: pVal(params.custCode) ?? null,
        CustName: pVal(params.custName) ?? null,
        GoodId: Number(pVal(params.goodId)),
        GoodCode: pVal(params.goodCode),
        GoodName: pVal(params.goodName),
        Oct31ReferencePrice: Number(pVal(params.oct31ReferencePrice)),
        ConvertedRebateAmount: Number(pVal(params.convertedRebateAmount)),
        IssuedTonnage: Number(pVal(params.issuedTonnage)),
        RemainingTonnage: Number(pVal(params.remainingTonnage)),
        IssuedDate: pVal(params.issuedDate),
        ExpiryDate: pVal(params.expiryDate),
        ExtendedExpiryDate: null,
        Status: pVal(params.status),
        CreatedByUserId: pVal(params.createdByUserId) ?? null,
        CreatedAt: new Date(),
        UpdatedAt: new Date(),
      };
      state.tickets.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // SELECT single ticket by Id (with or without lock hints)
    if (/SELECT\s+\*\s+FROM\s+wf\.FertilizerTicket[\s\S]*WHERE\s+Id\s*=\s*@id/i.test(sql)) {
      const id = Number(pVal(params.id));
      const found = state.tickets.find(t => t.Id === id);
      return { recordset: found ? [{ ...found }] : [] };
    }

    // SELECT active tickets for customer (FIFO by expiry), supporting redemption query
    if (/FROM\s+wf\.FertilizerTicket[\s\S]*WHERE\s+CustId\s*=\s*@custId[\s\S]*RemainingTonnage\s*>\s*0/i.test(sql)) {
      const custId = Number(pVal(params.custId));
      const today = String(pVal(params.today) || '2999-12-31');
      const matched = state.tickets
        .filter(t =>
          t.CustId === custId &&
          t.RemainingTonnage > 0 &&
          ['ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE'].includes(t.Status) &&
          ((t.ExtendedExpiryDate && t.ExtendedExpiryDate >= today) ||
           (!t.ExtendedExpiryDate && t.ExpiryDate >= today))
        )
        .sort((a, b) => {
          const ea = a.ExtendedExpiryDate || a.ExpiryDate;
          const eb = b.ExtendedExpiryDate || b.ExpiryDate;
          return ea.localeCompare(eb) || a.IssuedDate.localeCompare(b.IssuedDate) || (a.Id - b.Id);
        });
      return { recordset: matched.map(t => ({ ...t })) };
    }

    // SELECT customer tickets (all or active only)
    if (/FROM\s+wf\.FertilizerTicket[\s\S]*WHERE\s+CustId\s*=\s*@custId/i.test(sql)) {
      const custId = Number(pVal(params.custId));
      const includeAll = !/AND Status IN/i.test(sql);
      const matched = state.tickets
        .filter(t => t.CustId === custId && (includeAll || ['ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE'].includes(t.Status)))
        .sort((a, b) => {
          const ea = a.ExtendedExpiryDate || a.ExpiryDate;
          const eb = b.ExtendedExpiryDate || b.ExpiryDate;
          return ea.localeCompare(eb) || (a.Id - b.Id);
        });
      return { recordset: matched.map(t => ({ ...t })) };
    }

    // UPDATE ticket (redemption: RemainingTonnage)
    if (/UPDATE\s+wf\.FertilizerTicket[\s\S]*SET\s+RemainingTonnage\s*=\s*@remainingAfter/i.test(sql)) {
      const id = Number(pVal(params.id));
      const row = state.tickets.find(t => t.Id === id);
      if (!row) return { recordset: [], rowsAffected: [0] };
      row.RemainingTonnage = Number(pVal(params.remainingAfter));
      row.Status = pVal(params.nextStatus);
      row.UpdatedAt = new Date();
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // UPDATE ticket (extension: ExtendedExpiryDate)
    if (/UPDATE\s+wf\.FertilizerTicket[\s\S]*SET\s+ExtendedExpiryDate\s*=\s*@newExpiryDate/i.test(sql)) {
      const id = Number(pVal(params.id));
      const row = state.tickets.find(t => t.Id === id);
      if (!row) return { recordset: [], rowsAffected: [0] };
      row.ExtendedExpiryDate = pVal(params.newExpiryDate);
      row.Status = pVal(params.newStatus);
      row.UpdatedAt = new Date();
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // UPDATE tickets to EXPIRED (daily cron)
    if (/UPDATE\s+wf\.FertilizerTicket[\s\S]*SET\s+Status\s*=\s*'EXPIRED'/i.test(sql)) {
      const today = String(pVal(params.today));
      const expired = [];
      for (const t of state.tickets) {
        if (
          ['ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE'].includes(t.Status) &&
          t.RemainingTonnage > 0
        ) {
          const effectiveExpiry = t.ExtendedExpiryDate || t.ExpiryDate;
          if (effectiveExpiry < today) {
            t.Status = 'EXPIRED';
            t.UpdatedAt = new Date();
            expired.push({ ...t });
          }
        }
      }
      return { recordset: expired, rowsAffected: [expired.length] };
    }

    // SELECT expiring tickets (warning query)
    if (/FROM\s+wf\.FertilizerTicket[\s\S]*ExpiryDate\s*<=\s*@warningDate/i.test(sql)) {
      const today = String(pVal(params.today) || '2020-01-01');
      const warningDate = String(pVal(params.warningDate) || '2999-12-31');
      const matched = state.tickets.filter(t => {
        if (!['ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE'].includes(t.Status)) return false;
        if (t.RemainingTonnage <= 0) return false;
        const eff = t.ExtendedExpiryDate || t.ExpiryDate;
        return eff <= warningDate && eff >= today;
      });
      return { recordset: matched.map(t => ({ ...t })) };
    }

    // INSERT INTO wf.TicketRedemptionHistory
    if (/INSERT\s+INTO\s+wf\.TicketRedemptionHistory/i.test(sql)) {
      const id = state.nextRedemptionId++;
      const row = {
        Id: id,
        TicketId: Number(pVal(params.ticketId)),
        SoId: pVal(params.soId) ?? null,
        DocNo: pVal(params.docNo) ?? null,
        RedemptionOrder: Number(pVal(params.redemptionOrder)),
        RedeemedTonnage: Number(pVal(params.redeemedTonnage)),
        RemainingBefore: Number(pVal(params.remainingBefore)),
        RemainingAfter: Number(pVal(params.remainingAfter)),
        RedeemedByUserId: pVal(params.redeemedByUserId) ?? null,
        RedeemedAt: new Date(),
        Note: pVal(params.note) ?? null,
      };
      state.redemptions.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // INSERT INTO wf.RebateAuditAndOverrideLog
    if (/INSERT\s+INTO\s+wf\.RebateAuditAndOverrideLog/i.test(sql)) {
      const id = state.nextAuditId++;
      const row = {
        Id: id,
        AuditType: pVal(params.auditType),
        EntityType: pVal(params.entityType),
        EntityId: pVal(params.entityId) ?? null,
        CustId: pVal(params.custId) ?? null,
        ActionPerformed: pVal(params.actionPerformed),
        Reason: pVal(params.reason),
        DetailsBefore: pVal(params.detailsBefore) ?? null,
        DetailsAfter: pVal(params.detailsAfter) ?? null,
        PerformedByUserId: Number(pVal(params.performedByUserId)),
        PerformedByRole: pVal(params.performedByRole) ?? null,
        ApprovedByUserId: pVal(params.approvedByUserId) ?? null,
        ApprovedByRole: pVal(params.approvedByRole) ?? null,
        PerformedAt: new Date(),
      };
      state.audits.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // SELECT MAX overdue from the WinSpeed accounts-receivable ledger.
    if (/FROM\s+dbo\.SOInvHD\s+i/i.test(sql)) {
      const custId = Number(pVal(params.custId));
      const today = String(pVal(params.today) || '2026-01-01');
      let maxDays = 0;
      let missingDates = 0;
      for (const sohd of state.sohdRows) {
        const remainder = sohd.RemaAmnt ?? ((sohd.TotalAmt || 0) - (sohd.PaidAmount || 0));
        const eligible = (sohd.ARID ?? sohd.CustID) === custId && remainder > 0.01 &&
          [107, 110, 115, 201, 202].includes(sohd.DocuType) &&
          !(sohd.DocuType === 107 && sohd.CouponFlag === 'Y') && sohd.DocuStatus !== 'C' && sohd.ReplaceFlag !== 'Y' && sohd.MultiCurrency !== 'Y';
        if (eligible) {
          const dueDate = sohd.DocuDate;
          if (!dueDate) { missingDates++; continue; }
          if (dueDate < today) {
            const due = new Date(dueDate + 'T00:00:00Z');
            const now = new Date(today + 'T00:00:00Z');
            const days = Math.floor((now - due) / 86400000);
            if (days > maxDays) maxDays = days;
          }
        }
      }
      return { recordset: [{ MaxOverdueDays: maxDays, MissingDateCount: missingDates }] };
    }

    // SELECT redemption history for ticket
    if (/FROM\s+wf\.TicketRedemptionHistory[\s\S]*WHERE\s+TicketId\s*=\s*@ticketId/i.test(sql)) {
      const ticketId = Number(pVal(params.ticketId));
      const matched = state.redemptions.filter(r => r.TicketId === ticketId).sort((a, b) => a.RedemptionOrder - b.RedemptionOrder);
      return { recordset: matched.map(r => ({ ...r })) };
    }

    // SELECT audit log
    if (/FROM\s+wf\.RebateAuditAndOverrideLog/i.test(sql)) {
      return { recordset: state.audits.map(a => ({ ...a })) };
    }

    throw new Error(`Unhandled mock SQL query: ${sql}`);
  }

  return { state, query };
}

// ─── Helper Tests ───────────────────────────────────────────────────────────

test('addDays calculates expiry correctly', () => {
  assert.equal(addDays('2026-01-01', 90), '2026-04-01');
  assert.equal(addDays('2026-11-01', 90), '2027-01-30');
  assert.equal(addDays('2026-12-15', 30), '2027-01-14');
});

test('diffDays returns correct day difference', () => {
  assert.equal(diffDays('2026-01-01', '2026-04-01'), 90);
  assert.equal(diffDays('2026-11-01', '2026-11-01'), 0);
  assert.equal(diffDays('2026-01-01', '2025-12-31'), -1);
});

// ─── AR Aging Validation Tests ──────────────────────────────────────────────

test('validateCustomerAging: customer with no overdue invoices is NOT blocked', async () => {
  const db = createInMemoryTicketDb({
    sohdRows: [
      { CustID: 100, DocuDate: '2026-10-01', DueDate: '2026-10-01', TotalAmt: 100000, PaidAmount: 100000, DocuType: 202, DocuStatus: 'A' },
    ],
  });

  const result = await validateCustomerAging(db.query, 100, { asOfDate: '2026-11-01' });
  assert.equal(result.isBlocked, false);
  assert.equal(result.maxOverdueDays, 0);
});

test('aging includes unpaid opening receivables and ignores coupon duplicate, credits and settled rows', async () => {
  const db = createInMemoryTicketDb({ sohdRows: [
    { ARID: 101, DocuDate: '2025-12-01', DueDate: '2026-02-01', RemaAmnt: 100, DocuType: 110 },
    { ARID: 101, DocuDate: '2024-01-01', DueDate: '2024-01-01', RemaAmnt: 100, DocuType: 107, CouponFlag: 'Y' },
    { ARID: 101, DocuDate: '2024-01-01', DueDate: '2024-01-01', RemaAmnt: 100, DocuType: 109 },
    { ARID: 101, DocuDate: '2024-01-01', DueDate: '2024-01-01', RemaAmnt: 0, DocuType: 202 },
  ] });
  const aging = await validateCustomerAging(db.query, 101, { asOfDate: '2026-02-01' });
  assert.equal(aging.maxOverdueDays, 62); assert.equal(aging.isBlocked, true);
});

test('unverified aging bypass and missing AR dates fail closed', async () => {
  const db = createInMemoryTicketDb({ sohdRows: [{ ARID: 102, RemaAmnt: 10, DocuType: 202 }] });
  await assert.rejects(validateCustomerAging(db.query, 102), { code: 'AGING_DATA_UNAVAILABLE' });
  await assert.rejects(assertAgingNotBlocked(db.query, 102, { agingOverrideGranted: true }), { code: 'AGING_OVERRIDE_UNVERIFIED' });
});

test('validateCustomerAging: customer with 61-day overdue IS blocked', async () => {
  const db = createInMemoryTicketDb({
    sohdRows: [
      { CustID: 200, DocuDate: '2026-09-01', DueDate: '2026-09-01', TotalAmt: 50000, PaidAmount: 0, DocuType: 202, DocuStatus: 'A' },
    ],
  });

  const result = await validateCustomerAging(db.query, 200, { asOfDate: '2026-11-01' });
  assert.equal(result.isBlocked, true);
  assert.equal(result.maxOverdueDays, 61);
  assert.equal(result.agingLimitDays, 60);
});

test('assertAgingNotBlocked throws AGING_BLOCKED when overdue > 60 days', async () => {
  const db = createInMemoryTicketDb({
    sohdRows: [
      { CustID: 300, DocuDate: '2026-08-01', DueDate: '2026-08-01', TotalAmt: 100000, PaidAmount: 0, DocuType: 202, DocuStatus: 'A' },
    ],
  });

  await assert.rejects(
    () => assertAgingNotBlocked(db.query, 300, { asOfDate: '2026-11-01' }),
    (err) => err.code === 'AGING_BLOCKED' && err.status === 403
  );

  // A boolean supplied by a caller is not an approved override.
  await assert.rejects(() => assertAgingNotBlocked(db.query, 300, { asOfDate: '2026-11-01', agingOverrideGranted: true }), { code: 'AGING_OVERRIDE_UNVERIFIED' });
});

// ─── Ticket Issuance Tests ──────────────────────────────────────────────────

test('issueTicketFromConversion creates ticket with 90-day validity', async () => {
  const db = createInMemoryTicketDb();
  const actorUser = { id: 901, role: 'ACCOUNTING' };

  const ticket = await issueTicketFromConversion(db.query, {
    conversionId: 1,
    custId: 500,
    custName: 'ร้านเกษตรรุ่งเรือง',
    goodId: 1094,
    goodCode: '15-7-18',
    goodName: 'ปุ๋ย 15-7-18',
    oct31ReferencePrice: 18000,
    convertedRebateAmount: 36000,
    issuedTonnage: 2,
    issuedDate: '2026-11-01',
    actorUser,
  });

  assert.equal(ticket.status, TICKET_STATUS.ACTIVE);
  assert.equal(ticket.issuedTonnage, 2);
  assert.equal(ticket.remainingTonnage, 2);
  assert.equal(ticket.issuedDate, '2026-11-01');
  assert.equal(ticket.expiryDate, '2027-01-30'); // 90 days
  assert.equal(ticket.oct31ReferencePrice, 18000);
  assert.equal(ticket.convertedRebateAmount, 36000);
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.state.audits[0].AuditType, AUDIT_TYPE.TICKET_ISSUED);
});

test('converter can select a valid expiry date, which is stored and audited', async () => {
  const db = createInMemoryTicketDb();
  const ticket = await issueTicketFromConversion(db.query, {
    conversionId: 1, custId: 500, goodId: 1094, goodCode: 'TEST', goodName: 'Test',
    oct31ReferencePrice: 18000, convertedRebateAmount: 18000, issuedTonnage: 1,
    issuedDate: '2026-11-01', expiryDate: '2027-04-30', actorUser: { id: 901, role: 'ACCOUNTING' },
  });
  assert.equal(ticket.expiryDate, '2027-04-30');
  assert.match(JSON.stringify(db.state.audits[0]), /2027-04-30/);
});

test('invalid or past chosen expiry is rejected before any ticket is issued', async () => {
  for (const expiryDate of ['2026-10-31', '2026-02-30']) {
    const db = createInMemoryTicketDb();
    await assert.rejects(issueTicketFromConversion(db.query, {
      conversionId: 1, custId: 500, goodId: 1094, goodCode: 'TEST', goodName: 'Test',
      oct31ReferencePrice: 18000, convertedRebateAmount: 18000, issuedTonnage: 1,
      issuedDate: '2026-11-01', expiryDate, actorUser: { id: 901, role: 'ACCOUNTING' },
    }), { code: 'INVALID_TICKET_EXPIRY' });
    assert.equal(db.state.tickets.length, 0);
  }
});

test('issueTicketFromConversion blocks when AR aging > 60 days', async () => {
  const db = createInMemoryTicketDb({
    sohdRows: [
      { CustID: 600, DocuDate: '2026-08-01', DueDate: '2026-08-01', TotalAmt: 100000, PaidAmount: 0, DocuType: 202, DocuStatus: 'A' },
    ],
  });

  await assert.rejects(
    () => issueTicketFromConversion(db.query, {
      custId: 600,
      goodId: 1094,
      goodCode: '15-7-18',
      goodName: 'ปุ๋ย 15-7-18',
      oct31ReferencePrice: 18000,
      convertedRebateAmount: 18000,
      issuedTonnage: 1,
      issuedDate: '2026-11-01',
      actorUser: { id: 1, role: 'ACCOUNTING' },
    }),
    (err) => err.code === 'AGING_BLOCKED'
  );

  // A boolean cannot stand in for an independently verified override.
  await assert.rejects(() => issueTicketFromConversion(db.query, {
    custId: 600,
    goodId: 1094,
    goodCode: '15-7-18',
    goodName: 'ปุ๋ย 15-7-18',
    oct31ReferencePrice: 18000,
    convertedRebateAmount: 18000,
    issuedTonnage: 1,
    issuedDate: '2026-11-01',
    actorUser: { id: 1, role: 'ACCOUNTING' },
    agingOverrideGranted: true,
  }), { code: 'AGING_OVERRIDE_UNVERIFIED' });
});

// ─── Ticket Redemption Tests ────────────────────────────────────────────────

test('redeemTickets: FIFO by expiry date (soonest first), partial + full redemption', async () => {
  const db = createInMemoryTicketDb();

  // Seed 3 tickets for customer 700:
  // Ticket A: expiry 2027-01-30 (issued 2026-11-01), 2 tons
  // Ticket B: expiry 2027-02-28 (issued 2026-12-01), 3 tons
  // Ticket C: expiry 2027-03-01 (issued 2026-12-02), 1.5 tons
  const seedTickets = [
    { id: 1, custId: 700, expiryDate: '2027-01-30', issuedDate: '2026-11-01', remainingTonnage: 2, status: 'ACTIVE' },
    { id: 2, custId: 700, expiryDate: '2027-02-28', issuedDate: '2026-12-01', remainingTonnage: 3, status: 'ACTIVE' },
    { id: 3, custId: 700, expiryDate: '2027-03-01', issuedDate: '2026-12-02', remainingTonnage: 1.5, status: 'ACTIVE' },
  ];
  for (const t of seedTickets) {
    state_seedTicket(db.state, t);
  }

  const result = await redeemTickets(db.query, {
    custId: 700,
    requestedTonnage: 3.5,
    soId: 9001,
    docNo: 'SO-TEST-001',
    actorUser: { id: 101, role: 'COUNTER_SALES' },
    asOfDate: '2026-12-15',
  });

  assert.equal(result.totalRedeemed, 3.5);
  assert.equal(result.allocations.length, 2);

  // Ticket A fully consumed (2 tons)
  assert.equal(result.allocations[0].ticketId, 1);
  assert.equal(result.allocations[0].redeemedTonnage, 2);
  assert.equal(result.allocations[0].remainingAfter, 0);
  assert.equal(result.allocations[0].resultingStatus, TICKET_STATUS.REDEEMED);

  // Ticket B partially consumed (1.5 of 3 tons)
  assert.equal(result.allocations[1].ticketId, 2);
  assert.equal(result.allocations[1].redeemedTonnage, 1.5);
  assert.equal(result.allocations[1].remainingAfter, 1.5);
  assert.equal(result.allocations[1].resultingStatus, TICKET_STATUS.PARTIALLY_USED);

  // Ticket C untouched
  assert.equal(db.state.tickets.find(t => t.Id === 3).RemainingTonnage, 1.5);

  // Redemption history recorded
  assert.equal(db.state.redemptions.length, 2);
  assert.equal(db.state.redemptions[0].TicketId, 1);
  assert.equal(db.state.redemptions[1].TicketId, 2);

  // Remaining available = 1.5 (B) + 1.5 (C) = 3.0
  assert.equal(result.remainingAvailable, 3);
});

test('redeemTickets: blocks when AR aging > 60 days', async () => {
  const db = createInMemoryTicketDb({
    sohdRows: [
      { CustID: 800, DocuDate: '2026-08-01', DueDate: '2026-08-01', TotalAmt: 50000, PaidAmount: 0, DocuType: 202, DocuStatus: 'A' },
    ],
  });
  state_seedTicket(db.state, { id: 1, custId: 800, expiryDate: '2027-03-01', issuedDate: '2026-12-01', remainingTonnage: 5, status: 'ACTIVE' });

  await assert.rejects(
    () => redeemTickets(db.query, {
      custId: 800,
      requestedTonnage: 1,
      actorUser: { id: 101, role: 'SALES' },
      asOfDate: '2026-11-01',
    }),
    (err) => err.code === 'AGING_BLOCKED'
  );
});

test('redeemTickets: insufficient balance throws error', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, { id: 1, custId: 900, expiryDate: '2027-03-01', issuedDate: '2026-12-01', remainingTonnage: 2, status: 'ACTIVE' });

  await assert.rejects(
    () => redeemTickets(db.query, {
      custId: 900,
      requestedTonnage: 5,
      actorUser: { id: 101, role: 'SALES' },
      asOfDate: '2026-12-15',
    }),
    (err) => err.code === 'INSUFFICIENT_TICKET_BALANCE'
  );
});

// ─── Expired Ticket Extension Tests ─────────────────────────────────────────

test('extendExpiredTicket: EXPIRED ticket gets EXTENDED_ACTIVE with new expiry date', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, {
    id: 1, custId: 400, expiryDate: '2026-12-31', issuedDate: '2026-10-01',
    remainingTonnage: 1.5, status: 'EXPIRED',
  });

  const extended = await extendExpiredTicket(db.query, {
    ticketId: 1,
    additionalDays: 30,
    reason: 'ลูกค้าชำระเงินแล้ว รอขนส่ง',
    actorUser: { id: 999, role: 'C_LEVEL' },
  });

  assert.equal(extended.status, TICKET_STATUS.EXTENDED_ACTIVE);
  assert.equal(extended.extendedExpiryDate, '2027-01-30'); // 2026-12-31 + 30
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.state.audits[0].AuditType, AUDIT_TYPE.TICKET_EXTENSION);
});

test('extendExpiredTicket: rejects non-EXPIRED tickets', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, {
    id: 1, custId: 400, expiryDate: '2027-03-01', issuedDate: '2026-12-01',
    remainingTonnage: 2, status: 'ACTIVE',
  });

  await assert.rejects(
    () => extendExpiredTicket(db.query, {
      ticketId: 1,
      reason: 'Test',
      actorUser: { id: 999, role: 'C_LEVEL' },
    }),
    (err) => err.code === 'INVALID_TICKET_STATUS_FOR_EXTENSION'
  );
});

test('extendExpiredTicket: rejects SALES role (unauthorized)', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, {
    id: 1, custId: 400, expiryDate: '2026-12-31', issuedDate: '2026-10-01',
    remainingTonnage: 1, status: 'EXPIRED',
  });

  await assert.rejects(
    () => extendExpiredTicket(db.query, {
      ticketId: 1,
      reason: 'Test reason',
      actorUser: { id: 101, role: 'SALES' },
    }),
    (err) => err.code === 'FORBIDDEN_EXTENSION_ROLE'
  );
});

test('extendExpiredTicket: rejects empty reason', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, {
    id: 1, custId: 400, expiryDate: '2026-12-31', issuedDate: '2026-10-01',
    remainingTonnage: 1, status: 'EXPIRED',
  });

  await assert.rejects(
    () => extendExpiredTicket(db.query, {
      ticketId: 1,
      reason: '',
      actorUser: { id: 999, role: 'C_LEVEL' },
    }),
    (err) => err.code === 'EXTENSION_REASON_REQUIRED'
  );
});

// ─── Aging Override Tests ───────────────────────────────────────────────────

test('grantAgingOverride: executive can override and audit is logged', async () => {
  const db = createInMemoryTicketDb({
    sohdRows: [
      { CustID: 1000, DocuDate: '2026-07-01', DueDate: '2026-07-01', TotalAmt: 200000, PaidAmount: 0, DocuType: 202, DocuStatus: 'A' },
    ],
  });

  const result = await grantAgingOverride(db.query, {
    custId: 1000,
    transactionType: 'CONVERSION',
    reason: 'ลูกค้าเก่าแก่ มีเครดิตดีย์ รอชำระเงินจากพืชผล',
    actorUser: { id: 888, role: 'C_LEVEL' },
  });

  assert.equal(result.overrideGranted, true);
  assert.equal(result.custId, 1000);
  assert.ok(result.maxOverdueDays > 60);
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.state.audits[0].AuditType, AUDIT_TYPE.AGING_OVERRIDE);
  assert.equal(db.state.audits[0].ActionPerformed, 'AGING_OVERRIDE_CONVERSION');
});

test('grantAgingOverride: SALES cannot override', async () => {
  const db = createInMemoryTicketDb();

  await assert.rejects(
    () => grantAgingOverride(db.query, {
      custId: 1000,
      transactionType: 'REDEMPTION',
      reason: 'Test',
      actorUser: { id: 101, role: 'SALES' },
    }),
    (err) => err.code === 'FORBIDDEN_AGING_OVERRIDE_ROLE'
  );
});

test('grantAgingOverride: empty reason rejected', async () => {
  const db = createInMemoryTicketDb();

  await assert.rejects(
    () => grantAgingOverride(db.query, {
      custId: 1000,
      transactionType: 'CONVERSION',
      reason: '',
      actorUser: { id: 888, role: 'C_LEVEL' },
    }),
    (err) => err.code === 'OVERRIDE_REASON_REQUIRED'
  );
});

// ─── Daily Expired Ticket Transition Tests ──────────────────────────────────

test('expireOverdueTickets: transitions past-due tickets to EXPIRED', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, { id: 1, custId: 100, expiryDate: '2026-11-30', issuedDate: '2026-09-01', remainingTonnage: 3, status: 'ACTIVE' });
  state_seedTicket(db.state, { id: 2, custId: 100, expiryDate: '2027-03-01', issuedDate: '2026-12-01', remainingTonnage: 2, status: 'ACTIVE' });
  state_seedTicket(db.state, { id: 3, custId: 200, expiryDate: '2026-12-15', issuedDate: '2026-09-15', remainingTonnage: 1, status: 'PARTIALLY_USED' });

  const result = await expireOverdueTickets(db.query, '2026-12-20');

  assert.equal(result.expiredCount, 2);  // Tickets 1 and 3
  assert.equal(db.state.tickets.find(t => t.Id === 1).Status, 'EXPIRED');
  assert.equal(db.state.tickets.find(t => t.Id === 2).Status, 'ACTIVE');  // Not expired yet
  assert.equal(db.state.tickets.find(t => t.Id === 3).Status, 'EXPIRED');
});

test('expireOverdueTickets: EXTENDED_ACTIVE respects extended expiry', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, {
    id: 1, custId: 100, expiryDate: '2026-11-30', issuedDate: '2026-09-01',
    remainingTonnage: 2, status: 'EXTENDED_ACTIVE',
    extendedExpiryDate: '2027-01-15',
  });

  const result1 = await expireOverdueTickets(db.query, '2026-12-20');
  assert.equal(result1.expiredCount, 0);  // Extended to 2027-01-15, NOT expired

  const result2 = await expireOverdueTickets(db.query, '2027-01-16');
  assert.equal(result2.expiredCount, 1);  // Now past extended expiry
  assert.equal(db.state.tickets[0].Status, 'EXPIRED');
});

// ─── Pre-Expiry Alert Tests ─────────────────────────────────────────────────

test('getExpiringTickets: returns tickets expiring within warningDays', async () => {
  const db = createInMemoryTicketDb();
  state_seedTicket(db.state, { id: 1, custId: 100, expiryDate: '2027-01-10', issuedDate: '2026-10-15', remainingTonnage: 2, status: 'ACTIVE' });
  state_seedTicket(db.state, { id: 2, custId: 200, expiryDate: '2027-02-01', issuedDate: '2026-11-01', remainingTonnage: 3, status: 'ACTIVE' });
  state_seedTicket(db.state, { id: 3, custId: 300, expiryDate: '2027-03-01', issuedDate: '2026-12-01', remainingTonnage: 1, status: 'ACTIVE' });

  const result15 = await getExpiringTickets(db.query, { warningDays: 15, asOfDate: '2027-01-01' });
  // Tickets expiring between 2027-01-01 and 2027-01-16: only ticket 1 (2027-01-10)
  assert.equal(result15.count, 1);
  assert.equal(result15.tickets[0].id, 1);

  const result7 = await getExpiringTickets(db.query, { warningDays: 7, asOfDate: '2027-01-01' });
  // Tickets expiring between 2027-01-01 and 2027-01-08: only ticket 1 is at 2027-01-10 so out of range
  assert.equal(result7.count, 0);
});

// ─── Full Lifecycle Integration Test ────────────────────────────────────────

test('Full lifecycle: issue → redeem partially → expire → extend → redeem remainder', async () => {
  const db = createInMemoryTicketDb();
  const accountant = { id: 901, role: 'ACCOUNTING' };
  const exec = { id: 999, role: 'C_LEVEL' };
  const sales = { id: 101, role: 'COUNTER_SALES' };

  // 1) Issue a ticket: 5 tons, valid from 2026-11-01 to 2027-01-30
  const ticket = await issueTicketFromConversion(db.query, {
    custId: 1500,
    goodId: 1094,
    goodCode: '15-7-18',
    goodName: 'ปุ๋ย 15-7-18',
    oct31ReferencePrice: 18000,
    convertedRebateAmount: 90000,
    issuedTonnage: 5,
    issuedDate: '2026-11-01',
    actorUser: accountant,
  });
  assert.equal(ticket.status, TICKET_STATUS.ACTIVE);
  assert.equal(ticket.remainingTonnage, 5);

  // 2) Redeem 2 tons on Dec 15
  const r1 = await redeemTickets(db.query, {
    custId: 1500,
    requestedTonnage: 2,
    soId: 9001,
    docNo: 'SO-001',
    actorUser: sales,
    asOfDate: '2026-12-15',
  });
  assert.equal(r1.totalRedeemed, 2);
  assert.equal(r1.allocations[0].remainingAfter, 3);
  assert.equal(r1.allocations[0].resultingStatus, TICKET_STATUS.PARTIALLY_USED);

  // 3) Expire (ticket still valid until 2027-01-30)
  const expire1 = await expireOverdueTickets(db.query, '2027-01-15');
  assert.equal(expire1.expiredCount, 0);

  // 4) Time passes: ticket expires on 2027-01-31
  const expire2 = await expireOverdueTickets(db.query, '2027-01-31');
  assert.equal(expire2.expiredCount, 1);
  assert.equal(db.state.tickets[0].Status, 'EXPIRED');

  // 5) Executive extends by 30 days (new expiry: 2027-03-01)
  const extended = await extendExpiredTicket(db.query, {
    ticketId: ticket.id,
    additionalDays: 30,
    reason: 'รอฤดูเก็บเกี่ยว ลูกค้าจะมารับปุ๋ย',
    actorUser: exec,
  });
  assert.equal(extended.status, TICKET_STATUS.EXTENDED_ACTIVE);
  assert.equal(extended.extendedExpiryDate, '2027-03-01'); // 2027-01-30 + 30 days

  // 6) Redeem remaining 3 tons
  const r2 = await redeemTickets(db.query, {
    custId: 1500,
    requestedTonnage: 3,
    soId: 9002,
    docNo: 'SO-002',
    actorUser: sales,
    asOfDate: '2027-02-15',
  });
  assert.equal(r2.totalRedeemed, 3);
  assert.equal(r2.allocations[0].remainingAfter, 0);
  assert.equal(r2.allocations[0].resultingStatus, TICKET_STATUS.REDEEMED);

  // Verify complete audit trail
  assert.ok(db.state.audits.length >= 4); // ISSUED, REDEMPTION, EXTENSION, REDEMPTION
  const auditTypes = db.state.audits.map(a => a.AuditType);
  assert.ok(auditTypes.includes(AUDIT_TYPE.TICKET_ISSUED));
  assert.ok(auditTypes.includes(AUDIT_TYPE.TICKET_REDEMPTION));
  assert.ok(auditTypes.includes(AUDIT_TYPE.TICKET_EXTENSION));
});

// ─── Seed helper ────────────────────────────────────────────────────────────

function state_seedTicket(state, data) {
  const row = {
    Id: data.id || state.nextTicketId++,
    TicketNo: data.ticketNo || `TKT-SEED-${String(data.id).padStart(4, '0')}`,
    ConversionId: data.conversionId ?? null,
    CustId: data.custId,
    CustCode: data.custCode ?? null,
    CustName: data.custName ?? null,
    GoodId: data.goodId || 1094,
    GoodCode: data.goodCode || '15-7-18',
    GoodName: data.goodName || 'ปุ๋ย 15-7-18',
    Oct31ReferencePrice: data.oct31ReferencePrice || 18000,
    ConvertedRebateAmount: data.convertedRebateAmount || 0,
    IssuedTonnage: data.issuedTonnage || data.remainingTonnage || 0,
    RemainingTonnage: data.remainingTonnage || 0,
    IssuedDate: data.issuedDate || '2026-11-01',
    ExpiryDate: data.expiryDate || '2027-01-30',
    ExtendedExpiryDate: data.extendedExpiryDate || null,
    Status: data.status || 'ACTIVE',
    CreatedByUserId: data.createdByUserId ?? null,
    CreatedAt: new Date(),
    UpdatedAt: new Date(),
  };
  if (row.Id >= state.nextTicketId) state.nextTicketId = row.Id + 1;
  state.tickets.push(row);
  return row;
}

