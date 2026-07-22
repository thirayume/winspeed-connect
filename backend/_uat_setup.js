const { wfQuery } = require('./db');

setTimeout(async () => {
  try {
    // Create UAT admin user
    await wfQuery(
      "IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username='uat_admin') " +
      "INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, IsActive) " +
      "VALUES ('uat_admin', '$2b$12$wwDzfn/3qGnZJBxm5TsiueTnabL6Yk4xTgqX5eFa6JiQRArpNqNnu', 'UAT Test Admin', 'ADMIN', 1)"
    );

    // List top users
    const r = await wfQuery('SELECT TOP 10 Id, Username, DisplayName, Role, IsActive FROM wf.AppUser WHERE IsActive=1 ORDER BY Id');
    console.log(JSON.stringify(r.recordset, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}, 3000);
