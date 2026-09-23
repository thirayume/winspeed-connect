/**
 * recon.js — Reconciliation Workbench (FR-027)
 * กระทบยอด shipped SO ↔ WINSpeed invoice (dbo.SOInvHD) ↔ WINSpeed weigh (dbo.WGHD)
 *   - case คำนวณสด · degrade ได้ถ้า TruckScale ล่ม
 *   - คนตัดสิน exception ผ่าน wf.ReconResolution (resolve/ignore + owner)
 * เขียนเฉพาะ wf (ReconResolution) · อ่าน dbo
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
// เดิมเทียบยอดกับตาราง tblscale ใน MySQL ของ TruckScale
// MySQL ถูกลบออกถาวรเมื่อ 04/09/2569 — ย้ายมาอ่าน dbo.WGHD ซึ่งเป็นแหล่งเดียวแล้ว
// dbo.WGHD มีครบทั้ง MoveBill · CarNo · WeightNet · DateOut จึงเทียบได้เหมือนเดิม
// และดีกว่าเดิมตรงที่อยู่ฐานเดียวกัน ไม่ต้องข้ามเครื่อง
const { requireAuth, requireRole } = require('../middleware/auth');

const { evaluateSoGlStatus } = require('../services/native-gl-linkage');


router.use(requireAuth);
router.use(requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL', 'REPORT_PILOT'));

const WEIGH_TOL_KG = 50; // ผลต่างน้ำหนักที่ยอมรับ

const isNum = (s) => /^\d+$/.test(String(s));
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

const WEIGH_REASONS = {
  NO_WEIGH: 'ยังไม่มีข้อมูลตั๋วชั่ง',
  UNLINKED: 'ยังไม่ได้ผูก Movebill หรือตั๋วชั่ง',
  TS_NOT_FOUND: 'ไม่พบประวัติการชั่งใน TruckScale',
  TS_UNAVAILABLE: 'ระบบ TruckScale ไม่พร้อมใช้งาน',
  VARIANCE: 'น้ำหนักชั่งต่างเกินเกณฑ์ที่กำหนด (50 กก.)',
  CANDIDATE_MATCH: 'จับคู่ด้วยทะเบียนรถและวันที่ (ยังไม่ได้รับการยืนยันระดับตั๋ว)',
};

/**
 * หาใบกำกับของ SO แบบ batched และคำนวณปริมาณ/ยอดเงินระดับ line เพื่อป้องกัน fan-out
 * รองรับทั้ง:
 *   1a) Direct 103 -> SOInvDT
 *   1b) 103 -> 104 Delivery Order -> SOInvDT
 *   2) Header RefSOID
 *   3) Fallback Candidate SONo = WsDocuNo (ติดป้าย CANDIDATE_FALLBACK)
 */
