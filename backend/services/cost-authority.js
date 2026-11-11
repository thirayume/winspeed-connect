'use strict';

/**
 * cost-authority.js — Costlist lookup & confidential minimum selling floor check.
 *
 * Security rule (owner requirement):
 *   Costlist is an absolute floor below which NO sale, quotation, rebate deduction,
 *   or special price is permitted in any circumstance. When a price violates the floor,
 *   user-facing errors and responses MUST remain strictly neutral — NEVER reveal the
 *   cost value or mention "cost" / "ราคาทุน" to sales or customer-facing workflows.
 */

const { sql, wfQuery } = require('../db');
const { getBangkokDateString } = require('./so-pickup-policy');

const NEUTRAL_PRICE_THRESHOLD_CODE = 'PRICE_BELOW_MIN_THRESHOLD';

function buildNeutralThresholdMessage(items = []) {
  const labels = items
    .map(v => v.goodName || v.goodCode || (v.goodId ? `#${v.goodId}` : null))
    .filter(Boolean);
  const unique = [...new Set(labels)].slice(0, 5);
  const suffix = labels.length > 5 ? ` และอีก ${labels.length - 5} รายการ` : '';
  if (unique.length > 0) {
    return `ราคาขายของรายการ ${unique.join(', ')}${suffix} ไม่อยู่ในเกณฑ์ที่บริษัทกำหนด กรุณาตรวจสอบและแก้ไขราคา`;
  }
  return 'ราคาขายไม่อยู่ในเกณฑ์ที่บริษัทกำหนด กรุณาตรวจสอบและแก้ไขราคา';
}

function isNonCommercialLine(line = {}) {
  return Boolean(
    line.isGiveaway || line.IsGiveaway ||
    line.isCouponDrawn || line.IsCouponDrawn ||
    line.couponReservationId || line.CouponReservationId ||
    line.refCouponDocuNo || line.RefCouponDocuNo ||
    line.isControlTicketDrawn || line.IsControlTicketDrawn ||
    line.refControlTicketNo || line.RefControlTicketNo
  );
}

/**
 * Resolves the authoritative CostPrice for a product as of targetDate.
 * Looks up active CostBook covering targetDate first, falling back to latest ACTIVE CostBook.
 */
