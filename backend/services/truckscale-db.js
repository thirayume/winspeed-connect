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
      queueLimit: 0,
      charset: 'utf8mb4',
    });
  }
  return pool;
}

async function tsQuery(sql, params = []) {
  const p = getPool();
  if (!p) throw Object.assign(new Error('TruckScale MySQL ยังไม่ได้ตั้งค่า (MYSQL_HOST)'), { status: 503 });
  const [rows] = await p.query(sql, params);
  return rows;
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

module.exports = { getPool, tsQuery, insertPreWeighTicket, removePreWeighTicket };