async function lookupInvoices(rows) {
  const map = {};
  const ids = [...new Set(rows.map(r => String(r.SoId)).filter(isNum))];
  if (!ids.length) return map;
  const idList = ids.map(quote).join(',');

  // 1a) ทางตรง: SO 103 -> SOInvDT (RefID)
  const qDirect = (await wfQuery(`
    SELECT d.RefID AS SoId, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
           h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
           CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
           d.ListNo AS InvListNo,
           ISNULL(d.GoodQty2, 0) AS LineQtyTon, ISNULL(d.GoodAmnt, 0) AS LineAmnt,
           'PRIMARY_103_LINE' AS Provenance
    FROM dbo.SOInvDT d WITH (NOLOCK)
    JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = d.SOInvID AND h.DocuType IN (107, 202)
    WHERE d.RefID IN (${idList})
  `)).recordset || [];

  // 1b) ผ่านใบส่งของ: SO 103 -> SODT 104 (RefSOID) -> SOInvDT (RefID = 104 SOID AND RefListNo = 104 ListNo)
  const qVia104 = (await wfQuery(`
    SELECT dt104.RefSOID AS SoId, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
           h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
           CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
           d.ListNo AS InvListNo,
           ISNULL(d.GoodQty2, 0) AS LineQtyTon, ISNULL(d.GoodAmnt, 0) AS LineAmnt,
           'PRIMARY_104_LINE' AS Provenance
    FROM dbo.SODT dt104 WITH (NOLOCK)
    JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = dt104.SOID AND hd104.DocuType = 104 AND hd104.DocuStatus <> 'C'
    JOIN dbo.SOInvDT d WITH (NOLOCK) ON d.RefID = dt104.SOID AND d.RefListNo = dt104.ListNo
    JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = d.SOInvID AND h.DocuType IN (107, 202)
    WHERE dt104.RefSOID IN (${idList})
  `)).recordset || [];

  // Deduplicate invoice lines by composite key (SoId, SOInvID, InvListNo) to prevent fan-out
  const seenLines = new Set();
  const lineAggregates = {};

  for (const line of [...qDirect, ...qVia104]) {
    const sId = String(line.SoId);
    const lineKey = `${sId}|${line.SOInvID}|${line.InvListNo}`;
    if (seenLines.has(lineKey)) continue;
    seenLines.add(lineKey);

    const aggKey = `${sId}|${line.SOInvID}`;
    if (!lineAggregates[aggKey]) {
      lineAggregates[aggKey] = {
        SoId: sId,
        SOInvID: line.SOInvID,
        DocuNo: line.DocuNo,
        DocuDate: line.DocuDate,
        DocuType: line.DocuType,
        DocuStatus: line.DocuStatus,
        PostID: line.PostID,
        PostGL: line.PostGL,
        PostGLDate: line.PostGLDate,
        LineQtyTon: 0,
        LineAmnt: 0,
        Provenance: line.Provenance,
        lineCount: 0,
      };
    }
    lineAggregates[aggKey].LineQtyTon += Number(line.LineQtyTon || 0);
    lineAggregates[aggKey].LineAmnt += Number(line.LineAmnt || 0);
    lineAggregates[aggKey].lineCount++;
  }

  for (const agg of Object.values(lineAggregates)) {
    const sId = agg.SoId;
    if (!map[sId]) map[sId] = [];
    map[sId].push(agg);
  }

  // 2) อ้างอิงระดับหัวใบสั่งขาย RefSOID (เฉพาะกรณีไม่มี line link ใดๆ; ถือเป็น UNKNOWN_HEADER_ALLOCATION)
  const qHeaderRef = (await wfQuery(`
    SELECT CAST(h.RefSOID AS VARCHAR(50)) AS SoId, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
           h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
           CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
           NULL AS LineQtyTon, NULL AS LineAmnt,
           'HEADER_SO_REF_UNALLOCATED' AS Provenance
    FROM dbo.SOInvHD h WITH (NOLOCK)
    WHERE h.DocuType IN (107, 202) AND CAST(h.RefSOID AS VARCHAR(50)) IN (${idList})
  `)).recordset || [];

  for (const x of qHeaderRef) {
    const sId = String(x.SoId);
    if (!map[sId]) map[sId] = [];
    if (!map[sId].some(e => e.SOInvID === x.SOInvID)) {
      map[sId].push(x);
    }
  }

  // 3) Fallback เฉพาะที่ยังไม่เจอ: SONo = WsDocuNo (ทำเครื่องหมายชัดเจนว่าเป็น CANDIDATE_FALLBACK ไม่ใช่ verified)
  const left = rows.filter(r => !map[String(r.SoId)] || map[String(r.SoId)].length === 0);
  if (left.length) {
    const lNos = [...new Set(left.map(r => r.WsDocuNo).filter(Boolean))];
    if (lNos.length) {
      const alt = (await wfQuery(`
        SELECT h.SONo, h.SOInvID, h.DocuNo, CONVERT(VARCHAR(10), h.DocuDate, 120) AS DocuDate,
               h.DocuType, h.DocuStatus, h.PostID, h.PostGL,
               CONVERT(VARCHAR(10), h.PostGLDate, 120) AS PostGLDate,
               NULL AS LineQtyTon, NULL AS LineAmnt,
               'CANDIDATE_FALLBACK' AS Provenance
        FROM dbo.SOInvHD h WITH (NOLOCK)
        WHERE h.DocuType IN (107, 202) AND h.SONo IN (${lNos.map(quote).join(',')})
      `)).recordset || [];

      for (const r of left) {
        if (!r.WsDocuNo) continue;
        const hits = alt.filter(x => x.SONo === r.WsDocuNo);
        if (hits.length > 0) {
          const sId = String(r.SoId);
          if (!map[sId]) map[sId] = [];
          for (const h of hits) {
            if (!map[sId].some(e => e.SOInvID === h.SOInvID)) {
              map[sId].push(h);
            }
          }
        }
      }
    }
  }
  return map;
}

