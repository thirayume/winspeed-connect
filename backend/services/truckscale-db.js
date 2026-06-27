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

module.exports = { getPool, tsQuery };
