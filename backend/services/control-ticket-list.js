'use strict';
const {sql,query,wfQuery}=require('../db');
const {getVisibleScope,scopeFilter}=require('./visible-scope');
const {actorPerspective}=require('./business-identity');
const {customerVisible}=require('./secondary-customer-scope');
const {withActorScope}=require('./secondary-read-scope');

async function readControlTickets(user,params={}) {
  const req={user,query:params};
    const { custId, includeCompleted, tab, q, page, pageSize, paginated } = req.query;
    const isPaginated = paginated === 'true' || page !== undefined || pageSize !== undefined;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    // Allow higher limit for customer-scoped queries to prevent silent truncation in CreateSODialog (R3-03 Point B)
    const maxLimit = custId ? 2000 : 500;
    const defaultLimit = custId ? 1000 : (isPaginated ? 50 : 200);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(pageSize, 10) || defaultLimit));
    const offset = (pageNum - 1) * limit;

    const expiryPolicy=await require('./coupon-expiry-policy').readCouponExpirySettings(wfQuery);
    const {getBangkokDateString}=require('./so-pickup-policy');
    const inputs = {ticketLifeDays:{type:sql.Int,value:expiryPolicy.lifeDays},ticketWarningDays:{type:sql.Int,value:expiryPolicy.warningDays},ticketToday:{type:sql.Date,value:getBangkokDateString()}};
    const expirySql='COALESCE(ov.ExpiryDate, ticketExpiry.ExpiryDate, DATEADD(day,@ticketLifeDays,CONVERT(date,h104.DocuDate)))';
    if (custId) inputs.custId = { type: sql.NVarChar(50), value: String(custId).trim() };
    if (q) inputs.q = { type: sql.NVarChar(100), value: `%${String(q).trim()}%` };
    // Customer-filtered ticket balances must use the same customer scope on both databases.
    if (custId && !await customerVisible(req.user, custId))
      throw Object.assign(new Error('ไม่พบลูกค้า'),{status:404});
    const ctVisible = custId ? { all: true } : await getVisibleScope(req.user);
    const ctActorUser = custId ? null : actorPerspective(req.user);
    const ctActor = !ctActorUser || ctActorUser === req.user ? null : await getVisibleScope(ctActorUser);
    const ctScope = withActorScope(scopeFilter(ctVisible, { empCol: 'h104.EmpID', prefix: 'ct' }), ctActor, { empCol: 'h104.EmpID' }, 'cta');
    const ctPending = withActorScope(scopeFilter(ctVisible, { empCol: 'h.EmpID', prefix: 'cp' }), ctActor, { empCol: 'h.EmpID' }, 'cpa');
    const ctDraft = withActorScope(scopeFilter(ctVisible, { userCol: 'so.SalesUserId', prefix: 'cd' }), ctActor, { userCol: 'so.SalesUserId' }, 'cda');
    // Data start date: a ticket issued before it is history, unless it still carries a
    // balance. Like old unpaid invoices in credit, that balance is an opening balance and
    // stays. Exhausted or cancelled older tickets are hidden. Pending bookings
    // and drafts are source documents, so their details respect the data window;
    // carried-forward outstanding quantities belong in balance reports.
    let ctWindow;
    try { ctWindow = await require('./global-data-window-store').readGlobalDataWindow(); }
    catch { throw Object.assign(new Error('ไม่สามารถตรวจวันเริ่มข้อมูลได้'),{code:'DATA_WINDOW_UNAVAILABLE',status:503}); }
    inputs.ctDataStart = { type: sql.Date, value: ctWindow.businessDate };
    inputs.ctDataStartUtc = { type: sql.DateTime2, value: ctWindow.utcInstant };
    Object.assign(inputs, ctScope.inputs, ctPending.inputs, ctDraft.inputs);

    const settlementSource=await require('./coupon-recovery-readiness').assertRecoveryReadiness(wfQuery);

    // Migration 139 records partial settlement separately. The source coupon's
    // native balance has already fallen, so only its still-unconsumed reservation
    // belongs in the held balance. For a database without the column, keep the
    // conservative legacy calculation rather than inventing settled quantities.
    const reservationSchema = await wfQuery("SELECT COL_LENGTH('wf.CouponReservation','ConsumedQty') AS ConsumedQtyColumn, OBJECT_ID('wf.CouponReservationSettlement','U') AS SettlementTable");
    const schemaRow = reservationSchema.recordset?.[0];
    const hasSettlement = schemaRow?.ConsumedQtyColumn != null && schemaRow?.SettlementTable != null;
    if (!hasSettlement) await require('./coupon-settlement-read-hold').assertLegacySettlementSchema(wfQuery);
    const { resolveHoldPolicy, heldReservationExpirySql } = require('./coupon-authorization-hold');
    const authHolds = await resolveHoldPolicy(wfQuery);
    const remainingReservationSql = reservationSchema.recordset?.[0]?.ConsumedQtyColumn != null
      ? 'CASE WHEN cr.ReservedQty >= ISNULL(cr.ConsumedQty,0) AND ISNULL(cr.ConsumedQty,0) >= 0 THEN cr.ReservedQty - ISNULL(cr.ConsumedQty,0) ELSE cr.ReservedQty END'
      : 'cr.ReservedQty';

    // 1. Query Issued Coupons from WFCoupon linked to 104 and 103
    const couponQuery = `
      SELECT
        c.CouponID,
        c.CouponNo,
        c.CouponNo AS DocuNo,
        c.CouponNo AS DisplayDocuNo,
        CASE WHEN h103.DocuDate >= @ctDataStart THEN h103.DocuNo END AS BookingDocuNo,
        CASE WHEN h103.DocuDate >= @ctDataStart THEN h103.AppvDocuNo END AS AppvDocuNo,
        CASE WHEN h104.DocuDate >= @ctDataStart THEN h104.DocuNo END AS DeliveryDocuNo,
        CASE WHEN h104.DocuDate >= @ctDataStart THEN c.DocuID END AS DeliverySOID,
        COALESCE(CASE WHEN h103.DocuDate >= @ctDataStart THEN h103.SOID END,
                 CASE WHEN h104.DocuDate >= @ctDataStart THEN h104.SOID END) AS SOID,
        CASE WHEN h104.DocuDate >= @ctDataStart THEN c.RefListno END AS ListNo,
        h104.CustID,
        h104.CustName,
        COALESCE(CASE WHEN h104.DocuDate >= @ctDataStart THEN h104.TransRegistration END,
                 CASE WHEN h103.DocuDate >= @ctDataStart THEN h103.TransRegistration END) AS TruckPlate,
        CASE WHEN h104.DocuDate >= @ctDataStart THEN h104.DocuDate END AS DocuDate,
        CASE WHEN h103.DocuDate >= @ctDataStart THEN h103.AppvFlag END AS AppvFlag,
        CASE WHEN h103.DocuDate >= @ctDataStart THEN h103.AppvDate END AS AppvDate,
        h104.DocuStatus,
        c.GoodID,
        g.GoodCode,
        c.GoodName,
        c.GoodPrice,
        u.GoodUnitName,
        CAST(c.GoodQty AS DECIMAL(12, 3)) AS TotalQtyTon,
        CAST(c.GoodQty AS DECIMAL(12, 3)) AS IssuedQtyTon,
        CAST(c.RemaQty AS DECIMAL(12, 3)) AS NativeRemainingQtyTon,
        CAST(ISNULL(res.TotalReserved, 0) AS DECIMAL(12, 3)) AS ReservedQtyTon,
        CAST(c.RemaQty - ISNULL(res.TotalReserved, 0) AS DECIMAL(12, 3)) AS AvailableQtyTon,
        CAST(c.GoodQty - (c.RemaQty - ISNULL(res.TotalReserved, 0)) AS DECIMAL(12, 3)) AS DrawnQtyTon,
        CASE
          WHEN c.RemaQty < 0 OR (c.RemaQty - ISNULL(res.TotalReserved, 0)) < 0 THEN 'NEGATIVE'
          WHEN c.RemaQty = 0 THEN 'ZERO'
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0 AND c.RemaQty > 0 THEN 'RESERVED_FULL'
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) > 0 THEN 'POSITIVE'
          ELSE 'UNKNOWN'
        END AS BalanceState,
        CASE
          WHEN h104.DocuStatus = 'C' THEN 'CANCELLED'
          ELSE 'ISSUED'
        END AS Lifecycle,
        CONVERT(date,${expirySql}) AS ExpiryDate,
        ov.ExpiryDate AS ControlExpiryDate,
        ticketExpiry.ExpiryDate AS TicketExpiryDate,
        h104.DocuDate AS ExpiryIssueDate,
        ov.ExpiryRows AS ControlExpiryRows,
        ov.ExpiryType,
        ov.StrictOverrideFlag,
        ov.ReasonCode,
        ov.ReasonText
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = c.DocuID AND h104.DocuType = 104
      LEFT JOIN dbo.SODT d104 WITH (NOLOCK) ON d104.SOID = c.DocuID AND d104.ListNo = c.RefListno
      LEFT JOIN dbo.SOHD h103 WITH (NOLOCK) ON h103.SOID = d104.RefSOID AND h103.DocuType = 103
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = c.GoodUnitID
      LEFT JOIN (
        SELECT cr.CouponId, SUM(${remainingReservationSql}) AS TotalReserved
        FROM wf.CouponReservation cr
        WHERE cr.Status = 'RESERVED' AND ${heldReservationExpirySql('cr',authHolds)}
        GROUP BY cr.CouponId
      ) res ON res.CouponId = c.CouponID
      LEFT JOIN wf.CouponExpiry ticketExpiry WITH (NOLOCK) ON ticketExpiry.CouponId=c.CouponID
      OUTER APPLY (
        SELECT MAX(ov.ExpiryDate) AS ExpiryDate,COUNT(*) AS ExpiryRows,
          MAX(ov.ExpiryType) AS ExpiryType,MAX(CONVERT(int,ov.StrictOverrideFlag)) AS StrictOverrideFlag,
          MAX(ov.ReasonCode) AS ReasonCode,MAX(ov.ReasonText) AS ReasonText
        FROM wf.ControlTicketOverlay ov WITH (NOLOCK) WHERE ov.DocuId=c.CouponID
      ) ov
      WHERE ${ctScope.sql}
        AND (ISNULL(h104.DocuDate, h103.DocuDate) >= @ctDataStart
          OR (c.RemaQty <> 0 AND ISNULL(h104.DocuStatus, '') <> 'C'))
        ${custId ? `AND (h104.CustID = @custId OR h103.CustID = @custId)` : ''}
        ${q ? `AND (c.CouponNo LIKE @q OR (h103.DocuDate >= @ctDataStart AND (h103.DocuNo LIKE @q OR h103.AppvDocuNo LIKE @q)) OR (h104.DocuDate >= @ctDataStart AND h104.DocuNo LIKE @q) OR h104.CustName LIKE @q OR c.GoodName LIKE @q)` : ''}
    `;

    // 2. Query Pending Approved Booking (103 with AI but no 104 issued)
    const pendingQuery = `
      SELECT
        NULL AS CouponID,
        NULL AS CouponNo,
        h.DocuNo,
        ISNULL(h.AppvDocuNo, h.DocuNo) AS DisplayDocuNo,
        h.DocuNo AS BookingDocuNo,
        h.AppvDocuNo,
        NULL AS DeliveryDocuNo,
        NULL AS DeliverySOID,
        h.SOID,
        dt.ListNo AS ListNo,
        h.CustID,
        h.CustName,
        h.TransRegistration AS TruckPlate,
        h.DocuDate,
        h.AppvFlag,
        h.AppvDate,
        h.DocuStatus,
        dt.GoodID,
        g.GoodCode,
        dt.GoodName,
        dt.GoodPrice2 AS GoodPrice,
        u.GoodUnitName,
        CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12, 3)) AS TotalQtyTon,
        CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12, 3)) AS IssuedQtyTon,
        NULL AS NativeRemainingQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS ReservedQtyTon,
        NULL AS AvailableQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS DrawnQtyTon,
        'PENDING_ISSUE' AS BalanceState,
        'APPROVED_NOT_ISSUED' AS Lifecycle,
        ov.ExpiryDate,
        ov.ExpiryDate AS ControlExpiryDate,
        CAST(NULL AS date) AS TicketExpiryDate,
        CAST(NULL AS date) AS ExpiryIssueDate,
        CAST(1 AS int) AS ControlExpiryRows,
        ov.ExpiryType,
        ov.StrictOverrideFlag,
        ov.ReasonCode,
        ov.ReasonText
      FROM dbo.SOHD h WITH (NOLOCK)
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = h.SOID
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = dt.GoodUnitID2
      OUTER APPLY (
        SELECT TOP 1
          ov.ExpiryDate,
          ov.ExpiryType,
          ov.StrictOverrideFlag,
          ov.ReasonCode,
          ov.ReasonText
        FROM wf.ControlTicketOverlay ov WITH (NOLOCK)
        WHERE (ov.DocuNo = h.DocuNo)
           OR (h.AppvDocuNo IS NOT NULL AND ov.DocuNo = h.AppvDocuNo)
        ORDER BY
          CASE
            WHEN ov.DocuNo = h.DocuNo THEN 1
            WHEN h.AppvDocuNo IS NOT NULL AND ov.DocuNo = h.AppvDocuNo THEN 2
            ELSE 3
          END ASC,
          ov.UpdatedAt DESC
      ) ov
      WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.DocuDate >= @ctDataStart AND ${ctPending.sql}
        AND (h.AppvDocuNo LIKE 'AI%' OR h.TransRegistration = N'ตั๋วคุม')
        AND NOT EXISTS (
          SELECT 1 FROM dbo.SODT d2 WITH (NOLOCK)
          JOIN dbo.SOHD h2 WITH (NOLOCK) ON h2.SOID = d2.SOID AND h2.DocuType = 104 AND h2.DocuStatus <> 'C'
          WHERE d2.RefSOID = h.SOID
        )
        ${custId ? `AND h.CustID = @custId` : ''}
        ${q ? `AND (h.DocuNo LIKE @q OR h.AppvDocuNo LIKE @q OR h.CustName LIKE @q OR dt.GoodName LIKE @q)` : ''}
    `;

    // 3. Query Draft Tickets from wf.SalesOrder
    const draftQuery = `
      SELECT
        NULL AS CouponID,
        NULL AS CouponNo,
        so.WfRef AS DocuNo,
        so.WfRef AS DisplayDocuNo,
        so.WfRef AS BookingDocuNo,
        so.WfRef AS AppvDocuNo,
        NULL AS DeliveryDocuNo,
        NULL AS DeliverySOID,
        so.Id AS SOID,
        wfl.LineNum AS ListNo,
        so.CustId AS CustID,
        so.CustName,
        so.TruckPlate,
        so.CreatedAt AS DocuDate,
        'N' AS AppvFlag,
        NULL AS AppvDate,
        'DRAFT' AS DocuStatus,
        wfl.GoodId AS GoodID,
        g.GoodCode,
        wfl.GoodName,
        wfl.PricePerTon AS GoodPrice,
        N'ตัน' AS GoodUnitName,
        CAST(ISNULL(wfl.QtyTon, 0) AS DECIMAL(12, 3)) AS TotalQtyTon,
        CAST(ISNULL(wfl.QtyTon, 0) AS DECIMAL(12, 3)) AS IssuedQtyTon,
        NULL AS NativeRemainingQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS ReservedQtyTon,
        NULL AS AvailableQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS DrawnQtyTon,
        'DRAFT' AS BalanceState,
        'DRAFT' AS Lifecycle,
        NULL AS ExpiryDate,
        CAST(NULL AS date) AS ControlExpiryDate,
        CAST(NULL AS date) AS TicketExpiryDate,
        CAST(NULL AS date) AS ExpiryIssueDate,
        CAST(0 AS int) AS ControlExpiryRows,
        NULL AS ExpiryType,
        CAST(0 AS BIT) AS StrictOverrideFlag,
        NULL AS ReasonCode,
        NULL AS ReasonText
      FROM wf.SalesOrder so WITH (NOLOCK)
      JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = so.Id
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = wfl.GoodId
      WHERE so.SoPrefix = 'AI' AND so.Status = 'DRAFT' AND so.CreatedAt >= @ctDataStartUtc AND ${ctDraft.sql}
        ${custId ? `AND so.CustId = @custId` : ''}
        ${q ? `AND (so.WfRef LIKE @q OR so.CustName LIKE @q OR wfl.GoodName LIKE @q)` : ''}
    `;

    const selectedTab = String(tab || (includeCompleted === 'true' ? 'ALL' : 'ACTIVE')).toUpperCase();

    let subqueries = [];
    if (selectedTab === 'PENDING') {
      subqueries = [pendingQuery, draftQuery];
    } else if (selectedTab === 'HISTORY' || selectedTab === 'USED_UP') {
      // HISTORY: normally exhausted (RemaQty = 0 AND NetAvailable = 0) OR cancelled, strictly excluding anomalies (R3-03 Point 3)
      const historyCouponQuery = `${couponQuery} AND (((c.RemaQty = 0 AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0)) OR (c.RemaQty > 0 AND h104.DocuStatus = 'C')) AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) >= 0 AND c.RemaQty >= 0`;
      subqueries = [historyCouponQuery];
    } else if (selectedTab === 'ACTIVE') {
      const activeCouponQuery = `${couponQuery} AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) > 0 AND c.RemaQty > 0 AND h104.DocuStatus <> 'C'`;
      subqueries = [activeCouponQuery];
    } else if (selectedTab === 'OUTSTANDING') {
      subqueries=[`${couponQuery} AND c.RemaQty>0 AND h104.DocuStatus<>'C'`];
    } else if (selectedTab === 'RESERVED_FULL') {
      const reservedCouponQuery = `${couponQuery} AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0 AND c.RemaQty > 0 AND h104.DocuStatus <> 'C'`;
      subqueries = [reservedCouponQuery];
    } else if (selectedTab === 'ALERTS' || selectedTab === 'EXPIRED_ALERT') {
      const alertCouponQuery = `${couponQuery}
        AND ${expirySql} IS NOT NULL
        AND ${expirySql}<=DATEADD(day,@ticketWarningDays,@ticketToday)
        AND c.RemaQty>0 AND (c.RemaQty-ISNULL(res.TotalReserved,0))>=0 AND h104.DocuStatus<>'C'`;
      subqueries = [alertCouponQuery];
    } else if (selectedTab === 'UNKNOWN' || selectedTab === 'REVIEW') {
      // REVIEW: anomaly remaining or negative available (R3-03 Point 3)
      const reviewCouponQuery = `${couponQuery} AND (c.RemaQty < 0 OR (c.RemaQty - ISNULL(res.TotalReserved, 0)) < 0)`;
      subqueries = [reviewCouponQuery];
    } else {
      subqueries = [couponQuery, pendingQuery, draftQuery];
    }

    inputs.offset = { type: sql.Int, value: offset };
    inputs.limit = { type: sql.Int, value: limit };

    const allowedExpiry=new Set(['ALL','EXPIRED','TODAY','NEAR_EXPIRY','VALID','UNKNOWN']);
    const expiryFilter=String(req.query.expiry||'ALL').toUpperCase();
    if(!allowedExpiry.has(expiryFilter))throw Object.assign(new Error('ตัวกรองอายุตั๋วไม่ถูกต้อง'),{status:400});
    inputs.expiryFilter={type:sql.VarChar(20),value:expiryFilter};
    const expiryStateSql=`CASE WHEN ExpiryDate IS NULL THEN 'UNKNOWN' WHEN CONVERT(date,ExpiryDate)<@ticketToday THEN 'EXPIRED' WHEN CONVERT(date,ExpiryDate)=@ticketToday THEN 'TODAY' WHEN CONVERT(date,ExpiryDate)<=DATEADD(day,@ticketWarningDays,@ticketToday) THEN 'NEAR_EXPIRY' ELSE 'VALID' END`;
    const expiryWhere=`(@expiryFilter='ALL' OR (${expiryStateSql})=@expiryFilter)`;
    const orderBy=req.query.sort==='FIFO'?'ExpiryIssueDate ASC, DocuNo ASC, ISNULL(CouponID,0) ASC':selectedTab==='ALERTS'||req.query.sort==='OLDEST'?'ExpiryDate ASC, DocuDate ASC, DocuNo ASC, ISNULL(CouponID,0) ASC':'DocuDate DESC, DocuNo DESC, ISNULL(CouponID,0) DESC, ISNULL(SOID,0) DESC, ISNULL(ListNo,0) ASC';
    const fullUnionSql = `
      WITH AllControlItems AS (
        ${subqueries.join('\n UNION ALL \n')}
      ),
      PagingCTE AS (
        SELECT
          *,
          COUNT(*) OVER() AS TotalFilteredCount,
          ROW_NUMBER() OVER (
            ORDER BY ${orderBy}
          ) AS RowNum
        FROM AllControlItems WHERE ${expiryWhere}
      )
      SELECT * FROM PagingCTE
      WHERE RowNum > @offset AND RowNum <= (@offset + @limit)
      ORDER BY RowNum ASC
    `;

    const rawRows = await query(fullUnionSql, inputs);
    // A page containing a changed/missing settled 116 must not advertise its
    // pre-recovery available balance. Keep tab and paging semantics intact by
    // stopping this page, rather than silently moving an item between tabs.
    // This is a read-side check, not an atomic reservation authorization.
    if (hasSettlement) {
      const ids = rawRows.filter(r => r.CouponID != null).map(r => r.CouponID);
      const conflicts = await require('./coupon-settlement-read-hold').findSettlementSourceConflicts(wfQuery, ids, settlementSource);
      if (conflicts.size) throw Object.assign(new Error('พบตั๋วที่ต้องตรวจใบขนก่อนแสดงยอด กรุณาติดต่อผู้ดูแล'),
        { code: 'COUPON_SETTLEMENT_SOURCE_CHANGED', status: 409 });
    }
    let totalCount = 0;
    if (rawRows && rawRows.length > 0) {
      totalCount = Number(rawRows[0].TotalFilteredCount || rawRows.length);
    } else if (isPaginated && pageNum > 1) {
      const countRes = await query(`
        WITH AllControlItems AS (
          ${subqueries.join('\n UNION ALL \n')}
        )
        SELECT COUNT(*) AS TotalCount FROM AllControlItems WHERE ${expiryWhere}
      `, inputs);
      totalCount = Number(countRes[0]?.TotalCount || 0);
    }

    const { resolveTicketPolicy, evaluateTicketExpiry, evaluateTicketEligibility } = require('./ticket-policy');
    const policy = {...await resolveTicketPolicy(),alertDays:expiryPolicy.warningDays};
    const {couponExpiry}=require('./coupon-expiry-policy');

    // Enrich with multi-axis status & policy
    const enriched = (rawRows || []).map(r => {
      const effectiveExpiry=couponExpiry({controlDate:r.ControlExpiryDate===undefined?r.ExpiryDate:r.ControlExpiryDate,
        ticketDate:r.TicketExpiryDate,issueDate:r.ExpiryIssueDate,controlRows:r.ControlExpiryRows??1,...expiryPolicy},inputs.ticketToday.value);
      const expiryEval=evaluateTicketExpiry(effectiveExpiry.expiryDate,inputs.ticketToday.value,policy.alertDays,false,Boolean(r.StrictOverrideFlag));
      expiryEval.status=effectiveExpiry.status;
      expiryEval.isNearExpiry=effectiveExpiry.isExpiringSoon;
      expiryEval.provenance=effectiveExpiry.source||'UNKNOWN';
      if(effectiveExpiry.status==='TODAY')expiryEval.label='หมดอายุวันนี้';

      const eligibilityEval = evaluateTicketEligibility({
        couponId: r.CouponID,
        lifecycle: r.Lifecycle,
        balanceState: r.BalanceState,
        availableQtyTon: r.AvailableQtyTon,
        nativeRemainingQtyTon: r.NativeRemainingQtyTon,
        expiryEval,
        strictOverride: Boolean(r.StrictOverrideFlag),
        strictMode: policy.strictMode,
      });

      const balanceState = r.BalanceState;
      const lifecycle = r.Lifecycle;
      const expiryState = expiryEval.status === 'EXPIRED' ? 'EXPIRED' : (expiryEval.status === 'TODAY' ? 'TODAY' : (expiryEval.status === 'NEAR_EXPIRY' ? 'EXPIRING' : (expiryEval.expiryDate ? 'VALID' : 'UNKNOWN')));

      const isCoupon = r.CouponID != null;
      const entityType = isCoupon ? 'COUPON' : (lifecycle === 'APPROVED_NOT_ISSUED' ? 'BOOKING' : 'DRAFT');
      const exactId = r.CouponID || r.SOID;
      const entityKey = isCoupon
        ? `coupon:${r.CouponID}`
        : (lifecycle === 'APPROVED_NOT_ISSUED'
            ? `booking:${r.SOID}:${r.ListNo || 1}`
            : `draft:${r.SOID}:${r.ListNo || 1}`);

      const {ControlExpiryDate,TicketExpiryDate,ExpiryIssueDate,ControlExpiryRows,...visibleRow}=r;
      return {
        ...visibleRow,
        entityType,
        exactId,
        entityKey,
        BalanceState: balanceState,
        Lifecycle: lifecycle,
        ExpiryState: expiryState,
        Eligibility: eligibilityEval.eligibility,
        Reasons: eligibilityEval.reasons,
        expiry: expiryEval,
        expiryStatus: expiryEval.status,
        expiryDate: expiryEval.expiryDate,
        expirySource:effectiveExpiry.source,
        ticketLifeDays:expiryPolicy.lifeDays,
        warningLeadDays:expiryPolicy.warningDays,
        daysRemaining: expiryEval.daysRemaining,
        strictMode: policy.strictMode,
        strictOverride: Boolean(r.StrictOverrideFlag),
        isBlocked: eligibilityEval.isBlocked,
        isSpendable: eligibilityEval.isSpendable,
        warning: eligibilityEval.warnings?.length > 0 ? eligibilityEval.warnings.join('; ') : null,
        error: eligibilityEval.isBlocked ? (eligibilityEval.reasons?.join('; ') || eligibilityEval.error) : null,
        customerCandidate: {
          candidateCustId: r.CustID,
          candidateCustName: r.CustName,
          isPrefixCandidateOnly: true,
          note: 'Prefix ลูกค้าเป็น candidate เท่านั้น ไม่ใช่สิทธิ์เบิกข้ามลูกค้าอัตโนมัติ',
        },
      };
    });

    return {total:totalCount,page:pageNum,pageSize:limit,totalPages:Math.ceil(totalCount/limit)||1,data:enriched,expiryPolicy};

}