/**
 * ตรวจสอบความเชื่อมโยงกับสมุดรายวัน GL จริง (dbo.GLHD / dbo.GLDT JourID='1001')
 * ไม่ประดิษฐ์ข้อมูล ไม่อนุมานว่าพบ GLHD = POSTED สำเร็จถ้าไม่มีหลักฐาน
/**
 * ตรวจสอบความเชื่อมโยงกับสมุดรายวัน GL จริง (dbo.GLHD / dbo.GLDT JourID='1001')
 * ดึง GL candidate headers ทั้งหมดสำหรับ PostID ของใบกำกับที่ผ่านการตรวจสอบ
 * เพื่อส่งให้ evaluateSoGlStatus ใน native-gl-linkage ตรวจ typed identity,
 * 1-to-1 cardinality, และความสมดุล Dr = Cr ระดับสตางค์ (0 cents discrepancy)
 */
async function lookupGL(invoices) {
  // Exclude candidate invoices from verified GL lookup!
  const verifiedInvoices = invoices.filter(i => i.Provenance !== 'CANDIDATE_FALLBACK');
  const postIds = [...new Set(verifiedInvoices.map(i => i.PostID).filter(isNum))];
  if (!postIds.length) return [];

  const gls = (await wfQuery(`
    SELECT gl.GLID, gl.DocuNo, CONVERT(VARCHAR(10), gl.DocuDate, 120) AS JournalDate,
           gl.JourID, jour.JourName, gl.FromID, gl.FromFlag, gl.DocuStatus, gl.TotaAmnt,
           COUNT(dt.ListNo) AS LineCount,
           ISNULL(SUM(dt.DrAmnt), 0) AS SumDebit,
           ISNULL(SUM(dt.CrAmnt), 0) AS SumCredit,
           SUM(CASE WHEN dt.ListNo IS NOT NULL AND (dt.DrAmnt IS NULL OR dt.CrAmnt IS NULL) THEN 1 ELSE 0 END) AS InvalidLineCount
    FROM dbo.GLHD gl WITH (NOLOCK)
    LEFT JOIN dbo.EMAccJour jour WITH (NOLOCK) ON jour.JourID = gl.JourID
    LEFT JOIN dbo.GLDT dt WITH (NOLOCK) ON dt.GLID = gl.GLID
    WHERE gl.JourID = '1001'
      AND gl.FromFlag IN ('107', '202')
      AND gl.FromID IN (${postIds.map(quote).join(',')})
    GROUP BY gl.GLID, gl.DocuNo, gl.DocuDate, gl.JourID, jour.JourName, gl.FromID, gl.FromFlag, gl.DocuStatus, gl.TotaAmnt
  `)).recordset || [];

  return gls;
}

