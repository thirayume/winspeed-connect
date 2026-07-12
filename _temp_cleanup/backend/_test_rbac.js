require('dotenv').config();
const { sql, query, wfQuery } = require('./db');

async function testRBAC() {
  // Test as SALES (e.g. empId = 1016)
  const salesEmpId = '1016';
  
  // Customers Query for SALES
  const salesCustomers = await query(`
    SELECT COUNT(*) as Count
    FROM dbo.EMCust c WITH (NOLOCK) 
    WHERE ISNULL(c.Inactive, 'A') <> 'I'
      AND c.CustID IN (SELECT CustID FROM dbo.EMCustMultiEmp WITH (NOLOCK) WHERE EmpID = @userEmpId)
  `, { userEmpId: { type: sql.Int, value: Number(salesEmpId) } });

  // Customers Query for ADMIN
  const adminCustomers = await query(`
    SELECT COUNT(*) as Count
    FROM dbo.EMCust c WITH (NOLOCK) 
    WHERE ISNULL(c.Inactive, 'A') <> 'I'
  `);

  console.log('Customers visible to SALES (EmpID 1016):', salesCustomers[0]?.Count);
  console.log('Customers visible to ADMIN:', adminCustomers[0]?.Count);

  // SO Query for SALES
  const salesSOs = await wfQuery(`
    SELECT COUNT(*) as Count
    FROM wf.v_AllSalesOrders so
    WHERE so.CustId IN (SELECT CustID FROM dbo.EMCustMultiEmp WITH (NOLOCK) WHERE EmpID = @userEmpId) OR so.SalesUserId = @userId
  `, { userEmpId: { type: sql.Int, value: Number(salesEmpId) }, userId: { type: sql.Int, value: 9999 } });

  // SO Query for ADMIN
  const adminSOs = await wfQuery(`
    SELECT COUNT(*) as Count
    FROM wf.v_AllSalesOrders so
  `);

  console.log('SOs visible to SALES (EmpID 1016):', salesSOs.recordset[0]?.Count);
  console.log('SOs visible to ADMIN:', adminSOs.recordset[0]?.Count);

  process.exit(0);
}

testRBAC().catch(console.error);