async function listControlTickets(req,res) {
 try { const result=await readControlTickets(req.user,req.query);res.setHeader('X-Total-Count',result.total);if(result.total>result.pageSize)res.setHeader('X-Truncated','true');
  return res.json(req.query.paginated==='true'||req.query.page!==undefined||req.query.pageSize!==undefined?result:result.data);
 }catch(e){console.error('[control-tickets]',e);return res.status(e.status||500).json({code:e.code,message:e.message});}
}
// Compatibility endpoints use the operational reader too; no second balance,
// expiry, scope or recovery calculation. They keep the legacy array contract.
async function legacyCouponRows(user,params={}) {
  const result=[];let page=1,totalPages=1;
  do {
    const r=await readControlTickets(user,{custId:params.custId,tab:'OUTSTANDING',paginated:'true',page:String(page),pageSize:'500',sort:'FIFO'});
    result.push(...r.data);totalPages=r.totalPages;page++;
    if(totalPages>200)throw Object.assign(new Error('รายการตั๋วมากเกินไป กรุณาระบุลูกค้า'),{status:413});
  }while(page<=totalPages);
  const owners=[...new Set(result.map(r=>String(r.CustID)).filter(Boolean))];
  const benes=new Map();
  const metadata=new Map();
  for(let start=0;start<result.length;start+=500){
    const inputs={};const ids=result.slice(start,start+500).map((r,i)=>{inputs['cid'+i]={type:sql.Int,value:r.CouponID};return '@cid'+i;});
    const rows=(await wfQuery(`SELECT c.CouponID,cu.CustCode,hd.EmpID,emp.EmpName
      FROM dbo.WFCoupon c JOIN dbo.SOHD hd ON hd.SOID=c.DocuID
      LEFT JOIN dbo.EMCust cu ON cu.CustID=hd.CustID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID=hd.EmpID WHERE c.CouponID IN (${ids.join(',')})`,inputs)).recordset||[];
    for(const row of rows)metadata.set(Number(row.CouponID),row);
  }
  for(let start=0;start<owners.length;start+=500){
    const inputs={};const keys=owners.slice(start,start+500).map((id,i)=>{inputs['owner'+i]={type:sql.VarChar(50),value:id};return '@owner'+i;});
    const rows=(await wfQuery(`SELECT OwnerCustId,BeneficiaryCustId,BeneficiaryCustCode,BeneficiaryCustName,Scope,Reason
      FROM wf.CouponBeneficiary WHERE OwnerCustId IN (${keys.join(',')}) AND Status='ACTIVE'
      AND (EffectiveFrom IS NULL OR EffectiveFrom<=CAST(DATEADD(hour,7,GETUTCDATE()) AS date))
      AND (EffectiveTo IS NULL OR EffectiveTo>=CAST(DATEADD(hour,7,GETUTCDATE()) AS date))`,inputs)).recordset||[];
    for(const b of rows){const list=benes.get(String(b.OwnerCustId))||[];list.push(b);benes.set(String(b.OwnerCustId),list);}
  }
  return result.map(r=>{
    const beneficiaries=(benes.get(String(r.CustID))||[]).filter(b=>b.Scope==='ALL'||String(b.Scope)===String(r.GoodID)).map(b=>({beneficiaryCustId:b.BeneficiaryCustId,beneficiaryCustCode:b.BeneficiaryCustCode,beneficiaryCustName:b.BeneficiaryCustName||b.BeneficiaryCustCode||b.BeneficiaryCustId,scope:b.Scope,reason:b.Reason}));
    const {GoodPrice,...safeRow}=r;
    const meta=metadata.get(Number(r.CouponID))||{};
    const mayReadPrice=user?.role!=='SALES'&&user?.actorRole!=='SALES';
    return {...safeRow,...(mayReadPrice?{GoodPrice}:{}),CustCode:meta.CustCode,EmpID:meta.EmpID,EmpName:meta.EmpName,custCode:meta.CustCode,ownerCustCode:meta.CustCode,empId:meta.EmpID,empName:meta.EmpName,couponId:r.CouponID,couponNo:r.CouponNo,soNo:r.DeliveryDocuNo,docuDate:r.DocuDate,
      custId:String(r.CustID),custName:r.CustName,goodId:r.GoodID,goodName:r.GoodName,
      goodQty:Number(r.TotalQtyTon||0),remaQty:Number(r.NativeRemainingQtyTon||0),
      availableQty:Number(r.AvailableQtyTon||0),reservedQty:Number(r.ReservedQtyTon||0),
      redeemedQty:Number(r.TotalQtyTon||0)-Number(r.NativeRemainingQtyTon||0),
      GoodQty:r.TotalQtyTon,RemaQty:r.NativeRemainingQtyTon,RedeemedQty:Number(r.TotalQtyTon||0)-Number(r.NativeRemainingQtyTon||0),
      SONo:r.DeliveryDocuNo,daysLeft:r.daysRemaining,isExpired:r.expiryStatus==='EXPIRED',
      isExpiringSoon:r.expiryStatus==='NEAR_EXPIRY',isToday:r.expiryStatus==='TODAY',beneficiaries};
  });
}
async function couponWorklist(req,res){
  try{return res.json(await legacyCouponRows(req.user,{custId:req.params?.custId}));}
  catch(e){return res.status(e.status||500).json({code:e.code,message:e.message});}
}
module.exports={readControlTickets,listControlTickets,legacyCouponRows,couponWorklist};
