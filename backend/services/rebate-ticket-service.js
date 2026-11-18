/**
 * RebateTicketService
 *
 * Implements Business Specification Sections 4 & 5:
 *   Section 4: Fertilizer Ticket Validity & Redemption Rules
 *     - 90-day validity from issued_date
 *     - FIFO redemption by expiry_date (soonest-expiring first)
 *     - Partial redemption across multiple orders
 *     - Daily scheduled job to expire past-due tickets
 *     - Pre-expiry alerts (15-day and 7-day warnings)
 *   Section 5: Credit & AR Aging Policy (≤60 days) & Executive Exception
 *     - AR Aging constraint for conversion and redemption
 *     - Executive override for aging > 60 days
 *     - Expired ticket extension workflow (EXPIRED → EXTENDED_ACTIVE)
 *     - Immutable audit trail for all overrides and extensions
 */

const { wfTransaction, sql } = require('../db');
const { defaultRebateQuery: wfQuery, transactionQuery } = require('./rebate-sql');
const { getBangkokDateString } = require('./so-pickup-policy');
const { hasPermission } = require('./role-capabilities');
const { approvalIdentity } = require('./approval-identity');
const { getSettingValue, logChangeEvent } = require('./policy-contract');
const { broadcast } = require('./socket');
const {
  REBATE_CONSTANTS,
  round2,
  round4,
  formatYmd,
  generateDocCode,
} = require('./rebate-pool-models');
const { createRebateError } = require('./rebate-calculator-service');

function bothHaveCapability(user, capability) {
  const identity = approvalIdentity(user);
  if (identity.impersonating && !identity.actorRoles.length) return false;
  const actor = identity.impersonating ? { role: user.actorRole, roles: user.actorRoles, permissions: user.actorPermissions } : user;
  return hasPermission(user, capability) && hasPermission(actor, capability);
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TICKET_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PARTIALLY_USED: 'PARTIALLY_USED',
  REDEEMED: 'REDEEMED',
  EXPIRED: 'EXPIRED',
  EXTENDED_ACTIVE: 'EXTENDED_ACTIVE',
  CANCELLED: 'CANCELLED',
});

const AUDIT_TYPE = Object.freeze({
  AGING_OVERRIDE: 'AGING_OVERRIDE',
  TICKET_EXTENSION: 'TICKET_EXTENSION',
  TICKET_REDEMPTION: 'TICKET_REDEMPTION',
  TICKET_ISSUED: 'TICKET_ISSUED',
  TICKET_EXPIRED: 'TICKET_EXPIRED',
  TICKET_CANCELLED: 'TICKET_CANCELLED',
});

const DEFAULT_VALIDITY_DAYS = 90;
const DEFAULT_AGING_LIMIT_DAYS = 60;
const BAGS_PER_TON = REBATE_CONSTANTS.BAGS_PER_TON || 20;

// ─── Helpers ────────────────────────────────────────────────────────────────

function addDays(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return formatYmd(d);
}

function diffDays(fromYmd, toYmd) {
  const a = new Date(fromYmd + 'T00:00:00Z');
  const b = new Date(toYmd + 'T00:00:00Z');
  return Math.floor((b - a) / 86400000);
}

function mapTicketRow(row) {
  if (!row) return null;
  const expiryDate = formatYmd(row.ExpiryDate ?? row.expiry_date);
  const extendedExpiryDate = formatYmd(row.ExtendedExpiryDate ?? row.extended_expiry_date);
  const effectiveExpiryDate = extendedExpiryDate || expiryDate;
  return {
    id: row.Id != null ? Number(row.Id) : (row.id ?? null),
    ticketNo: row.TicketNo ?? row.ticket_no ?? null,
    conversionId: row.ConversionId != null ? Number(row.ConversionId) : null,
    custId: Number(row.CustId ?? row.cust_id),
    custCode: row.CustCode ?? row.cust_code ?? null,
    custName: row.CustName ?? row.cust_name ?? null,
    goodId: Number(row.GoodId ?? row.good_id),
    goodCode: row.GoodCode ?? row.good_code ?? null,
    goodName: row.GoodName ?? row.good_name ?? null,
    oct31ReferencePrice: round2(row.Oct31ReferencePrice ?? row.oct31_reference_price ?? 0),
    convertedRebateAmount: round2(row.ConvertedRebateAmount ?? row.converted_rebate_amount ?? 0),
    issuedTonnage: round4(row.IssuedTonnage ?? row.issued_tonnage ?? 0),
    remainingTonnage: round4(row.RemainingTonnage ?? row.remaining_tonnage ?? 0),
    issuedDate: formatYmd(row.IssuedDate ?? row.issued_date),
    expiryDate,
    extendedExpiryDate,
    effectiveExpiryDate,
    status: row.Status ?? row.status ?? TICKET_STATUS.ACTIVE,
    createdByUserId: row.CreatedByUserId != null ? Number(row.CreatedByUserId) : null,
    createdAt: row.CreatedAt ?? row.created_at ?? null,
    updatedAt: row.UpdatedAt ?? row.updated_at ?? null,
  };
}

