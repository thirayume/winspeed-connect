const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../services/socket');

router.use(requireAuth);

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

// GET /api/trips
router.get('/', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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
    res.status(500).json({ message: error.message });
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
router.get('/board', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const inputs = {};
    let where = 'WHERE 1=1';
    if (status) { where += ' AND t.Status = @status'; inputs.status = { type: sql.VarChar(50), value: status }; }
    if (search) {
      where += ' AND (t.TripCode LIKE @search OR t.TransRegistration LIKE @search OR t.DriverName LIKE @search)';
      inputs.search = { type: sql.NVarChar(100), value: `%${search}%` };
    }

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
        JOIN dbo.SODT d ON d.SOID = TRY_CAST(e.SOID AS INT) AND d.DocuType = 103
        LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
        LEFT JOIN wf.SalesOrderLineExt le ON le.SOID = e.SOID AND le.ListNo = d.ListNo
        WHERE e.TripId IN (${idList})`),

      // สถานะรถจาก WGHD — 1 ลงทะเบียน · 2 กำลังโหลด · 3 ชั่งออกแล้ว
      wfQuery(`
        SELECT e.TripId, CAST(w.SPID AS VARCHAR(50)) AS MemberId,
               w.Id, w.CarNo, w.DateReg, w.Status, w.WGType,
               w.WeightIn, w.WeightOut, w.WeightNet, w.TONNet, w.DocuNo, w.MoveBill
        FROM wf.SalesOrderExt e
        JOIN dbo.WGHD w ON w.SPID = TRY_CAST(e.SOID AS INT)
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
    // มาเป็น **สตริง** ส่วนบน Linux (Railway/Render) ใช้ tedious ซึ่งคืนมาเป็น
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
      const maxTon = capacityTon > 0 ? capacityTon * (1 + tolerancePct / 100) : 0;

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
router.get('/:id', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const trip = await wfQuery(`SELECT * FROM wf.SalesTrip WHERE TripId = @id`, {
      id: { type: sql.Int, value: req.params.id }
    });
    if (!trip.recordset[0]) return res.status(404).json({ message: 'ไม่พบ Trip นี้' });

    const orders = await wfQuery(`
      SELECT Id, WfRef, SoPrefix, CustName, TruckPlate, Status, CreatedAt
      FROM wf.SalesOrder
      WHERE TripId = @id
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
// และต้องเด้ง Pre-Sling / หมายเหตุ / ของแถม ให้คนคุมลานเห็นก่อนเริ่ม
//
// อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น
router.get('/:id/loading-plan', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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
        JOIN dbo.SODT d ON d.SOID = TRY_CAST(e.SOID AS INT) AND d.DocuType = 103
        LEFT JOIN dbo.SOHD s ON s.SOID = TRY_CAST(e.SOID AS INT) AND s.DocuType = 103
        LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
        LEFT JOIN wf.SalesOrderLineExt le ON le.SOID = e.SOID AND le.ListNo = d.ListNo
        WHERE e.TripId = @id`, { id })
    ]);

    const memberInfo = new Map(members.map(m => [m.memberKind + '#' + String(m.memberId), m]));
    const rows = camelizeRows([...(draftRes.recordset || []), ...(confRes.recordset || [])])
      .map(l => {
        const m = memberInfo.get(l.memberKind + '#' + String(l.memberId)) || {};
        return {
          ...l,
          docuNo: m.docuNo,
          soPrefix: m.soPrefix,
          custId: m.custId,
          custName: m.custName,
          isGiveaway: !!l.isGiveaway,
          preSling: !!l.pSling,
          // แยกตัวแม่/ตัวลูกเป็นรายบรรทัด ตามที่ยืนยันไว้ว่าแยกที่ระดับ line
          split: (Number(l.masterQty || 0) > 0 || Number(l.childQty || 0) > 0)
            ? { masterQty: Number(l.masterQty || 0), childQty: Number(l.childQty || 0) }
            : null
        };
      });

    // เรียงตามลำดับที่ระบุใน SO เป็นหลัก บรรทัดที่ไม่ระบุไปต่อท้าย
    const sequenced   = rows.filter(r => r.loadSequence != null).sort((a, b) => a.loadSequence - b.loadSequence);
    const unsequenced = rows.filter(r => r.loadSequence == null)
      .sort((a, b) => String(a.docuNo || '').localeCompare(String(b.docuNo || '')) || a.listNo - b.listNo);

    const plan = [...sequenced, ...unsequenced].map((r, i) => ({ step: i + 1, ...r }));

    const totalTon = plan.reduce((s, r) => s + Number(r.qtyTon || 0), 0);
    const capacityTon = Number(trip.truckCapacityTon || 0);
    const tolerancePct = Number(trip.tolerancePct ?? 5);
    const maxTon = capacityTon > 0 ? capacityTon * (1 + tolerancePct / 100) : 0;

    // สิ่งที่ต้องแจ้งคนคุมลานก่อนเริ่มขึ้นของ
    const alerts = [];
    if (plan.some(r => r.preSling)) alerts.push({ level: 'info', text: 'ใบจองในเที่ยวนี้ขอใช้ Pre-Sling' });
    if (trip.preSlingRequired)      alerts.push({ level: 'info', text: 'เที่ยวนี้ตั้งค่าให้ใช้ Pre-Sling ทั้งคัน' });
    if (unsequenced.length > 0 && sequenced.length > 0)
      alerts.push({ level: 'warn', text: `มี ${unsequenced.length} รายการที่ไม่ได้ระบุลำดับ ระบบเรียงต่อท้ายให้` });
    const giveaways = plan.filter(r => r.isGiveaway);
    if (giveaways.length > 0)
      alerts.push({ level: 'info', text: `มีของแถม ${giveaways.length} รายการ รวม ${giveaways.reduce((s, r) => s + Number(r.qtyTon || 0), 0).toFixed(3)} ตัน` });
    const tickets = [...new Set(plan.filter(r => r.refControlTicketNo).map(r => r.refControlTicketNo))];
    if (tickets.length > 0)
      alerts.push({ level: 'info', text: `เบิกจากตั๋วคุม ${tickets.join(', ')}` });
    if (maxTon > 0 && totalTon > maxTon)
      alerts.push({ level: 'error', text: `น้ำหนักรวม ${totalTon.toFixed(3)} ตัน เกินความจุสูงสุด ${maxTon.toFixed(3)} ตัน` });
    const remarks = [...new Set(plan.map(r => r.truckRemark).filter(Boolean))];
    for (const rm of remarks) alerts.push({ level: 'info', text: `หมายเหตุรถ: ${rm}` });

    res.json({
      trip,
      totals: {
        totalTon: Number(totalTon.toFixed(3)),
        capacityTon,
        tolerancePct,
        maxTon: Number(maxTon.toFixed(3)),
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

// POST /api/trips
router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { tripCode, transRegistration, driverName, truckCapacityTon, orderIds } = req.body;
    if (!tripCode) return res.status(400).json({ message: 'กรุณาระบุ TripCode' });

    await wfTransaction(async tx => {
      const tripReq = tx.request();
      tripReq.input('tripCode', sql.VarChar(50), tripCode);
      tripReq.input('transRegistration', sql.VarChar(50), transRegistration || null);
      tripReq.input('driverName', sql.VarChar(100), driverName || null);
      tripReq.input('truckCapacityTon', sql.Decimal(18,2), truckCapacityTon || null);
      tripReq.input('createdBy', sql.Int, req.user.sub);

      const tripRes = await tripReq.query(`
        INSERT INTO wf.SalesTrip (TripCode, TransRegistration, DriverName, TruckCapacityTon, CreatedBy)
        OUTPUT inserted.TripId
        VALUES (@tripCode, @transRegistration, @driverName, @truckCapacityTon, @createdBy)
      `);
      const tripId = tripRes.recordset[0].TripId;

      if (orderIds && orderIds.length > 0) {
        for (const orderId of orderIds) {
          const soReq = tx.request();
          soReq.input('tripId', sql.Int, tripId);
          soReq.input('soId', sql.Int, orderId);
          await soReq.query(`UPDATE wf.SalesOrder SET TripId = @tripId WHERE Id = @soId`);
        }
      }
    });

    res.json({ message: 'สร้าง Trip สำเร็จ' });
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/trips/:id
router.put('/:id', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { transRegistration, driverName, truckCapacityTon, orderIds } = req.body;
    
    await wfTransaction(async tx => {
      const tripReq = tx.request();
      tripReq.input('tripId', sql.Int, req.params.id);
      tripReq.input('transRegistration', sql.VarChar(50), transRegistration || null);
      tripReq.input('driverName', sql.VarChar(100), driverName || null);
      tripReq.input('truckCapacityTon', sql.Decimal(18,2), truckCapacityTon || null);

      await tripReq.query(`
        UPDATE wf.SalesTrip
        SET TransRegistration = @transRegistration,
            DriverName = @driverName,
            TruckCapacityTon = @truckCapacityTon
        WHERE TripId = @tripId
      `);

      // Clear existing links
      await tx.request().input('tripId', sql.Int, req.params.id)
        .query(`UPDATE wf.SalesOrder SET TripId = NULL WHERE TripId = @tripId`);

      // Re-link
      if (orderIds && orderIds.length > 0) {
        for (const orderId of orderIds) {
          const soReq = tx.request();
          soReq.input('tripId', sql.Int, req.params.id);
          soReq.input('soId', sql.Int, orderId);
          await soReq.query(`UPDATE wf.SalesOrder SET TripId = @tripId WHERE Id = @soId`);
        }
      }
    });

    res.json({ message: 'อัปเดต Trip สำเร็จ' });
  } catch (error) {
    console.error('[trips]', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