async function resolveAuthoritativeCost({ goodId = null, goodCode = null, asOfDate = null, queryFn = wfQuery } = {}) {
  const targetDate = asOfDate ? String(asOfDate).slice(0, 10) : getBangkokDateString();
  const gid = goodId != null && String(goodId).trim() !== '' ? String(goodId).trim() : null;
  let gcode = goodCode != null && String(goodCode).trim() !== '' ? String(goodCode).trim() : null;

  if (!gid && !gcode) {
    return { hasCost: false, costPrice: null, goodId: null, goodCode: null, costBookId: null };
  }

  let canonicalGoodId = gid;
  if (!gcode || !canonicalGoodId) {
    try {
      const lookup = await queryFn(`
        SELECT TOP 1 CAST(GoodID AS NVARCHAR(20)) AS GoodID, GoodCode
        FROM dbo.EMGood WITH (NOLOCK)
        WHERE (${canonicalGoodId && /^\d+$/.test(canonicalGoodId) ? 'GoodID = @gidInt' : '1=0'})
           OR (@gcode IS NOT NULL AND GoodCode = @gcode)
      `, {
        gidInt: { type: sql.Int, value: canonicalGoodId && /^\d+$/.test(canonicalGoodId) ? Number(canonicalGoodId) : 0 },
        gcode: { type: sql.NVarChar(50), value: gcode },
      });
      const hit = lookup?.recordset?.[0];
      if (hit) {
        canonicalGoodId = canonicalGoodId || String(hit.GoodID || '').trim();
        gcode = gcode || (hit.GoodCode ? String(hit.GoodCode).trim() : null);
      }
    } catch {
      // Partial mock DBs may not stub dbo.EMGood; continue with supplied keys
    }
  }

  try {
    const res = await queryFn(`
      SELECT TOP 1
             cb.Id AS CostBookId,
             cb.Name AS CostBookName,
             cb.EffectiveMonth,
             CONVERT(VARCHAR(10), cb.EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), cb.EffectiveTo, 23) AS EffectiveTo,
             cbl.GoodId,
             cbl.GoodCode,
             cbl.GoodName,
             cbl.CostPrice
      FROM wf.CostBookLine cbl WITH (NOLOCK)
      JOIN wf.CostBook cb WITH (NOLOCK) ON cb.Id = cbl.CostBookId
      WHERE cb.Status = 'ACTIVE'
        AND cbl.CostPrice IS NOT NULL
        AND cbl.CostPrice > 0
        AND (
          (@goodId IS NOT NULL AND cbl.GoodId = @goodId)
          OR (@goodCode IS NOT NULL AND cbl.GoodCode = @goodCode)
        )
      ORDER BY
        CASE
          WHEN (cb.EffectiveFrom IS NULL OR cb.EffectiveFrom <= @targetDate)
           AND (cb.EffectiveTo IS NULL OR cb.EffectiveTo >= @targetDate) THEN 0
          ELSE 1
        END,
        COALESCE(cb.EffectiveFrom, '1900-01-01') DESC,
        cb.Id DESC
    `, {
      goodId: { type: sql.NVarChar(20), value: canonicalGoodId },
      goodCode: { type: sql.NVarChar(50), value: gcode },
      targetDate: { type: sql.Date, value: targetDate },
    });

    const row = res?.recordset?.[0];
    if (!row || row.CostPrice == null) {
      return { hasCost: false, costPrice: null, goodId: canonicalGoodId, goodCode: gcode, costBookId: null };
    }

    return {
      hasCost: true,
      costPrice: Number(row.CostPrice),
      goodId: row.GoodId ? String(row.GoodId) : canonicalGoodId,
      goodCode: row.GoodCode ? String(row.GoodCode) : gcode,
      goodName: row.GoodName || null,
      costBookId: Number(row.CostBookId),
      costBookName: row.CostBookName || null,
      effectiveFrom: row.EffectiveFrom || null,
      effectiveTo: row.EffectiveTo || null,
    };
  } catch (err) {
    // Allow isolated environments before Migration 186 to pass without crashing
    if (/Invalid object name 'wf\.CostBook/i.test(String(err?.message || ''))) {
      return { hasCost: false, costPrice: null, goodId: canonicalGoodId, goodCode: gcode, costBookId: null };
    }
    throw err;
  }
}

/**
 * Checks whether any selling line sits below its active CostPrice, accounting for
 * both direct unit price and bill-level rebate deduction per ton.
 * Returns confidentially sanitized violations (NO cost numbers).
 */
async function evaluateSellingPriceFloor({
  lines = [],
  asOfDate = null,
  rebateDiscountAmt = 0,
  queryFn = wfQuery,
} = {}) {
  const checkLines = Array.isArray(lines) ? lines : [];
  const commercialLines = checkLines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => !isNonCommercialLine(line));

  if (commercialLines.length === 0) {
    return { blocked: false, violations: [], message: null };
  }

  const totalCommercialTon = commercialLines.reduce((sum, { line }) => {
    const q = Number(line.qtyTon ?? line.QtyTon ?? 0);
    return sum + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);
  const rebatePerTon = totalCommercialTon > 0 && Number(rebateDiscountAmt) > 0
    ? Number(rebateDiscountAmt) / totalCommercialTon
    : 0;

  const costCache = new Map();
  const violations = [];

  for (const { line, idx } of commercialLines) {
    const goodId = line.goodId ?? line.GoodId ?? null;
    const goodCode = line.goodCode ?? line.GoodCode ?? null;
    const goodName = line.goodName ?? line.GoodName ?? null;
    const rawUnitPrice = line.pricePerTon ?? line.PricePerTon ?? line.price ?? line.Price ?? line.approvedPrice ?? line.requestedPrice;
    if (rawUnitPrice === null || rawUnitPrice === undefined || rawUnitPrice === '') continue;

    const unitPrice = Number(rawUnitPrice);
    if (!Number.isFinite(unitPrice)) continue;

    const cacheKey = `${goodId || ''}|${goodCode || ''}`;
    let costInfo = costCache.get(cacheKey);
    if (!costInfo) {
      costInfo = await resolveAuthoritativeCost({ goodId, goodCode, asOfDate, queryFn });
      costCache.set(cacheKey, costInfo);
    }

    if (!costInfo || !costInfo.hasCost || !(costInfo.costPrice > 0)) continue;

    const effectiveNetUnitPrice = Number((unitPrice - rebatePerTon).toFixed(2));
    // Strict < comparison: selling equal to cost is borderline allowed or block < costPrice;
    // user rule: "ห้ามจำหน่ายต่ำกว่าราคาทุนเสมอ ทุกกรณี" (strictly < costPrice)
    if (unitPrice < costInfo.costPrice || effectiveNetUnitPrice < costInfo.costPrice) {
      violations.push({
        lineIndex: idx,
        key: line.key ?? null,
        goodId: goodId ? String(goodId) : (costInfo.goodId || null),
        goodCode: goodCode ? String(goodCode) : (costInfo.goodCode || null),
        goodName: goodName ? String(goodName) : (costInfo.goodName || null),
      });
    }
  }

  if (violations.length === 0) {
    return { blocked: false, violations: [], message: null };
  }

  return {
    blocked: true,
    violations,
    message: buildNeutralThresholdMessage(violations),
  };
}

