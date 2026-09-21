'use strict';

/**
 * native-document-resolver.js — Universal Native Document Chain Resolver
 *
 * Implements R1-03, P1 & Codex Slice 1 findings (S1-03, S1-04):
 * 1. Resolves forwards & backwards along the canonical chain:
 *    I/K 103 (Booking) <-> AI (AppvDocuNo) <-> I/K 104 (Delivery) <-> C/D (WFCoupon) <-> 116 (WFRedemtion) <-> J/N 107 (SOInv)
 * 2. Strict Entity & ID Validation (S1-03):
 *    - Allowlisted entity types (BOOKING, DELIVERY, COUPON, REDEMPTION, INVOICE, APPROVAL, SO)
 *    - Positive 32-bit integer validation for exactId
 *    - DB existence check: returns NOT_FOUND / WRONG_TYPE if nonexistent or mismatched type (never resolved: true with empty chain)
 * 3. Scoped Line Linkage & Direct Invoices (S1-04):
 *    - Scoped edges matching lines: WFCoupon.RefListno = SODT.ListNo; 104 SODT.RefSOID = 103 SOHD.SOID
 *    - Direct invoice path via SOInvDT (RefID / RefSOID) without 116 redemption
 *    - Cancelled 104 deliveries retained in trace as evidence with isCancelled: true
 *    - Explicit graph bounds (maxQueries = 30, maxNodes = 50, maxDepth = 5) and truncation flag
 *    - Preserves nullable units/quantities (never silently coerces missing units to 'ตัน')
 * 4. Ambiguity handling (S1-03):
 *    - Keyed by `${entityType}:${id}` to prevent cross-table ID collisions
 *    - Detects duplicate CouponNo groups (50 groups) and returns isAmbiguous: true with candidates
 */

const { sql, wfQuery } = require('../db');

const ALLOWED_ENTITY_TYPES = Object.freeze(['BOOKING', 'DELIVERY', 'COUPON', 'REDEMPTION', 'INVOICE', 'APPROVAL', 'SO']);

/**
 * Detect entity type and primary key from reference string if not explicitly given
 */
