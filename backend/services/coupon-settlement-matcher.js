/**
 * coupon-settlement-matcher.js
 *
 * Pure function module for matching native WinSpeed redemptions (WFRedemtionHD/DT)
 * to active Coupon Reservations (wf.CouponReservation) for F-12 settlement and reconciliation.
 *
 * Rules (per R6 §1.4 / D4):
 * 1. Same CouponID
 * 2. Cut DocuDate >= carrier bill's confirm date (or created date if not confirmed)
 * 3. Normalized cut CarLicense == carrier bill's native plate (TransRegistration)
 * 4. NEVER match on quantity alone
 * 5. Cut quantity <= remaining reserved (supports partial cuts)
 * 6. Each cut line used at most once
 * 7. Ambiguous matches are listed and NOT settled
 */

/**
 * Normalizes truck plate string for strict comparison.
 * Trims, removes internal and surrounding whitespace, and converts to lowercase.
 */
function normalizePlate(plate) {
  if (!plate || typeof plate !== 'string') return '';
  return plate.trim().replace(/\s+/g, '').toLowerCase();
}

/**
 * Formats a date into Bangkok business date string (YYYY-MM-DD) in Asia/Bangkok (+07:00).
 * Prevents UTC offset regression where local-midnight DocuDate falls on the previous day.
 */
function toBangkokDateString(d) {
  if (!d) return null;
  const dateObj = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(dateObj);
}

/**
 * Earliest cut date (Bangkok YYYY-MM-DD) that may be listed or manually settled
 * against a reservation created at `createdAt`: created date minus N days.
 */
function earliestCutDate(createdAt, windowDays) {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return null;
  const days = Number.isFinite(Number(windowDays)) ? Number(windowDays) : 3;
  return toBangkokDateString(new Date(created.getTime() - days * 24 * 60 * 60 * 1000));
}

/**
 * Pure function: Matches WinSpeed native ticket cuts to active coupon reservations.
 *
 * @param {Array} reservations - List of reservations [{ id, couponId, reservedQty, plate, confirmDate, carrierSoId, carrierDocuNo }]
 * @param {Array} cuts - List of native cuts [{ redemptionId, couponId, goodQty, docuNo, docuDate, carLicense }]
 * @returns {Object} { matches, ambiguous, doubleCountedQty, doubleCountedReservations, unmatchedCuts, unmatchedReservations }
 */
