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
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  let remarkText = `WF-SO:${soId || wfRef || ''}`;
  if (overrideReason) {
    remarkText += ` | Discretion: ${overrideReason} (By: ${overrideApprovedByName || operatorName || 'N/A'})`;
  }

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
             Time_Out = ?, 
             one_App = ?,
             Computer_w = ?,
             Remark = CONCAT(IFNULL(Remark, ''), ' ', ?)
         WHERE s_id = ?`,
        [
          gross || 0,
          net || 0,
          dateStr,
          timeStr,
          String(wfRef || soId || '').substring(0, 100),
          scaleNo || 1,
          remarkText,
          sid
        ]
      );
      console.log(`[truckscale] Successfully updated tblscale s_id=${sid} for SO:${soId}`);
      if (wfRef) await removePreWeighTicket(wfRef);
      return { success: true, action: 'updated', s_id: sid };
    } else {
      // 2. Fallback: INSERT new record into tblscale (TS-02)
      const genSeq = `WF-${Date.now().toString().slice(-8)}`;
      const insertMb = mb || genSeq;

      const res = await tsQuery(
        `INSERT INTO tblscale 
         (sequence, movebill, one_car_regis, one_cus_name, weight_in, weight_out, weight_net, Date_In, Date_Out, Time_In, Time_Out, Computer_w, one_App, Remark) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          genSeq,
          insertMb,
          plate.substring(0, 50),
          String(custName || '').substring(0, 100),
          tare || 0,
          gross || 0,
          net || 0,
          dateStr,
          dateStr,
          timeStr,
          timeStr,
          scaleNo || 1,
          String(wfRef || soId || '').substring(0, 100),
          remarkText
        ]
      );
      console.log(`[truckscale] Inserted fallback record into tblscale (seq: ${genSeq}) for SO:${soId}`);
      if (wfRef) await removePreWeighTicket(wfRef);
      return { success: true, action: 'inserted', insertId: res.insertId };
    }
  } catch (e) {
    console.error(`[truckscale] writeBackWeighOutTicket failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

module.exports = { getPool, tsQuery, insertPreWeighTicket, removePreWeighTicket, writeBackWeighOutTicket };
