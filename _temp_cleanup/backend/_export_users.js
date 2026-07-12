require('dotenv').config();
const { wfQuery, sql } = require('./db');
const fs = require('fs');
const path = require('path');

async function exportCsv() {
  const usersRes = await wfQuery(`
    SELECT u.Username, u.DisplayName, u.Role, u.EmpId,
           -- Get nickname from old inactive records if available
           (SELECT TOP 1 DisplayName FROM wf.AppUser old WHERE old.EmpId = u.EmpId AND old.IsActive = 0 AND old.DisplayName LIKE '%(%)') AS OldDisplayName
    FROM wf.AppUser u
    WHERE u.IsActive = 1
    ORDER BY u.Role, u.Username
  `);
  
  // Get Regions from Giveaway
  const giveawayRes = await wfQuery(`SELECT DISTINCT EmpCode, Region FROM wf.GiveawayBudget`);
  const giveawayMap = {};
  for (const r of giveawayRes.recordset) {
    if (!giveawayMap[r.EmpCode]) giveawayMap[r.EmpCode] = [];
    giveawayMap[r.EmpCode].push(r.Region);
  }

  // Get Regions from EMSaleArea via EMCustMultiEmp
  const areaRes = await wfQuery(`
    SELECT DISTINCT ce.EmpID, a.SaleAreaName
    FROM dbo.EMCustMultiEmp ce
    JOIN dbo.EMCust c ON c.CustID = ce.CustID
    JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
  `);
  const areaMap = {};
  for (const r of areaRes.recordset) {
    const eId = String(r.EmpID);
    if (!areaMap[eId]) areaMap[eId] = [];
    areaMap[eId].push(r.SaleAreaName);
  }
  
  const rows = [['Username', 'DisplayName', 'Nickname/OldName', 'Role', 'Password', 'Region(Giveaway)', 'Region(SaleArea)']];
  
  for (const u of usersRes.recordset) {
    let password = 'W0rldF3rt'; // Default for all standard users
    
    // Extract nickname or use old display name
    let nickname = '';
    if (u.OldDisplayName) {
      const match = u.OldDisplayName.match(/\((.*?)\)/);
      nickname = match ? match[1] : u.OldDisplayName;
    }

    const empCode = u.Username.toUpperCase(); // e.g. EMP-00001
    const regionGiveaway = giveawayMap[empCode] ? giveawayMap[empCode].join(' / ') : '';
    const regionArea = u.EmpId && areaMap[u.EmpId] ? areaMap[u.EmpId].join(' / ') : '';
    
    const safeDisplayName = u.DisplayName ? `"${u.DisplayName.replace(/"/g, '""')}"` : '';
    const safeNickname = nickname ? `"${nickname.replace(/"/g, '""')}"` : '';
    const safeRegionGiveaway = regionGiveaway ? `"${regionGiveaway.replace(/"/g, '""')}"` : '';
    const safeRegionArea = regionArea ? `"${regionArea.replace(/"/g, '""')}"` : '';
    
    rows.push([u.Username, safeDisplayName, safeNickname, u.Role, password, safeRegionGiveaway, safeRegionArea].join(','));
  }
  
  const csvContent = "\uFEFF" + rows.join('\n'); // Add BOM for Excel UTF-8 support
  const outPath = path.join(__dirname, '..', 'users_credentials.csv');
  fs.writeFileSync(outPath, csvContent, 'utf8');
  console.log(`Exported to ${outPath}`);
  
  process.exit(0);
}

exportCsv().catch(console.error);
