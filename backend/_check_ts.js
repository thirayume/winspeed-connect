const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  
  const [rows] = await conn.query('DESCRIBE tbl_keyone');
  console.log(JSON.stringify(rows, null, 2));
  await conn.end();
}
main().catch(console.error);