function mapRedemptionRow(row) {
  if (!row) return null;
  return {
    id: row.Id != null ? Number(row.Id) : (row.id ?? null),
    ticketId: Number(row.TicketId ?? row.ticket_id),
    soId: row.SoId != null ? Number(row.SoId) : null,
    docNo: row.DocNo ?? row.doc_no ?? null,
    redemptionOrder: Number(row.RedemptionOrder ?? row.redemption_order ?? 0),
    redeemedTonnage: round4(row.RedeemedTonnage ?? row.redeemed_tonnage ?? 0),
    remainingBefore: round4(row.RemainingBefore ?? row.remaining_before ?? 0),
    remainingAfter: round4(row.RemainingAfter ?? row.remaining_after ?? 0),
    redeemedByUserId: row.RedeemedByUserId != null ? Number(row.RedeemedByUserId) : null,
    redeemedAt: row.RedeemedAt ?? row.redeemed_at ?? null,
    note: row.Note ?? row.note ?? null,
  };
}

function mapAuditRow(row) {
  if (!row) return null;
  return {
    id: row.Id != null ? Number(row.Id) : (row.id ?? null),
    auditType: row.AuditType ?? row.audit_type ?? null,
    entityType: row.EntityType ?? row.entity_type ?? null,
    entityId: row.EntityId != null ? Number(row.EntityId) : null,
    custId: row.CustId != null ? Number(row.CustId) : null,
    actionPerformed: row.ActionPerformed ?? row.action_performed ?? null,
    reason: row.Reason ?? row.reason ?? null,
    detailsBefore: row.DetailsBefore ?? row.details_before ?? null,
    detailsAfter: row.DetailsAfter ?? row.details_after ?? null,
    performedByUserId: Number(row.PerformedByUserId ?? row.performed_by_user_id),
    performedByRole: row.PerformedByRole ?? row.performed_by_role ?? null,
    approvedByUserId: row.ApprovedByUserId != null ? Number(row.ApprovedByUserId) : null,
    approvedByRole: row.ApprovedByRole ?? row.approved_by_role ?? null,
    performedAt: row.PerformedAt ?? row.performed_at ?? null,
  };
}

// ─── AR Aging Validation ────────────────────────────────────────────────────

/**
 * Checks age from AR document date, including unpaid opening balances.
 * Returns { isBlocked, maxOverdueDays, agingLimitDays }.
 */
async function validateCustomerAging(queryFn = wfQuery, custId, options = {}) {
  const numericCustId = Number(custId);
  if (!Number.isInteger(numericCustId) || numericCustId <= 0) {
    throw createRebateError('กรุณาระบุรหัสลูกค้าที่ถูกต้อง', {
      status: 400,
      code: 'INVALID_CUSTOMER',
    });
  }

  const agingLimitDays = Number(options.agingLimitDays) || DEFAULT_AGING_LIMIT_DAYS;
  const today = formatYmd(options.asOfDate) || getBangkokDateString();

  // Use the WinSpeed AR ledger, including unpaid opening balances. SOHD does
  // not contain paid amount or due date on the SQL 2008 installation.
  const res = await queryFn(
    `SELECT ISNULL(MAX(DATEDIFF(DAY, i.DocuDate, @today)), 0) AS MaxOverdueDays,
       ISNULL(SUM(CASE WHEN i.DocuDate IS NULL THEN 1 ELSE 0 END), 0) AS MissingDateCount
     FROM dbo.SOInvHD i ${options.lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
     WHERE i.ARID = @custId
       AND i.DocuType IN (107, 110, 115, 201, 202)
       AND NOT (i.DocuType = 107 AND ISNULL(i.CouponFlag, 'N') = 'Y')
       AND ISNULL(i.MultiCurrency, 'N') = 'N'
       AND ISNULL(i.DocuStatus, 'N') <> 'C'
       AND ISNULL(i.ReplaceFlag, 'N') <> 'Y'
       AND ISNULL(i.RemaAmnt, 0) > 0.01`,
    { custId: numericCustId, today }
  );

  if (!res.recordset?.[0] || Number(res.recordset[0].MissingDateCount || 0) > 0) {
    throw createRebateError('ไม่สามารถตรวจวันที่เอกสารลูกหนี้ได้', { status: 503, code: 'AGING_DATA_UNAVAILABLE' });
  }
  const maxOverdueDays = Math.max(0, Number(res.recordset[0].MaxOverdueDays || 0));

  return {
    custId: numericCustId,
    maxOverdueDays,
    maxDocumentAgeDays: maxOverdueDays,
    ageBasis: 'DOCUMENT_DATE',
    agingLimitDays,
    isBlocked: maxOverdueDays > agingLimitDays,
    asOfDate: today,
  };
}