function matchCutsToReservations(reservations = [], cuts = [], options = {}) {
  const windowDays = Number(options.settlementWindowDays ?? 3);
  const goLiveCutoff = options.goLiveCutoffDate || null;
  const matches = [];
  const ambiguous = [];
  const usedRedemptionIds = new Set();

  // Create mutable working copies of reservations to track remaining reserved quantity
  const resWorking = (reservations || []).map(r => {
    const reserved = Number(r.reservedQty != null ? r.reservedQty : (r.ReservedQty != null ? r.ReservedQty : 0));
    const consumed = Number(r.consumedQty != null ? r.consumedQty : (r.ConsumedQty != null ? r.ConsumedQty : 0));
    const remaining = r.remainingReservedQty != null
      ? Number(r.remainingReservedQty)
      : (r.RemainingReservedQty != null ? Number(r.RemainingReservedQty) : Math.max(0, Number((reserved - consumed).toFixed(4))));
    return {
      id: String(r.id != null ? r.id : r.Id),
      couponId: Number(r.couponId != null ? r.couponId : r.CouponId),
      reservedQty: reserved,
      remainingReservedQty: remaining,
      consumedQty: consumed,
      plate: normalizePlate(r.plate || r.TripPlate || r.TransRegistration || r.CarrierPlate),
      confirmDate: r.confirmDate || r.ConfirmedAt || r.DocuDate || r.createdAt || r.CreatedAt,
      createdAt: r.createdAt || r.CreatedAt || r.confirmDate || r.ConfirmedAt || r.DocuDate,
      carrierSoId: r.carrierSoId || r.CarrierSoId,
      carrierDocuNo: r.carrierDocuNo || r.CarrierDocuNo,
      beneficiaryCustId: r.beneficiaryCustId || r.BeneficiaryCustId,
      beneficiaryName: r.beneficiaryName || r.BeneficiaryName,
      beneficiaryCode: r.beneficiaryCode || r.BeneficiaryCode,
      ownerCustId: r.ownerCustId || r.OwnerCustId,
      isSettled: remaining <= 0,
    };
  });

  // Sort cuts chronologically: oldest cuts match first
  const sortedCuts = (cuts || [])
    .map(c => ({
      redemptionId: String(c.redemptionId != null ? c.redemptionId : (c.RedemtionID != null ? c.RedemtionID : (c.RedemptionId != null ? c.RedemptionId : ''))),
      couponId: Number(c.couponId != null ? c.couponId : (c.CouponID != null ? c.CouponID : c.CouponId)),
      goodQty: Number(c.goodQty != null ? c.goodQty : (c.GoodQty != null ? c.GoodQty : 0)),
      docuNo: String(c.docuNo || c.DocuNo || c.redemptionDocuNo || c.RedemptionDocuNo || ''),
      docuDate: c.docuDate || c.DocuDate,
      plate: normalizePlate(c.carLicense || c.CarLicense || c.carPlate || c.CarPlate || c.plate),
      receiver: String(c.receiver || c.issueName || c.IssueName || '').trim(),
      raw: c,
    }))
    .filter(c => c.goodQty > 0)
    .sort((a, b) => new Date(a.docuDate).getTime() - new Date(b.docuDate).getTime());

  for (const cut of sortedCuts) {
    if (usedRedemptionIds.has(cut.redemptionId)) continue;

    // RULE 4: NEVER match on quantity alone! A cut without plate cannot be matched safely.
    if (!cut.plate) {
      continue;
    }

    // Find candidate reservations:
    // - Same CouponId
    // - Same normalized plate
    // - Remaining reserved qty > 0
    // - Cut date >= go-live cutoff
    // - Cut date >= carrier bill's confirm date (RULE 2). The N-day window only
    //   limits which unmatched cuts are listed and manually settleable (R10.7-1);
    //   it never lets an automatic match take a cut dated before the confirm.
    const cutDateStr = toBangkokDateString(cut.docuDate);
    if (goLiveCutoff && cutDateStr && cutDateStr < goLiveCutoff) {
      continue;
    }

    const candidates = resWorking.filter(r => {
      if (r.couponId !== cut.couponId) return false;
      if (r.remainingReservedQty <= 0) return false;
      if (!r.plate || r.plate !== cut.plate) return false;

      if (r.confirmDate) {
        const confirmStr = toBangkokDateString(r.confirmDate);
        if (cutDateStr && confirmStr && cutDateStr < confirmStr) return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      continue;
    }

    if (candidates.length > 1) {
      // Multiple candidate reservations with same plate on same coupon
      const exactQty = candidates.filter(r => Math.abs(r.remainingReservedQty - cut.goodQty) < 0.0001);
      if (exactQty.length === 1) {
        applyMatch(exactQty[0], cut);
      } else if (exactQty.length > 1) {
        // FIFO: Multiple candidates with exact qty tie, match earliest confirmDate / ID
        exactQty.sort((a, b) => {
          const tA = new Date(a.confirmDate || 0).getTime();
          const tB = new Date(b.confirmDate || 0).getTime();
          if (tA !== tB) return tA - tB;
          return Number(a.id) - Number(b.id);
        });
        applyMatch(exactQty[0], cut);
      } else {
        // No exact qty match: Sort candidates by confirmDate (FIFO)
        candidates.sort((a, b) => {
          const tA = new Date(a.confirmDate || 0).getTime();
          const tB = new Date(b.confirmDate || 0).getTime();
          if (tA !== tB) return tA - tB;
          return Number(a.id) - Number(b.id);
        });
        if (cut.goodQty <= candidates[0].remainingReservedQty) {
          applyMatch(candidates[0], cut);
        } else {
          ambiguous.push({
            redemptionId: cut.redemptionId,
            redemptionDocuNo: cut.docuNo,
            plate: cut.plate,
            cutQty: cut.goodQty,
            reason: 'MULTIPLE_CANDIDATE_RESERVATIONS',
            candidateReservationIds: candidates.map(c => c.id),
          });
          continue;
        }
      }
    } else {
      applyMatch(candidates[0], cut);
    }
  }

  function applyMatch(res, cut) {
    usedRedemptionIds.add(cut.redemptionId);
    const matchedQty = Math.min(res.remainingReservedQty, cut.goodQty);
    const isPartial = matchedQty < res.remainingReservedQty;

    res.remainingReservedQty = Number((res.remainingReservedQty - matchedQty).toFixed(4));
    res.consumedQty = Number((res.consumedQty + matchedQty).toFixed(4));
    if (res.remainingReservedQty <= 0) {
      res.isSettled = true;
    }

    matches.push({
      reservationId: res.id,
      carrierSoId: res.carrierSoId,
      carrierDocuNo: res.carrierDocuNo,
      redemptionId: cut.redemptionId,
      redemptionDocuNo: cut.docuNo,
      cutDate: cut.docuDate,
      plate: cut.plate,
      matchedQty,
      isPartial,
      originalReservedQty: res.reservedQty,
      remainingReservedQty: res.remainingReservedQty,
    });
  }

  const doubleCountedReservations = matches.map(m => ({
    reservationId: m.reservationId,
    carrierSoId: m.carrierSoId,
    carrierDocuNo: m.carrierDocuNo,
    reservedQty: m.matchedQty,
    matchingRedemptionId: m.redemptionId,
    matchingRedemptionDocuNo: m.redemptionDocuNo,
    cutQty: m.matchedQty,
    isPartial: m.isPartial,
    remainingReservedQty: m.remainingReservedQty,
  }));

  const doubleCountedQty = Number(
    matches.reduce((sum, m) => sum + m.matchedQty, 0).toFixed(4)
  );

  // R10.7-1: a coupon with a long history has many old cuts. List only cuts on or
  // after the go-live cutoff and no more than N days before an open reservation
  // on the same coupon was created; anything older cannot belong to the app.
  const isListable = (cut) => {
    const cutDateStr = toBangkokDateString(cut.docuDate);
    if (goLiveCutoff && cutDateStr && cutDateStr < goLiveCutoff) return false;
    return resWorking.some(r => {
      if (r.couponId !== cut.couponId || r.remainingReservedQty <= 0) return false;
      const minAllowedStr = earliestCutDate(r.createdAt, windowDays);
      return !(cutDateStr && minAllowedStr && cutDateStr < minAllowedStr);
    });
  };

  const enrichedUnmatchedCuts = sortedCuts
    .filter(c => !usedRedemptionIds.has(c.redemptionId))
    .filter(isListable)
    .map(cut => {
      // Find candidate reservations on the same coupon with remaining reserved balance
      const couponCandidates = resWorking.filter(r => r.couponId === cut.couponId && r.remainingReservedQty > 0);

      let reason = 'NO_CANDIDATE';
      let candidateReservations = couponCandidates;

      if (couponCandidates.length === 0) {
        reason = 'NO_CANDIDATE';
        candidateReservations = [];
      } else {
        const plateMatches = couponCandidates.filter(r => r.plate && r.plate === cut.plate);
        if (plateMatches.length > 0) {
          // Plate matched! Check if any candidate was rejected because cut date < confirm date
          const dateFailed = plateMatches.filter(r => {
            if (!r.confirmDate) return false;
            const rDateStr = toBangkokDateString(r.confirmDate);
            const cutDateStr = toBangkokDateString(cut.docuDate);
            return cutDateStr && rDateStr && cutDateStr < rDateStr;
          });

          if (dateFailed.length > 0) {
            reason = 'CUT_BEFORE_CONFIRM';
            candidateReservations = plateMatches;
          } else {
            reason = 'QTY_MISMATCH';
            candidateReservations = plateMatches;
          }
        } else {
          // Plate did not match. Check receiver / beneficiary
          if (cut.receiver) {
            const cutRecClean = cut.receiver.replace(/\s+/g, '').toLowerCase();
            const receiverMatches = couponCandidates.filter(r => {
              const bName = String(r.beneficiaryName || '').replace(/\s+/g, '').toLowerCase();
              const bCode = String(r.beneficiaryCode || '').replace(/\s+/g, '').toLowerCase();
              const bId = String(r.beneficiaryCustId || '').replace(/\s+/g, '').toLowerCase();
              return (bName && cutRecClean === bName) ||
                     (bCode && cutRecClean === bCode) ||
                     (bId && cutRecClean === bId);
            });

            if (receiverMatches.length === 0) {
              reason = 'RECEIVER_MISMATCH';
            } else {
              reason = 'NO_CANDIDATE';
            }
          } else {
            reason = 'NO_CANDIDATE';
          }
        }
      }

      return {
        redemptionId: cut.redemptionId,
        docuNo: cut.docuNo,
        docuDate: cut.docuDate,
        goodQty: cut.goodQty,
        receiver: cut.receiver,
        plate: cut.plate,
        reason,
        candidateReservations: candidateReservations.map(r => ({
          id: r.id,
          carrierSoId: r.carrierSoId,
          carrierDocuNo: r.carrierDocuNo,
          plate: r.plate,
          reservedQty: r.reservedQty,
          remainingReservedQty: r.remainingReservedQty,
          confirmDate: r.confirmDate,
          beneficiaryCustId: r.beneficiaryCustId,
          beneficiaryName: r.beneficiaryName,
          beneficiaryCode: r.beneficiaryCode
        }))
      };
    });

  const unmatchedReservations = resWorking.filter(r => r.remainingReservedQty > 0);

  return {
    matches,
    ambiguous,
    doubleCountedQty,
    doubleCountedReservations,
    unmatchedCuts: enrichedUnmatchedCuts,
    unmatched: enrichedUnmatchedCuts,
    unmatchedReservations,
  };
}

module.exports = {
  normalizePlate,
  toBangkokDateString,
  earliestCutDate,
  matchCutsToReservations,
};