async function detectReferenceCandidates(rawRef) {
  const ref = String(rawRef || '').trim();
  if (!ref) return [];

  const candidates = [];

  // Check 1: Numeric ID could be CouponID or SOID
  if (/^\d+$/.test(ref)) {
    const num = parseInt(ref, 10);
    // Check WFCoupon.CouponID
    const cp = await wfQuery(`
      SELECT CouponID, CouponNo, GoodName, RemaQty, DocuID
      FROM dbo.WFCoupon WITH (NOLOCK)
      WHERE CouponID = @num
    `, { num: { type: sql.Int, value: num } });
    if (cp.recordset?.length) {
      candidates.push({ entityType: 'COUPON', id: num, docuNo: cp.recordset[0].CouponNo, details: cp.recordset[0] });
    }

    // Check SOHD.SOID (103 or 104)
    const so = await wfQuery(`
      SELECT SOID, DocuNo, DocuType, AppvDocuNo, CustName
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE SOID = @num
    `, { num: { type: sql.Int, value: num } });
    if (so.recordset?.length) {
      const row = so.recordset[0];
      candidates.push({
        entityType: row.DocuType === 103 ? 'BOOKING' : (row.DocuType === 104 ? 'DELIVERY' : 'SO'),
        id: num,
        docuNo: row.DocuNo,
        details: row
      });
    }
    if (candidates.length > 0) return candidates;
  }

  // Check 2: AppvDocuNo (AI prefix)
  if (/^AI/i.test(ref)) {
    const aiRows = await wfQuery(`
      SELECT SOID, DocuNo, AppvDocuNo, CustID, CustName, DocuDate
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE DocuType = 103 AND AppvDocuNo = @ref
    `, { ref: { type: sql.NVarChar(50), value: ref } });
    for (const r of (aiRows.recordset || [])) {
      candidates.push({ entityType: 'APPROVAL', id: r.SOID, docuNo: r.AppvDocuNo, bookingDocuNo: r.DocuNo, details: r });
    }
    if (candidates.length > 0) return candidates;
  }

  // Check 3: CouponNo (C or D prefix, e.g. C6906916, D6904966)
  if (/^[CD]\d+/i.test(ref)) {
    const cpRows = await wfQuery(`
      SELECT c.CouponID, c.CouponNo, c.DocuID, s.DocuNo AS DeliveryDocuNo, s.DocuDate, s.CustID, s.CustName, c.GoodName, c.RemaQty
      FROM dbo.WFCoupon c WITH (NOLOCK)
      LEFT JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
      WHERE c.CouponNo = @ref
    `, { ref: { type: sql.NVarChar(50), value: ref } });
    for (const r of (cpRows.recordset || [])) {
      candidates.push({ entityType: 'COUPON', id: r.CouponID, docuNo: r.CouponNo, details: r });
    }
    if (candidates.length > 0) return candidates;
  }

  // Check 4: SOHD DocuNo (I or K prefix, could be 103 Booking or 104 Delivery)
  const soRows = await wfQuery(`
    SELECT SOID, DocuNo, DocuType, AppvDocuNo, CustID, CustName, DocuDate, DocuStatus
    FROM dbo.SOHD WITH (NOLOCK)
    WHERE DocuNo = @ref
    ORDER BY DocuType ASC
  `, { ref: { type: sql.NVarChar(50), value: ref } });
  for (const r of (soRows.recordset || [])) {
    const dtNum = Number(r.DocuType);
    candidates.push({
      entityType: dtNum === 103 ? 'BOOKING' : (dtNum === 104 ? 'DELIVERY' : 'SO'),
      id: r.SOID,
      docuNo: r.DocuNo,
      details: r
    });
  }
  if (candidates.length > 0) return candidates;

  // Check 5: Invoice (SOInvHD DocuNo, e.g. J or N prefix)
  const invRows = await wfQuery(`
    SELECT SOInvID, DocuNo, Docutype AS DocuType, CustID, CustName, DocuDate, NetAmnt
    FROM dbo.SOInvHD WITH (NOLOCK)
    WHERE DocuNo = @ref
  `, { ref: { type: sql.NVarChar(50), value: ref } });
  for (const r of (invRows.recordset || [])) {
    candidates.push({ entityType: 'INVOICE', id: r.SOInvID, docuNo: r.DocuNo, details: r });
  }
  if (candidates.length > 0) return candidates;

  // Check 6: Redemption (WFRedemtionHD DocuNo)
  const redRows = await wfQuery(`
    SELECT RedemtionID, DocuNo, DocuType, DocuDate, DocuStatus
    FROM dbo.WFRedemtionHD WITH (NOLOCK)
    WHERE DocuNo = @ref
  `, { ref: { type: sql.NVarChar(50), value: ref } });
  for (const r of (redRows.recordset || [])) {
    candidates.push({ entityType: 'REDEMPTION', id: r.RedemtionID, docuNo: r.DocuNo, details: r });
  }

  return candidates;
}

/**
 * Universal resolver function
 * @param {Object} options
 * @param {string} [options.entityType] - Explicit entity type (BOOKING, DELIVERY, COUPON, REDEMPTION, INVOICE, APPROVAL, SO)
 * @param {string|number} [options.reference] - Identifier or document number
 * @param {number} [options.exactId] - Disambiguated primary key (e.g. CouponID or SOID)
 */