/**
 * Asserts that a customer's AR aging does NOT exceed the limit.
 * Throws AGING_BLOCKED if it does, unless an override token is provided.
 */
async function assertAgingNotBlocked(queryFn, custId, options = {}) {
  // A caller-controlled boolean is not evidence of an approved override.
  // Keep overrides closed until the approval record is linked and consumed.
  if (options.agingOverrideGranted) throw createRebateError('ยังไม่สามารถใช้รายการยกเว้นอายุหนี้ได้', { status: 409, code: 'AGING_OVERRIDE_UNVERIFIED' });
  const aging = await validateCustomerAging(queryFn, custId, options);
  if (aging.isBlocked) {
    throw createRebateError(
      `ลูกค้ารหัส ${custId} มีอายุเอกสารลูกหนี้คงค้างเกิน ${aging.agingLimitDays} วัน (${aging.maxDocumentAgeDays} วัน) ไม่สามารถแปลง/ใช้ตั๋วปุ๋ยได้`,
      {
        status: 403,
        code: 'AGING_BLOCKED',
        details: {
          custId: aging.custId,
          maxOverdueDays: aging.maxOverdueDays,
          agingLimitDays: aging.agingLimitDays,
        },
      }
    );
  }
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

async function insertAuditLog(queryFn, auditData) {
  const res = await queryFn(
    `INSERT INTO wf.RebateAuditAndOverrideLog (
       AuditType, EntityType, EntityId, CustId,
       ActionPerformed, Reason, DetailsBefore, DetailsAfter,
       PerformedByUserId, PerformedByRole, ApprovedByUserId, ApprovedByRole
     )
     OUTPUT INSERTED.*
     VALUES (
       @auditType, @entityType, @entityId, @custId,
       @actionPerformed, @reason, @detailsBefore, @detailsAfter,
       @performedByUserId, @performedByRole, @approvedByUserId, @approvedByRole
     )`,
    {
      auditType: auditData.auditType,
      entityType: auditData.entityType,
      entityId: auditData.entityId ?? null,
      custId: auditData.custId ?? null,
      actionPerformed: auditData.actionPerformed,
      reason: auditData.reason || '',
      detailsBefore: auditData.detailsBefore ? JSON.stringify(auditData.detailsBefore) : null,
      detailsAfter: auditData.detailsAfter ? JSON.stringify(auditData.detailsAfter) : null,
      performedByUserId: auditData.performedByUserId,
      performedByRole: auditData.performedByRole ?? null,
      approvedByUserId: auditData.approvedByUserId ?? null,
      approvedByRole: auditData.approvedByRole ?? null,
    }
  );
  return mapAuditRow(res.recordset?.[0]);
}

// ─── Ticket Issuance (after conversion) ─────────────────────────────────────

/**
 * Issues a Fertilizer Ticket from a completed conversion.
 * Links back to FertilizerTicketConversion; the converter may select an
 * expiry date, otherwise the configured/default validity is applied.
 * and inserts into wf.FertilizerTicket.
 */
async function issueTicketFromConversion(queryFnOrUndefined, params = {}) {
  const {
    conversionId = null,
    custId,
    custCode = null,
    custName = null,
    goodId,
    goodCode,
    goodName,
    oct31ReferencePrice,
    convertedRebateAmount,
    issuedTonnage,
    issuedDate = null,
    validityDays = DEFAULT_VALIDITY_DAYS,
    expiryDate: selectedExpiryDate = null,
    actorUser = null,
    asOfDate = null,
    agingOverrideGranted = false,
  } = params;

  const today = formatYmd(issuedDate) || formatYmd(asOfDate) || getBangkokDateString();
  const { isValidStartDate } = require('./data-window');
  if (!isValidStartDate(today) || !Number.isInteger(validityDays) || validityDays < 1) {
    throw createRebateError('วันออกหรืออายุตั๋วไม่ถูกต้อง', { status: 400, code: 'INVALID_TICKET_VALIDITY' });
  }
  const expiryDate = selectedExpiryDate == null ? addDays(today, validityDays) : String(selectedExpiryDate);
  if (!isValidStartDate(expiryDate) || expiryDate < today) {
    throw createRebateError('วันหมดอายุต้องเป็นวันที่ถูกต้องและไม่ก่อนวันแปลง', { status: 400, code: 'INVALID_TICKET_EXPIRY' });
  }
  const ticketNo = params.ticketNo || generateDocCode('TKT', today);

  const runInTx = async (txQuery) => {
    // Aging check before issuing
    await assertAgingNotBlocked(txQuery, custId, { agingOverrideGranted, asOfDate: today });

    const res = await txQuery(
      `INSERT INTO wf.FertilizerTicket (
         TicketNo, ConversionId, CustId, CustCode, CustName,
         GoodId, GoodCode, GoodName,
         Oct31ReferencePrice, ConvertedRebateAmount,
         IssuedTonnage, RemainingTonnage,
         IssuedDate, ExpiryDate,
         Status, CreatedByUserId
       )
       OUTPUT INSERTED.*
       VALUES (
         @ticketNo, @conversionId, @custId, @custCode, @custName,
         @goodId, @goodCode, @goodName,
         @oct31ReferencePrice, @convertedRebateAmount,
         @issuedTonnage, @remainingTonnage,
         @issuedDate, @expiryDate,
         @status, @createdByUserId
       )`,
      {
        ticketNo,
        conversionId: conversionId ?? null,
        custId: Number(custId),
        custCode,
        custName,
        goodId: Number(goodId),
        goodCode,
        goodName,
        oct31ReferencePrice: round2(oct31ReferencePrice),
        convertedRebateAmount: round2(convertedRebateAmount),
        issuedTonnage: round4(issuedTonnage),
        remainingTonnage: round4(issuedTonnage),
        issuedDate: today,
        expiryDate,
        status: TICKET_STATUS.ACTIVE,
        createdByUserId: actorUser?.id ?? null,
      }
    );

    const ticket = mapTicketRow(res.recordset?.[0]);

    // Audit trail
    await insertAuditLog(txQuery, {
      auditType: AUDIT_TYPE.TICKET_ISSUED,
      entityType: 'FERTILIZER_TICKET',
      entityId: ticket.id,
      custId: ticket.custId,
      actionPerformed: 'ISSUE_TICKET',
      reason: `Issued ticket ${ticketNo} for ${round4(issuedTonnage)} tons, valid until ${expiryDate}`,
      detailsAfter: ticket,
      performedByUserId: actorUser?.id ?? 0,
      performedByRole: actorUser?.role ?? null,
    });

    return ticket;
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  return wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
}

// ─── Ticket Redemption (FIFO by expiry_date) ────────────────────────────────

/**
 * Redeems fertilizer tickets for a customer order.
 * FIFO by effective expiry date (soonest-expiring tickets first).
 * AR Aging check is enforced before redemption.
 *
 * @returns {{ redeemedTonnage, allocations, updatedTickets }}
 */
async function redeemTickets(queryFnOrUndefined, params = {}) {
  const {
    custId,
    requestedTonnage,
    soId = null,
    docNo = null,
    actorUser = null,
    asOfDate = null,
    agingOverrideGranted = false,
    note = null,
  } = params;

  const numericCustId = Number(custId);
  const tonnage = round4(Number(requestedTonnage));
  if (!Number.isInteger(numericCustId) || numericCustId <= 0) {
    throw createRebateError('กรุณาระบุรหัสลูกค้าที่ถูกต้อง', {
      status: 400,
      code: 'INVALID_CUSTOMER',
    });
  }
  if (!Number.isFinite(tonnage) || tonnage <= 0) {
    throw createRebateError('จำนวนตันที่ต้องการใช้ตั๋วปุ๋ยต้องมากกว่า 0', {
      status: 400,
      code: 'INVALID_REDEMPTION_TONNAGE',
    });
  }

  const today = formatYmd(asOfDate) || getBangkokDateString();

  const runInTx = async (txQuery) => {
    // Aging check
    await assertAgingNotBlocked(txQuery, numericCustId, { agingOverrideGranted, asOfDate: today });

    // Fetch active tickets sorted by effective expiry date (FIFO soonest first)
    const ticketRes = await txQuery(
      `SELECT *
       FROM wf.FertilizerTicket WITH (UPDLOCK, ROWLOCK)
       WHERE CustId = @custId
         AND RemainingTonnage > 0
         AND Status IN ('ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE')
         AND (
           (ExtendedExpiryDate IS NOT NULL AND ExtendedExpiryDate >= @today)
           OR (ExtendedExpiryDate IS NULL AND ExpiryDate >= @today)
         )
       ORDER BY
         ISNULL(ExtendedExpiryDate, ExpiryDate) ASC,
         IssuedDate ASC,
         Id ASC`,
      { custId: numericCustId, today }
    );

    const tickets = (ticketRes.recordset || []).map(mapTicketRow);
    const totalAvailable = round4(tickets.reduce((s, t) => s + t.remainingTonnage, 0));

    if (totalAvailable <= 0) {
      throw createRebateError('ไม่มีตั๋วปุ๋ยที่ใช้งานได้สำหรับลูกค้ารายนี้', {
        status: 400,
        code: 'NO_ACTIVE_TICKETS',
      });
    }
    if (tonnage > totalAvailable) {
      throw createRebateError(
        `ตั๋วปุ๋ยคงเหลือไม่เพียงพอ (มี ${totalAvailable} ตัน แต่ขอใช้ ${tonnage} ตัน)`,
        {
          status: 400,
          code: 'INSUFFICIENT_TICKET_BALANCE',
          details: { totalAvailable, requestedTonnage: tonnage },
        }
      );
    }

    // FIFO deduction loop
    let remainingToDeduct = tonnage;
    let redemptionOrder = 0;
    const allocations = [];
    const updatedTickets = [];

    for (const ticket of tickets) {
      if (remainingToDeduct <= 0) break;
      if (ticket.remainingTonnage <= 0) continue;

      const deduct = round4(Math.min(ticket.remainingTonnage, remainingToDeduct));
      if (deduct <= 0) continue;

      const remainingAfter = round4(ticket.remainingTonnage - deduct);
      const nextStatus = remainingAfter <= 0
        ? TICKET_STATUS.REDEEMED
        : TICKET_STATUS.PARTIALLY_USED;

      redemptionOrder += 1;

      // Update ticket
      const updRes = await txQuery(
        `UPDATE wf.FertilizerTicket
         SET RemainingTonnage = @remainingAfter,
             Status = @nextStatus,
             UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
         OUTPUT INSERTED.*
         WHERE Id = @id`,
        {
          id: ticket.id,
          remainingAfter,
          nextStatus,
        }
      );

      // Insert redemption history
      await txQuery(
        `INSERT INTO wf.TicketRedemptionHistory (
           TicketId, SoId, DocNo, RedemptionOrder,
           RedeemedTonnage, RemainingBefore, RemainingAfter,
           RedeemedByUserId, Note
         )
         VALUES (
           @ticketId, @soId, @docNo, @redemptionOrder,
           @redeemedTonnage, @remainingBefore, @remainingAfter,
           @redeemedByUserId, @note
         )`,
        {
          ticketId: ticket.id,
          soId: soId ?? null,
          docNo: docNo ?? null,
          redemptionOrder,
          redeemedTonnage: deduct,
          remainingBefore: ticket.remainingTonnage,
          remainingAfter,
          redeemedByUserId: actorUser?.id ?? null,
          note: note ?? null,
        }
      );

      allocations.push({
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        redemptionOrder,
        redeemedTonnage: deduct,
        remainingBefore: ticket.remainingTonnage,
        remainingAfter,
        resultingStatus: nextStatus,
      });

      updatedTickets.push(mapTicketRow(updRes.recordset?.[0]) || {
        ...ticket,
        remainingTonnage: remainingAfter,
        status: nextStatus,
      });

      remainingToDeduct = round4(remainingToDeduct - deduct);
    }

    if (remainingToDeduct > 0.0001) {
      throw createRebateError('ไม่สามารถตัดยอดตั๋วปุ๋ย FIFO ได้ครบตามจำนวนที่ขอ', {
        status: 409,
        code: 'FIFO_REDEMPTION_INCOMPLETE',
      });
    }

    const totalRedeemed = round4(allocations.reduce((s, a) => s + a.redeemedTonnage, 0));

    // Audit trail
    await insertAuditLog(txQuery, {
      auditType: AUDIT_TYPE.TICKET_REDEMPTION,
      entityType: 'FERTILIZER_TICKET',
      entityId: soId,
      custId: numericCustId,
      actionPerformed: 'REDEEM_TICKETS',
      reason: `Redeemed ${totalRedeemed} tons across ${allocations.length} tickets for SO ${docNo || soId || 'N/A'}`,
      detailsAfter: { allocations },
      performedByUserId: actorUser?.id ?? 0,
      performedByRole: actorUser?.role ?? null,
    });

    try {
      broadcast('ticket_redeemed', {
        custId: numericCustId,
        totalRedeemed,
        ticketCount: allocations.length,
      });
    } catch { /* non-fatal */ }

    return {
      custId: numericCustId,
      totalRedeemed,
      remainingAvailable: round4(totalAvailable - totalRedeemed),
      allocations,
      updatedTickets,
    };
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  return wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
}

// ─── Expired Ticket Extension (Executive Override) ──────────────────────────

/**
 * Extends an expired ticket's validity by adding days.
 * Requires ROLE_EXECUTIVE / C_LEVEL / ADMIN + mandatory reason.
 */
async function extendExpiredTicket(queryFnOrUndefined, params = {}) {
  const {
    ticketId,
    additionalDays = 30,
    reason,
    actorUser,
  } = params;

  if (!actorUser || !actorUser.id) {
    throw createRebateError('กรุณาเข้าสู่ระบบก่อนดำเนินการ', {
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  }

  const canExtend = bothHaveCapability(actorUser, 'rebate.ticket-extend');

  if (!canExtend) {
    throw createRebateError(
      'เฉพาะผู้บริหาร (C_LEVEL / ADMIN) เท่านั้นที่สามารถต่ออายุตั๋วปุ๋ยที่หมดอายุได้',
      { status: 403, code: 'FORBIDDEN_EXTENSION_ROLE' }
    );
  }

  const extensionReason = String(reason || '').trim();
  if (!extensionReason) {
    throw createRebateError('กรุณาระบุเหตุผลในการขอต่ออายุตั๋วปุ๋ย', {
      status: 400,
      code: 'EXTENSION_REASON_REQUIRED',
    });
  }

  const days = Math.max(1, parseInt(additionalDays, 10) || 30);

  const runInTx = async (txQuery) => {
    // Fetch ticket with lock
    const ticketRes = await txQuery(
      `SELECT * FROM wf.FertilizerTicket WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`,
      { id: ticketId }
    );
    const ticket = mapTicketRow(ticketRes.recordset?.[0]);
    if (!ticket) {
      throw createRebateError('ไม่พบตั๋วปุ๋ยที่ต้องการต่ออายุ', {
        status: 404,
        code: 'TICKET_NOT_FOUND',
      });
    }

    if (ticket.status !== TICKET_STATUS.EXPIRED) {
      throw createRebateError(
        `ไม่สามารถต่ออายุตั๋วที่มีสถานะ ${ticket.status} ได้ (ต้องเป็น EXPIRED เท่านั้น)`,
        { status: 409, code: 'INVALID_TICKET_STATUS_FOR_EXTENSION' }
      );
    }

    if (ticket.remainingTonnage <= 0) {
      throw createRebateError('ตั๋วปุ๋ยนี้ถูกใช้หมดแล้ว ไม่สามารถต่ออายุได้', {
        status: 409,
        code: 'TICKET_FULLY_REDEEMED',
      });
    }

    const baseDate = ticket.extendedExpiryDate || ticket.expiryDate;
    const newExpiryDate = addDays(baseDate, days);

    const updRes = await txQuery(
      `UPDATE wf.FertilizerTicket
       SET ExtendedExpiryDate = @newExpiryDate,
           Status = @newStatus,
           UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
       OUTPUT INSERTED.*
       WHERE Id = @id`,
      {
        id: ticketId,
        newExpiryDate,
        newStatus: TICKET_STATUS.EXTENDED_ACTIVE,
      }
    );

    const updated = mapTicketRow(updRes.recordset?.[0]);

    // Immutable audit trail
    await insertAuditLog(txQuery, {
      auditType: AUDIT_TYPE.TICKET_EXTENSION,
      entityType: 'FERTILIZER_TICKET',
      entityId: ticketId,
      custId: ticket.custId,
      actionPerformed: 'EXTEND_EXPIRED_TICKET',
      reason: extensionReason,
      detailsBefore: {
        status: ticket.status,
        expiryDate: ticket.expiryDate,
        extendedExpiryDate: ticket.extendedExpiryDate,
      },
      detailsAfter: {
        status: updated.status,
        extendedExpiryDate: updated.extendedExpiryDate,
        additionalDays: days,
      },
      performedByUserId: actorUser.id,
      performedByRole: actorUser.role || null,
      approvedByUserId: actorUser.id,
      approvedByRole: actorUser.role || null,
    });

    return updated;
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  return wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
}

// ─── Aging Override (Executive Exception) ───────────────────────────────────

/**
 * Grants a temporary aging override for a customer, allowing
 * ticket conversion or redemption despite AR > 60 days.
 */
async function grantAgingOverride(queryFnOrUndefined, params = {}) {
  const {
    custId,
    transactionType,  // 'CONVERSION' | 'REDEMPTION'
    reason,
    actorUser,
  } = params;

  if (!actorUser || !actorUser.id) {
    throw createRebateError('กรุณาเข้าสู่ระบบก่อนดำเนินการ', {
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  }

  const canOverride = bothHaveCapability(actorUser, 'rebate.aging-override');

  if (!canOverride) {
    throw createRebateError(
      'เฉพาะผู้บริหาร (C_LEVEL / MANAGER / ADMIN) เท่านั้นที่สามารถปลดล็อกข้อจำกัด Aging ได้',
      { status: 403, code: 'FORBIDDEN_AGING_OVERRIDE_ROLE' }
    );
  }

  const overrideReason = String(reason || '').trim();
  if (!overrideReason) {
    throw createRebateError('กรุณาระบุเหตุผลในการปลดล็อก Aging', {
      status: 400,
      code: 'OVERRIDE_REASON_REQUIRED',
    });
  }

  const txType = String(transactionType || 'GENERAL').toUpperCase();

  const runInTx = async (txQuery) => {
    const aging = await validateCustomerAging(txQuery, custId);

    const auditEntry = await insertAuditLog(txQuery, {
      auditType: AUDIT_TYPE.AGING_OVERRIDE,
      entityType: 'CUSTOMER_AGING',
      entityId: null,
      custId: Number(custId),
      actionPerformed: `AGING_OVERRIDE_${txType}`,
      reason: overrideReason,
      detailsBefore: {
        maxOverdueDays: aging.maxOverdueDays,
        agingLimitDays: aging.agingLimitDays,
        isBlocked: aging.isBlocked,
      },
      detailsAfter: {
        overrideGranted: true,
        transactionType: txType,
      },
      performedByUserId: actorUser.id,
      performedByRole: actorUser.role || null,
      approvedByUserId: actorUser.id,
      approvedByRole: actorUser.role || null,
    });

    return {
      overrideGranted: true,
      custId: Number(custId),
      transactionType: txType,
      maxOverdueDays: aging.maxOverdueDays,
      auditId: auditEntry?.id ?? null,
    };
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  return wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
}

// ─── Daily Expired Ticket Transition ────────────────────────────────────────

/**
 * Daily scheduled job: Transitions ACTIVE/PARTIALLY_USED/EXTENDED_ACTIVE
 * tickets past their effective expiry date to EXPIRED.
 */
async function expireOverdueTickets(queryFn = wfQuery, asOfDate = null) {
  const today = formatYmd(asOfDate) || getBangkokDateString();

  const res = await queryFn(
    `UPDATE wf.FertilizerTicket
     SET Status = 'EXPIRED',
         UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
     OUTPUT INSERTED.*
     WHERE Status IN ('ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE')
       AND RemainingTonnage > 0
       AND (
         (ExtendedExpiryDate IS NOT NULL AND ExtendedExpiryDate < @today)
         OR (ExtendedExpiryDate IS NULL AND ExpiryDate < @today)
       )`,
    { today }
  );

  const expired = (res.recordset || []).map(mapTicketRow);

  if (expired.length > 0) {
    try {
      broadcast('tickets_expired', {
        asOfDate: today,
        expiredCount: expired.length,
        tickets: expired.map(t => ({
          ticketNo: t.ticketNo,
          custId: t.custId,
          remainingTonnage: t.remainingTonnage,
        })),
      });
    } catch { /* non-fatal */ }
  }

  return {
    asOfDate: today,
    expiredCount: expired.length,
    expiredTickets: expired,
  };
}

// ─── Pre-Expiry Alert Check ─────────────────────────────────────────────────

/**
 * Finds tickets expiring within warningDays (15 or 7 days before expiry).
 */
async function getExpiringTickets(queryFn = wfQuery, { warningDays = 15, asOfDate = null } = {}) {
  const today = formatYmd(asOfDate) || getBangkokDateString();
  const warningDate = addDays(today, warningDays);

  const res = await queryFn(
    `SELECT *
     FROM wf.FertilizerTicket WITH (NOLOCK)
     WHERE Status IN ('ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE')
       AND RemainingTonnage > 0
       AND (
         (ExtendedExpiryDate IS NOT NULL AND ExtendedExpiryDate <= @warningDate AND ExtendedExpiryDate >= @today)
         OR (ExtendedExpiryDate IS NULL AND ExpiryDate <= @warningDate AND ExpiryDate >= @today)
       )
     ORDER BY ISNULL(ExtendedExpiryDate, ExpiryDate) ASC, CustId ASC`,
    { today, warningDate }
  );

  return {
    asOfDate: today,
    warningDays,
    warningDate,
    count: res.recordset?.length || 0,
    tickets: (res.recordset || []).map(mapTicketRow),
  };
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

async function getCustomerTickets(queryFn = wfQuery, { custId, includeExpired = false } = {}) {
  const statusFilter = includeExpired
    ? ''
    : `AND Status IN ('ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE')`;

  const res = await queryFn(
    `SELECT *
     FROM wf.FertilizerTicket WITH (NOLOCK)
     WHERE CustId = @custId ${statusFilter}
     ORDER BY ISNULL(ExtendedExpiryDate, ExpiryDate) ASC, IssuedDate ASC, Id ASC`,
    { custId: Number(custId) }
  );

  return (res.recordset || []).map(mapTicketRow);
}

async function getTicketRedemptionHistory(queryFn = wfQuery, ticketId) {
  const res = await queryFn(
    `SELECT * FROM wf.TicketRedemptionHistory WITH (NOLOCK)
     WHERE TicketId = @ticketId
     ORDER BY RedemptionOrder ASC`,
    { ticketId: Number(ticketId) }
  );
  return (res.recordset || []).map(mapRedemptionRow);
}

async function getAuditLog(queryFn = wfQuery, { entityType = null, entityId = null, custId = null, limit = 100 } = {}) {
  const where = ['1 = 1'];
  const params = { limit: Math.min(limit, 500) };
  if (entityType) { where.push('EntityType = @entityType'); params.entityType = entityType; }
  if (entityId != null) { where.push('EntityId = @entityId'); params.entityId = Number(entityId); }
  if (custId != null) { where.push('CustId = @custId'); params.custId = Number(custId); }

  const res = await queryFn(
    `SELECT TOP (@limit) * FROM wf.RebateAuditAndOverrideLog WITH (NOLOCK)
     WHERE ${where.join(' AND ')}
     ORDER BY PerformedAt DESC, Id DESC`,
    params
  );
  return (res.recordset || []).map(mapAuditRow);
}

module.exports = {
  // Constants
  TICKET_STATUS,
  AUDIT_TYPE,
  DEFAULT_VALIDITY_DAYS,
  DEFAULT_AGING_LIMIT_DAYS,

  // Helpers
  addDays,
  diffDays,
  mapTicketRow,
  mapRedemptionRow,
  mapAuditRow,

  // AR Aging
  validateCustomerAging,
  assertAgingNotBlocked,

  // Audit
  insertAuditLog,

  // Ticket lifecycle
  issueTicketFromConversion,
  redeemTickets,
  extendExpiredTicket,
  grantAgingOverride,
  expireOverdueTickets,
  getExpiringTickets,

  // Queries
  getCustomerTickets,
  getTicketRedemptionHistory,
  getAuditLog,
};

