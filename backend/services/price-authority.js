const crypto = require('crypto');
const { sql, query, wfQuery, wfTransaction } = require('../db');
const { getBangkokDateString } = require('./so-pickup-policy');

/**
 * Calculates a deterministic SHA-256 fingerprint for SO pricing lines.
 * Any change to goods, quantities, prices, or giveaway flags will change the fingerprint.
 */
function calculatePricingFingerprint(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const normalized = lines.map(l => {
    const gid = String(l.goodId || l.GoodId || l.goodCode || l.GoodCode || '').trim();
    const qty = Number(l.qtyTon || l.QtyTon || 0).toFixed(3);
    const price = Number(l.pricePerTon || l.PricePerTon || 0).toFixed(2);
    const giveaway = (l.isGiveaway || l.IsGiveaway) ? '1' : '0';
    return `${gid}:${qty}:${price}:${giveaway}`;
  }).sort().join('|');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Resolves authoritative announced price from server masters (dbo.EMSetPriceDT / HD).
 * Prevents client price spoofing and enforces below-announced-price approval workflow.
 * Strictly enforces BeginDate <= targetDate AND (EndDate IS NULL OR EndDate >= targetDate).
 * Does not fallback to expired prices or guess numeric customer codes.
 */
async function resolveAuthoritativePrice({ custId, goodId, goodCode, asOfDate = null }) {
  const targetDate = asOfDate || getBangkokDateString();
  const goodIdParsed = Number.isInteger(Number(goodId)) && String(goodId).trim() !== '' ? Number(goodId) : null;
  const targetGoodCode = goodCode ? String(goodCode) : (!goodIdParsed && goodId ? String(goodId) : null);

  // Canonical resolution of customer identity from dbo.EMCust
  let canonicalCustId = null;
  if (custId) {
    const isNumeric = /^\d+$/.test(String(custId).trim());
    const custRows = await query(`
      SELECT TOP 1 CustID, CustCode, CustName
      FROM dbo.EMCust WITH (NOLOCK)
      WHERE ${isNumeric ? 'CustID = @cid OR CustCode = @ccode' : 'CustCode = @ccode'}
    `, {
      cid: { type: sql.Int, value: isNumeric ? Number(custId) : 0 },
      ccode: { type: sql.VarChar(20), value: String(custId).trim() },
    });
    if (custRows && custRows.length > 0) {
      canonicalCustId = custRows[0].CustID;
    }
  }

  const inputs = {
    d: { type: sql.Date, value: targetDate },
    goodId: { type: sql.Int, value: goodIdParsed },
    goodCode: { type: sql.NVarChar(50), value: targetGoodCode },
    custId: { type: sql.Int, value: canonicalCustId },
  };

  const rows = await query(`
    SELECT TOP 1 
      dt.SetPriceID, dt.ListNo, dt.GoodPriceNet AS AnnouncedPrice,
      hd.CustID, hd.BeginDate, hd.EndDate, 'EMSetPrice' AS PriceSource
    FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
    JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
    WHERE dt.GoodPriceNet > 0
      AND hd.BeginDate <= @d AND (hd.EndDate IS NULL OR hd.EndDate >= @d)
      AND (
        (@goodId IS NOT NULL AND dt.ListID = @goodId)
        OR (@goodCode IS NOT NULL AND g.GoodCode = @goodCode)
      )
      AND (
        hd.CustID IS NULL
        OR (@custId IS NOT NULL AND hd.CustID = @custId)
      )
    ORDER BY 
      CASE WHEN (hd.CustID IS NOT NULL AND @custId IS NOT NULL AND hd.CustID = @custId) THEN 0 ELSE 1 END,
      hd.BeginDate DESC
  `, inputs);

  if (rows && rows.length > 0) {
    const r = rows[0];
    return {
      hasAnnouncedPrice: true,
      announcedPrice: Number(r.AnnouncedPrice),
      priceSource: r.PriceSource,
      setPriceId: r.SetPriceID,
      listNo: r.ListNo,
      beginDate: r.BeginDate,
      endDate: r.EndDate,
      priceStatus: 'ACTIVE',
    };
  }

  return {
    hasAnnouncedPrice: false,
    announcedPrice: null,
    priceSource: 'NONE',
    setPriceId: null,
    priceStatus: 'UNKNOWN',
    error: 'ไม่พบราคาประกาศที่มีผลบังคับใช้ (วันที่ปัจจุบันอยู่นอกช่วงเวลาประกาศ หรือไม่มีราคาตั้ง)',
  };
}

/**
 * Evaluates line price against authoritative announced price.
 * Rules:
 * - Giveaway lines are exempt from below-announced price approval.
 * - Selling Price < Announced Price -> requiresPriceApproval = true.
 * - Missing Announced Price -> requiresPriceApproval = true.
 */
async function evaluateLinePrice(line, custId, asOfDate = null, options = {}) {
  if (line.isGiveaway) {
    return {
      isGiveaway: true,
      requiresApproval: false,
      announcedPrice: 0,
      requestedPrice: 0,
      deviationPerTon: 0,
    };
  }

  // D1 / R5-2 / R6-1 / R7-4: Validated coupon reservation lines are ฿0 and skip announced price approval by default.
  // CRITICAL SECURITY: Never trust client flags or line markers.
  // Exemption strictly requires server-side validated set passed via options.isCouponValidated === true.
  const isCouponValidated = Boolean(options.isCouponValidated === true);
  if (isCouponValidated) {
    return {
      isGiveaway: false,
      isCouponDrawn: true,
      requiresApproval: false,
      announcedPrice: 0,
      requestedPrice: 0,
      deviationPerTon: 0,
      totalDeviation: 0,
      reason: 'ยกเว้นการอนุมัติราคาเนื่องจากเป็นการตัดตั๋วคูปองที่มีการจองสิทธิ์ถูกต้องในระบบ',
    };
  }

  const auth = await resolveAuthoritativePrice({
    custId,
    goodId: line.goodId,
    goodCode: line.goodCode,
    asOfDate,
  });

  const requestedPrice = Number(line.pricePerTon) || 0;
  const qtyTon = Number(line.qtyTon) || 0;

  if (!auth.hasAnnouncedPrice) {
    return {
      isGiveaway: false,
      hasAnnouncedPrice: false,
      requiresApproval: true,
      announcedPrice: null,
      requestedPrice,
      deviationPerTon: 0,
      totalDeviation: 0,
      reason: `ไม่พบราคาประกาศสำหรับสินค้า ${line.goodCode || line.goodId}`,
    };
  }

  const deviationPerTon = auth.announcedPrice - requestedPrice;
  const isBelowAnnounced = deviationPerTon > 0;

  return {
    isGiveaway: false,
    hasAnnouncedPrice: true,
    requiresApproval: isBelowAnnounced,
    announcedPrice: auth.announcedPrice,
    requestedPrice,
    deviationPerTon: isBelowAnnounced ? deviationPerTon : 0,
    totalDeviation: isBelowAnnounced ? Number((deviationPerTon * qtyTon).toFixed(2)) : 0,
    priceSource: auth.priceSource,
    reason: isBelowAnnounced
      ? `ราคาขาย ฿${requestedPrice.toLocaleString()} ต่ำกว่าราคาประกาศ ฿${auth.announcedPrice.toLocaleString()} (ส่วนต่าง ฿${deviationPerTon.toLocaleString()}/ตัน)`
      : null,
  };
}

/**
 * Records price approval request in wf.PriceApproval when an SO has lines below announced price.
 */
async function createPriceApprovalRequest(tx, {
  soId,
  wfRef,
  docuNo = null,
  custId,
  custName,
  goodId,
  goodCode,
  goodName,
  qtyTon,
  announcedPrice,
  requestedPrice,
  priceDeviationPerTon,
  totalDeviationAmt,
  priceSource = 'EMSetPrice',
  documentRevision = 1,
  requestedBy,
  reasonText = null,
}) {
  const req = tx.request();
  req.input('soId', sql.Int, soId);
  req.input('wfRef', sql.NVarChar(30), wfRef || null);
  req.input('docuNo', sql.NVarChar(50), docuNo || null);
  req.input('custId', sql.NVarChar(20), String(custId));
  req.input('custName', sql.NVarChar(200), custName ? String(custName) : null);
  req.input('goodId', sql.NVarChar(50), String(goodId));
  // a line sent without its code was stored as the text "undefined" and the approver saw "สินค้า: undefined"
  // (UAT 2026-10-09); a missing code or name now comes from the goods master
  const present = v => (v === undefined || v === null || ['', 'undefined', 'null'].includes(String(v).trim()) ? null : String(v));
  req.input('goodCode', sql.NVarChar(50), present(goodCode));
  req.input('goodName', sql.NVarChar(200), present(goodName));
  req.input('qtyTon', sql.Decimal(12, 3), Number(qtyTon));
  req.input('announcedPrice', sql.Decimal(12, 2), Number(announcedPrice));
  req.input('requestedPrice', sql.Decimal(12, 2), Number(requestedPrice));
  req.input('devPerTon', sql.Decimal(12, 2), Number(priceDeviationPerTon));
  req.input('totalDev', sql.Decimal(14, 2), Number(totalDeviationAmt));
  req.input('source', sql.VarChar(50), priceSource);
  req.input('rev', sql.Int, documentRevision);
  req.input('by', sql.Int, Number(requestedBy));
  req.input('reason', sql.NVarChar(500), reasonText || null);

  const res = await req.query(`
    INSERT INTO wf.PriceApproval (
      SoId, WfRef, DocuNo, CustId, CustName, GoodId, GoodCode, GoodName,
      QtyTon, AnnouncedPrice, RequestedPrice, PriceDeviationPerTon, TotalDeviationAmt,
      PriceSource, DocumentRevision, Status, RequestedBy, ReasonText
    )
    OUTPUT inserted.Id
    VALUES (
      @soId, @wfRef, @docuNo, @custId, @custName, @goodId,
      COALESCE(@goodCode, (SELECT TOP 1 g.GoodCode FROM dbo.EMGood g WITH (NOLOCK) WHERE CAST(g.GoodID AS NVARCHAR(50)) = @goodId), @goodId),
      COALESCE(@goodName, (SELECT TOP 1 g.GoodName1 FROM dbo.EMGood g WITH (NOLOCK) WHERE CAST(g.GoodID AS NVARCHAR(50)) = @goodId)),
      @qtyTon, @announcedPrice, @requestedPrice, @devPerTon, @totalDev,
      @source, @rev, 'PENDING', @by, @reason
    )
  `);

  return res.recordset[0].Id;
}

module.exports = {
  calculatePricingFingerprint,
  resolveAuthoritativePrice,
  evaluateLinePrice,
  createPriceApprovalRequest,
};