async function resolveNativeDocumentChain(options = {}) {
  const ref = String(options.reference || options.exactId || '').trim();
  if (!ref && !options.exactId) {
    return { resolved: false, isAmbiguous: false, error: 'Reference or ID is required', chain: null };
  }

  // 1. Validate entityType if provided (S1-03)
  let targetType = null;
  if (options.entityType) {
    targetType = String(options.entityType).toUpperCase().trim();
    if (!ALLOWED_ENTITY_TYPES.includes(targetType)) {
      return {
        resolved: false,
        isAmbiguous: false,
        error: `INVALID_ENTITY_TYPE: "${options.entityType}" is not allowed. Supported: ${ALLOWED_ENTITY_TYPES.join(', ')}`,
        chain: null
      };
    }
  }

  // 2. Validate exactId if provided (S1-03)
  let idNum = null;
  if (options.exactId != null) {
    idNum = Number(options.exactId);
    if (!Number.isInteger(idNum) || idNum <= 0 || idNum > 2147483647) {
      return {
        resolved: false,
        isAmbiguous: false,
        error: `INVALID_EXACT_ID: exactId must be a positive 32-bit integer (got ${options.exactId})`,
        chain: null
      };
    }
  }

  let primaryCandidate = null;

  // 3. Exact ID & Typed Lookup with DB existence verification (S1-03)
  if (idNum && targetType) {
    if (targetType === 'COUPON') {
      const res = await wfQuery(`
        SELECT CouponID, CouponNo, DocuID, GoodID, GoodName, GoodQty, RemaQty, GoodUnitID
        FROM dbo.WFCoupon WITH (NOLOCK)
        WHERE CouponID = @id
      `, { id: { type: sql.Int, value: idNum } });
      if (!res.recordset?.length) {
        return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: Coupon with ID ${idNum} does not exist`, chain: null };
      }
      primaryCandidate = { entityType: 'COUPON', id: idNum, exactId: idNum, docuNo: res.recordset[0].CouponNo, details: res.recordset[0] };
    } else if (targetType === 'BOOKING') {
      const res = await wfQuery(`
        SELECT SOID, DocuNo, DocuType, AppvDocuNo, CustID, CustName, DocuDate, DocuStatus
        FROM dbo.SOHD WITH (NOLOCK)
        WHERE SOID = @id AND DocuType = 103
      `, { id: { type: sql.Int, value: idNum } });
      if (!res.recordset?.length) {
        const anySo = await wfQuery(`SELECT SOID, DocuType FROM dbo.SOHD WITH (NOLOCK) WHERE SOID = @id`, { id: { type: sql.Int, value: idNum } });
        if (anySo.recordset?.length) {
          return { resolved: false, isAmbiguous: false, error: `WRONG_TYPE: SOHD with ID ${idNum} is DocuType ${anySo.recordset[0].DocuType}, not BOOKING (103)`, chain: null };
        }
        return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: Booking with ID ${idNum} does not exist`, chain: null };
      }
      primaryCandidate = { entityType: 'BOOKING', id: idNum, exactId: idNum, docuNo: res.recordset[0].DocuNo, details: res.recordset[0] };
    } else if (targetType === 'DELIVERY') {
      const res = await wfQuery(`
        SELECT SOID, DocuNo, DocuType, AppvDocuNo, CustID, CustName, DocuDate, DocuStatus
        FROM dbo.SOHD WITH (NOLOCK)
        WHERE SOID = @id AND DocuType = 104
      `, { id: { type: sql.Int, value: idNum } });
      if (!res.recordset?.length) {
        const anySo = await wfQuery(`SELECT SOID, DocuType FROM dbo.SOHD WITH (NOLOCK) WHERE SOID = @id`, { id: { type: sql.Int, value: idNum } });
        if (anySo.recordset?.length) {
          return { resolved: false, isAmbiguous: false, error: `WRONG_TYPE: SOHD with ID ${idNum} is DocuType ${anySo.recordset[0].DocuType}, not DELIVERY (104)`, chain: null };
        }
        return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: Delivery with ID ${idNum} does not exist`, chain: null };
      }
      primaryCandidate = { entityType: 'DELIVERY', id: idNum, exactId: idNum, docuNo: res.recordset[0].DocuNo, details: res.recordset[0] };
    } else if (targetType === 'REDEMPTION') {
      const res = await wfQuery(`
        SELECT RedemtionID, DocuNo, DocuType, DocuDate, DocuStatus
        FROM dbo.WFRedemtionHD WITH (NOLOCK)
        WHERE RedemtionID = @id
      `, { id: { type: sql.Int, value: idNum } });
      if (!res.recordset?.length) {
        return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: Redemption with ID ${idNum} does not exist`, chain: null };
      }
      primaryCandidate = { entityType: 'REDEMPTION', id: idNum, exactId: idNum, docuNo: res.recordset[0].DocuNo, details: res.recordset[0] };
    } else if (targetType === 'INVOICE') {
      const res = await wfQuery(`
        SELECT SOInvID, DocuNo, Docutype AS DocuType, CustID, CustName, DocuDate, NetAmnt
        FROM dbo.SOInvHD WITH (NOLOCK)
        WHERE SOInvID = @id
      `, { id: { type: sql.Int, value: idNum } });
      if (!res.recordset?.length) {
        return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: Invoice with ID ${idNum} does not exist`, chain: null };
      }
      primaryCandidate = { entityType: 'INVOICE', id: idNum, exactId: idNum, docuNo: res.recordset[0].DocuNo, details: res.recordset[0] };
    } else {
      const res = await wfQuery(`
        SELECT SOID, DocuNo, DocuType, AppvDocuNo, CustID, CustName, DocuDate, DocuStatus
        FROM dbo.SOHD WITH (NOLOCK)
        WHERE SOID = @id
      `, { id: { type: sql.Int, value: idNum } });
      if (!res.recordset?.length) {
        return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: SO with ID ${idNum} does not exist`, chain: null };
      }
      primaryCandidate = { entityType: targetType, id: idNum, exactId: idNum, docuNo: res.recordset[0].DocuNo, details: res.recordset[0] };
    }
  } else {
    // Reference-based candidate discovery
    let candidates = await detectReferenceCandidates(ref);
    if (targetType) {
      candidates = candidates.filter(c => c.entityType === targetType);
    }

    if (candidates.length === 0) {
      return { resolved: false, isAmbiguous: false, error: `NOT_FOUND: No native records found matching reference "${ref}"`, chain: null };
    }

    if (candidates.length > 1) {
      // Disambiguation needed
      const distinctTypes = new Set(candidates.map(c => c.entityType));
      const distinctIds = new Set(candidates.map(c => c.id));
      if (distinctIds.size > 1) {
        return {
          resolved: false,
          isAmbiguous: true,
          error: `AMBIGUOUS_REFERENCE: Multiple records found for "${ref}". Specify exactId or entityType to disambiguate.`,
          candidates: candidates.map(c => ({
            entityType: c.entityType,
            id: c.id,
            exactId: c.id,
            docuNo: c.docuNo,
            goodName: c.details?.GoodName,
            remaQty: c.details?.RemaQty
          }))
        };
      }
    }
    primaryCandidate = { ...candidates[0], exactId: candidates[0].id };
  }

  // 4. Graph traversal collectors & strict resource bounds (S1-04 / R2-04)
  const bookingMap = new Map();
  const deliveryMap = new Map();
  const couponMap = new Map();
  const redemptionMap = new Map();
  const invoiceMap = new Map();
  const edges = [];

  const visited = new Set();
  let queryCount = 0;
  const MAX_QUERIES = options.budgets?.queryBudget || options.budget?.queryBudget || 30;
  const MAX_NODES = options.budgets?.nodeBudget || options.budget?.nodeBudget || 50;
  const MAX_DEPTH = options.budgets?.depthBudget || options.budget?.depthBudget || 5;
  let isTruncated = false;
  const truncationReasons = [];

  function shouldStop(depth) {
    if (queryCount >= MAX_QUERIES) {
      isTruncated = true;
      if (!truncationReasons.includes(`Query budget exceeded (${MAX_QUERIES})`)) {
        truncationReasons.push(`Query budget exceeded (${MAX_QUERIES})`);
      }
      return true;
    }
    if (visited.size >= MAX_NODES) {
      isTruncated = true;
      if (!truncationReasons.includes(`Node budget exceeded (${MAX_NODES})`)) {
        truncationReasons.push(`Node budget exceeded (${MAX_NODES})`);
      }
      return true;
    }
    if (depth >= MAX_DEPTH) {
      isTruncated = true;
      if (!truncationReasons.includes(`Depth budget exceeded (${MAX_DEPTH})`)) {
        truncationReasons.push(`Depth budget exceeded (${MAX_DEPTH})`);
      }
      return true;
    }
    return false;
  }

  // Helper to expand booking SOID
  async function expandBooking(soId, depth = 0) {
    const key = `booking:${soId}`;
    if (visited.has(key) || shouldStop(depth)) return;
    visited.add(key);
    queryCount++;

    const bRows = await wfQuery(`
      SELECT 
        b.SOID, b.DocuNo, b.DocuType, b.DocuDate, b.AppvDocuNo, b.AppvFlag, b.AppvDate,
        b.CustID, b.CustName, b.TransRegistration AS TruckPlate, b.DocuStatus,
        dt.ListNo, dt.GoodID, g.GoodCode, dt.GoodName, dt.GoodQty2, u.GoodUnitName
      FROM dbo.SOHD b WITH (NOLOCK)
      LEFT JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = b.SOID
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = dt.GoodUnitID2
      WHERE b.SOID = @soId
    `, { soId: { type: sql.Int, value: soId } });

    if (!bRows.recordset?.length) return;

    for (const r of bRows.recordset) {
      if (!bookingMap.has(r.SOID)) {
        bookingMap.set(r.SOID, {
          soId: r.SOID,
          docuNo: r.DocuNo,
          appvDocuNo: r.AppvDocuNo,
          appvFlag: r.AppvFlag,
          appvDate: r.AppvDate,
          docuDate: r.DocuDate,
          custId: r.CustID,
          custName: r.CustName,
          truckPlate: r.TruckPlate,
          docuStatus: r.DocuStatus,
          lines: []
        });
      }
      if (r.ListNo != null) {
        bookingMap.get(r.SOID).lines.push({
          listNo: r.ListNo,
          goodId: r.GoodID,
          goodCode: r.GoodCode,
          goodName: r.GoodName,
          orderedQtyTon: r.GoodQty2 != null ? Number(r.GoodQty2) : null,
          unitName: r.GoodUnitName || null
        });
      }
    }

    // Trace forward to 104 deliveries: SODT.RefSOID = booking SOID (retain cancelled as evidence! S1-04)
    if (!shouldStop(depth + 1)) {
      queryCount++;
      const delLines = await wfQuery(`
        SELECT DISTINCT dt.SOID AS DeliverySOID
        FROM dbo.SODT dt WITH (NOLOCK)
        JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = dt.SOID AND h.DocuType = 104
        WHERE dt.RefSOID = @soId
      `, { soId: { type: sql.Int, value: soId } });

      for (const d of (delLines.recordset || [])) {
        edges.push({ source: `BOOKING:${soId}`, target: `DELIVERY:${d.DeliverySOID}`, type: 'DELIVERY' });
        await expandDelivery(d.DeliverySOID, depth + 1);
      }
    }

    // Trace direct invoices linked to booking (S1-04 direct invoice path)
    if (!shouldStop(depth + 1)) {
      queryCount++;
      const invLinks = await wfQuery(`
        SELECT DISTINCT inv.SOInvID
        FROM dbo.SOInvDT invDt WITH (NOLOCK)
        JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.SOInvID = invDt.SOInvID
        WHERE invDt.RefID = @soId
      `, { soId: { type: sql.Int, value: soId } });

      for (const inv of (invLinks.recordset || [])) {
        edges.push({ source: `BOOKING:${soId}`, target: `INVOICE:${inv.SOInvID}`, type: 'DIRECT_INVOICE' });
        await expandInvoice(inv.SOInvID, depth + 1);
      }
    }
  }

  // Helper to expand delivery 104 SOID
  async function expandDelivery(soId, depth = 0) {
    const key = `delivery:${soId}`;
    if (visited.has(key) || shouldStop(depth)) return;
    visited.add(key);
    queryCount++;

    const dRows = await wfQuery(`
      SELECT 
        d.SOID, d.DocuNo, d.DocuType, d.DocuDate, d.DocuStatus, d.CustID, d.CustName,
        dt.ListNo, dt.RefSOID AS BookingSOID, dt.RefListNo AS BookingListNo,
        dt.GoodID, g.GoodCode, dt.GoodName, dt.GoodQty2, u.GoodUnitName
      FROM dbo.SOHD d WITH (NOLOCK)
      LEFT JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = d.SOID
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = dt.GoodUnitID2
      WHERE d.SOID = @soId
    `, { soId: { type: sql.Int, value: soId } });

    if (!dRows.recordset?.length) return;

    for (const r of dRows.recordset) {
      if (!deliveryMap.has(r.SOID)) {
        deliveryMap.set(r.SOID, {
          soId: r.SOID,
          docuNo: r.DocuNo,
          docuDate: r.DocuDate,
          docuStatus: r.DocuStatus,
          isCancelled: r.DocuStatus === 'C',
          custId: r.CustID,
          custName: r.CustName,
          lines: []
        });
      }
      if (r.ListNo != null) {
        deliveryMap.get(r.SOID).lines.push({
          listNo: r.ListNo,
          bookingSoId: r.BookingSOID,
          bookingListNo: r.BookingListNo,
          goodId: r.GoodID,
          goodCode: r.GoodCode,
          goodName: r.GoodName,
          deliveryQtyTon: r.GoodQty2 != null ? Number(r.GoodQty2) : null,
          unitName: r.GoodUnitName || null
        });
      }
      // Expand upstream booking if linked
      if (r.BookingSOID && !shouldStop(depth + 1)) {
        await expandBooking(r.BookingSOID, depth + 1);
      }
    }

    const firstRow = dRows.recordset[0];
    const isCancelled = firstRow.DocuStatus === 'C';

    // If delivery is not cancelled, trace forward to WFCoupon (S1-04)
    if (!isCancelled && !shouldStop(depth + 1)) {
      queryCount++;
      const cpRows = await wfQuery(`
        SELECT c.CouponID
        FROM dbo.WFCoupon c WITH (NOLOCK)
        WHERE c.DocuID = @soId
      `, { soId: { type: sql.Int, value: soId } });

      for (const c of (cpRows.recordset || [])) {
        edges.push({ source: `DELIVERY:${soId}`, target: `COUPON:${c.CouponID}`, type: 'COUPON' });
        await expandCoupon(c.CouponID, depth + 1);
      }
    }

    // Trace direct invoices linked to delivery (S1-04 direct invoice path)
    if (!shouldStop(depth + 1)) {
      queryCount++;
      const invLinks = await wfQuery(`
        SELECT DISTINCT inv.SOInvID
        FROM dbo.SOInvDT invDt WITH (NOLOCK)
        JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.SOInvID = invDt.SOInvID
        WHERE invDt.RefID = @soId
      `, { soId: { type: sql.Int, value: soId } });

      for (const inv of (invLinks.recordset || [])) {
        edges.push({ source: `DELIVERY:${soId}`, target: `INVOICE:${inv.SOInvID}`, type: 'DIRECT_INVOICE' });
        await expandInvoice(inv.SOInvID, depth + 1);
      }
    }
  }

  // Helper to expand CouponID
  async function expandCoupon(couponId, depth = 0) {
    const key = `coupon:${couponId}`;
    if (visited.has(key) || shouldStop(depth)) return;
    visited.add(key);
    queryCount++;

    const cpRows = await wfQuery(`
      SELECT 
        c.CouponID, c.CouponNo, c.DocuID AS DeliverySOID, c.RefListno AS DeliveryListNo,
        c.GoodID, g.GoodCode, c.GoodName, c.GoodPrice,
        c.GoodQty, c.RemaQty, c.ContainQty, c.SackQty,
        u.GoodUnitName,
        d.DocuNo AS DeliveryDocuNo, d.DocuDate AS DeliveryDocuDate, d.CustID, d.CustName,
        dt.RefSOID AS BookingSOID, dt.RefListNo AS BookingListNo
      FROM dbo.WFCoupon c WITH (NOLOCK)
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = c.GoodUnitID
      LEFT JOIN dbo.SOHD d WITH (NOLOCK) ON d.SOID = c.DocuID
      LEFT JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = c.DocuID AND dt.ListNo = c.RefListno
      WHERE c.CouponID = @couponId
    `, { couponId: { type: sql.Int, value: couponId } });

    if (!cpRows.recordset?.length) return;
    const cp = cpRows.recordset[0];

    couponMap.set(cp.CouponID, {
      couponId: cp.CouponID,
      couponNo: cp.CouponNo,
      goodId: cp.GoodID,
      goodCode: cp.GoodCode,
      goodName: cp.GoodName,
      goodPrice: cp.GoodPrice != null ? Number(cp.GoodPrice) : null,
      initialQtyTon: cp.GoodQty != null ? Number(cp.GoodQty) : null,
      remainingQtyTon: cp.RemaQty != null ? Number(cp.RemaQty) : null,
      containQty: cp.ContainQty != null ? Number(cp.ContainQty) : null,
      sackQty: cp.SackQty != null ? Number(cp.SackQty) : null,
      unitName: cp.GoodUnitName || null,
      deliverySoId: cp.DeliverySOID,
      deliveryDocuNo: cp.DeliveryDocuNo,
      deliveryDocuDate: cp.DeliveryDocuDate,
      deliveryListNo: cp.DeliveryListNo,
      bookingSoId: cp.BookingSOID,
      bookingListNo: cp.BookingListNo,
      ownerCustId: cp.CustID,
      ownerCustName: cp.CustName
    });

    // Expand upstream delivery if not yet visited
    if (cp.DeliverySOID && !shouldStop(depth + 1)) {
      await expandDelivery(cp.DeliverySOID, depth + 1);
    }
    // Expand upstream booking if direct
    if (cp.BookingSOID && !shouldStop(depth + 1)) {
      await expandBooking(cp.BookingSOID, depth + 1);
    }

    // Trace downstream redemptions (116)
    if (!shouldStop(depth + 1)) {
      queryCount++;
      const redRows = await wfQuery(`
        SELECT 
          rd.RedemtionID, rd.Listno, rd.CouponID, rd.CouponNo, rd.GoodQty AS RedeemedQty,
          rd.RemaQty AS RedemptionRemaQty, rd.SOInvID, rd.SOListNo,
          rh.DocuNo AS RedemptionDocuNo, rh.DocuDate AS RedemptionDate, rh.DocuType AS RedemptionType, rh.DocuStatus AS RedemptionStatus
        FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
        JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
        WHERE rd.CouponID = @couponId
      `, { couponId: { type: sql.Int, value: couponId } });

      for (const r of (redRows.recordset || [])) {
        if (!redemptionMap.has(r.RedemtionID)) {
          redemptionMap.set(r.RedemtionID, {
            redemtionId: r.RedemtionID,
            docuNo: r.RedemptionDocuNo,
            docuDate: r.RedemptionDate,
            docuType: r.RedemptionType,
            docuStatus: r.RedemptionStatus,
            lines: []
          });
        }
        redemptionMap.get(r.RedemtionID).lines.push({
          listNo: r.Listno,
          couponId: r.CouponID,
          couponNo: r.CouponNo,
          redeemedQtyTon: r.RedeemedQty != null ? Number(r.RedeemedQty) : null,
          remaQty: r.RedemptionRemaQty != null ? Number(r.RedemptionRemaQty) : null,
          soInvId: r.SOInvID,
          soListNo: r.SOListNo
        });

        // Expand downstream invoice if present
        if (r.SOInvID) {
          edges.push({ source: `REDEMPTION:${r.RedemtionID}`, target: `INVOICE:${r.SOInvID}`, type: 'INVOICE' });
          if (!shouldStop(depth + 1)) {
            await expandInvoice(r.SOInvID, depth + 1);
          }
        }
      }
    }
  }

  // Helper to expand Invoice SOInvID
  async function expandInvoice(invId, depth = 0) {
    const key = `invoice:${invId}`;
    if (visited.has(key) || shouldStop(depth)) return;
    visited.add(key);
    queryCount++;

    const invRows = await wfQuery(`
      SELECT 
        h.SOInvID, h.DocuNo, h.Docutype AS DocuType, h.DocuDate, h.DocuStatus,
        h.CustID, h.CustName, h.NetAmnt, h.PostGL, h.PostGLDate,
        dt.ListNo, dt.GoodID, g.GoodCode, dt.GoodName, dt.GoodQty2, dt.GoodAmnt,
        dt.RefID, dt.RefListNo
      FROM dbo.SOInvHD h WITH (NOLOCK)
      LEFT JOIN dbo.SOInvDT dt WITH (NOLOCK) ON dt.SOInvID = h.SOInvID
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      WHERE h.SOInvID = @invId
    `, { invId: { type: sql.Int, value: invId } });

    if (!invRows.recordset?.length) return;

    for (const r of invRows.recordset) {
      if (!invoiceMap.has(r.SOInvID)) {
        invoiceMap.set(r.SOInvID, {
          soInvId: r.SOInvID,
          docuNo: r.DocuNo,
          docuType: r.DocuType,
          docuDate: r.DocuDate,
          docuStatus: r.DocuStatus,
          custId: r.CustID,
          custName: r.CustName,
          netAmnt: r.NetAmnt != null ? Number(r.NetAmnt) : null,
          postGL: r.PostGL,
          postGLDate: r.PostGLDate,
          lines: []
        });
      }
      if (r.ListNo != null) {
        invoiceMap.get(r.SOInvID).lines.push({
          listNo: r.ListNo,
          goodId: r.GoodID,
          goodCode: r.GoodCode,
          goodName: r.GoodName,
          qtyTon: r.GoodQty2 != null ? Number(r.GoodQty2) : null,
          amount: r.GoodAmnt != null ? Number(r.GoodAmnt) : null,
          refId: r.RefID,
          refListNo: r.RefListNo
        });
      }

      // Reverse path: if invoice line references delivery 104 or booking 103 (S1-04)
      if (r.RefID && !shouldStop(depth + 1)) {
        const refSo = await wfQuery(`SELECT SOID, DocuType FROM dbo.SOHD WITH (NOLOCK) WHERE SOID = @rid`, { rid: { type: sql.Int, value: r.RefID } });
        if (refSo.recordset?.length) {
          const dt = Number(refSo.recordset[0].DocuType);
          if (dt === 104) await expandDelivery(r.RefID, depth + 1);
          else if (dt === 103) await expandBooking(r.RefID, depth + 1);
        }
      }
    }
  }

  // Execute entry point expansion based on primaryCandidate
  switch (primaryCandidate.entityType) {
    case 'BOOKING':
    case 'APPROVAL':
      await expandBooking(primaryCandidate.id, 0);
      break;
    case 'DELIVERY':
      await expandDelivery(primaryCandidate.id, 0);
      break;
    case 'COUPON':
      await expandCoupon(primaryCandidate.id, 0);
      break;
    case 'REDEMPTION': {
      queryCount++;
      const rdLines = await wfQuery(`
        SELECT DISTINCT CouponID FROM dbo.WFRedemtionDT WHERE RedemtionID = @id
      `, { id: { type: sql.Int, value: primaryCandidate.id } });
      for (const l of (rdLines.recordset || [])) {
        if (l.CouponID) await expandCoupon(l.CouponID, 0);
      }
      break;
    }
    case 'INVOICE': {
      await expandInvoice(primaryCandidate.id, 0);
      queryCount++;
      const redLinks = await wfQuery(`
        SELECT DISTINCT RedemtionID, CouponID FROM dbo.WFRedemtionDT WHERE SOInvID = @id
      `, { id: { type: sql.Int, value: primaryCandidate.id } });
      for (const l of (redLinks.recordset || [])) {
        if (l.CouponID) await expandCoupon(l.CouponID, 0);
      }
      break;
    }
    default:
      if (primaryCandidate.id) await expandBooking(primaryCandidate.id, 0);
      break;
  }

  const bookings = Array.from(bookingMap.values());
  const deliveries = Array.from(deliveryMap.values());
  const coupons = Array.from(couponMap.values());
  const redemptions = Array.from(redemptionMap.values());
  const invoices = Array.from(invoiceMap.values());

  const totalNodes = bookings.length + deliveries.length + coupons.length + redemptions.length + invoices.length;
  if (totalNodes === 0) {
    return {
      resolved: false,
      isAmbiguous: false,
      error: `NOT_FOUND: No native records or linked chain found for ${primaryCandidate.entityType} ${primaryCandidate.id}`,
      chain: null
    };
  }

  return {
    resolved: true,
    isAmbiguous: false,
    truncated: isTruncated,
    reasons: truncationReasons,
    budget: { maxQueries: MAX_QUERIES, maxNodes: MAX_NODES, maxDepth: MAX_DEPTH },
    coverage: { queriesRun: queryCount, nodesVisited: visited.size },
    edges,
    primaryEntity: primaryCandidate,
    chain: {
      bookings,
      deliveries,
      coupons,
      redemptions,
      invoices
    }
  };
}

module.exports = {
  ALLOWED_ENTITY_TYPES,
  detectReferenceCandidates,
  resolveNativeDocumentChain,
};
