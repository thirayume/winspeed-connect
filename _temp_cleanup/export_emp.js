const { sql, wfQuery } = require('./backend/db');
const fs = require('fs');

async function exportUsers() {
  try {
    const r = await wfQuery(`
      SELECT e.EmpCode, e.EmpName, e.username, e.EmpStatus, 
        (SELECT TOP 1 SaleAreaName FROM dbo.EMSaleArea WHERE SaleAreaID = e.EmpGroupID) as SaleAreaName
      FROM dbo.EMEmp e
      ORDER BY e.EmpCode
    `);
    
    let activeEmployees = r.recordset;

    let csv = '\uFEFFUsername,DisplayName,Nickname/OldName,Role,Password,Region(Giveaway),Region(SaleArea)\n';
    
    for (const emp of activeEmployees) {
      const username = (emp.EmpCode || '').toLowerCase().trim();
      const displayName = emp.EmpName ? emp.EmpName.trim() : '';
      const password = 'Wf' + username; // simple standard password
      const region = emp.SaleAreaName ? emp.SaleAreaName.trim() : '';
      
      let role = 'SALES'; // Default
      // Based on what the user said: "เช่นคนนี้ ผมเข้าใจว่าเป็นระดับหัวหน้าครับ EMP-00012, EMP-00059, EMP-00008 เป็นต้น"
      if (['emp-00008', 'emp-00012', 'emp-00059'].includes(username)) {
        role = 'MANAGER';
      }

      if (!username) continue;

      csv += `${username},"${displayName}",,${role},${password},,"${region}"\n`;
    }

    fs.writeFileSync('users_credentials.csv', csv, 'utf8');
    console.log('Exported ' + activeEmployees.length + ' users to users_credentials.csv');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

exportUsers();