async function assertPricesAboveCost(params = {}) {
  const result = await evaluateSellingPriceFloor(params);
  if (result.blocked) {
    const err = new Error(result.message);
    err.status = 422;
    err.statusCode = 422;
    err.code = NEUTRAL_PRICE_THRESHOLD_CODE;
    // Public details never include costPrice!
    err.details = result.violations;
    throw err;
  }
  return result;
}

/**
 * Checks whether any item on an order/quotation is explicitly marked SUSPENDED ("งดขาย")
 * in the active wf.PriceBook covering targetDate.
 */
async function assertPriceBookLinesSellable({ lines = [], asOfDate = null, queryFn = wfQuery } = {}) {
  const checkLines = Array.isArray(lines) ? lines : [];
  const commercialLines = checkLines.filter(l => !isNonCommercialLine(l));
  if (commercialLines.length === 0) return { ok: true };

  const targetDate = asOfDate ? String(asOfDate).slice(0, 10) : getBangkokDateString();
  try {
    const r = await queryFn(`
      SELECT pbl.GoodId, pbl.GoodCode, pbl.GoodName
      FROM wf.PriceBookLine pbl WITH (NOLOCK)
      JOIN wf.PriceBook pb WITH (NOLOCK) ON pb.Id = pbl.PriceBookId
      WHERE pb.Status = 'ACTIVE'
        AND pbl.LineStatus = 'SUSPENDED'
        AND (pb.EffectiveFrom IS NULL OR pb.EffectiveFrom <= @targetDate)
        AND (pb.EffectiveTo IS NULL OR pb.EffectiveTo >= @targetDate)
    `, { targetDate: { type: sql.Date, value: targetDate } });

    const suspendedRows = r?.recordset || [];
    if (!suspendedRows.length) return { ok: true };

    const suspendedById = new Set(suspendedRows.map(s => String(s.GoodId || '').trim()).filter(Boolean));
    const suspendedByCode = new Set(suspendedRows.map(s => String(s.GoodCode || '').trim()).filter(Boolean));

    const blocked = commercialLines.filter(l => {
      const gid = l.goodId != null ? String(l.goodId).trim() : '';
      const gcode = l.goodCode != null ? String(l.goodCode).trim() : '';
      return (gid && suspendedById.has(gid)) || (gcode && suspendedByCode.has(gcode));
    });

    if (blocked.length > 0) {
      const names = blocked.map(b => b.goodName || b.goodCode || b.goodId).filter(Boolean);
      const err = new Error(`รายการสินค้าถูกตั้งสถานะ "งดขาย" ในตารางราคารอบปัจจุบัน: ${names.join(', ')}`);
      err.status = 400;
      err.statusCode = 400;
      err.code = 'GOOD_SUSPENDED_ON_PRICELIST';
      throw err;
    }
  } catch (err) {
    if (err.code === 'GOOD_SUSPENDED_ON_PRICELIST') throw err;
    if (!/Invalid object name 'wf\.PriceBook/i.test(String(err?.message || ''))) {
      throw err;
    }
  }
  return { ok: true };
}

module.exports = {
  NEUTRAL_PRICE_THRESHOLD_CODE,
  buildNeutralThresholdMessage,
  isNonCommercialLine,
  resolveAuthoritativeCost,
  evaluateSellingPriceFloor,
  assertPricesAboveCost,
  assertPriceBookLinesSellable,
};