async function buildCases(days) {
  // 1) SOHD records
  const rows = (await wfQuery(`
    SELECT TOP 500 CAST(hd.SOID AS VARCHAR(50)) AS SoId, ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
           hd.CustName, hd.TransRegistration AS TruckPlate,
           CONVERT(VARCHAR(10), hd.DocuDate, 120) AS ShipDate, hd.DocuNo AS WsDocuNo,
           hd.DocuStatus, hd.AppvFlag,
           ext.WeighOutWeight, ext.TripId,
           wt.NetKg, wt.Movebill, wt.ScaleNo, wt.Status AS WeighTicketStatus,
           ISNULL(ord.TotalOrderedQtyTon, 0) AS TotalOrderedQtyTon
    FROM dbo.SOHD hd WITH (NOLOCK)
    LEFT JOIN (
      SELECT SOID, SUM(ISNULL(GoodQty2, 0)) AS TotalOrderedQtyTon
      FROM dbo.SODT WITH (NOLOCK)
      GROUP BY SOID
    ) ord ON ord.SOID = hd.SOID
    LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = hd.SOID
    LEFT JOIN wf.WeighTicket wt WITH (NOLOCK) ON wt.SoId = CAST(hd.SOID AS NVARCHAR(50))
    WHERE hd.DocuType = 103 AND hd.DocuDate >= DATEADD(day, -@d, GETDATE())
    ORDER BY hd.DocuDate DESC
  `, { d: { type: sql.Int, value: Number(days) || 7 } })).recordset || [];

  // 2) แนบข้อมูลใบกำกับ (batched & line-level)
  const invMap = await lookupInvoices(rows);

  // 3) แนบข้อมูล GL จริง
  const allInvs = Object.values(invMap).flat();
  const allGls = await lookupGL(allInvs);

  // 4) TruckScale matching
  let tsMap = {}, tsAvailable = true;
  const movebills = [...new Set(rows.map(r => r.Movebill).filter(Boolean))].map(String);

  try {
    if (movebills.length) {
      const inputs = {};
      const names = movebills.map((mb, i) => {
        inputs[`mb${i}`] = { type: sql.VarChar(50), value: mb };
        return `@mb${i}`;
      });
      const ts = (await wfQuery(`
        SELECT RTRIM(w.MoveBill) AS MoveBill, w.WeightNet
        FROM dbo.WGHD w
        WHERE RTRIM(w.MoveBill) IN (${names.join(',')})`, inputs)).recordset || [];
      for (const t of ts) {
        tsMap[String(t.MoveBill)] = { net: Number(t.WeightNet), matchBy: 'movebill' };
      }
    }

    // ใบที่ยังจับคู่ไม่ได้ — ลองด้วยทะเบียนรถกับวันชั่งออก (ถือเป็น CANDIDATE ไม่ใช่ verified event)
    const unmatched = rows.filter(r => !r.Movebill || tsMap[String(r.Movebill)] == null);
    const dates = unmatched.map(r => (r.ShipDate ? new Date(r.ShipDate) : null)).filter(Boolean);
    if (unmatched.length && dates.length) {
      const min = new Date(Math.min(...dates.map(d => d.getTime())) - 86400000);
      const max = new Date(Math.max(...dates.map(d => d.getTime())) + 86400000);
      const fallbackRows = (await wfQuery(`
        SELECT RTRIM(w.CarNo) AS CarNo, w.DateOut, w.WeightNet, RTRIM(w.MoveBill) AS MoveBill
        FROM dbo.WGHD w
        WHERE w.DateOut BETWEEN @min AND @max
        ORDER BY w.Id DESC`, {
          min: { type: sql.DateTime, value: min },
          max: { type: sql.DateTime, value: max },
        })).recordset || [];

      for (const r of unmatched) {
        if (!r.TruckPlate || !r.ShipDate) continue;
        const target = new Date(r.ShipDate).getTime();
        const hit = fallbackRows.find(t =>
          String(t.CarNo || '').trim() === String(r.TruckPlate || '').trim() &&
          t.DateOut && Math.abs(new Date(t.DateOut).getTime() - target) <= 86400000
        );
        if (hit) {
          tsMap[`plate:${r.SoId}`] = {
            net: Number(hit.WeightNet),
            matchBy: 'plate_date_candidate',
            fallbackMovebill: hit.MoveBill || null,
          };
        }
      }
    }
  } catch (e) {
    console.error('[recon] อ่าน dbo.WGHD ไม่สำเร็จ:', e.message);
    tsAvailable = false;
  }

  // 5) Resolutions
  const resRows = (await wfQuery(`SELECT SoId, CheckType, Status, Note FROM wf.ReconResolution`)).recordset || [];
  const resMap = {};
  for (const r of resRows) resMap[`${r.SoId}|${r.CheckType}`] = { status: r.Status, note: r.Note };

  return rows.map(r => {
    const netApp = r.NetKg != null ? Number(r.NetKg) : null;
    const tsHit = r.Movebill && tsMap[String(r.Movebill)] != null
      ? tsMap[String(r.Movebill)]
      : tsMap[`plate:${r.SoId}`];

    // มิติ 1: WEIGH check
    let weigh;
    if (netApp == null && !tsHit) weigh = 'NO_WEIGH';
    else if (!tsAvailable) weigh = 'TS_UNAVAILABLE';
    else if (!tsHit) weigh = r.Movebill ? 'TS_NOT_FOUND' : 'UNLINKED';
    else if (tsHit.matchBy === 'plate_date_candidate') weigh = 'CANDIDATE_MATCH';
    else weigh = Math.abs(netApp - tsHit.net) <= WEIGH_TOL_KG ? 'MATCHED' : 'VARIANCE';

    // มิติ 1 (Fulfillment Status): แยกจาก SOHD.DocuStatus='Y' อย่างเคร่งครัด
    let fulfillmentStatus;
    if (r.DocuStatus === 'C') fulfillmentStatus = 'CANCELLED';
    else if (r.WeighOutWeight && Number(r.WeighOutWeight) > 0) fulfillmentStatus = 'SHIPPED';
    else if (r.WeighTicketStatus === 'DONE' && r.NetKg != null && Number(r.NetKg) > 0) fulfillmentStatus = 'SHIPPED';
    else if (r.DocuStatus === 'Y') fulfillmentStatus = 'UNKNOWN'; // Native closed without workflow proof
    else fulfillmentStatus = 'NOT_SHIPPED';

    // มิติ 2: INVOICE check & Invoices List
    const invList = invMap[String(r.SoId)] || [];
    const activeInvs = invList.filter(i => i.DocuStatus !== 'C');
    const cancelledInvs = invList.filter(i => i.DocuStatus === 'C');

    const totalOrderedQty = Number(r.TotalOrderedQtyTon) || 0;
    const totalInvoicedAmount = activeInvs.reduce((s, i) => s + (Number(i.LineAmnt) || 0), 0);
    const totalInvoicedQty = activeInvs.reduce((s, i) => s + (Number(i.LineQtyTon) || 0), 0);

    const orderedKg = Math.round(totalOrderedQty * 1000);
    const invoicedKg = Math.round(totalInvoicedQty * 1000);

    let invoiceStatus;
    if (invList.length === 0) invoiceStatus = 'NO_INVOICE';
    else if (activeInvs.length === 0 && cancelledInvs.length > 0) invoiceStatus = 'CANCELLED';
    else if (activeInvs.some(i => i.Provenance === 'CANDIDATE_FALLBACK')) invoiceStatus = 'CANDIDATE_INVOICE';
    else if (orderedKg > 0 && invoicedKg > 0 && invoicedKg < orderedKg) invoiceStatus = 'PARTIAL_INVOICED';
    else invoiceStatus = 'INVOICE_FOUND';

    // มิติ 3: NATIVE GL Posting Flag & Verified GL Linkage
    let nativeGlPostingFlag = null;
    if (activeInvs.length > 0) {
      const allY = activeInvs.every(i => i.PostGL === 'Y');
      const allN = activeInvs.every(i => i.PostGL === 'N');
      nativeGlPostingFlag = allY ? 'Y' : (allN ? 'N' : 'MIXED');
    }

    const soGlEval = evaluateSoGlStatus(activeInvs, allGls);
    const verifiedGlStatus = soGlEval.verifiedGlStatus;
    const matchedGL = soGlEval.matchedGL;
    const glDocuDate = soGlEval.glDocuDate;

    // มิติ 4: Operational Readiness vs Posting Readiness
    const wRes = resMap[`${r.SoId}|WEIGH`];
    const iRes = resMap[`${r.SoId}|INVOICE`];

    const readinessReasons = [];
    if (fulfillmentStatus !== 'SHIPPED') {
      if (fulfillmentStatus === 'CANCELLED') readinessReasons.push('ใบสั่งขายถูกยกเลิก');
      else readinessReasons.push('ยังไม่มีหลักฐานการส่งสินค้าที่ผ่านการรับรอง');
    }
    if (r.AppvFlag === 'W') readinessReasons.push('ใบสั่งขายรอการอนุมัติ');
    // Operational readiness requires verified physical weighing.
    // Administrative resolutions (wRes) do NOT turn unverified physical evidence into QUALIFIED.
    if (weigh === 'CANDIDATE_MATCH') {
      readinessReasons.push('หลักฐานชั่งเป็นเพียงการจับคู่ทะเบียน/วันชั่ง (CANDIDATE_MATCH) ยังไม่ได้รับการยืนยัน Movebill');
    } else if (weigh !== 'MATCHED') {
      readinessReasons.push(WEIGH_REASONS[weigh] || 'หลักฐานชั่งยังไม่เรียบร้อย');
    }
    if (invoiceStatus === 'INVOICE_FOUND' && verifiedGlStatus === 'VERIFIED_GL') {
      readinessReasons.push('ออกใบกำกับและลงบัญชี GL แล้ว');
    }

    const operationalReadiness = readinessReasons.length === 0 ? 'QUALIFIED' : 'BLOCKED';

    // Exceptions and Overall
    const isExc = (s) => ['VARIANCE', 'TS_NOT_FOUND', 'NO_WEIGH', 'UNLINKED', 'TS_UNAVAILABLE', 'INCONSISTENT', 'FLAGGED_BUT_NO_GL'].includes(s);
    const weighOpen = isExc(weigh) && !wRes;
    const glOpen = ['INCONSISTENT', 'FLAGGED_BUT_NO_GL'].includes(verifiedGlStatus);
    const invoiceOpen = (invoiceStatus === 'CANCELLED' || invoiceStatus === 'CANDIDATE_INVOICE') && !iRes;

    let overall;
    if (weighOpen || glOpen || invoiceOpen) overall = 'EXCEPTION';
    else if (weigh === 'CANDIDATE_MATCH' || invoiceStatus === 'CANDIDATE_INVOICE') overall = 'AMBIGUOUS';
    else if (wRes || iRes) overall = 'RESOLVED';
    else overall = 'OK';

    // Primary/First active invoice for display & legacy compatibility
    const primaryInv = activeInvs[0] || invList[0] || null;
    const readyForPostInvoice = false; // BLOCKED_SPEC: native posting writeback contract is unverified
    const postInvoiceStatus = verifiedGlStatus === 'VERIFIED_GL' ? 'POSTED' : 'UNVERIFIED';
    const invoice = activeInvs.length > 0 ? (invoiceStatus === 'PARTIAL_INVOICED' ? 'PARTIAL' : 'MATCHED') : (invList.length > 0 ? 'CANCELLED' : 'PENDING');

    return {
      soId: r.SoId,
      wfRef: r.WfRef,
      custName: r.CustName,
      truckPlate: r.TruckPlate,
      shipDate: r.ShipDate,
      wsDocuNo: r.WsDocuNo,
      soDocuNo: r.WsDocuNo || r.WfRef,

      // 1. Fulfillment
      fulfillmentStatus,
      netApp,
      netTs: tsHit ? tsHit.net : null,
      tsMatchBy: tsHit ? tsHit.matchBy : null,
      tsFallbackMovebill: (tsHit && tsHit.fallbackMovebill) || null,
      variance: (netApp != null && tsHit) ? Math.round(netApp - tsHit.net) : null,
      movebill: r.Movebill,
      scaleNo: r.ScaleNo,
      weigh,

      // 2. Invoices (multi-invoice trace)
      invoiceStatus,
      invoices: invList.map(inv => ({
        soInvId: inv.SOInvID,
        docuNo: inv.DocuNo,
        docuDate: inv.DocuDate,
        docuType: inv.DocuType,
        docuStatus: inv.DocuStatus,
        postGL: inv.PostGL,
        postGLDate: inv.PostGLDate,
        postId: inv.PostID ? String(inv.PostID) : null,
        lineQty: inv.LineQtyTon != null ? Number(inv.LineQtyTon) : null,
        lineAmnt: inv.LineAmnt != null ? Number(inv.LineAmnt) : null,
        provenance: inv.Provenance,
      })),
      wsInvoiceNo: primaryInv ? primaryInv.DocuNo : null,
      wsInvoiceId: primaryInv ? primaryInv.SOInvID : null,
      wsInvoiceDate: primaryInv ? primaryInv.DocuDate : null,
      wsInvoiceType: primaryInv ? primaryInv.DocuType : null,
      wsPostId: primaryInv ? primaryInv.PostID : null,
      invoiceCount: invList.length,
      totalOrderedQty,
      totalInvoicedQty,
      totalInvoicedAmount,

      // 3. GL Posting & Verification
      nativeGlPostingFlag,
      verifiedGlStatus,
      glDocuNo: matchedGL ? matchedGL.DocuNo : null,
      glDocuDate: (matchedGL && verifiedGlStatus === 'VERIFIED_GL') ? (matchedGL.JournalDate || matchedGL.DocuDate) : null,
      glJourId: matchedGL ? matchedGL.JourID : null,
      glTotalAmnt: matchedGL ? Number(matchedGL.TotaAmnt) : null,

      // 4. Operational & Posting Readiness
      operationalReadiness,
      readinessReasons,
      nativePostingReadiness: 'UNVERIFIED_CONTRACT',

      // Resolutions & Overall
      weighResolution: wRes || null,
      invoiceResolution: iRes || null,
      overall,
      tsAvailable,

      // Legacy compatibility fields
      invoice,
      postInvoiceStatus,
      readyForPostInvoice,
    };
  });
}

