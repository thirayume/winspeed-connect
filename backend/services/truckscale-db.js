/**
 * truckscale-db.js — MySQL pool สำหรับ TruckScale (db_truckscale บน Railway)
 * แยกขาดจาก SQL Server (WINSpeed) · ไม่เกี่ยวกับ DB_MODE
 * ตั้งค่าใน .env: MYSQL_HOST / MYSQL_PORT / MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD
 */
const mysql = require('mysql2/promise');

let pool = null;
function getPool() {
  if (!process.env.MYSQL_HOST) return null;     // ยังไม่ตั้งค่า
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 10,           // จำกัดจำนวนคิวรอเชื่อมต่อสูงสุด 10 คำขอ ป้องกันการค้างสะสม
      connectTimeout: 5000,     // Timeout การเชื่อมต่อเริ่มต้น 5 วินาที
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: 'utf8mb4',
    });
  }
  return pool;
}

async function tsQuery(sql, params = []) {
  const p = getPool();
  if (!p) throw Object.assign(new Error('TruckScale MySQL ยังไม่ได้ตั้งค่า (MYSQL_HOST)'), { status: 503 });

  // ป้องกันการแขวนค้างด้วย Promise.race Timeout 6 วินาที
  const timeoutMs = 6000;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('TruckScale MySQL query timeout (6s)'), { status: 504 }));
    }, timeoutMs);
  });

  try {
    const queryPromise = p.query(sql, params);
    const [rows] = await Promise.race([queryPromise, timeoutPromise]);
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

async function insertPreWeighTicket(so) {
  if (!getPool()) return false;
  
  // Format datetime as YYYY-MM-DD HH:mm:ss
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datetime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  
  const sqlCheck = `
    SELECT s_id FROM tblscale 
    WHERE one_car_regis = ? 
      AND weight_in > 0 
      AND (weight_out = 0 OR weight_out IS NULL)
    ORDER BY s_id DESC LIMIT 1
  `;

  try {
    const existing = await tsQuery(sqlCheck, [String(so.TruckPlate || '').substring(0, 50)]);
    if (existing && existing.length > 0) {
      console.log(`[truckscale] Truck ${so.TruckPlate} is already in tblscale (s_id: ${existing[0].s_id}). Skipping tbl_keyone insert.`);
      return true; // Pretend success so we don't block the flow
    }
  } catch (e) {
    console.error(`[truckscale] Failed to check existing tblscale: ${e.message}`);
    // proceed to insert anyway if check fails, or maybe just proceed
  }
  
  const sql = `
    INSERT INTO tbl_keyone 
    (one_cus_id, one_cus_name, one_car_regis, one_datetime, one_day, one_num, one_w_type, one_App) 
    VALUES (?, ?, ?, ?, 0, 0, 'ชั่งรับ', ?)
  `;
  
  const params = [
    String(so.CustId || '').substring(0, 50),
    String(so.CustName || '').substring(0, 100),
    String(so.TruckPlate || '').substring(0, 50),
    datetime,
    String(so.WfRef || '').substring(0, 100)
  ];
  
  try {
    await tsQuery(sql, params);
    console.log(`[truckscale] Inserted pre-weigh ticket into tbl_keyone for SO: ${so.WfRef}, Plate: ${so.TruckPlate}`);
    return true;
  } catch (e) {
    console.error(`[truckscale] Failed to insert pre-weigh ticket: ${e.message}`);
    return false;
  }
}

async function removePreWeighTicket(wfRef) {
  if (!getPool() || !wfRef) return false;
  
  const sql = `DELETE FROM tbl_keyone WHERE one_App = ?`;
  
  try {
    await tsQuery(sql, [String(wfRef).substring(0, 100)]);
    console.log(`[truckscale] Removed pre-weigh ticket from tbl_keyone for SO: ${wfRef}`);
    return true;
  } catch (e) {
    console.error(`[truckscale] Failed to remove pre-weigh ticket: ${e.message}`);
    return false;
  }
}

function getThaiDateComponents(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(now.getDate());
  const month = pad(now.getMonth() + 1);
  const fullThaiYear = now.getFullYear() + 543;
  const shortThaiYear = String(fullThaiYear).slice(-2);

  // DD/MM/YYYY in Thai Buddhist Era (พ.ศ.)
  const dateStr = `${day}/${month}/${fullThaiYear}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // Date_Out2: OLE Automation Date Serial integer (Epoch: 1899-12-30 UTC)
  const epoch = Date.UTC(1899, 11, 30);
  const target = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const oleDateSerial = Math.floor((target - epoch) / 86400000);

  // s_day: YYMM in Thai Buddhist Era (e.g. 6905 for May 2569)
  const sDay = Number(`${shortThaiYear}${month}`);

  return { dateStr, timeStr, oleDateSerial, sDay };
}

async function writeBackWeighOutTicket(ticketData) {
  if (!getPool()) {
    console.log('[truckscale] MySQL not configured. Skipping writeBackWeighOutTicket.');
    return { success: false, reason: 'mysql_not_configured' };
  }

  const {
    soId,
    wfRef,
    truckPlate,
    custName,
    gross,
    tare,
    net,
    scaleNo,
    movebill,
    overrideReason,
    overrideApprovedByName,
    operatorName
  } = ticketData;

  const plate = String(truckPlate || '').trim();
  const mb = movebill ? String(movebill).trim() : '';

  const now = new Date();
  const { dateStr, timeStr, oleDateSerial, sDay } = getThaiDateComponents(now);

  // Format one_des (max 100 chars) instead of one_App or Remark
  let oneDes = `WF-SO:${soId || wfRef || ''}`;
  if (overrideReason) {
    oneDes += ` | Discretion: ${overrideReason} (By: ${overrideApprovedByName || operatorName || 'N/A'})`;
  }
  oneDes = oneDes.substring(0, 100);

  try {
    // 1. Search for existing OPEN ticket in tblscale
    let existing = [];
    if (mb) {
      existing = await tsQuery(
        `SELECT s_id, sequence, movebill FROM tblscale WHERE movebill = ? ORDER BY s_id DESC LIMIT 1`,
        [mb]
      );
    }
    if ((!existing || existing.length === 0) && plate) {
      existing = await tsQuery(
        `SELECT s_id, sequence, movebill FROM tblscale 
         WHERE one_car_regis = ? AND (weight_out = 0 OR weight_out IS NULL) 
         ORDER BY s_id DESC LIMIT 1`,
        [plate]
      );
    }

    if (existing && existing.length > 0) {
      const sid = existing[0].s_id;
      await tsQuery(
        `UPDATE tblscale 
         SET weight_out = ?, 
             weight_net = ?, 
             Date_Out = ?, 
             Date_Out2 = ?,
             Time_Out = ?, 
             Computer_w = ?,
             one_des = ?
         WHERE s_id = ?`,
        [
          gross || 0,
          net || 0,
          dateStr,
          oleDateSerial,
          timeStr,
          scaleNo || 1,
          oneDes,
          sid
        ]
      );
      console.log(`[truckscale] Successfully updated tblscale s_id=${sid} for SO:${soId}`);
      if (wfRef) await removePreWeighTicket(wfRef);
      return { success: true, action: 'updated', s_id: sid, sequence: existing[0].sequence || null };
    } else {
      // 2. Fallback: INSERT new record into tblscale
      const maxRes = await tsQuery(
        `SELECT MAX(s_num) AS maxNum FROM tblscale WHERE s_day = ?`,
        [sDay]
      ).catch(() => [{ maxNum: 0 }]);

      const sNum = ((maxRes && maxRes[0] && maxRes[0].maxNum) || 0) + 1;
      const insertMb = mb || `${sDay}${String(sNum).padStart(4, '0')}`;
      // sequence เป็น varchar(10) และค่าจริงในตารางเป็นตัวเลข 8 หลัก (เช่น '02784996')
      // รูปแบบเดิม 'WF-' + 8 หลัก ยาว 11 ตัวอักษร จึงถูกปฏิเสธด้วย Data too long
      // ใช้ 'WF' + 8 หลัก = 10 ตัวอักษรพอดี และยังแยกออกจากใบที่ชั่งจริงได้
      const genSeq = `WF${Date.now().toString().slice(-8)}`;

      const res = await tsQuery(
        `INSERT INTO tblscale 
         (sequence, movebill, one_car_regis, one_cus_name, weight_in, weight_out, weight_net, Date_In, Date_In2, Date_Out, Date_Out2, Time_In, Time_Out, s_day, s_num, Computer_w, one_des) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          genSeq,
          insertMb,
          plate.substring(0, 50),
          String(custName || '').substring(0, 100),
          tare || 0,
          gross || 0,
          net || 0,
          dateStr,
          oleDateSerial,
          dateStr,
          oleDateSerial,
          timeStr,
          timeStr,
          sDay,
          sNum,
          scaleNo || 1,
          oneDes
        ]
      );
      console.log(`[truckscale] Inserted fallback record into tblscale (seq: ${genSeq}, mb: ${insertMb}) for SO:${soId}`);
      if (wfRef) await removePreWeighTicket(wfRef);
      return { success: true, action: 'inserted', insertId: res.insertId, sequence: genSeq };
    }
  } catch (e) {
    console.error(`[truckscale] writeBackWeighOutTicket failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// บันทึกผลการเขียนกลับลง wf.WeighTicket เพื่อให้รายงานกระทบยอด R-3 ตรวจย้อนได้ว่า
// ใบสั่งขายใดทำให้เกิดใบชั่งที่แอปสร้างเอง และใบใดเขียนกลับไม่สำเร็จ
// เรียกจากทั้งเส้นทาง ship ตรงและ outbox retry จึงรวมไว้ที่เดียวไม่ให้ตรรกะซ้ำ
async function recordWriteBackResult(soId, result) {
  if (!soId) return;
  try {
    const { sql, wfQuery } = require('../db');
    const ok = Boolean(result && result.success);
    const sid = result && (result.s_id != null ? Number(result.s_id)
      : (result.insertId != null ? Number(result.insertId) : null));
    await wfQuery(`
      UPDATE wf.WeighTicket
      SET ScaleWriteAction = @action,
          ScaleSid         = COALESCE(@sid, ScaleSid),
          ScaleSequence    = COALESCE(@seq, ScaleSequence),
          ScaleWrittenAt   = CASE WHEN @action IN ('updated','inserted') THEN GETUTCDATE() ELSE ScaleWrittenAt END,
          ScaleError       = @err
      WHERE Id = (SELECT TOP 1 Id FROM wf.WeighTicket WHERE SoId = @so ORDER BY WeighOutAt DESC, Id DESC)`,
      {
        so:     { type: sql.NVarChar(50), value: String(soId) },
        action: { type: sql.VarChar(10), value: ok ? (result.action || 'updated') : 'failed' },
        sid:    { type: sql.Int, value: Number.isFinite(sid) ? sid : null },
        seq:    { type: sql.VarChar(10), value: (result && result.sequence) || null },
        err:    { type: sql.NVarChar(500), value: ok ? null
                  : String((result && (result.error || result.reason)) || 'unknown').slice(0, 500) },
      });
  } catch (error) {
    // ไม่ให้การบันทึกผลทำให้การ ship ล้มเหลว แต่ต้องเห็นใน log
    console.error('[truckscale] recordWriteBackResult failed: ' + error.message);
  }
}

// อ่านใบชั่งฝั่งโรงงานตามช่วงวัน (อ่านอย่างเดียว) สำหรับรายงานกระทบยอด
// ห้ามกรองด้วย Date_Out เพราะเป็น varchar 'DD/MM/YYYY' ปี พ.ศ. เทียบช่วงไม่ได้
// ใช้ Date_Out2 ซึ่งเป็นเลข serial แบบ OLE (epoch 1899-12-30) แทน
function oleDateSerial(date) {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(1899, 11, 30)) / 86400000);
}

async function listScaleTicketsByDateRange(fromDate, toDate) {
  if (!getPool()) return [];
  return tsQuery(
    `SELECT s_id, sequence, movebill, one_car_regis, one_cus_name,
            weight_in, weight_out, weight_net, Date_Out, Date_Out2, Time_Out, one_des
     FROM tblscale
     WHERE Date_Out2 BETWEEN ? AND ?
     ORDER BY s_id DESC`,
    [oleDateSerial(fromDate), oleDateSerial(toDate)]
  );
}

module.exports = {
  getPool, tsQuery, insertPreWeighTicket, removePreWeighTicket, writeBackWeighOutTicket,
  getThaiDateComponents, recordWriteBackResult, listScaleTicketsByDateRange, oleDateSerial,
};
