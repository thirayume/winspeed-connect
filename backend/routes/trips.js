const { validateBookingNotes } = require('../services/booking-notes');
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { broadcast } = require('../services/socket');

router.use(requireAuth);

// R12 O-4: a trip is visible when its creator or any of its bills belongs to the user's own + team scope
const { getVisibleScope, scopeFilter } = require('../services/visible-scope');
async function tripScopeSql(user, alias = 't') {
  const scope = await getVisibleScope(user);
  if (scope.all) return { sql: '1=1', inputs: {} };
  const created = scopeFilter(scope, { userCol: `${alias}.CreatedBy`, prefix: 'tc' });
  const member = scopeFilter(scope, { userCol: 'm.SalesUserId', prefix: 'tm' });
  return {
    sql: `(${created.sql} OR EXISTS (SELECT 1 FROM wf.v_TripMember m WHERE m.TripId = ${alias}.TripId AND ${member.sql}))`,
    inputs: { ...created.inputs, ...member.inputs },
  };
}

// Actions by trip id obey the same scope as the detail view (out of scope → 404)
async function requireTripInScope(req, res, next) {
  try {
    const ts = await tripScopeSql(req.user);
    if (ts.sql === '1=1') return next();
    const r = await wfQuery(`SELECT 1 AS ok FROM wf.SalesTrip t WHERE t.TripId = @tid AND ${ts.sql}`,
      { tid: { type: sql.Int, value: Number(req.params.id) || 0 }, ...ts.inputs });
    if (!r.recordset?.[0]) return res.status(404).json({ message: 'ไม่พบ Trip นี้' });
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

// GET /api/trips
router.get('/', requireCapability('trip.view'), async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = 'WHERE 1=1';
    const inputs = {};
    if (status) {
      where += ' AND Status = @status';
      inputs.status = { type: sql.VarChar(50), value: status };
    }
    if (search) {
      where += ' AND (TripCode LIKE @search OR TransRegistration LIKE @search OR DriverName LIKE @search)';
      inputs.search = { type: sql.NVarChar(100), value: `%${search}%` };
    }

    const ts = await tripScopeSql(req.user);
    where += ` AND ${ts.sql}`;
    Object.assign(inputs, ts.inputs);
    const result = await wfQuery(`
      SELECT t.*, u.DisplayName AS CreatedByName,
             (SELECT COUNT(*) FROM wf.v_TripMember WHERE TripId = t.TripId) as OrderCount
      FROM wf.SalesTrip t
      LEFT JOIN wf.AppUser u ON u.Id = t.CreatedBy
      ${where}
      ORDER BY t.CreatedAt DESC
    `, inputs);

    res.json({ data: camelizeRows(result.recordset || []) });
  } catch (error) {
    console.error('[trips]', error);
    res.status(error.status || 500).json({ message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/trips/board  — กระดาน Sale Trip (เฟส 4)
//
// ต้องประกาศ **ก่อน** /:id ไม่งั้น Express จะจับคำว่า board เป็น id
//
// คืนลำดับชั้นตามที่ตกลงกันไว้
//   เที่ยวรถ → ลูกค้า → ใบจอง (เล่ม I / K) → รายการสินค้า
//
// สมาชิกของเที่ยวอ่านจาก wf.v_TripMember ซึ่งรวมทั้งใบร่างและใบที่ยืนยันแล้ว
// (หลังยืนยัน แถวใน wf.SalesOrder ถูกลบทิ้ง ตัวที่เหลือคือ wf.SalesOrderExt)
//
// อ่านอย่างเดียว ไม่เขียน dbo ทั้ง WGHD/WGDT และ SOHD/SODT
router.get('/board', requireCapability('trip.view'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const inputs = {};
    let where = 'WHERE 1=1';
    if (status) { where += ' AND t.Status = @status'; inputs.status = { type: sql.VarChar(50), value: status }; }
    if (search) {
      where += ' AND (t.TripCode LIKE @search OR t.TransRegistration LIKE @search OR t.DriverName LIKE @search)';
      inputs.search = { type: sql.NVarChar(100), value: `%${search}%` };
    }

    const bs = await tripScopeSql(req.user);
    where += ` AND ${bs.sql}`;
    Object.assign(inputs, bs.inputs);
    const tripsRes = await wfQuery(`
      SELECT t.*, u.DisplayName AS CreatedByName
      FROM wf.SalesTrip t
      LEFT JOIN wf.AppUser u ON u.Id = t.CreatedBy
      ${where}
      ORDER BY ISNULL(t.PickupDueDate, '9999-12-31'), t.CreatedAt DESC
    `, inputs);

    const trips = camelizeRows(tripsRes.recordset || []);
    if (trips.length === 0) return res.json({ data: [] });

    // int ล้วนที่อ่านกลับมาจาก DB เอง ไม่ใช่ค่าจากผู้ใช้ จึงต่อสตริงได้
    // กรอง Number.isInteger ไว้อีกชั้นกันพลาด
    const idList = trips.map(t => Number(t.tripId)).filter(Number.isInteger).join(',');

    const [membersRes, draftLinesRes, confLinesRes, weighRes, holdRes] = await Promise.all([
      wfQuery(`SELECT * FROM wf.v_TripMember WHERE TripId IN (${idList})`),

      wfQuery(`
        SELECT o.TripId, 'DRAFT' AS MemberKind, CAST(l.SoId AS VARCHAR(50)) AS MemberId,
               l.LineNum AS ListNo, l.GoodCode, l.GoodName,
               l.QtyTon, l.QtyBag, l.PricePerTon, l.NetPricePerTon, l.LineAmount,
               l.IsGiveaway, l.LoadSequence, l.MasterQty, l.ChildQty,
               l.RefControlTicketNo, l.IsControlTicketDrawn, l.GiveawayApprovalStatus
        FROM wf.SalesOrderLine l
        JOIN wf.SalesOrder o ON o.Id = l.SoId
        WHERE o.TripId IN (${idList})`),

      // ฝั่งที่ยืนยันแล้ว ตัวเลขจริงอยู่ที่ dbo.SODT ส่วนสิ่งที่ WINSpeed ไม่มี
      // (ลำดับขึ้นของ · ตั๋วคุมที่อ้างถึง · สถานะอนุมัติของแถม) อยู่ที่ wf.SalesOrderLineExt
      wfQuery(`
        SELECT e.TripId, 'CONFIRMED' AS MemberKind, CAST(d.SOID AS VARCHAR(50)) AS MemberId,
               d.ListNo, RTRIM(g.GoodCode) AS GoodCode, RTRIM(d.GoodName) AS GoodName,
               CAST(ISNULL(d.GoodQty2, 0) AS DECIMAL(18,3)) AS QtyTon,
               CAST(ISNULL(d.GoodQty1, 0) AS DECIMAL(18,0)) AS QtyBag,
               CAST(ISNULL(d.GoodPrice2, 0) AS DECIMAL(18,2)) AS PricePerTon,
               le.NetPricePerTon,
               CAST(ISNULL(d.GoodAmnt, 0) AS DECIMAL(18,2)) AS LineAmount,
               ISNULL(le.IsGiveaway, CASE WHEN d.FreeFlag = 'Y' THEN 1 ELSE 0 END) AS IsGiveaway,
               le.LoadSequence,
               ISNULL(le.MasterQty, d.MasterQty) AS MasterQty,
               ISNULL(le.ChildQty,  d.ChildQty)  AS ChildQty,
               le.RefControlTicketNo, le.IsControlTicketDrawn, le.GiveawayApprovalStatus
        FROM wf.SalesOrderExt e
        JOIN dbo.SODT d ON d.SOID = (
          CASE 
            WHEN e.SOID IS NOT NULL 
             AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%' 
             AND LTRIM(RTRIM(e.SOID)) <> '' 
             AND (
               LEN(LTRIM(RTRIM(e.SOID))) <= 9 
               OR (LEN(LTRIM(RTRIM(e.SOID))) = 10 AND CAST(LTRIM(RTRIM(e.SOID)) AS BIGINT) <= 2147483647)
             )
            THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT) 
            ELSE NULL 
          END
        ) AND d.DocuType = 103
        LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
        LEFT JOIN wf.SalesOrderLineExt le ON le.SOID = e.SOID AND le.ListNo = d.ListNo
        WHERE e.TripId IN (${idList})`),

      // สถานะรถจาก WGHD — 1 ลงทะเบียน · 2 กำลังโหลด · 3 ชั่งออกแล้ว
      wfQuery(`
        SELECT e.TripId, CAST(w.SPID AS VARCHAR(50)) AS MemberId,
               w.Id, w.CarNo, w.DateReg, w.Status, w.WGType,
               w.WeightIn, w.WeightOut, w.WeightNet, w.TONNet, w.DocuNo, w.MoveBill
        FROM wf.SalesOrderExt e
        JOIN dbo.WGHD w ON w.SPID = (
          CASE 
            WHEN e.SOID IS NOT NULL 
             AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%' 
             AND LTRIM(RTRIM(e.SOID)) <> '' 
             AND (
               LEN(LTRIM(RTRIM(e.SOID))) <= 9 
               OR (LEN(LTRIM(RTRIM(e.SOID))) = 10 AND CAST(LTRIM(RTRIM(e.SOID)) AS BIGINT) <= 2147483647)
             )
            THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT) 
            ELSE NULL 
          END
        )
        WHERE e.TripId IN (${idList})`),

      // คำขอแก้ไขที่ยังรออนุมัติ (เฟส 5) — ตัวที่ Hold รถต้องเด่นบนกระดาน
      // คนคุมลานต้องเห็นก่อนสั่งขึ้นของ ไม่ใช่ไปรู้เอาตอนรถจอดรอ
      wfQuery(`
        SELECT r.Id, r.SOID AS MemberId, r.TripId, r.StageAtRequest, r.ReasonCode,
               r.ReasonDetail, r.HoldTruck, r.RequestedAt,
               rs.ReasonText, u.DisplayName AS RequestedByName
        FROM wf.EditRequest r
        LEFT JOIN wf.EditReason rs ON rs.ReasonCode = r.ReasonCode
        LEFT JOIN wf.AppUser  u  ON u.Id = r.RequestedBy
        WHERE r.Status = 'PENDING' AND r.TripId IN (${idList})`)
    ]);

    const members   = camelizeRows(membersRes.recordset || []);
    const allLines  = camelizeRows([...(draftLinesRes.recordset || []), ...(confLinesRes.recordset || [])]);
    const weighRows = camelizeRows(weighRes.recordset || []);

    const key = (kind, id) => kind + '#' + String(id);

    const linesBy = new Map();
    for (const l of allLines) {
      const k = key(l.memberKind, l.memberId);
      if (!linesBy.has(k)) linesBy.set(k, []);
      linesBy.get(k).push(l);
    }
    const weighBy = new Map();
    for (const w of weighRows) {
      const k = key('CONFIRMED', w.memberId);
      if (!weighBy.has(k)) weighBy.set(k, []);
      weighBy.get(k).push(w);
    }
    // ⚠ ห้ามใช้ค่าดิบจาก driver เป็นคีย์ Map
    //
    // บน Windows แอปต่อ SQL Server ด้วย msnodesqlv8 ซึ่งคืน wf.SalesTrip.TripId
    // มาเป็น **สตริง** ส่วนบน Linux (Docker) ใช้ tedious ซึ่งคืนมาเป็น
    // **ตัวเลข** ทั้งที่คอลัมน์เป็น int เหมือนกัน ถ้าเอาค่าดิบมาเป็นคีย์
    // กระดานจะว่างเปล่าบนแพลตฟอร์มหนึ่งแต่ปกติดีอีกแพลตฟอร์มหนึ่ง
    // แปลงเป็นสตริงทั้งสองฝั่งเสมอ
    const tripKey = (v) => String(v);
    // คำขอค้างจับคู่กับใบจองด้วย SOID (สตริงทั้งคู่)
    const reqBy = new Map();
    for (const q of camelizeRows(holdRes.recordset || [])) {
      const k = key('CONFIRMED', q.memberId);
      if (!reqBy.has(k)) reqBy.set(k, []);
      reqBy.get(k).push(q);
    }

    const membersByTrip = new Map();
    for (const m of members) {
      const k = tripKey(m.tripId);
      if (!membersByTrip.has(k)) membersByTrip.set(k, []);
      membersByTrip.get(k).push(m);
    }

    // เฟสของทั้งเที่ยว = ขั้นที่ช้าที่สุดในบรรดาใบทั้งหมด
    // รถคันเดียวมีหลาย SO เที่ยวจะยังไม่ถือว่าออก จนกว่าจะชั่งออกครบทุกใบ
    // Status กลับมาเป็นสตริง ต้อง Number() ก่อนเทียบเสมอ
    const tripPhase = (rows, memberCount) => {
      if (rows.length === 0) return { phase: 'PLANNED', label: 'ยังไม่เข้าชั่ง' };
      const st = rows.map(r => Number(r.status));
      if (st.every(s => s === 3) && rows.length >= memberCount) return { phase: 'SHIPPED', label: 'ชั่งออกครบทุกใบ' };
      if (st.some(s => s === 2)) return { phase: 'LOADING', label: 'กำลังโหลดสินค้า' };
      if (st.some(s => s === 1)) return { phase: 'REGISTERED', label: 'รถลงทะเบียนแล้ว' };
      return { phase: 'PARTIAL', label: 'ชั่งออกบางส่วน' };
    };

    const data = trips.map(t => {
      const mem = membersByTrip.get(tripKey(t.tripId)) || [];
      const tripWeigh = [];
      const tripReqs = [];
      const byCust = new Map();
      let plannedTon = 0;
      let giveawayTon = 0;

      for (const m of mem) {
        const lines = (linesBy.get(key(m.memberKind, m.memberId)) || [])
          .sort((a, b) => (a.loadSequence ?? 9999) - (b.loadSequence ?? 9999) || a.listNo - b.listNo);
        const w = weighBy.get(key(m.memberKind, m.memberId)) || [];
        tripWeigh.push(...w);
        const reqs = reqBy.get(key(m.memberKind, m.memberId)) || [];
        tripReqs.push(...reqs);

        const bookingTon = lines.reduce((s, l) => s + Number(l.qtyTon || 0), 0);
        plannedTon  += bookingTon;
        giveawayTon += lines.filter(l => l.isGiveaway).reduce((s, l) => s + Number(l.qtyTon || 0), 0);

        const ck = m.custId || '-';
        if (!byCust.has(ck)) byCust.set(ck, { custId: m.custId, custName: m.custName, bookings: [] });
        byCust.get(ck).bookings.push({
          memberKind: m.memberKind,
          memberId: m.memberId,
          docuNo: m.docuNo,
          soPrefix: m.soPrefix,
          status: m.status,
          soid: m.soid,
          deliveryDate: m.deliveryDate,
          totalTon: Number(bookingTon.toFixed(3)),
          weighing: w,
          pendingRequests: reqs,
          lines
        });
      }

      const capacityTon  = Number(t.truckCapacityTon || 0);
      const tolerancePct = Number(t.tolerancePct ?? 5);
      const maxTon = capacityTon > 0 ? capacityTon : 0;

      return {
        ...t,
        capacity: {
          capacityTon,
          tolerancePct,
          maxTon: Number(maxTon.toFixed(3)),
          plannedTon: Number(plannedTon.toFixed(3)),
          giveawayTon: Number(giveawayTon.toFixed(3)),
          remainingTon: maxTon > 0 ? Number((maxTon - plannedTon).toFixed(3)) : null,
          usedPct: maxTon > 0 ? Number(((plannedTon / maxTon) * 100).toFixed(1)) : null,
          over: maxTon > 0 && plannedTon > maxTon
        },
        weighing: { ...tripPhase(tripWeigh, mem.length), rows: tripWeigh },
        // Hold เป็นจริงระหว่างที่คำขอยัง PENDING เท่านั้น
        // อนุมัติ/ปฏิเสธ/ถอน = จบการรอ รถไปต่อได้
        hold: {
          held: tripReqs.some(q => q.holdTruck),
          pendingCount: tripReqs.length,
          requests: tripReqs,
        },
        orderCount: mem.length,
        customers: Array.from(byCust.values())
      };
    });

    res.json({ data });
  } catch (error) {
    console.error('[trips/board]', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/trips/:id
router.get('/:id', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    const ds = await tripScopeSql(req.user, 'st');
    const trip = await wfQuery(`SELECT * FROM wf.SalesTrip st WHERE st.TripId = @id AND ${ds.sql}`, {
      id: { type: sql.Int, value: req.params.id }, ...ds.inputs,
    });
    if (!trip.recordset[0]) return res.status(404).json({ message: 'ไม่พบ Trip นี้' });

    const orders = await wfQuery(`
      SELECT Id, WfRef, SoPrefix, CustId, CustName, TruckPlate, Status, CreatedAt, NoTruckRequired, PSling, DeliveryDate, TripId
      FROM wf.SalesOrder
      WHERE TripId = @id
      UNION ALL
      SELECT soe.SOID AS Id, ISNULL(soe.WfRef, soh.DocuNo) AS WfRef, soe.SoPrefix, soh.CustID AS CustId, soh.CustName, soh.TransRegistration AS TruckPlate, 'CONFIRMED' AS Status, soh.DocuDate AS CreatedAt, soe.NoTruckRequired, soe.PSling, soe.DeliveryDate, soe.TripId
      FROM wf.SalesOrderExt soe
      JOIN dbo.SOHD soh ON soh.SOID = soe.SOID
      WHERE soe.TripId = @id
    `, { id: { type: sql.Int, value: req.params.id } });

    const data = camelizeRow(trip.recordset[0]);
    data.orders = camelizeRows(orders.recordset || []);
    res.json(data);
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/trips/:id/loading-plan  — ผังการจัดของอัตโนมัติ (เฟส 4)
//
// ใช้ตอน WGHD Status = 2 (รถกำลังโหลด) ตามที่กำหนดใน Document Flow
// ถ้า SO ระบุลำดับไว้ ต้องขึ้นของตามลำดับนั้นเท่านั้น
// Helper: Authoritative vehicle capacity resolution (SO-06)
async function resolveVehicleCapacity(transRegistration, truckTypeId, clientCapacity) {
  let truckType = null;
  if (truckTypeId) {
    const r = await wfQuery(`SELECT * FROM wf.TruckType WHERE Id = @id AND IsActive = 1`, {
      id: { type: sql.NVarChar(50), value: String(truckTypeId) }
    });
    truckType = r.recordset?.[0] || null;
  }

  if (!truckType && transRegistration) {
    const plate = String(transRegistration).toLowerCase();
    const allTypes = (await wfQuery(`SELECT * FROM wf.TruckType WHERE IsActive = 1`)).recordset || [];
    for (const t of allTypes) {
      if (plate.includes(t.Id.toLowerCase()) || plate.includes(t.Name.toLowerCase())) {
        truckType = t;
        break;
      }
    }
  }

  if (truckType) {
    const mainWeight = Number(truckType.MaxWeightMain || 0);
    const trailerWeight = Number(truckType.MaxWeightTrailer || 0);
    const ratedPayload = mainWeight + trailerWeight;
    return {
      status: 'VERIFIED',
      truckTypeId: truckType.Id,
      truckTypeName: truckType.Name,
      maxWeightMain: mainWeight,
      maxWeightTrailer: trailerWeight,
      ratedCapacityTon: ratedPayload,
      provenance: 'MASTER_TRUCK_TYPE'
    };
  }

  if (clientCapacity && Number(clientCapacity) > 0) {
    return {
      status: 'UNVERIFIED',
      truckTypeId: null,
      truckTypeName: null,
      maxWeightMain: null,
      maxWeightTrailer: null,
      ratedCapacityTon: Number(clientCapacity),
      provenance: 'CLIENT_DECLARED'
    };
  }

  return {
    status: 'UNKNOWN',
    truckTypeId: null,
    truckTypeName: null,
    maxWeightMain: null,
    maxWeightTrailer: null,
    ratedCapacityTon: 0,
    provenance: 'NONE'
  };
}

// และต้องเด้ง Pre-Sling / หมายเหตุ / ของแถม ให้คนคุมลานเห็นก่อนเริ่ม
//
// อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น
router.get('/:id/loading-plan', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), requireTripInScope, async (req, res) => {
  try {
    const id = { type: sql.Int, value: req.params.id };

    const tripRes = await wfQuery(`
      SELECT t.*, u.DisplayName AS CreatedByName
      FROM wf.SalesTrip t LEFT JOIN wf.AppUser u ON u.Id = t.CreatedBy
      WHERE t.TripId = @id`, { id });
    if (!tripRes.recordset[0]) return res.status(404).json({ message: 'ไม่พบ Trip นี้' });
    const trip = camelizeRow(tripRes.recordset[0]);

    const membersRes = await wfQuery(`SELECT * FROM wf.v_TripMember WHERE TripId = @id`, { id });
    const members = camelizeRows(membersRes.recordset || []);

    const [draftRes, confRes] = await Promise.all([
      wfQuery(`
        SELECT 'DRAFT' AS MemberKind, CAST(l.SoId AS VARCHAR(50)) AS MemberId,
               l.LineNum AS ListNo, l.GoodCode, l.GoodName, l.QtyTon, l.QtyBag,
               l.IsGiveaway, l.LoadSequence, l.MasterQty, l.ChildQty,
               l.RefControlTicketNo, o.PSling, o.TruckRemark, o.Remark
        FROM wf.SalesOrderLine l
        JOIN wf.SalesOrder o ON o.Id = l.SoId
        WHERE o.TripId = @id`, { id }),
      wfQuery(`
        SELECT 'CONFIRMED' AS MemberKind, CAST(d.SOID AS VARCHAR(50)) AS MemberId,
               d.ListNo, RTRIM(g.GoodCode) AS GoodCode, RTRIM(d.GoodName) AS GoodName,
               CAST(ISNULL(d.GoodQty2, 0) AS DECIMAL(18,3)) AS QtyTon,
               CAST(ISNULL(d.GoodQty1, 0) AS DECIMAL(18,0)) AS QtyBag,
               ISNULL(le.IsGiveaway, CASE WHEN d.FreeFlag = 'Y' THEN 1 ELSE 0 END) AS IsGiveaway,
               le.LoadSequence,
               ISNULL(le.MasterQty, d.MasterQty) AS MasterQty,
               ISNULL(le.ChildQty,  d.ChildQty)  AS ChildQty,
               le.RefControlTicketNo, e.PSling, e.TruckRemark,
               CAST(s.Remark AS NVARCHAR(500)) AS Remark
        FROM wf.SalesOrderExt e
        JOIN dbo.SODT d ON d.SOID = (
          CASE 
            WHEN e.SOID IS NOT NULL 
             AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%' 
             AND LTRIM(RTRIM(e.SOID)) <> '' 
             AND (
               LEN(LTRIM(RTRIM(e.SOID))) <= 9 
               OR (LEN(LTRIM(RTRIM(e.SOID))) = 10 AND CAST(LTRIM(RTRIM(e.SOID)) AS BIGINT) <= 2147483647)
             )
            THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT) 
            ELSE NULL 
          END
        ) AND d.DocuType = 103
        LEFT JOIN dbo.SOHD s ON s.SOID = (
          CASE 
            WHEN e.SOID IS NOT NULL 
             AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%' 
             AND LTRIM(RTRIM(e.SOID)) <> '' 
             AND (
               LEN(LTRIM(RTRIM(e.SOID))) <= 9 
               OR (LEN(LTRIM(RTRIM(e.SOID))) = 10 AND CAST(LTRIM(RTRIM(e.SOID)) AS BIGINT) <= 2147483647)
             )
            THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT) 
            ELSE NULL 
          END
        ) AND s.DocuType = 103
        LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
        LEFT JOIN wf.SalesOrderLineExt le ON le.SOID = e.SOID AND le.ListNo = d.ListNo
        WHERE e.TripId = @id`, { id })
    ]);

    const memberInfo = new Map(members.map(m => [m.memberKind + '#' + String(m.memberId), m]));
    const rows = camelizeRows([...(draftRes.recordset || []), ...(confRes.recordset || [])])
      .map(l => {
        const m = memberInfo.get(l.memberKind + '#' + String(l.memberId)) || {};
        const isGw = !!l.isGiveaway;
        const pieceQty = isGw ? (Number(l.qtyBag || 0) || Math.round(Number(l.qtyTon || 0) * 20) || Number(l.qtyTon || 0)) : 0;
        return {
          ...l,
          docuNo: m.docuNo,
          soPrefix: m.soPrefix,
          custId: m.custId,
          custName: m.custName,
          isGiveaway: isGw,
          qtyPiece: pieceQty,
          qtyTon: isGw ? 0 : Number(l.qtyTon || 0),
          preSling: !!l.pSling,
          // แยกตัวแม่/ตัวลูกเป็นรายบรรทัด ตามที่ยืนยันไว้ว่าแยกที่ระดับ line (ของแถมไม่แยกตัวแม่เป็นตัน)
          split: (!isGw && (Number(l.masterQty || 0) > 0 || Number(l.childQty || 0) > 0))
            ? { masterQty: Number(l.masterQty || 0), childQty: Number(l.childQty || 0) }
            : null
        };
      });

    // เรียงตามลำดับที่ระบุใน SO เป็นหลัก บรรทัดที่ไม่ระบุไปต่อท้าย
    const sequenced   = rows.filter(r => r.loadSequence != null).sort((a, b) => a.loadSequence - b.loadSequence);
    const unsequenced = rows.filter(r => r.loadSequence == null)
      .sort((a, b) => String(a.docuNo || '').localeCompare(String(b.docuNo || '')) || a.listNo - b.listNo);

    const plan = [...sequenced, ...unsequenced].map((r, i) => ({ step: i + 1, ...r }));

    // U-5: น้ำหนักรวมคิดเฉพาะสินค้าที่ไม่ใช่ของแถม
    const totalTon = plan.reduce((s, r) => s + (r.isGiveaway ? 0 : Number(r.qtyTon || 0)), 0);
    
    // Resolve authoritative vehicle capacity
    const capacityInfo = await resolveVehicleCapacity(trip.transRegistration, trip.truckTypeId, trip.truckCapacityTon);
    const capacityTon = capacityInfo.ratedCapacityTon;
    const tolerancePct = Number(trip.tolerancePct ?? 5);
    const maxTon = capacityTon > 0 ? capacityTon : 0;
    const toleranceLimit = maxTon > 0 ? Number((maxTon * (1 + tolerancePct / 100)).toFixed(3)) : 0;

    // สิ่งที่ต้องแจ้งคนคุมลานก่อนเริ่มขึ้นของ
    const alerts = [];
    if (plan.some(r => r.preSling)) alerts.push({ level: 'info', text: 'ใบจองในเที่ยวนี้ขอใช้ Pre-Sling' });
    if (trip.preSlingRequired)      alerts.push({ level: 'info', text: 'เที่ยวนี้ตั้งค่าให้ใช้ Pre-Sling ทั้งคัน' });
    if (unsequenced.length > 0 && sequenced.length > 0)
      alerts.push({ level: 'warn', text: `มี ${unsequenced.length} รายการที่ไม่ได้ระบุลำดับ ระบบเรียงต่อท้ายให้` });
    const giveaways = plan.filter(r => r.isGiveaway);
    if (giveaways.length > 0) {
      const totalPieces = giveaways.reduce((s, r) => s + (Number(r.qtyPiece) || Number(r.qtyBag) || 0), 0);
      alerts.push({ level: 'info', text: `มีของแถม ${giveaways.length} รายการ รวม ${totalPieces} ชิ้น` });
    }
    const tickets = [...new Set(plan.filter(r => r.refControlTicketNo).map(r => r.refControlTicketNo))];
    if (tickets.length > 0)
      alerts.push({ level: 'info', text: `เบิกจากตั๋วคุม ${tickets.join(', ')}` });
    if (capacityInfo.status === 'UNKNOWN')
      alerts.push({ level: 'warn', text: 'ไม่พบพิกัดความจุรถใน Master Data (แสดงสถานะ UNKNOWN)' });
    if (maxTon > 0 && totalTon > maxTon)
      alerts.push({ level: 'error', text: `น้ำหนักรวม ${totalTon.toFixed(3)} ตัน เกินพิกัดความจุสูงสุดของรถ ${maxTon.toFixed(3)} ตัน` });
    const remarks = [...new Set(plan.map(r => r.truckRemark).filter(Boolean))];
    for (const rm of remarks) alerts.push({ level: 'info', text: `หมายเหตุรถ: ${rm}` });

    res.json({
      trip: {
        ...trip,
        loadPlanStatus: trip.loadPlanStatus || 'DRAFT',
        loadPlanRevision: trip.loadPlanRevision || 1,
        saleConfirmedAt: trip.saleConfirmedAt || null,
        warehouseAckAt: trip.warehouseAckAt || null,
        truckTypeId: trip.truckTypeId || capacityInfo.truckTypeId
      },
      capacityInfo,
      totals: {
        totalTon: Number(totalTon.toFixed(3)),
        capacityTon,
        tolerancePct,
        maxTon: Number(maxTon.toFixed(3)),
        toleranceLimit,
        over: maxTon > 0 && totalTon > maxTon,
        lineCount: plan.length
      },
      alerts,
      plan
    });
  } catch (error) {
    console.error('[trips/loading-plan]', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/trips/:id/load-plan — Transactional Load Plan Confirmation (SO-07)
router.put('/:id/load-plan', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), requireTripInScope, async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ message: 'รหัส Trip ไม่ถูกต้อง' });
  }

  const { expectedPlanRevision, truckTypeId, lines, reason } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: 'กรุณาระบุรายการสินค้าในแผนจัดของ (lines)' });
  }

  try {
    const result = await wfTransaction(async (tx) => {
      // 1. Lock and read trip
      const tripRes = await tx.request()
        .input('tripId', sql.Int, tripId)
        .query(`SELECT * FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @tripId`);
      
      const trip = tripRes.recordset?.[0];
      if (!trip) {
        const err = new Error('ไม่พบ Trip นี้');
        err.status = 404;
        throw err;
      }

      const currentRevision = Number(trip.LoadPlanRevision || 1);
      if (expectedPlanRevision != null && Number(expectedPlanRevision) !== currentRevision) {
        const err = new Error(`เวอร์ชันแผนจัดของไม่ตรงกัน (Expected: ${expectedPlanRevision}, Current: ${currentRevision}) กรุณารีเฟรชเพื่อโหลดแผนล่าสุด`);
        err.status = 409;
        throw err;
      }

      // 2. Read active members of the trip to validate ownership
      const membersRes = await tx.request()
        .input('tripId', sql.Int, tripId)
        .query(`SELECT * FROM wf.v_TripMember WHERE TripId = @tripId`);
      const members = membersRes.recordset || [];
      const memberKeySet = new Set(members.map(m => `${m.MemberKind}#${m.MemberId}`));

      // 3. Read draft lines and confirmed lines for this trip
      const draftLinesRes = await tx.request().input('tripId', sql.Int, tripId).query(`
        SELECT CAST(l.SoId AS VARCHAR(50)) AS MemberId, l.LineNum, l.QtyTon, l.GoodName
        FROM wf.SalesOrderLine l
        JOIN wf.SalesOrder o ON o.Id = l.SoId
        WHERE o.TripId = @tripId
      `);
      const confLinesRes = await tx.request().input('tripId', sql.Int, tripId).query(`
        SELECT CAST(d.SOID AS VARCHAR(50)) AS MemberId, d.ListNo AS LineNum, 
               CAST(ISNULL(d.GoodQty2, 0) AS DECIMAL(18,3)) AS QtyTon, d.GoodName
        FROM wf.SalesOrderExt e
        JOIN dbo.SODT d ON d.SOID = (
          CASE 
            WHEN e.SOID IS NOT NULL 
             AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%' 
             AND LTRIM(RTRIM(e.SOID)) <> '' 
             AND (
               LEN(LTRIM(RTRIM(e.SOID))) <= 9 
               OR (LEN(LTRIM(RTRIM(e.SOID))) = 10 AND CAST(LTRIM(RTRIM(e.SOID)) AS BIGINT) <= 2147483647)
             )
            THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT) 
            ELSE NULL 
          END
        ) AND d.DocuType = 103
        WHERE e.TripId = @tripId
      `);

      const lineMap = new Map();
      for (const dl of (draftLinesRes.recordset || [])) {
        lineMap.set(`DRAFT#${dl.MemberId}#${dl.LineNum}`, Number(dl.QtyTon));
      }
      for (const cl of (confLinesRes.recordset || [])) {
        lineMap.set(`CONFIRMED#${cl.MemberId}#${cl.LineNum}`, Number(cl.QtyTon));
      }

      // 4. Validate every item in lines
      for (const item of lines) {
        const { memberKind, memberId, lineNum, loadSequence, masterQty, childQty } = item;
        const key = `${memberKind}#${memberId}`;
        if (!memberKeySet.has(key)) {
          const err = new Error(`รายการบิล ${memberId} (${memberKind}) ไม่ได้อยู่ในเที่ยวรถนี้`);
          err.status = 400;
          throw err;
        }

        const lineKey = `${memberKind}#${memberId}#${lineNum}`;
        if (!lineMap.has(lineKey)) {
          const err = new Error(`ไม่พบบรรทัดสินค้าลำดับที่ ${lineNum} ในบิล ${memberId}`);
          err.status = 400;
          throw err;
        }

        const expectedTon = lineMap.get(lineKey);
        const mQty = masterQty != null ? Number(masterQty) : 0;
        const cQty = childQty != null ? Number(childQty) : 0;

        if (mQty < 0 || cQty < 0) {
          const err = new Error(`จำนวนแม่/ลูก ต้องไม่ติดลบ (บิล ${memberId} บรรทัด ${lineNum})`);
          err.status = 400;
          throw err;
        }

        // If mother/trailer split is specified, ensure sum equals line quantity
        if (mQty > 0 || cQty > 0) {
          if (Math.abs((mQty + cQty) - expectedTon) > 0.005) {
            const err = new Error(`ยอดจัดแบ่งแม่ (${mQty}) + ลูก (${cQty}) = ${mQty + cQty} ตัน ไม่เท่ากับยอดในบิล (${expectedTon} ตัน) ของบิล ${memberId} บรรทัด ${lineNum}`);
            err.status = 400;
            throw err;
          }
        }
      }

      // 5. Update each line in wf.SalesOrderLine or wf.SalesOrderLineExt
      for (const item of lines) {
        const { memberKind, memberId, lineNum, loadSequence, masterQty, childQty } = item;
        const seq = loadSequence != null ? Number(loadSequence) : null;
        const mQty = masterQty != null ? Number(masterQty) : null;
        const cQty = childQty != null ? Number(childQty) : null;

        if (memberKind === 'DRAFT') {
          await tx.request()
            .input('soId', sql.Int, Number(memberId))
            .input('lineNum', sql.Int, Number(lineNum))
            .input('seq', sql.Int, seq)
            .input('mq', sql.Decimal(12, 3), mQty)
            .input('cq', sql.Decimal(12, 3), cQty)
            .query(`
              UPDATE wf.SalesOrderLine
              SET LoadSequence = @seq, MasterQty = @mq, ChildQty = @cq
              WHERE SoId = @soId AND LineNum = @lineNum
            `);
        } else if (memberKind === 'CONFIRMED') {
          await tx.request()
            .input('soId', sql.VarChar(50), String(memberId))
            .input('lineNum', sql.Int, Number(lineNum))
            .query(`
              IF NOT EXISTS (SELECT 1 FROM wf.SalesOrderLineExt WHERE SOID = @soId AND ListNo = @lineNum)
              BEGIN
                INSERT INTO wf.SalesOrderLineExt (SOID, ListNo) VALUES (@soId, @lineNum)
              END
            `);
          await tx.request()
            .input('soId', sql.VarChar(50), String(memberId))
            .input('lineNum', sql.Int, Number(lineNum))
            .input('seq', sql.Int, seq)
            .input('mq', sql.Decimal(12, 3), mQty)
            .input('cq', sql.Decimal(12, 3), cQty)
            .query(`
              UPDATE wf.SalesOrderLineExt
              SET LoadSequence = @seq, MasterQty = @mq, ChildQty = @cq
              WHERE SOID = @soId AND ListNo = @lineNum
            `);
        }
      }

      // 6. Update wf.SalesTrip state
      const nextRevision = currentRevision + 1;
      const snapshot = JSON.stringify(lines);

      await tx.request()
        .input('tripId', sql.Int, tripId)
        .input('rev', sql.Int, nextRevision)
        .input('userId', sql.Int, req.user.sub)
        .input('snapshot', sql.NVarChar(sql.MAX), snapshot)
        .input('truckTypeId', sql.NVarChar(50), truckTypeId || trip.TruckTypeId || null)
        .query(`
          UPDATE wf.SalesTrip
          SET LoadPlanStatus = 'SALE_CONFIRMED',
              LoadPlanRevision = @rev,
              SaleConfirmedAt = GETUTCDATE(),
              SaleConfirmedBy = @userId,
              WarehouseAckAt = NULL,
              WarehouseAckBy = NULL,
              LoadPlanSnapshot = @snapshot,
              TruckTypeId = @truckTypeId
          WHERE TripId = @tripId
        `);

      return {
        tripId,
        loadPlanStatus: 'SALE_CONFIRMED',
        loadPlanRevision: nextRevision,
        linesCount: lines.length,
        message: 'บันทึกและยืนยันแผนจัดของโดยพนักงานขายสำเร็จ'
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[trips/load-plan]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// POST /api/trips/:id/load-plan/ack — Warehouse Load Plan Acknowledgement (SO-07)
router.post('/:id/load-plan/ack', requireRole('WAREHOUSE', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ message: 'รหัส Trip ไม่ถูกต้อง' });
  }

  const { expectedPlanRevision, note } = req.body || {};
  if (expectedPlanRevision == null) {
    return res.status(400).json({ message: 'กรุณาระบุ expectedPlanRevision เพื่อป้องกันการรับทราบแผนที่ตกรุ่น' });
  }

  try {
    const result = await wfTransaction(async (tx) => {
      const tripRes = await tx.request()
        .input('tripId', sql.Int, tripId)
        .query(`SELECT * FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @tripId`);
      
      const trip = tripRes.recordset?.[0];
      if (!trip) {
        const err = new Error('ไม่พบ Trip นี้');
        err.status = 404;
        throw err;
      }

      if (trip.LoadPlanStatus !== 'SALE_CONFIRMED') {
        const err = new Error(`ไม่สามารถรับทราบแผนได้: แผนต้องอยู่ในสถานะ SALE_CONFIRMED (สถานะปัจจุบัน: ${trip.LoadPlanStatus || 'DRAFT'})`);
        err.status = 400;
        throw err;
      }

      const currentRevision = Number(trip.LoadPlanRevision || 1);
      if (Number(expectedPlanRevision) !== currentRevision) {
        const err = new Error(`เวอร์ชันแผนจัดของไม่ตรงกัน (Expected: ${expectedPlanRevision}, Current: ${currentRevision}) กรุณารีเฟรชเพื่อโหลดแผนล่าสุด`);
        err.status = 409;
        throw err;
      }

      await tx.request()
        .input('tripId', sql.Int, tripId)
        .input('userId', sql.Int, req.user.sub)
        .query(`
          UPDATE wf.SalesTrip
          SET LoadPlanStatus = 'WAREHOUSE_ACK',
              WarehouseAckAt = GETUTCDATE(),
              WarehouseAckBy = @userId
          WHERE TripId = @tripId
        `);

      return {
        tripId,
        loadPlanStatus: 'WAREHOUSE_ACK',
        loadPlanRevision: currentRevision,
        warehouseAckAt: new Date().toISOString(),
        warehouseAckBy: req.user.sub,
        message: 'ฝ่ายคลังรับทราบแผนจัดของเรียบร้อยแล้ว'
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[trips/load-plan/ack]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// POST /api/trips
router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    validateBookingNotes(req.body, ['remark']);
    const { tripCode, transRegistration, driverName, truckCapacityTon, orderIds, scheduledDate, deliveryDate } = req.body || {};
    let effectiveTripCode = tripCode;
    if (!effectiveTripCode) {
      const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
      const mm = String(new Date().getMonth() + 1).padStart(2, '0');
      const count = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.SalesTrip WHERE TripCode LIKE @p`, { p: { type: sql.VarChar(50), value: `TRIP${yy}${mm}-%` } })).recordset[0]?.Cnt || 0;
      effectiveTripCode = `TRIP${yy}${mm}-${String(count + 1).padStart(4, '0')}`;
    }

    // Lead-time evaluation (SO-03)
    const { resolvePickupPolicy, evaluateTripLeadTime } = require('../services/so-pickup-policy');
    const policy = await resolvePickupPolicy();
    let leadTimeWarning = null;

    const targetDate = scheduledDate || deliveryDate;
    if (targetDate) {
      const leadCheck = evaluateTripLeadTime(targetDate, policy.leadTimeDays, policy.strictMode);
      if (!leadCheck.valid) {
        if (leadCheck.blocked) {
          return res.status(400).json({ message: leadCheck.error });
        }
        leadTimeWarning = leadCheck.warning;
      }
    }

    const rawPlate = String(transRegistration || '').trim();
    const cleanPlate = !rawPlate || ['ยังไม่ระบุรถ','ตั๋วคุม','ไม่ระบุทะเบียนรถ'].includes(rawPlate) ? null : rawPlate;

    let newTripId = null;
    await wfTransaction(async tx => {
      const tripReq = tx.request();
      tripReq.input('tripCode', sql.VarChar(50), effectiveTripCode);
      tripReq.input('transRegistration', sql.VarChar(50), cleanPlate);
      tripReq.input('driverName', sql.VarChar(100), driverName || null);
      // Resolve capacity authoritatively from master
      const capacityInfo = await resolveVehicleCapacity(cleanPlate, req.body?.truckTypeId, truckCapacityTon);
      const masterCapacity = capacityInfo.ratedCapacityTon > 0 ? capacityInfo.ratedCapacityTon : (Number(truckCapacityTon) || null);

      tripReq.input('truckCapacityTon', sql.Decimal(18,2), masterCapacity || null);
      tripReq.input('truckTypeId', sql.NVarChar(50), capacityInfo.truckTypeId || req.body?.truckTypeId || null);
      tripReq.input('createdBy', sql.Int, req.user.sub);
      tripReq.input('tripRemark',sql.NVarChar(500),req.body?.remark ?? null);
      tripReq.input('preSling',sql.Bit,!!req.body?.pSling);
      tripReq.input('pickupDueDate', sql.Date, targetDate ? new Date(targetDate) : null);

      const tripRes = await tripReq.query(`
        INSERT INTO wf.SalesTrip (TripCode, TransRegistration, DriverName, TruckCapacityTon, TruckTypeId, CreatedBy, PickupDueDate, DocumentRevision, TripRemark, PreSlingRequired)
        OUTPUT inserted.TripId
        VALUES (@tripCode, @transRegistration, @driverName, @truckCapacityTon, @truckTypeId, @createdBy, @pickupDueDate, 1, @tripRemark, @preSling)
      `);
      newTripId = tripRes.recordset[0].TripId;

      if (orderIds && orderIds.length > 0) {
        for (const orderId of orderIds) {
          const soReq = tx.request();
          soReq.input('tripId', sql.Int, newTripId);
          soReq.input('soId', sql.Int, orderId);
          await soReq.query(`UPDATE wf.SalesOrder SET TripId = @tripId WHERE Id = @soId`);
        }
      }
    });

    res.json({ message: 'สร้าง Trip สำเร็จ', tripId: newTripId, tripCode: effectiveTripCode, warning: leadTimeWarning });
  } catch (error) {
    console.error('[trips]', error);
    res.status(error.status || 500).json({ message: error.message });
  }
});

// PUT /api/trips/:id
router.put('/:id', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), requireTripInScope, async (req, res) => {
  try {
    const body = validateBookingNotes(req.body || {}, ['remark']);
    const tripId = Number(req.params.id);
    if (!Number.isInteger(tripId) || !Number.isInteger(body.expectedRevision))
      return res.status(400).json({ message: 'ต้องระบุ TripId และ expectedRevision' });
    // Membership changes belong to the explicit assignment workflow, not metadata editing.
    if (body.orderIds !== undefined) return res.status(400).json({message:'การแก้ไขข้อมูลเที่ยวรถไม่รองรับการเปลี่ยนสมาชิก'});
    const { resolvePickupPolicy, evaluateTripLeadTime } = require('../services/so-pickup-policy');
    const policy = await resolvePickupPolicy();
    const targetDate = body.scheduledDate || body.deliveryDate;
    const check = targetDate ? evaluateTripLeadTime(targetDate, policy.leadTimeDays, policy.strictMode) : null;
    if (check?.blocked) return res.status(400).json({message:check.error});
    const result = await wfTransaction(async tx => {
      const { lockConfirmationResource } = require('../services/draft-confirmation');
      await lockConfirmationResource(tx, 'ConfirmTrip_' + tripId);
      const trip = (await tx.request().input('id',sql.Int,tripId).query(
        'SELECT * FROM wf.SalesTrip WITH (UPDLOCK,HOLDLOCK) WHERE TripId=@id')).recordset[0];
      if (!trip) throw Object.assign(new Error('ไม่พบเที่ยวรถ'),{status:404});
      if (!['ADMIN','C_LEVEL'].includes(req.user.role) && Number(trip.CreatedBy)!==Number(req.user.sub))
        throw Object.assign(new Error('ไม่มีสิทธิ์แก้ไขเที่ยวรถของผู้อื่น'),{status:403});
      if (trip.Status!=='DRAFT' || Number(trip.DocumentRevision)!==body.expectedRevision)
        throw Object.assign(new Error('สถานะหรือ revision เปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่'),{status:409});
      const members = (await tx.request().input('id',sql.Int,tripId).query(
        'SELECT Id,Status FROM wf.SalesOrder WITH (UPDLOCK,HOLDLOCK) WHERE TripId=@id ORDER BY Id')).recordset;
      if (members.some(m=>m.Status!=='DRAFT')) throw Object.assign(new Error('แก้ไขได้เฉพาะทริปแบบร่าง'),{status:409});
      const value = body.transRegistration === undefined ? trip.TransRegistration : body.transRegistration;
      const plate = String(value || '').trim();
      const cleanPlate = !plate || ['ยังไม่ระบุรถ','ตั๋วคุม','ไม่ระบุทะเบียนรถ'].includes(plate) ? null : plate;
      const cap = await resolveVehicleCapacity(cleanPlate,body.truckTypeId ?? trip.TruckTypeId,body.truckCapacityTon ?? trip.TruckCapacityTon);
      await tx.request().input('id',sql.Int,tripId).input('plate',sql.NVarChar(50),cleanPlate)
        .input('driver',sql.NVarChar(100),body.driverName === undefined ? trip.DriverName : body.driverName)
        .input('cap',sql.Decimal(18,2),cap.ratedCapacityTon || trip.TruckCapacityTon || null)
        .input('type',sql.NVarChar(50),cap.truckTypeId || trip.TruckTypeId || null)
        .input('tripRemark',sql.NVarChar(500),body.remark === undefined ? trip.TripRemark : body.remark)
        .input('preSling',sql.Bit,body.pSling === undefined ? trip.PreSlingRequired : !!body.pSling)
        .query(`UPDATE wf.SalesTrip SET TransRegistration=@plate, DriverName=@driver, TripRemark=@tripRemark, PreSlingRequired=@preSling,
          TruckCapacityTon=@cap, TruckTypeId=@type, WarehouseAckAt=NULL, WarehouseAckBy=NULL,
          DocumentRevision=DocumentRevision+1 WHERE TripId=@id`);
      for (const member of members) {
        await tx.request().input('id',sql.Int,member.Id).input('plate',sql.NVarChar(30),cleanPlate)
          .input('date',sql.Date,targetDate ? new Date(targetDate) : null)
          .input('ps',sql.Bit,body.pSling === undefined ? null : !!body.pSling)
          .query(`UPDATE wf.SalesOrder SET TruckPlate=@plate, DeliveryDate=COALESCE(@date,DeliveryDate),
            PSling=COALESCE(@ps,PSling),
            UpdatedAt=GETUTCDATE() WHERE Id=@id`);
        if (body.loadInOrder !== undefined) await tx.request().input('id',sql.Int,member.Id)
          .input('ordered',sql.Bit,!!body.loadInOrder).query(`UPDATE wf.SalesOrderLine
            SET LoadSequence=CASE WHEN @ordered=0 THEN NULL ELSE COALESCE(LoadSequence,LineNum) END WHERE SoId=@id`);
      }
      return {tripId,tripCode:trip.TripCode,documentRevision:trip.DocumentRevision+1};
    });
    res.json({...result,warning:check?.warning || null});
  } catch (error) { res.status(error.status || 500).json({message:error.message}); }
});

// POST /api/trips/:id/confirm — Atomic Trip Confirmation and Residual Split (SO-05)
router.post('/:id/confirm', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), requireTripInScope, async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ message: 'รหัส Trip ไม่ถูกต้อง' });
  }

  const { confirmedOrderIds, transRegistration, driverName, pickupDueDate, idempotencyKey, expectedRevision } = req.body || {};

  if (!Array.isArray(confirmedOrderIds) || confirmedOrderIds.length === 0) {
    return res.status(400).json({ message: 'กรุณาเลือกใบสั่งขาย (SO) ที่ต้องการยืนยันในเที่ยวนี้อย่างน้อย 1 รายการ' });
  }

  // R5-1 / F-06: Inspect member orders to determine if this is a control-ticket / no-truck trip
  const cleanOrderIds = confirmedOrderIds.map(id => String(id).replace(/^(DRAFT|NATIVE):/, '').trim()).filter(Boolean);
  const numericIds = cleanOrderIds.map(Number).filter(n => Number.isInteger(n) && n > 0);

  let memberOrders = [];
  if (numericIds.length > 0) {
    const idList = numericIds.join(',');
    memberOrders = (await wfQuery(`
      SELECT Id, NoTruckRequired, TruckPlate, SoPrefix FROM wf.SalesOrder WHERE Id IN (${idList})
      UNION ALL
      SELECT soe.SOID AS Id, soe.NoTruckRequired, soh.TransRegistration AS TruckPlate, soe.SoPrefix
      FROM wf.SalesOrderExt soe
      LEFT JOIN dbo.SOHD soh ON soh.SOID = soe.SOID
      WHERE soe.SOID IN (${idList})
    `)).recordset || [];
  }

  const isTicketBill = (b) => Boolean(
    b.TruckPlate === 'ตั๋วคุม' ||
    b.SoPrefix === 'AI'
  );
  const isNoTruckBill = (b) => Boolean(b.NoTruckRequired === 1 || b.NoTruckRequired === true) && !isTicketBill(b);
  const isNormalTruckBill = (b) => !isTicketBill(b) && !isNoTruckBill(b);

  const ticketCount = memberOrders.filter(isTicketBill).length;
  const noTruckCount = memberOrders.filter(isNoTruckBill).length;
  const normalTruckCount = memberOrders.filter(isNormalTruckBill).length;

  const isAllControlTicket = memberOrders.length > 0 && ticketCount === memberOrders.length;
  const isAllNoTruck = memberOrders.length > 0 && noTruckCount === memberOrders.length;
  const isMixedTicketTrip = ticketCount > 0 && ticketCount < memberOrders.length;

  if (isMixedTicketTrip) {
    return res.status(400).json({
      code: 'MIXED_CONTROL_TICKET_TRIP',
      message: 'เที่ยวนี้มีทั้งตั๋วคุมและบิลประเภทอื่นปนกัน กรุณาแยกเที่ยวรถสำหรับตั๋วคุม'
    });
  }

  let cleanTruckPlate = null;
  if (isAllControlTicket) {
    cleanTruckPlate = 'ตั๋วคุม';
  } else if (isAllNoTruck) {
    const raw = String(transRegistration || '').trim();
    cleanTruckPlate = (raw && raw !== 'ตั๋วคุม' && raw !== 'ยังไม่ระบุรถ' && raw !== 'ไม่ระบุทะเบียนรถ') ? raw : null;
  } else {
    cleanTruckPlate = String(transRegistration || '').trim() || null;
  }

  if (!isAllControlTicket && !isAllNoTruck) {
    if (!cleanTruckPlate || cleanTruckPlate === 'ยังไม่ระบุรถ' || cleanTruckPlate === 'ไม่ระบุทะเบียนรถ' || cleanTruckPlate === 'ตั๋วคุม') {
      return res.status(400).json({ message: 'การยืนยันเที่ยวรถจำเป็นต้องระบุทะเบียนรถ (ไม่สามารถยืนยันแบบไม่ระบุรถได้)' });
    }
  }

  // P1 Finding 4: วันรับห้ามเดา (สำหรับเที่ยวปกติบังคับส่ง pickupDueDate; สำหรับตั๋วคุม/ไม่ใช้รถไม่บังคับ)
  let targetPickupDate = null;
  if (isAllControlTicket || isAllNoTruck) {
    targetPickupDate = (pickupDueDate && typeof pickupDueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pickupDueDate.trim()))
      ? pickupDueDate.trim()
      : new Date().toISOString().slice(0, 10);
  } else {
    if (!pickupDueDate || typeof pickupDueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDueDate.trim())) {
      return res.status(400).json({ message: 'กรุณาระบุวันรับสินค้า (pickupDueDate ในรูปแบบ YYYY-MM-DD) ให้ชัดเจน ห้ามเว้นว่าง' });
    }
    targetPickupDate = pickupDueDate.trim();
  }

  // P1 Finding 4: Validate expectedRevision when provided
  if (expectedRevision != null && (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) <= 0)) {
    return res.status(400).json({ message: 'expectedRevision ต้องเป็นจำนวนเต็มบวก' });
  }

  // Lead-time policy check (ข้ามสำหรับตั๋วคุมและไม่ใช้รถเนื่องจากไม่มีรถบรรทุก)
  let leadCheck = null;
  if (!isAllControlTicket && !isAllNoTruck) {
    const { resolvePickupPolicy, evaluateTripLeadTime } = require('../services/so-pickup-policy');
    const policy = await resolvePickupPolicy();
    leadCheck = evaluateTripLeadTime(targetPickupDate, policy.leadTimeDays, policy.strictMode);
    if (!leadCheck.valid && leadCheck.blocked) {
      return res.status(400).json({ message: leadCheck.error, leadCheck });
    }
  }

  // Canonical payload hash calculation
  const crypto = require('crypto');
  const sortedOrderIds = confirmedOrderIds.map(String).sort();
  const canonicalPayload = JSON.stringify({
    tripId,
    confirmedOrderIds: sortedOrderIds,
    transRegistration: cleanTruckPlate,
    pickupDueDate: targetPickupDate,
  });
  const canonicalPayloadHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

  // Idempotency lookup with scoped authorization check (Finding 6)
  if (idempotencyKey) {
    const existing = (await wfQuery(`SELECT * FROM wf.SalesTrip WHERE IdempotencyKey = @key`, {
      key: { type: sql.VarChar(100), value: String(idempotencyKey) }
    })).recordset[0];
    if (existing) {
      const isElevated = ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(req.user.role);
      const isCreator = existing.CreatedBy === req.user.sub;
      if (!isElevated && !isCreator) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึงหรือยืนยันเที่ยวรถของผู้อื่น' });
      }

      if (Number(existing.TripId) === Number(tripId) && String(existing.PayloadHash || '').trim() === String(canonicalPayloadHash || '').trim()) {
        const residualTrip = (await wfQuery(`SELECT TripId, TripCode FROM wf.SalesTrip WHERE ParentTripId = @pid AND IsResidual = 1`, {
          pid: { type: sql.Int, value: tripId }
        })).recordset[0];
        return res.json({
          message: 'เที่ยวนี้ได้รับการยืนยันแล้ว (Idempotent)',
          trip: camelizeRow(existing),
          isIdempotent: true,
          tripId,
          residualTripId: residualTrip?.TripId || null,
          residualTripCode: residualTrip?.TripCode || null,
        });
      } else {
        return res.status(400).json({
          message: 'Idempotency key ซ้ำกับคำขออื่นที่มีข้อมูลต่างกัน',
        });
      }
    }
  }

  try {
    let residualTripId = null;
    let residualTripCode = null;
    let residualOrderCount = 0;
    let replayed = false;

    await wfTransaction(async tx => {
      // 1. Transaction-owned applock
      const lockReq = tx.request();
      lockReq.input('rname', sql.NVarChar(255), `ConfirmTrip_${tripId}`);
      const lockRes = await lockReq.query(`
        DECLARE @res INT;
        EXEC @res = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        SELECT @res AS LockResult;
      `);
      const lockCode = lockRes.recordset?.[0]?.LockResult;
      if (lockCode < 0) {
        const err = new Error('ไม่สามารถขอ lock เพื่อยืนยันเที่ยวรถได้ (กำลังมีคำขออื่นดำเนินการอยู่)');
        err.status = 409;
        throw err;
      }

      // 2. Read Trip with lock
      const tripReq = tx.request();
      tripReq.input('id', sql.Int, tripId);
      const tripRow = (await tripReq.query(`SELECT * FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @id`)).recordset[0];
      if (!tripRow) {
        const err = new Error('ไม่พบเที่ยวรถนี้');
        err.status = 404;
        throw err;
      }
      if (tripRow.Status === 'CONFIRMED' && idempotencyKey && tripRow.IdempotencyKey === idempotencyKey && String(tripRow.PayloadHash || '').trim() === canonicalPayloadHash) {
        if (!['ADMIN','MANAGER','C_LEVEL'].includes(req.user.role) && Number(tripRow.CreatedBy)!==Number(req.user.sub))
          throw Object.assign(new Error('ไม่มีสิทธิ์ยืนยันเที่ยวรถของผู้อื่น'),{status:403});
        const residual=(await tx.request().input('id',sql.Int,tripId).query('SELECT TripId,TripCode FROM wf.SalesTrip WHERE ParentTripId=@id AND IsResidual=1')).recordset[0];
        residualTripId=residual?.TripId || null;residualTripCode=residual?.TripCode || null;replayed=true;
        return;
      }
      if (tripRow.Status === 'CONFIRMED') {
        const err = new Error('เที่ยวนี้ได้รับการยืนยันไปแล้ว');
        err.status = 409;
        throw err;
      }
      if (expectedRevision != null && Number(expectedRevision) !== tripRow.DocumentRevision) {
        const err = new Error('ข้อมูลเที่ยวรถถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
        err.status = 409;
        err.currentRevision = tripRow.DocumentRevision;
        throw err;
      }

      // 3. Authorization / Ownership check
      const memReq = tx.request();
      memReq.input('tripId', sql.Int, tripId);
      const allMembers = (await memReq.query(`
        SELECT TripId, MemberKind, MemberId, DocuNo, SoPrefix, CustId, CustName, Status, DeliveryDate, SalesUserId, SOID
        FROM wf.v_TripMember
        WHERE TripId = @tripId
      `)).recordset || [];

      const isElevatedRole = ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(req.user.role);
      const isTripCreator = tripRow.CreatedBy === req.user.sub;
      if (!isElevatedRole && !isTripCreator) {
        const err = new Error('ไม่มีสิทธิ์ยืนยันเที่ยวรถของผู้อื่น');
        err.status = 403;
        throw err;
      }

      // 4. Resolve confirmed member IDs with typed identity (Finding 6)
      const typedMemberMap = new Map();
      const plainMemberMap = new Map();
      for (const m of allMembers) {
        const tKey = `${m.MemberKind}:${m.MemberId}`;
        typedMemberMap.set(tKey, m);
        const pKey = String(m.MemberId);
        if (plainMemberMap.has(pKey)) {
          plainMemberMap.set(pKey, 'AMBIGUOUS');
        } else {
          plainMemberMap.set(pKey, m);
        }
      }

      const confirmedMembers = [];
      const confirmedTypedKeySet = new Set();

      for (const rawId of confirmedOrderIds) {
        const strId = String(rawId).trim();
        let matchedMember = null;
        if (strId.startsWith('DRAFT:') || strId.startsWith('NATIVE:')) {
          matchedMember = typedMemberMap.get(strId);
        } else {
          const match = plainMemberMap.get(strId);
          if (match === 'AMBIGUOUS') {
            const err = new Error(`รหัสใบสั่งขาย #${strId} กำกวม มีทั้งแบบร่างและแบบ WINSpeed ในเที่ยวเดียวกัน กรุณาระบุประเภทให้ชัดเจน`);
            err.status = 400;
            throw err;
          }
          matchedMember = match;
        }

        if (!matchedMember) {
          const err = new Error(`ใบสั่งขาย #${strId} ไม่ได้สังกัดอยู่ในเที่ยวนี้`);
          err.status = 400;
          throw err;
        }

        const tKey = `${matchedMember.MemberKind}:${matchedMember.MemberId}`;
        if (!confirmedTypedKeySet.has(tKey)) {
          confirmedTypedKeySet.add(tKey);
          confirmedMembers.push(matchedMember);
        }
      }

      // Lock every draft member in ascending order before splitting or converting.
      const {confirmDraft,lockConfirmationResource}=require('../services/draft-confirmation');
      for(const m of allMembers.filter(m=>m.MemberKind==='DRAFT').sort((a,b)=>Number(a.MemberId)-Number(b.MemberId)))
        await lockConfirmationResource(tx,'ConfirmSO_'+m.MemberId);
      // 6. Handle residual unselected members
      const residualMembers = allMembers.filter(m => !confirmedTypedKeySet.has(`${m.MemberKind}:${m.MemberId}`));
      residualOrderCount = residualMembers.length;

      if (residualMembers.length > 0) {
        const baseCode = tripRow.TripCode.replace(/-R\d*$/, '');
        const existingResiduals = (await tx.request()
          .input('pattern', sql.VarChar(50), `${baseCode}-R%`)
          .query(`SELECT TripCode FROM wf.SalesTrip WHERE TripCode LIKE @pattern`)).recordset || [];

        const count = existingResiduals.length + 1;
        residualTripCode = `${baseCode}-R${count > 1 ? count : ''}`;

        const resReq = tx.request();
        resReq.input('tripCode', sql.VarChar(50), residualTripCode);
        resReq.input('truckCapacityTon', sql.Decimal(18, 2), tripRow.TruckCapacityTon || null);
        resReq.input('createdBy', sql.Int, req.user.sub);
        resReq.input('parentTripId', sql.Int, tripId);

        const rIns = await resReq.query(`
          INSERT INTO wf.SalesTrip (TripCode, TransRegistration, DriverName, TruckCapacityTon, CreatedBy, Status, ParentTripId, IsResidual, DocumentRevision)
          OUTPUT inserted.TripId
          VALUES (@tripCode, NULL, NULL, @truckCapacityTon, @createdBy, 'DRAFT', @parentTripId, 1, 1)
        `);
        residualTripId = rIns.recordset[0].TripId;

        // Move unselected orders to residual trip
        for (const rm of residualMembers) {
          if (rm.MemberKind === 'DRAFT') {
            await tx.request()
              .input('resTripId', sql.Int, residualTripId)
              .input('soId', sql.Int, Number(rm.MemberId))
              .query(`UPDATE wf.SalesOrder SET TripId = @resTripId, TruckPlate = NULL WHERE Id = @soId`);
          } else {
            await tx.request()
              .input('resTripId', sql.Int, residualTripId)
              .input('soid', sql.VarChar(50), String(rm.MemberId))
              .query(`UPDATE wf.SalesOrderExt SET TripId = @resTripId WHERE SOID = @soid`);
          }
        }
      }

      // 7. Process confirmed selected members
      for (const m of [...confirmedMembers].sort((a,b)=>Number(a.MemberId)-Number(b.MemberId))) {
        if (m.MemberKind === 'DRAFT') {
          await confirmDraft({tx,draftId:Number(m.MemberId),user:req.user,ip:req.ip,
            expectedTripId:tripId,explicitPickup:targetPickupDate,truckPlate:cleanTruckPlate});
        } else {
          // Already CONFIRMED native member: DO NOT overwrite original SO PickupDueDate! Only set TripId (Finding 5)
          await tx.request()
            .input('tripId', sql.Int, tripId)
            .input('soid', sql.VarChar(50), String(m.MemberId))
            .query(`UPDATE wf.SalesOrderExt SET TripId = @tripId, UpdatedAt = SYSUTCDATETIME() WHERE SOID = @soid`);
        }
      }

      // 8. Update Trip to CONFIRMED
      const confirmTripReq = tx.request();
      confirmTripReq.input('tripId', sql.Int, tripId);
      confirmTripReq.input('plate', sql.VarChar(50), cleanTruckPlate);
      confirmTripReq.input('driver', sql.VarChar(100), driverName || null);
      confirmTripReq.input('pDate', sql.Date, new Date(targetPickupDate));
      confirmTripReq.input('idemKey', sql.VarChar(100), idempotencyKey || null);
      confirmTripReq.input('payloadHash', sql.VarChar(64), canonicalPayloadHash);
      confirmTripReq.input('userId', sql.Int, req.user?.sub || null);

      await confirmTripReq.query(`
        UPDATE wf.SalesTrip
        SET Status = 'CONFIRMED',
            TransRegistration = @plate,
            DriverName = @driver,
            PickupDueDate = @pDate,
            ConfirmedAt = SYSUTCDATETIME(),
            IdempotencyKey = @idemKey,
            PayloadHash = @payloadHash,
            DocumentRevision = DocumentRevision + 1,
            LoadPlanStatus = CASE 
              WHEN LoadPlanStatus IN ('SALE_CONFIRMED', 'WAREHOUSE_ACK', 'LOADING', 'COMPLETED') THEN LoadPlanStatus 
              ELSE 'SALE_CONFIRMED' 
            END,
            LoadPlanRevision = ISNULL(LoadPlanRevision, 1),
            SaleConfirmedAt = ISNULL(SaleConfirmedAt, GETUTCDATE()),
            SaleConfirmedBy = ISNULL(SaleConfirmedBy, @userId)
        WHERE TripId = @tripId
      `);
    });

    broadcast('trip_updated', { tripId, action: 'confirmed', residualTripId });

    res.json({
      message: 'ยืนยันเที่ยวรถสำเร็จ' + (residualTripId ? ` (ย้ายบิลที่ไม่ได้เลือกไปยังเที่ยวตกค้าง ${residualTripCode})` : ''),
      tripId,
      confirmedOrderCount: sortedOrderIds.length,
      isIdempotent: replayed,
      residualTripId,
      residualTripCode,
      residualOrderCount,
      warning: leadCheck?.warning || null,
    });
  } catch (err) {
    console.error('[trips/confirm]', err);
    res.status(err.status || 500).json({ message: err.message, currentRevision: err.currentRevision });
  }
});

// POST /api/trips/:id/submit-plan — Submit load plan for already-confirmed trip (F-15)
router.post('/:id/submit-plan', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER', 'C_LEVEL'), requireTripInScope, async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ message: 'รหัส Trip ไม่ถูกต้อง' });
  }

  try {
    const result = await wfTransaction(async (tx) => {
      const trip = (await tx.request()
        .input('tripId', sql.Int, tripId)
        .query(`SELECT * FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @tripId`)).recordset?.[0];

      if (!trip) {
        throw Object.assign(new Error('ไม่พบ Trip นี้'), { status: 404 });
      }

      // R7-5: Restrict submit-plan to trip sales owner and elevated roles
      const isElevated = ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(req.user?.role);
      if (!isElevated) {
        const userId = Number(req.user?.sub || req.user?.userId);
        let isOwner = Number(trip.SaleConfirmedBy) === userId || Number(trip.CreatedBy) === userId;
        if (!isOwner) {
          // Check if user owns any order or draft in this trip
          const memberCheck = await tx.request()
            .input('tripId', sql.Int, tripId)
            .input('uid', sql.Int, userId)
            .query(`
              SELECT TOP 1 1 
              FROM wf.SalesOrder 
              WHERE TripId = @tripId 
                AND (SalesUserId = @uid OR EnteredByUserId = @uid)
            `);
          if (memberCheck.recordset?.length > 0) {
            isOwner = true;
          }
        }
        if (!isOwner) {
          throw Object.assign(
            new Error('ไม่มีสิทธิ์ส่งแผนการโหลดของเที่ยวรถนี้ (จำกัดเฉพาะเจ้าของเที่ยวรถและผู้มีสิทธิ์ระดับบริหาร)'),
            { status: 403 }
          );
        }
      }

      if (['SALE_CONFIRMED', 'WAREHOUSE_ACK', 'LOADING', 'COMPLETED'].includes(trip.LoadPlanStatus)) {
        return {
          tripId,
          loadPlanStatus: trip.LoadPlanStatus,
          message: `แผนการโหลดอยู่ในสถานะ ${trip.LoadPlanStatus} อยู่แล้ว`
        };
      }

      const rev = Number(trip.LoadPlanRevision || 1);
      await tx.request()
        .input('tripId', sql.Int, tripId)
        .input('rev', sql.Int, rev)
        .input('uid', sql.Int, req.user?.sub || null)
        .query(`
          UPDATE wf.SalesTrip
          SET LoadPlanStatus = 'SALE_CONFIRMED',
              LoadPlanRevision = @rev,
              SaleConfirmedAt = ISNULL(SaleConfirmedAt, GETUTCDATE()),
              SaleConfirmedBy = ISNULL(SaleConfirmedBy, @uid)
          WHERE TripId = @tripId
        `);

      return {
        tripId,
        loadPlanStatus: 'SALE_CONFIRMED',
        loadPlanRevision: rev,
        message: 'ส่งแผนการโหลดให้ฝ่ายคลังสำเร็จ'
      };
    });

    broadcast('trip_updated', { tripId, action: 'plan_submitted' });
    res.json(result);
  } catch (err) {
    console.error('[trips/submit-plan]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;