// GET /api/recon/summary?days=
router.get('/summary', async (req, res) => {
  try {
    const cases = await buildCases(req.query.days);
    const summary = {
      total: cases.length,
      ok: cases.filter(c => c.overall === 'OK').length,
      exception: cases.filter(c => c.overall === 'EXCEPTION').length,
      resolved: cases.filter(c => c.overall === 'RESOLVED').length,
      ambiguous: cases.filter(c => c.overall === 'AMBIGUOUS').length,
      operationallyQualified: cases.filter(c => c.operationalReadiness === 'QUALIFIED').length,
      operationallyBlocked: cases.filter(c => c.operationalReadiness === 'BLOCKED').length,
      invoiceFound: cases.filter(c => c.invoiceStatus === 'INVOICE_FOUND').length,
      partialInvoiced: cases.filter(c => c.invoiceStatus === 'PARTIAL_INVOICED').length,
      noInvoice: cases.filter(c => c.invoiceStatus === 'NO_INVOICE').length,
      glVerified: cases.filter(c => c.verifiedGlStatus === 'VERIFIED_GL').length,
      glUnposted: cases.filter(c => c.verifiedGlStatus === 'UNPOSTED_GL').length,
      glInconsistent: cases.filter(c => ['INCONSISTENT', 'FLAGGED_BUT_NO_GL'].includes(c.verifiedGlStatus)).length,
      tsAvailable: cases[0]?.tsAvailable ?? true,
      // Legacy compatibility:
      readyForPostInvoice: cases.filter(c => c.readyForPostInvoice).length,
      postedInvoice: cases.filter(c => c.postInvoiceStatus === 'POSTED').length,
    };
    res.json(summary);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/recon/cases?days=&status=
router.get('/cases', async (req, res) => {
  try {
    let cases = await buildCases(req.query.days);
    if (req.query.status) cases = cases.filter(c => c.overall === req.query.status);
    res.json(cases);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/recon/:soId/resolve  { checkType, action, note }
router.post('/:soId/resolve', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { checkType, action, note, wfRef } = req.body || {};
    if (!['WEIGH', 'INVOICE'].includes(checkType)) return res.status(400).json({ message: 'checkType ไม่ถูกต้อง' });
    const status = action === 'IGNORE' ? 'IGNORED' : 'RESOLVED';
    await wfQuery(`
      MERGE wf.ReconResolution AS t
      USING (SELECT @so AS SoId, @ct AS CheckType) AS s ON t.SoId=s.SoId AND t.CheckType=s.CheckType
      WHEN MATCHED THEN UPDATE SET Status=@st, Note=@note, ResolvedBy=@uid, ResolvedAt=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (SoId, WfRef, CheckType, Status, Note, ResolvedBy)
        VALUES (@so, @ref, @ct, @st, @note, @uid);`,
      {
        so:  { type: sql.NVarChar(50),  value: String(req.params.soId) },
        ref: { type: sql.NVarChar(30),  value: wfRef || null },
        ct:  { type: sql.NVarChar(20),  value: checkType },
        st:  { type: sql.NVarChar(20),  value: status },
        note:{ type: sql.NVarChar(500), value: note || null },
        uid: { type: sql.Int,           value: req.user.sub },
      });
    res.json({ soId: req.params.soId, checkType, status });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
