const db = require('./db');
async function run() {
  try {
    const result = await db.query(`
      SELECT EmpID, EmpCode, EmpName, EmpStatus, DeptID, EmpGroupID, EmpResignDate 
      FROM dbo.EMEmp 
      WHERE EmpResignDate IS NULL
    `);
    console.table(result);
    const result2 = await db.query(`SELECT DeptID, DeptCode, DeptName FROM dbo.EMDept`);
    console.table(result2);
    const result3 = await db.query(`SELECT EmpGroupID, EmpGroupCode, EmpGroupName FROM dbo.EMEmpGroup`);
    console.table(result3);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
run();
