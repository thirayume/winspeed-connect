const bcrypt = require('bcrypt');
const sql = require('mssql/msnodesqlv8');

const mode = process.argv[2] || 'inspect';
const username = process.argv[3] || 'admin';
const newPassword = process.argv[4] || 'W0rldF3rt';

async function main() {
  const pool = new sql.ConnectionPool({
    server: '.\\SQLEXPRESS',
    database: 'dbwins_worldfert9',
    driver: 'msnodesqlv8',
    options: { trustedConnection: true, trustServerCertificate: true },
  });
  await pool.connect();

  if (mode === 'inspect') {
    const summary = await pool.request().query(`
      SELECT Role, IsActive, COUNT(*) AS Cnt
      FROM wf.AppUser
      GROUP BY Role, IsActive
      ORDER BY Role, IsActive;
    `);
    const users = await pool.request().query(`
      SELECT TOP 25 Id, Username, DisplayName, Role, IsActive, EmpId
      FROM wf.AppUser
      ORDER BY CASE WHEN Role='ADMIN' THEN 0 ELSE 1 END, Username;
    `);
    console.log(JSON.stringify({ summary: summary.recordset, sampleUsers: users.recordset }, null, 2));
    await pool.close();
    return;
  }

  if (mode === 'reset') {
    const hash = await bcrypt.hash(newPassword, 12);
    const result = await pool.request()
      .input('username', sql.NVarChar(50), username)
      .input('hash', sql.NVarChar(255), hash)
      .query(`
        UPDATE wf.AppUser
        SET PasswordHash=@hash, IsActive=1, UpdatedAt=GETUTCDATE()
        OUTPUT inserted.Id, inserted.Username, inserted.DisplayName, inserted.Role, inserted.IsActive
        WHERE Username=@username;
      `);
    console.log(JSON.stringify({ reset: result.recordset }, null, 2));
    await pool.close();
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
