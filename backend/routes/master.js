/**
 * master.js — ข้อมูลหลักจาก dbo (WINSpeed)
 *
 * ส่วนใหญ่อ่านอย่างเดียวผ่าน query() ซึ่งใช้ readerPool
 * ยกเว้นการแก้ไข/ปิดใช้งาน ลูกค้า · สินค้า · ประเภทรถ ที่เขียน dbo ได้ตาม ADR-003
 * การเขียนต้องใช้ dboWrite() ซึ่งใช้ ownerPool และคืน rowsAffected ให้ตรวจได้
 *
 * เดิมหัวไฟล์เขียนว่า "ห้ามเขียน dbo ใดๆ" แต่โค้ดเขียนจริงผ่าน query() ซึ่งเป็น
 * pool สำหรับอ่าน และไม่มี rowsAffected จึงตรวจไม่ได้ว่ามีแถวถูกแก้จริงหรือไม่
 */
const router = require('express').Router();
const { sql, query, dboWrite } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { getBangkokDateString } = require('../services/so-pickup-policy');
const { parseNullableAgingInput, getCreditAgingPolicyBounds } = require('../services/credit-service');
// R12 O-4: SALES/MANAGER see their own + team documents (ADMIN/C_LEVEL/ACCOUNTING and operational roles see all)
const { getVisibleScope, scopeFilter } = require('../services/visible-scope');
const { nativeChainInScope } = require('../services/native-document-scope');

router.use(requireAuth);

// ถ้าไม่ตรวจว่ามีแถวถูกแก้จริง endpoint จะตอบ 200 ทั้งที่ไม่มีอะไรเปลี่ยน
// ซึ่งเท่ากับสร้างหลักฐานของสิ่งที่ไม่เคยเกิดขึ้น
const affected = result => Number(result?.rowsAffected?.[0] || 0);

// R12 items 14–16 (O-2): master-data writes go through wf procedures (migration 146) when present —
// the least-privilege app login has no UPDATE/INSERT on dbo.EMCust / EMGood / EMSetPrice*.
let masterProcsAvailable = null;
async function hasMasterProcs() {
  if (masterProcsAvailable !== null) return masterProcsAvailable;
  const { wfQuery } = require('../db');
  try {
    const r = await wfQuery("SELECT CASE WHEN OBJECT_ID('wf.sp_MasterCreatePrice', 'P') IS NOT NULL AND OBJECT_ID('wf.sp_MasterUpdateCustomer', 'P') IS NOT NULL THEN 1 ELSE 0 END AS HasProcs");
    masterProcsAvailable = Number(r.recordset?.[0]?.HasProcs || 0) === 1;
  } catch { masterProcsAvailable = false; }
  return masterProcsAvailable;
}
// EXEC wf.<proc> with named params; returns the first result row (OUTPUT values selected back)
async function execMasterProc(proc, params, outputs = []) {
  const { wfQuery } = require('../db');
  const decl = outputs.map(o => 'DECLARE @' + o.name + '_out ' + o.sqlType + ';').join(' ');
  const args = [
    ...Object.keys(params).map(k => '@' + k + ' = @' + k),
    ...outputs.map(o => '@' + o.name + ' = @' + o.name + '_out OUTPUT'),
  ].join(', ');
  const sel = outputs.length ? 'SELECT ' + outputs.map(o => '@' + o.name + '_out AS ' + o.name).join(', ') + ';' : '';
  const r = await wfQuery(decl + ' EXEC ' + proc + ' ' + args + '; ' + sel, params);
  return r.recordset?.[0] || {};
}
// SQL Server Native Client 10 (local 2008 R2 target) hands RAISERROR text over through an ANSI
// code page, so the procedures' Thai messages arrive garbled. The routes check the same rules
// first with Thai messages; a procedure refusal that still gets through shows a readable fallback.
const THAI_TEXT = /[฀-๿]/;
function masterWriteStatus(e) {
  const msg = e?.message || '';
  if (/permission was denied/i.test(msg)) {
    return { status: 503, message: 'ผู้ใช้ฐานข้อมูลของแอปไม่มีสิทธิ์เขียนข้อมูลหลัก WINSpeed โดยตรง — ต้อง apply migration 146_master_data_procs.sql' };
  }
  // RAISERROR from the procedures (severity 16) is a validation failure → 400
  if (!e?.status && (e?.class === 16 || e?.number === 50000)) {
    const text = msg.replace(/^(\[[^\]]*\])+/, '').trim();
    return { status: 400, message: THAI_TEXT.test(text) ? text : 'ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล WINSpeed — ตรวจชื่อ ราคา และวันที่อีกครั้ง' };
  }
  return { status: e?.status || 500, message: msg || 'Server error' };
}
// CustID and GoodID are INT in WINSpeed; anything else cannot exist
const isMasterId = v => /^\d{1,10}$/.test(String(v ?? ''));
const AFFECTED_OUT = [{ name: 'Affected', sqlType: 'INT' }];
const affectedOf = r => ({ rowsAffected: [Number(r.Affected || 0)] });

const CUSTOMER_FILTER_CANDIDATES = {
  salesperson: ['SalespersonUserId', 'SalesID', 'SaleID', 'SalesEmpID', 'SaleEmpID', 'BillEmp'],
  employee: ['BillEmp', 'EmpID', 'EmployeeID', 'StaffID'],
  area: ['SaleAreaID', 'AreaID', 'AreaCode', 'ZoneID', 'CustAreaID', 'RegionID'],
  group: ['CustGroupID', 'CustGroupCode', 'CustTypeID', 'GroupID', 'PriceGroupID'],
};

let customerFilterColumnCache = null;

function bracketIdent(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

// GET /api/master/company — ดึงข้อมูลบริษัทจาก dbo.EMComp
router.get('/company', async (req, res) => {
  try {
    const { getCompanyInfo } = require('../services/company-service');
    const info = await getCompanyInfo();
    res.json(info);
  } catch (err) {
    console.error('[master/company] error:', err.message);
    res.status(500).json({ message: 'Error retrieving company info' });
  }
});

async function getCustomerFilterColumns() {
  if (customerFilterColumnCache) return customerFilterColumnCache;
  const cols = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'EMCust'
  `);
  const existing = new Set((cols || []).map(r => String(r.COLUMN_NAME).toLowerCase()));
  const found = {};
  for (const [key, candidates] of Object.entries(CUSTOMER_FILTER_CANDIDATES)) {
    found[key] = candidates.find(c => existing.has(c.toLowerCase())) || null;
  }
  customerFilterColumnCache = found;
  return found;
}

// GET /api/master/customer-filters
router.get('/customer-filters', async (req, res) => {
  try {
    const columns = await getCustomerFilterColumns();

    // 1. Salesperson: Active sales and managers from wf.AppUser (+ count from wf.CustomerExt)
    const salesperson = await query(`
      SELECT CONVERT(NVARCHAR(50), u.Id) AS value,
             u.DisplayName + ' (@' + u.Username + ')' AS label,
             COUNT(cx.CustId) AS count
      FROM wf.AppUser u WITH (NOLOCK)
      LEFT JOIN wf.UserRole ur WITH (NOLOCK) ON ur.UserId = u.Id
      LEFT JOIN wf.CustomerExt cx WITH (NOLOCK) ON cx.SalespersonUserId = u.Id
      WHERE (u.Role IN ('SALES', 'COUNTER_SALES', 'MANAGER') 
             OR u.RoleCode IN ('SALES', 'COUNTER_SALES', 'MANAGER')
             OR ur.RoleCode IN ('SALES', 'COUNTER_SALES', 'MANAGER'))
        AND u.IsActive = 1
      GROUP BY u.Id, u.DisplayName, u.Username
      ORDER BY u.DisplayName
    `);

    // 2. Area: The 14 official sale regions from wf.SaleRegion
    const area = await query(`
      SELECT r.RegionCode AS value,
             r.RegionCode + ' ' + r.RegionName AS label,
             r.RegionCode AS regionCode,
             r.RegionName AS regionName,
             COUNT(c.CustID) AS count
      FROM wf.SaleRegion r WITH (NOLOCK)
      LEFT JOIN dbo.EMSaleArea a WITH (NOLOCK) ON SUBSTRING(a.SaleAreaCode, 1, 2) = r.RegionCode
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON (c.SaleAreaID = a.SaleAreaID OR c.CustID IN (SELECT CustId FROM wf.CustomerExt WHERE RegionCode = r.RegionCode)) AND ISNULL(c.Inactive, 'A') <> 'I'
      WHERE ISNULL(r.IsActive, 1) = 1
      GROUP BY r.RegionCode, r.RegionName
      ORDER BY r.RegionCode
    `);

    // 3. Group: From dbo.EMCustGroup
    const group = await query(`
      SELECT CONVERT(NVARCHAR(50), g.CustGroupID) AS value,
             g.CustGroupName AS label,
             COUNT(c.CustID) AS count
      FROM dbo.EMCustGroup g WITH (NOLOCK)
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustGroupID = g.CustGroupID AND ISNULL(c.Inactive, 'A') <> 'I'
      GROUP BY g.CustGroupID, g.CustGroupName
      ORDER BY g.CustGroupID
    `);

    // 4. Regions: From wf.SaleRegion
    const regions = await query(`
      SELECT r.RegionCode AS value,
             r.RegionName AS label,
             COUNT(c.CustID) AS count
      FROM wf.SaleRegion r WITH (NOLOCK)
      LEFT JOIN dbo.EMSaleArea a WITH (NOLOCK) ON SUBSTRING(a.SaleAreaCode, 1, 2) = r.RegionCode
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.SaleAreaID = a.SaleAreaID AND ISNULL(c.Inactive, 'A') <> 'I'
      WHERE ISNULL(r.IsActive, 1) = 1
      GROUP BY r.RegionCode, r.RegionName
      ORDER BY r.RegionCode
    `);

    // 5. Employee: mirror of salesperson for backwards compatibility
    const employee = salesperson;

    res.json({ columns, salesperson, employee, area, group, regions });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/customers
router.get('/customers', async (req, res) => {
  try {
    const { q, salesperson, area, group, employee, region, includeInactive } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 800, 50), 3000);
    const conditions = [`c.CustName NOT LIKE N'%ไม่ใช้%'`, `c.CustName NOT LIKE N'%ยกเลิก%'`];
    if (includeInactive !== 'true') {
      conditions.push(`ISNULL(c.Inactive, 'A') <> 'I'`);
    }
    const inputs = { limit: { type: sql.Int, value: limit } };
    if (q) {
      conditions.push(`(c.CustName LIKE N'%' + @q + '%' OR c.CustCode LIKE N'%' + @q + '%' OR CONVERT(NVARCHAR(50), c.CustID) LIKE N'%' + @q + '%')`);
      inputs.q = { type: sql.NVarChar(100), value: q };
    }
    if (salesperson || employee) {
      const spVal = salesperson || employee;
      conditions.push(`(CONVERT(NVARCHAR(50), cx.SalespersonUserId) = @salesperson OR CONVERT(NVARCHAR(50), c.BillEmp) = @salesperson)`);
      inputs.salesperson = { type: sql.NVarChar(50), value: String(spVal) };
    }
    if (area || region) {
      const regionVal = region || area;
      conditions.push(`(COALESCE(cx.RegionCode, SUBSTRING(area.SaleAreaCode, 1, 2)) = @region OR CONVERT(NVARCHAR(50), c.SaleAreaID) = @region OR CONVERT(NVARCHAR(50), cx.SaleAreaId) = @region)`);
      inputs.region = { type: sql.NVarChar(50), value: String(regionVal) };
    }
    if (group) {
      conditions.push(`(CONVERT(NVARCHAR(50), c.CustGroupID) = @group OR CONVERT(NVARCHAR(50), cx.CustGroupId) = @group)`);
      inputs.group = { type: sql.NVarChar(50), value: String(group) };
    }

    const policyBounds = await getCreditAgingPolicyBounds();
    inputs.defaultAgingDays = { type: sql.Int, value: policyBounds.defaultAgingDays };

    const rows = await query(
      `SELECT TOP (@limit)
              c.CustID, c.CustCode, c.CustName, 
              COALESCE(cx.PrimaryPhone, c.ContTel) AS Tel, 
              COALESCE(cx.SecondaryPhone, c.ContTel1) AS Mobile,
              cx.PrimaryPhone, cx.SecondaryPhone, cx.Email, cx.LineId,
              ISNULL(cx.Remark, '') AS Remark, c.Inactive, 
              COALESCE(cx.AgingDays, cm.AgingDays, c.CreditDays) AS RawAgingDays,
              COALESCE(cx.AgingDays, cm.AgingDays, c.CreditDays, @defaultAgingDays) AS AgingDays,
              COALESCE(cx.AgingDays, cm.AgingDays, c.CreditDays, @defaultAgingDays) AS CreditDays,
              CASE WHEN COALESCE(cx.AgingDays, cm.AgingDays, c.CreditDays) IS NULL THEN 1 ELSE 0 END AS IsDefaultAging,
              COALESCE(cx.CreditLimit, cm.CreditLimit, c.CreditAmnt, 0) AS CreditLimit,
              ISNULL(cm.CreditHold, 0) AS CreditHold,
              CONVERT(NVARCHAR(50), COALESCE(cx.SalespersonUserId, c.BillEmp)) AS salespersonId,
              COALESCE(salesUser.DisplayName, cx.SalespersonName, salesEmp.EmpName) AS salespersonName,
              CONVERT(NVARCHAR(50), COALESCE(c.SaleAreaID, cx.SaleAreaId)) AS areaId,
              area.SaleAreaName AS areaName,
              COALESCE(cx.RegionCode, SUBSTRING(area.SaleAreaCode, 1, 2)) AS regionCode,
              r.RegionName AS regionName,
              CONVERT(NVARCHAR(50), COALESCE(c.CustGroupID, cx.CustGroupId)) AS groupId,
              cg.CustGroupName AS groupName,
              CONVERT(NVARCHAR(50), COALESCE(cx.SalespersonUserId, c.BillEmp)) AS employeeId,
              COALESCE(salesUser.DisplayName, cx.SalespersonName, salesEmp.EmpName) AS employeeName
       FROM dbo.EMCust c WITH (NOLOCK) 
       LEFT JOIN wf.CustomerExt cx WITH (NOLOCK) ON cx.CustId = c.CustID
       LEFT JOIN wf.CreditMaster cm WITH (NOLOCK) ON cm.CustId = c.CustID
       LEFT JOIN wf.AppUser salesUser WITH (NOLOCK) ON salesUser.Id = cx.SalespersonUserId
       LEFT JOIN dbo.EMEmp salesEmp WITH (NOLOCK) ON salesEmp.EmpID = c.BillEmp
       LEFT JOIN dbo.EMSaleArea area WITH (NOLOCK) ON area.SaleAreaID = COALESCE(c.SaleAreaID, cx.SaleAreaId)
       LEFT JOIN wf.SaleRegion r WITH (NOLOCK) ON r.RegionCode = COALESCE(cx.RegionCode, SUBSTRING(area.SaleAreaCode, 1, 2))
       LEFT JOIN dbo.EMCustGroup cg WITH (NOLOCK) ON cg.CustGroupID = COALESCE(c.CustGroupID, cx.CustGroupId)
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.CustName`,
      inputs
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/customer-groups — ดึงรายชื่อกลุ่มลูกค้าพร้อมจำนวนลูกค้า
router.get('/customer-groups', async (req, res) => {
  try {
    const rows = await query(`
      SELECT g.CustGroupID, g.CustGroupCode, g.CustGroupName, g.CustGroupNameEng, g.Remark,
             COUNT(c.CustID) AS CustomerCount
      FROM dbo.EMCustGroup g WITH (NOLOCK)
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustGroupID = g.CustGroupID AND ISNULL(c.Inactive, 'A') <> 'I'
      GROUP BY g.CustGroupID, g.CustGroupCode, g.CustGroupName, g.CustGroupNameEng, g.Remark
      ORDER BY g.CustGroupID
    `);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/master/customer-groups — เพิ่มกลุ่มลูกค้าใหม่
router.post('/customer-groups', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { CustGroupCode, CustGroupName, CustGroupNameEng, Remark } = req.body || {};
    if (!CustGroupName || !String(CustGroupName).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อกลุ่มลูกค้า' });
    }
    const nameVal = String(CustGroupName).trim();
    // Auto-generate next CustGroupID and Code if not provided
    const maxRes = await query(`SELECT ISNULL(MAX(CustGroupID), 2000) + 1 AS NextID, COUNT(*) AS Total FROM dbo.EMCustGroup`);
    const nextId = Number(maxRes?.[0]?.NextID || 2001);
    const codeVal = CustGroupCode && String(CustGroupCode).trim()
      ? String(CustGroupCode).trim()
      : String(nextId % 1000).padStart(3, '0');

    await dboWrite(`
      INSERT INTO dbo.EMCustGroup (CustGroupID, CustGroupCode, CustGroupName, CustGroupNameEng, Remark)
      VALUES (@id, @code, @name, @nameEng, @remark)
    `, {
      id: { type: sql.Int, value: nextId },
      code: { type: sql.VarChar(20), value: codeVal },
      name: { type: sql.VarChar(100), value: nameVal },
      nameEng: { type: sql.VarChar(100), value: CustGroupNameEng || '' },
      remark: { type: sql.VarChar(255), value: Remark || null },
    });
    res.status(201).json({ ok: true, CustGroupID: nextId, CustGroupCode: codeVal, CustGroupName: nameVal });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/master/customer-groups/:id — แก้ไขกลุ่มลูกค้า
router.put('/customer-groups/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { CustGroupName, CustGroupNameEng, Remark } = req.body || {};
    if (!CustGroupName || !String(CustGroupName).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อกลุ่มลูกค้า' });
    }
    await dboWrite(`
      UPDATE dbo.EMCustGroup
      SET CustGroupName = @name,
          CustGroupNameEng = COALESCE(@nameEng, CustGroupNameEng),
          Remark = @remark
      WHERE CustGroupID = @id
    `, {
      id: { type: sql.Int, value: id },
      name: { type: sql.VarChar(100), value: String(CustGroupName).trim() },
      nameEng: { type: sql.VarChar(100), value: CustGroupNameEng !== undefined ? CustGroupNameEng : null },
      remark: { type: sql.VarChar(255), value: Remark || null },
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/master/customer-groups/:id — ลบกลุ่มลูกค้า (มี Safeguard ตรวจสอบว่าไม่มีลูกค้าผูกอยู่)
router.delete('/customer-groups/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const countRes = await query(`
      SELECT COUNT(*) AS Cnt FROM dbo.EMCust WHERE CustGroupID = @id AND ISNULL(Inactive, 'A') <> 'I'
    `, { id: { type: sql.Int, value: id } });
    const count = Number(countRes?.[0]?.Cnt || 0);
    if (count > 0) {
      return res.status(400).json({ message: `ไม่สามารถลบกลุ่มลูกค้านี้ได้ เนื่องจากมีลูกค้าผูกอยู่จำนวน ${count} ราย` });
    }
    await dboWrite(`DELETE FROM dbo.EMCustGroup WHERE CustGroupID = @id`, { id: { type: sql.Int, value: id } });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/customer-requests
router.get('/customer-requests', async (req, res) => {
  try {
    const allAccess = ['ADMIN', 'MANAGER'].includes(req.user?.role);
    const where = allAccess ? '' : 'WHERE cr.RequestedBy = @uid';
    const inputs = allAccess ? {} : { uid: { type: sql.Int, value: req.user.sub } };
    const rows = await query(`
      SELECT TOP 200
             cr.*,
             requester.DisplayName AS RequestedByName,
             reviewer.DisplayName AS ReviewedByName
      FROM wf.CustomerRequest cr
      LEFT JOIN wf.AppUser requester ON requester.Id = cr.RequestedBy
      LEFT JOIN wf.AppUser reviewer ON reviewer.Id = cr.ReviewedBy
      ${where}
      ORDER BY CASE WHEN cr.Status = 'PENDING' THEN 0 ELSE 1 END, cr.CreatedAt DESC
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/master/customer-requests — รองรับข้อมูลแบบครบถ้วนสอดคล้องกับหน้าแก้ไขลูกค้า
router.post('/customer-requests', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const {
      CustName, ContactName, Tel, Mobile, TaxId, Address, Note,
      SalespersonUserId, SalespersonName, RegionCode, CustGroupId, CustGroupName,
      Email, LineId, CreditLimit, AgingDays, CreditHold
    } = req.body || {};
    if (!CustName || !String(CustName).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อลูกค้า' });
    }

    // Resolve Salesperson Name if ID provided
    let spName = SalespersonName || null;
    let spId = SalespersonUserId ? Number(SalespersonUserId) : null;
    if (spId && !spName) {
      const uRes = await query(`SELECT DisplayName FROM wf.AppUser WHERE Id = @uid`, { uid: { type: sql.Int, value: spId } });
      spName = uRes?.[0]?.DisplayName || null;
    }

    // Resolve Customer Group Name if ID provided
    let grpName = CustGroupName || null;
    if (CustGroupId && !grpName) {
      const gRes = await query(`SELECT CustGroupName FROM dbo.EMCustGroup WHERE CustGroupID = @gid`, { gid: { type: sql.Int, value: Number(CustGroupId) } });
      grpName = gRes?.[0]?.CustGroupName || null;
    }

    const rows = await query(`
      INSERT INTO wf.CustomerRequest
        (CustName, ContactName, Tel, Mobile, TaxId, Address, Note, RequestedBy,
         SalespersonUserId, SalespersonName, RegionCode, CustGroupId, CustGroupName,
         Email, LineId, CreditLimit, AgingDays, CreditHold)
      OUTPUT inserted.Id
      VALUES
        (@custName, @contactName, @tel, @mobile, @taxId, @address, @note, @uid,
         @spUserId, @spName, @regionCode, @custGroupId, @custGroupName,
         @email, @lineId, @creditLimit, @agingDays, @creditHold)
    `, {
      custName: { type: sql.NVarChar(255), value: String(CustName).trim() },
      contactName: { type: sql.NVarChar(255), value: ContactName || null },
      tel: { type: sql.NVarChar(50), value: Tel || null },
      mobile: { type: sql.NVarChar(50), value: Mobile || null },
      taxId: { type: sql.NVarChar(50), value: TaxId || null },
      address: { type: sql.NVarChar(500), value: Address || null },
      note: { type: sql.NVarChar(500), value: Note || null },
      uid: { type: sql.Int, value: req.user.sub },
      spUserId: { type: sql.Int, value: spId },
      spName: { type: sql.NVarChar(100), value: spName },
      regionCode: { type: sql.NVarChar(20), value: RegionCode || null },
      custGroupId: { type: sql.NVarChar(50), value: CustGroupId ? String(CustGroupId) : null },
      custGroupName: { type: sql.NVarChar(100), value: grpName },
      email: { type: sql.NVarChar(100), value: Email || null },
      lineId: { type: sql.NVarChar(100), value: LineId || null },
      creditLimit: { type: sql.Decimal(18, 2), value: CreditLimit != null ? Number(CreditLimit) : 0 },
      agingDays: { type: sql.Int, value: parseNullableAgingInput(AgingDays) },
      creditHold: { type: sql.Bit, value: CreditHold ? 1 : 0 },
    });
    res.status(201).json({ id: rows[0]?.Id });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/master/customer-requests/:id/review — close request after Sale Admin/WINSpeed action
router.patch('/customer-requests/:id/review', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { status, winspeedCustId, reviewNote } = req.body || {};
    const nextStatus = String(status || '').toUpperCase();
    if (!['APPROVED', 'REJECTED', 'COMPLETED'].includes(nextStatus)) {
      return res.status(400).json({ message: 'สถานะไม่ถูกต้อง' });
    }
    const id = Number(req.params.id);

    // Fetch the request record first
    const reqRow = (await query(`SELECT * FROM wf.CustomerRequest WHERE Id = @id`, { id: { type: sql.Int, value: id } }))?.[0];
    if (!reqRow) return res.status(404).json({ message: 'ไม่พบคำขอนี้' });

    const finalWinspeedCustId = winspeedCustId || reqRow.WinspeedCustId;

    await query(`
      UPDATE wf.CustomerRequest
      SET Status = @status,
          WinspeedCustId = COALESCE(@winspeedCustId, WinspeedCustId),
          ReviewedBy = @uid,
          ReviewedAt = GETUTCDATE(),
          ReviewNote = @reviewNote,
          UpdatedAt = GETUTCDATE()
      WHERE Id = @id
    `, {
      id: { type: sql.Int, value: id },
      status: { type: sql.NVarChar(20), value: nextStatus },
      winspeedCustId: { type: sql.NVarChar(20), value: winspeedCustId || null },
      reviewNote: { type: sql.NVarChar(500), value: reviewNote || null },
      uid: { type: sql.Int, value: req.user.sub },
    });

    // If completed and has WINSpeed CustID, sync metadata into wf.CustomerExt and wf.CreditMaster
    if (nextStatus === 'COMPLETED' && finalWinspeedCustId) {
      try {
        await query(`
          IF EXISTS (SELECT 1 FROM wf.CustomerExt WHERE CustId = @custId)
            UPDATE wf.CustomerExt
            SET SalespersonUserId = COALESCE(@spUserId, SalespersonUserId),
                SalespersonName = COALESCE(@spName, SalespersonName),
                RegionCode = COALESCE(@regionCode, RegionCode),
                CustGroupId = COALESCE(@custGroupId, CustGroupId),
                Email = COALESCE(@email, Email),
                LineId = COALESCE(@lineId, LineId),
                CreditLimit = COALESCE(@creditLimit, CreditLimit),
                AgingDays = COALESCE(@agingDays, AgingDays),
                UpdatedAt = GETUTCDATE()
            WHERE CustId = @custId
          ELSE
            INSERT INTO wf.CustomerExt (CustId, SalespersonUserId, SalespersonName, RegionCode, CustGroupId, Email, LineId, CreditLimit, AgingDays, UpdatedAt)
            VALUES (@custId, @spUserId, @spName, @regionCode, @custGroupId, @email, @lineId, @creditLimit, @agingDays, GETUTCDATE());

          MERGE wf.CreditMaster AS t USING (SELECT @custId AS CustId) AS s ON t.CustId = s.CustId
          WHEN MATCHED THEN UPDATE SET
            CreditLimit = COALESCE(@creditLimit, t.CreditLimit),
            AgingDays = COALESCE(@agingDays, t.AgingDays),
            CreditHold = COALESCE(@creditHold, t.CreditHold),
            UpdatedBy = @uid,
            UpdatedAt = GETUTCDATE()
          WHEN NOT MATCHED THEN INSERT (CustId, CustName, CreditLimit, AgingDays, CreditHold, UpdatedBy, UpdatedAt)
            VALUES (@custId, @custName, @creditLimit, @agingDays, ISNULL(@creditHold, 0), @uid, GETUTCDATE());
        `, {
          custId: { type: sql.NVarChar(20), value: String(finalWinspeedCustId) },
          custName: { type: sql.NVarChar(200), value: reqRow.CustName },
          spUserId: { type: sql.Int, value: reqRow.SalespersonUserId || null },
          spName: { type: sql.NVarChar(100), value: reqRow.SalespersonName || null },
          regionCode: { type: sql.NVarChar(20), value: reqRow.RegionCode || null },
          custGroupId: { type: sql.NVarChar(50), value: reqRow.CustGroupId || null },
          email: { type: sql.NVarChar(100), value: reqRow.Email || null },
          lineId: { type: sql.NVarChar(100), value: reqRow.LineId || null },
          creditLimit: { type: sql.Decimal(18, 2), value: reqRow.CreditLimit != null ? Number(reqRow.CreditLimit) : null },
          agingDays: { type: sql.Int, value: parseNullableAgingInput(reqRow.AgingDays) },
          creditHold: { type: sql.Bit, value: reqRow.CreditHold ? 1 : 0 },
          uid: { type: sql.Int, value: req.user.sub },
        });
      } catch (syncErr) {
        console.warn('[customer-request:review-sync-warning]', syncErr?.message);
      }
    }

    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/master/customers/:id
router.patch('/customers/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    const {
      CustName,
      Tel,
      PrimaryPhone,
      Mobile,
      SecondaryPhone,
      Email,
      LineId,
      Remark,
      CreditLimit,
      AgingDays,
      CreditHold,
      salespersonId,
      areaId,
      groupId,
      employeeId,
    } = req.body;
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสลูกค้านี้' });
    if (CustName !== undefined && CustName !== null && !String(CustName).trim()) {
      return res.status(400).json({ message: 'ชื่อลูกค้าต้องไม่ว่าง' });
    }

    const primaryPhoneVal = PrimaryPhone !== undefined ? PrimaryPhone : Tel;
    const secondaryPhoneVal = SecondaryPhone !== undefined ? SecondaryPhone : Mobile;

    // 1. Update ERP
    const __rows = (await hasMasterProcs())
      ? affectedOf(await execMasterProc('wf.sp_MasterUpdateCustomer', {
          CustID: { type: sql.VarChar(20), value: id },
          CustName: { type: sql.NVarChar(255), value: CustName ?? null },
          Tel: { type: sql.NVarChar(50), value: primaryPhoneVal ?? null },
          Mobile: { type: sql.NVarChar(50), value: secondaryPhoneVal ?? null },
        }, AFFECTED_OUT))
      : await dboWrite(`
      UPDATE dbo.EMCust 
      SET CustName = COALESCE(@name, CustName), 
          ContTel = COALESCE(@tel, ContTel),
          ContTel1 = COALESCE(@mob, ContTel1)
      WHERE CustID = @id
    `, {
      name: { type: sql.NVarChar(255), value: CustName },
      tel: { type: sql.NVarChar(50), value: primaryPhoneVal },
      mob: { type: sql.NVarChar(50), value: secondaryPhoneVal },
      id: { type: sql.VarChar(20), value: id }
    });

    // Lookup area and region (supports both 2-character RegionCode and numeric SaleAreaID)
    let regionCodeVal = null;
    let resolvedAreaId = null;
    if (areaId) {
      const areaStr = String(areaId).trim();
      const rRes = await query(`SELECT RegionCode, RegionName FROM wf.SaleRegion WHERE RegionCode = @rCode`, { rCode: { type: sql.NVarChar(20), value: areaStr } });
      if (rRes?.[0]?.RegionCode) {
        regionCodeVal = rRes[0].RegionCode;
        const aRes = await query(`SELECT TOP 1 SaleAreaID FROM dbo.EMSaleArea WHERE SaleAreaCode LIKE @pfx + '%' ORDER BY SaleAreaCode`, { pfx: { type: sql.VarChar(10), value: regionCodeVal } });
        resolvedAreaId = aRes?.[0]?.SaleAreaID ? Number(aRes[0].SaleAreaID) : null;
      } else {
        const aRes = await query(`SELECT SaleAreaID, SaleAreaCode FROM dbo.EMSaleArea WHERE SaleAreaID = @aid`, { aid: { type: sql.Int, value: Number(areaStr) } });
        if (aRes?.[0]?.SaleAreaCode) {
          regionCodeVal = String(aRes[0].SaleAreaCode).substring(0, 2);
          resolvedAreaId = Number(aRes[0].SaleAreaID);
        }
      }
    }

    // 1b. Update optional ERP classifications if columns exist in dbo.EMCust
    const updateClauses = [];
    const updateInputs = { id: { type: sql.VarChar(20), value: id } };
    if (areaId !== undefined) {
      updateClauses.push('SaleAreaID = @areaId');
      updateInputs.areaId = { type: sql.Int, value: resolvedAreaId };
    }
    if (groupId !== undefined) {
      updateClauses.push('CustGroupID = @groupId');
      updateInputs.groupId = { type: sql.Int, value: groupId ? Number(groupId) : null };
    }
    if (employeeId !== undefined || salespersonId !== undefined) {
      const spIdVal = salespersonId !== undefined ? salespersonId : employeeId;
      updateClauses.push('BillEmp = @billEmp');
      updateInputs.billEmp = { type: sql.Int, value: spIdVal ? Number(spIdVal) : null };
    }
    if (updateClauses.length > 0) {
      try {
        await dboWrite(`
          UPDATE dbo.EMCust 
          SET ${updateClauses.join(', ')}
          WHERE CustID = @id
        `, updateInputs);
      } catch (err) {
        console.warn('[master/customers:update-ext-cols-warning]', err?.message);
      }
    }

    // Lookup salesperson user info if salespersonId provided
    const spId = salespersonId !== undefined ? salespersonId : employeeId;
    let spUser = null;
    if (spId) {
      const uRes = await query(`SELECT Id, DisplayName FROM wf.AppUser WHERE Id = @uid`, { uid: { type: sql.Int, value: Number(spId) } });
      spUser = uRes?.[0] || null;
    }
    
    // 2. Update wf.CustomerExt with portal contacts, salesperson, area, and credit/aging
    const hasExtUpdates = Remark !== undefined || PrimaryPhone !== undefined || Tel !== undefined
      || SecondaryPhone !== undefined || Mobile !== undefined || Email !== undefined
      || LineId !== undefined || CreditLimit !== undefined || AgingDays !== undefined
      || salespersonId !== undefined || employeeId !== undefined || areaId !== undefined || groupId !== undefined;

    if (hasExtUpdates) {
      await query(`
        IF EXISTS (SELECT 1 FROM wf.CustomerExt WHERE CustId = @id)
          UPDATE wf.CustomerExt 
          SET Remark = CASE WHEN @hasRemark = 1 THEN @remark ELSE Remark END,
              PrimaryPhone = CASE WHEN @hasPrimaryPhone = 1 THEN @primaryPhone ELSE PrimaryPhone END,
              SecondaryPhone = CASE WHEN @hasSecondaryPhone = 1 THEN @secondaryPhone ELSE SecondaryPhone END,
              Email = CASE WHEN @hasEmail = 1 THEN @email ELSE Email END,
              LineId = CASE WHEN @hasLineId = 1 THEN @lineId ELSE LineId END,
              CreditLimit = CASE WHEN @hasCreditLimit = 1 THEN @creditLimit ELSE CreditLimit END,
              AgingDays = CASE WHEN @hasAgingDays = 1 THEN @agingDays ELSE AgingDays END,
              SalespersonUserId = CASE WHEN @hasSp = 1 THEN @spUserId ELSE SalespersonUserId END,
              SalespersonName = CASE WHEN @hasSp = 1 THEN @spName ELSE SalespersonName END,
              SaleAreaId = CASE WHEN @hasArea = 1 THEN @areaIdStr ELSE SaleAreaId END,
              RegionCode = CASE WHEN @hasArea = 1 THEN @regionCode ELSE RegionCode END,
              CustGroupId = CASE WHEN @hasGroup = 1 THEN @groupIdStr ELSE CustGroupId END,
              UpdatedAt = GETUTCDATE()
          WHERE CustId = @id
        ELSE
          INSERT INTO wf.CustomerExt (CustId, Remark, PrimaryPhone, SecondaryPhone, Email, LineId, CreditLimit, AgingDays, SalespersonUserId, SalespersonName, SaleAreaId, RegionCode, CustGroupId, UpdatedAt)
          VALUES (@id, @remark, @primaryPhone, @secondaryPhone, @email, @lineId, @creditLimit, @agingDays, @spUserId, @spName, @areaIdStr, @regionCode, @groupIdStr, GETUTCDATE())
      `, {
        id: { type: sql.VarChar(20), value: id },
        remark: { type: sql.NVarChar(500), value: Remark ?? null },
        hasRemark: { type: sql.Bit, value: Remark !== undefined ? 1 : 0 },
        primaryPhone: { type: sql.NVarChar(50), value: primaryPhoneVal ?? null },
        hasPrimaryPhone: { type: sql.Bit, value: (PrimaryPhone !== undefined || Tel !== undefined) ? 1 : 0 },
        secondaryPhone: { type: sql.NVarChar(255), value: secondaryPhoneVal ?? null },
        hasSecondaryPhone: { type: sql.Bit, value: (SecondaryPhone !== undefined || Mobile !== undefined) ? 1 : 0 },
        email: { type: sql.NVarChar(255), value: Email ?? null },
        hasEmail: { type: sql.Bit, value: Email !== undefined ? 1 : 0 },
        lineId: { type: sql.NVarChar(100), value: LineId ?? null },
        hasLineId: { type: sql.Bit, value: LineId !== undefined ? 1 : 0 },
        creditLimit: { type: sql.Decimal(18, 2), value: CreditLimit != null ? Number(CreditLimit) : null },
        hasCreditLimit: { type: sql.Bit, value: CreditLimit !== undefined ? 1 : 0 },
        agingDays: { type: sql.Int, value: parseNullableAgingInput(AgingDays) },
        hasAgingDays: { type: sql.Bit, value: AgingDays !== undefined ? 1 : 0 },
        spUserId: { type: sql.Int, value: spUser?.Id ? Number(spUser.Id) : (spId ? Number(spId) : null) },
        spName: { type: sql.NVarChar(100), value: spUser?.DisplayName || null },
        hasSp: { type: sql.Bit, value: (salespersonId !== undefined || employeeId !== undefined) ? 1 : 0 },
        areaIdStr: { type: sql.VarChar(20), value: areaId ? String(areaId) : null },
        regionCode: { type: sql.NVarChar(10), value: regionCodeVal },
        hasArea: { type: sql.Bit, value: areaId !== undefined ? 1 : 0 },
        groupIdStr: { type: sql.VarChar(20), value: groupId ? String(groupId) : null },
        hasGroup: { type: sql.Bit, value: groupId !== undefined ? 1 : 0 },
      });
    }

    // 3. Keep wf.CreditMaster synchronized if credit fields changed
    if (CreditLimit !== undefined || AgingDays !== undefined || CreditHold !== undefined || CustName !== undefined) {
      await query(`
        MERGE wf.CreditMaster AS t USING (SELECT @id AS CustId) AS s ON t.CustId = s.CustId
        WHEN MATCHED THEN UPDATE SET
          CustName = COALESCE(@custName, CustName),
          CreditLimit = CASE WHEN @hasCreditLimit = 1 THEN @creditLimit ELSE CreditLimit END,
          AgingDays = CASE WHEN @hasAgingDays = 1 THEN @agingDays ELSE AgingDays END,
          CreditHold = CASE WHEN @hasCreditHold = 1 THEN @creditHold ELSE CreditHold END,
          UpdatedBy = @uid,
          UpdatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (CustId, CustName, CreditLimit, AgingDays, CreditHold, UpdatedBy, UpdatedAt)
          VALUES (@id, @custName, @creditLimit, @agingDays, ISNULL(@creditHold, 0), @uid, GETUTCDATE());
      `, {
        id: { type: sql.NVarChar(20), value: String(id) },
        custName: { type: sql.NVarChar(200), value: CustName || null },
        creditLimit: { type: sql.Decimal(18, 2), value: CreditLimit != null ? Number(CreditLimit) : null },
        hasCreditLimit: { type: sql.Bit, value: CreditLimit !== undefined ? 1 : 0 },
        agingDays: { type: sql.Int, value: parseNullableAgingInput(AgingDays) },
        hasAgingDays: { type: sql.Bit, value: AgingDays !== undefined ? 1 : 0 },
        creditHold: { type: sql.Bit, value: CreditHold ? 1 : 0 },
        hasCreditHold: { type: sql.Bit, value: CreditHold !== undefined ? 1 : 0 },
        uid: { type: sql.Int, value: req.user?.sub || null },
      });
    }
    
    if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบรหัสลูกค้านี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message }); }
});

// DELETE /api/master/customers/:id (Soft Delete)
router.delete('/customers/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสลูกค้านี้' });
    const __rows = (await hasMasterProcs())
      ? affectedOf(await execMasterProc('wf.sp_MasterSetCustomerInactive', { CustID: { type: sql.VarChar(20), value: id } }, AFFECTED_OUT))
      : await dboWrite(`UPDATE dbo.EMCust SET Inactive = 'I', InactiveDate = GETDATE() WHERE CustID = @id`, {
        id: { type: sql.VarChar(20), value: id }
      });
    if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบรหัสลูกค้านี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message }); }
});

// POST /api/master/customers/batch-edit — แก้ไขข้อมูลลูกค้าแบบชุด (เซลล์ผู้ดูแล, เขตการขาย, กลุ่มลูกค้า, ระงับเครดิต/ปิดใช้งาน)
router.post('/customers/batch-edit', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { custIds, salespersonUserId, areaId, groupId, creditHold, inactive } = req.body || {};
    if (!Array.isArray(custIds) || custIds.length === 0) {
      return res.status(400).json({ message: 'ต้องระบุรายการลูกค้า (custIds)' });
    }
    const cleanCustIds = custIds.map(String).filter(isMasterId);
    if (cleanCustIds.length === 0) {
      return res.status(400).json({ message: 'ไม่พบรหัสลูกค้าที่ถูกต้อง' });
    }

    // Lookup salesperson if provided
    let spUser = null;
    if (salespersonUserId) {
      const uRes = await query(`SELECT Id, DisplayName FROM wf.AppUser WHERE Id = @uid`, { uid: { type: sql.Int, value: Number(salespersonUserId) } });
      spUser = uRes?.[0] || null;
    }

    // Lookup area and region if provided (supports both 2-char RegionCode and SaleAreaID)
    let regionCodeVal = null;
    let resolvedAreaId = null;
    if (areaId) {
      const areaStr = String(areaId).trim();
      const rRes = await query(`SELECT RegionCode, RegionName FROM wf.SaleRegion WHERE RegionCode = @rCode`, { rCode: { type: sql.NVarChar(20), value: areaStr } });
      if (rRes?.[0]?.RegionCode) {
        regionCodeVal = rRes[0].RegionCode;
        const aRes = await query(`SELECT TOP 1 SaleAreaID FROM dbo.EMSaleArea WHERE SaleAreaCode LIKE @pfx + '%' ORDER BY SaleAreaCode`, { pfx: { type: sql.VarChar(10), value: regionCodeVal } });
        resolvedAreaId = aRes?.[0]?.SaleAreaID ? Number(aRes[0].SaleAreaID) : null;
      } else {
        const aRes = await query(`SELECT SaleAreaID, SaleAreaCode FROM dbo.EMSaleArea WHERE SaleAreaID = @aid`, { aid: { type: sql.Int, value: Number(areaStr) } });
        if (aRes?.[0]?.SaleAreaCode) {
          regionCodeVal = String(aRes[0].SaleAreaCode).substring(0, 2);
          resolvedAreaId = Number(aRes[0].SaleAreaID);
        }
      }
    }

    const hasSp = salespersonUserId !== undefined;
    const hasArea = areaId !== undefined;
    const hasGroup = groupId !== undefined;
    const hasCreditHold = creditHold !== undefined;
    const hasInactive = inactive !== undefined;

    const uid = req.user?.sub || null;

    // Process all customers
    for (const custId of cleanCustIds) {
      // 1. Update dbo.EMCust if area, group, billEmp, or inactive provided
      const emCustSets = [];
      const emCustInputs = { id: { type: sql.VarChar(20), value: custId } };
      if (hasArea && resolvedAreaId !== null) {
        emCustSets.push('SaleAreaID = @areaId');
        emCustInputs.areaId = { type: sql.Int, value: resolvedAreaId };
      }
      if (hasGroup) {
        emCustSets.push('CustGroupID = @groupId');
        emCustInputs.groupId = { type: sql.Int, value: groupId ? Number(groupId) : null };
      }
      if (hasSp) {
        emCustSets.push('BillEmp = @billEmp');
        emCustInputs.billEmp = { type: sql.Int, value: spUser?.Id ? Number(spUser.Id) : (salespersonUserId ? Number(salespersonUserId) : null) };
      }
      if (hasInactive) {
        emCustSets.push("Inactive = @inactive, InactiveDate = CASE WHEN @inactive = 'I' THEN GETDATE() ELSE NULL END");
        emCustInputs.inactive = { type: sql.VarChar(1), value: inactive ? 'I' : 'A' };
      }
      if (emCustSets.length > 0) {
        try {
          await dboWrite(`UPDATE dbo.EMCust SET ${emCustSets.join(', ')} WHERE CustID = @id`, emCustInputs);
        } catch (err) {
          console.warn('[master/customers:batch-emcust-warning]', err?.message);
        }
      }

      // 2. Update wf.CustomerExt
      if (hasSp || hasArea || hasGroup) {
        await query(`
          IF EXISTS (SELECT 1 FROM wf.CustomerExt WHERE CustId = @id)
            UPDATE wf.CustomerExt 
            SET SalespersonUserId = CASE WHEN @hasSp = 1 THEN @spUserId ELSE SalespersonUserId END,
                SalespersonName = CASE WHEN @hasSp = 1 THEN @spName ELSE SalespersonName END,
                SaleAreaId = CASE WHEN @hasArea = 1 THEN @areaIdStr ELSE SaleAreaId END,
                RegionCode = CASE WHEN @hasArea = 1 THEN @regionCode ELSE RegionCode END,
                CustGroupId = CASE WHEN @hasGroup = 1 THEN @groupIdStr ELSE CustGroupId END,
                UpdatedAt = GETUTCDATE()
            WHERE CustId = @id
          ELSE
            INSERT INTO wf.CustomerExt (CustId, SalespersonUserId, SalespersonName, SaleAreaId, RegionCode, CustGroupId, UpdatedAt)
            VALUES (@id, @spUserId, @spName, @areaIdStr, @regionCode, @groupIdStr, GETUTCDATE())
        `, {
          id: { type: sql.VarChar(20), value: custId },
          spUserId: { type: sql.Int, value: spUser?.Id ? Number(spUser.Id) : (salespersonUserId ? Number(salespersonUserId) : null) },
          spName: { type: sql.NVarChar(100), value: spUser?.DisplayName || null },
          hasSp: { type: sql.Bit, value: hasSp ? 1 : 0 },
          areaIdStr: { type: sql.VarChar(20), value: areaId ? String(areaId) : null },
          regionCode: { type: sql.NVarChar(10), value: regionCodeVal },
          hasArea: { type: sql.Bit, value: hasArea ? 1 : 0 },
          groupIdStr: { type: sql.VarChar(20), value: groupId ? String(groupId) : null },
          hasGroup: { type: sql.Bit, value: hasGroup ? 1 : 0 },
        });
      }

      // 3. Update wf.CreditMaster if creditHold provided
      if (hasCreditHold) {
        await query(`
          MERGE wf.CreditMaster AS t USING (SELECT @id AS CustId) AS s ON t.CustId = s.CustId
          WHEN MATCHED THEN UPDATE SET CreditHold = @creditHold, UpdatedBy = @uid, UpdatedAt = GETUTCDATE()
          WHEN NOT MATCHED THEN INSERT (CustId, CreditHold, CreditLimit, AgingDays, UpdatedBy, UpdatedAt)
            VALUES (@id, @creditHold, NULL, NULL, @uid, GETUTCDATE());
        `, {
          id: { type: sql.NVarChar(20), value: custId },
          creditHold: { type: sql.Bit, value: creditHold ? 1 : 0 },
          uid: { type: sql.Int, value: uid },
        });
      }
    }

    res.json({ ok: true, count: cleanCustIds.length, message: `อัปเดตข้อมูลลูกค้า ${cleanCustIds.length} รายสำเร็จ` });
  } catch (e) {
    console.error('[master/customers:batch-edit]', e);
    res.status(500).json({ message: 'บันทึกการแก้ไขแบบชุดไม่สำเร็จ: ' + (e?.message || '') });
  }
});

// GET /api/master/goods — ดึงสินค้า (รองรับการกรองตามกลุ่มสินค้า, forSale, และสถานะงดจำหน่าย)
router.get('/goods', async (req, res) => {
  try {
    const { q, forSale, groupId, includeInactive, excludeGiveaways = 'true', limit = 800 } = req.query;
    const safeLimit = Math.max(50, Math.min(Number(limit) || 800, 2000));
    let extraFilter = '';
    const inputs = {
      limit: { type: sql.Int, value: safeLimit },
      ...(q ? { q: { type: sql.NVarChar(100), value: q } } : {}),
    };
    if (q) {
      extraFilter += ` AND (g.GoodCode LIKE N'%' + @q + '%' OR g.GoodName1 LIKE N'%' + @q + '%' OR g.GoodID = @q)`;
    }
    if (forSale === 'true') {
      // สำหรับการเปิดบิลขาย: เฉพาะปุ๋ยสูตร (1003) และแม่ปุ๋ย (1004)
      extraFilter += ` AND g.GoodGroupID IN (1003, 1004)`;
    } else if (groupId) {
      extraFilter += ` AND g.GoodGroupID = @groupId`;
      inputs.groupId = { type: sql.Int, value: Number(groupId) };
    }
    // ควบรวมของแถม: ไม่แสดงกลุ่มส่งเสริมการขาย (GoodGroupID=1005) ในหน้ารายการสินค้าทั่วไป (ให้ดูแลในแท็บของแถมแทน)
    if (excludeGiveaways === 'true') {
      extraFilter += ` AND ISNULL(g.GoodGroupID, 0) <> 1005`;
    }
    const inactiveFilter = includeInactive === 'true'
      ? ''
      : ` AND ISNULL(g.Inactive, 'A') = 'A'`;

    const rows = await query(`
      SELECT TOP (@limit)
             g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             ISNULL(gx.BagPerTon, 20)         AS BagPerTon,
             ISNULL(gx.WeightKgPerBag, 50.0)  AS WeightKgPerBag,
             g.GoodGroupID,
             COALESCE(gg.GoodGroupName, N'ไม่ระบุกลุ่ม') AS GoodGroupName,
             0                                AS SetPrice,
             g.StockQty,
             g.RemaQty,
             gx.ImageUrl,
             ISNULL(g.Inactive, 'A')          AS Inactive,
             CAST(0 AS DECIMAL(18,3)) AS TotalQtyTon,
             CAST(0 AS DECIMAL(18,3)) AS TotalQtyTonThisYear
      FROM dbo.EMGood g WITH (NOLOCK)
      LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON g.GoodGroupID = gg.GoodGroupID
      WHERE 1=1
        ${inactiveFilter}
        AND g.GoodName1 NOT LIKE N'%ไม่ใช้%' AND g.GoodName1 NOT LIKE N'%ยกเลิก%'
        ${extraFilter}
      ORDER BY g.GoodCode
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/transports - WINSpeed transport master for SOHD.TranspID
router.get('/transports', async (req, res) => {
  try {
    const { q, limit = 300 } = req.query;
    const safeLimit = Math.max(20, Math.min(Number(limit) || 300, 1000));
    const whereClause = q
      ? `WHERE (TranspCode LIKE N'%' + @q + '%' OR TranspName LIKE N'%' + @q + '%' OR Remark LIKE N'%' + @q + '%')`
      : '';
    const rows = await query(`
      SELECT TOP (@limit)
             TranspID,
             TranspCode,
             TranspName,
             Remark
      FROM dbo.EMTransp WITH (NOLOCK)
      ${whereClause}
      ORDER BY TranspName, TranspCode, TranspID
    `, {
      limit: { type: sql.Int, value: safeLimit },
      ...(q ? { q: { type: sql.NVarChar(100), value: q } } : {}),
    });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/master/goods/:id
router.patch('/goods/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    const { GoodName, BagPerTon, WeightKgPerBag, ImageUrl } = req.body || {};
    if (GoodName === undefined && BagPerTon === undefined && WeightKgPerBag === undefined && ImageUrl === undefined) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลที่ต้องแก้ไข' });
    }
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    if (GoodName !== undefined && GoodName !== null && !String(GoodName).trim()) {
      return res.status(400).json({ message: 'ชื่อสินค้าต้องไม่ว่าง' });
    }

    let __rows = null;
    if (GoodName !== undefined) {
      __rows = (await hasMasterProcs())
        ? affectedOf(await execMasterProc('wf.sp_MasterUpdateGoodName', {
            GoodID: { type: sql.VarChar(20), value: id },
            GoodName: { type: sql.NVarChar(255), value: GoodName },
          }, AFFECTED_OUT))
        : await dboWrite(`UPDATE dbo.EMGood SET GoodName1 = @name WHERE GoodID = @id`, {
          name: { type: sql.NVarChar(255), value: GoodName },
          id: { type: sql.VarChar(20), value: id }
        });
      if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    }
    
    if (BagPerTon !== undefined || WeightKgPerBag !== undefined || ImageUrl !== undefined) {
      if (!__rows) {
        const check = await query(`SELECT 1 FROM dbo.EMGood WITH (NOLOCK) WHERE GoodID = @id`, { id: { type: sql.VarChar(20), value: id } });
        if (!check || check.length === 0) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
      }
      await query(`
        IF EXISTS (SELECT 1 FROM wf.GoodExtra WHERE GoodId = @id)
          UPDATE wf.GoodExtra SET 
            BagPerTon = COALESCE(@bpt, BagPerTon),
            WeightKgPerBag = COALESCE(@kgb, WeightKgPerBag),
            ImageUrl = COALESCE(@img, ImageUrl)
          WHERE GoodId = @id
        ELSE
          INSERT INTO wf.GoodExtra (GoodId, BagPerTon, WeightKgPerBag, ImageUrl)
          VALUES (@id, ISNULL(@bpt, 20), ISNULL(@kgb, 50.0), @img)
      `, {
        bpt: { type: sql.Int, value: BagPerTon },
        kgb: { type: sql.Decimal(10,4), value: WeightKgPerBag },
        img: { type: sql.NVarChar(1000), value: ImageUrl },
        id: { type: sql.VarChar(20), value: id }
      });
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message }); }
});

// DELETE /api/master/goods/:id (Soft Delete)
router.delete('/goods/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    const __rows = (await hasMasterProcs())
      ? affectedOf(await execMasterProc('wf.sp_MasterSetGoodInactive', { GoodID: { type: sql.VarChar(20), value: id } }, AFFECTED_OUT))
      : await dboWrite(`UPDATE dbo.EMGood SET Inactive = 'I', InactiveDate = GETDATE() WHERE GoodID = @id`, {
        id: { type: sql.VarChar(20), value: id }
      });
    if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message }); }
});

// PATCH /api/master/goods/:id/status — เปิดจำหน่าย ('A') หรือ งดจำหน่ายชั่วคราว ('I')
router.patch('/goods/:id/status', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    const { inactive } = req.body || {};
    const statusVal = String(inactive || 'I').toUpperCase() === 'A' ? 'A' : 'I';
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    
    const __rows = await dboWrite(
      `UPDATE dbo.EMGood 
       SET Inactive = @status, 
           InactiveDate = CASE WHEN @status = 'I' THEN GETDATE() ELSE NULL END 
       WHERE GoodID = @id`,
      {
        status: { type: sql.VarChar(1), value: statusVal },
        id: { type: sql.VarChar(20), value: id }
      }
    );
    if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    res.json({ ok: true, status: statusVal });
  } catch (e) { console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message }); }
});

// GET /api/master/giveaway-goods — ของแถม (ดึงรายการที่ถูก Map หรือมี GoodGroupName='ของแถม' หรือรหัสของแถม)
router.get('/giveaway-goods', async (req, res) => {
  try {
    const { wfQuery } = require('../db');
    const { matchGiveawayItem, findMatchingQuota } = require('../services/giveaway-matcher');
    const { loadQuotaRows, committedOnOpenDrafts, quotaKey } = require('../services/giveaway-quota');
    const targetUserId = req.query.salesUserId ? Number(req.query.salesUserId) : req.user.sub;
    const excludeSoId = req.query.excludeSoId ? String(req.query.excludeSoId) : null;
    const { canViewSalesUser } = require('../services/visible-scope');
    if (!(await canViewSalesUser(req.user, targetUserId))) {
      return res.status(403).json({ message: 'ดูโควต้าของพนักงานขายคนอื่นได้เฉพาะคนในทีม' });
    }

    // สินค้าของแถมจาก WINSpeed GoodGroupID = 1005 (ส่งเสริมการขาย)
    const goods = await query(`
      SELECT g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             CASE 
               WHEN g.GoodName1 LIKE N'%ตรารถเกษตร%' OR g.GoodName1 LIKE N'%รถเกษตร%' THEN N'ตรารถเกษตร'
               WHEN g.GoodName1 LIKE N'%ตราปุ๋ยเทพ%' OR g.GoodName1 LIKE N'%ปุ๋ยเทพ%' THEN N'ตราปุ๋ยเทพ'
               ELSE COALESCE(m.Brand, N'ส่วนกลาง')
             END AS MapBrand,
             COALESCE(m.ItemName, g.GoodName1) AS MapItem,
             u.GoodUnitName AS UnitName
      FROM dbo.EMGood g WITH (NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 mm.Brand, mm.ItemName
        FROM wf.GiveawayItemMapping mm WITH (NOLOCK)
        WHERE mm.GoodID = g.GoodID AND ISNUMERIC(mm.Brand) = 0 AND mm.ItemName NOT IN (N'รถเกษตร', N'ปุ๋ยเทพ')
        ORDER BY mm.Id
      ) m
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON g.GoodGroupID = gg.GoodGroupID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON g.MainGoodUnitID = u.GoodUnitID
      WHERE (g.GoodGroupID = 1005 OR gg.GoodGroupName = N'ส่งเสริมการขาย' OR gg.GoodGroupName = N'ของแถม' OR m.Brand IS NOT NULL)
        AND ISNULL(g.Inactive, 'A') = 'A'
        AND g.GoodName1 NOT LIKE N'%ไม่ใช้%' AND g.GoodName1 NOT LIKE N'%ยกเลิก%'
      ORDER BY g.GoodCode ASC
    `);

    // R11 U-7/U-8: โควต้าคงเหลือจริงด้วยตัวจับคู่เดียวกับที่เซิร์ฟเวอร์ใช้ตรวจตอนบันทึก/อนุมัติ
    // = งบคงเหลือ − ชิ้นที่ใส่ไว้ในบิลร่างอื่นของผู้ขายคนนี้
    const quotaRows = await loadQuotaRows(wfQuery, targetUserId);
    const committed = await committedOnOpenDrafts(wfQuery, targetUserId, quotaRows, excludeSoId);
    const rows = goods.map(g => {
      const d = { goodId: g.GoodID, goodName: g.GoodName, brand: g.MapBrand, itemName: g.MapItem };
      const q = findMatchingQuota(d, quotaRows);
      const matched = matchGiveawayItem(d);
      return {
        GoodID: g.GoodID,
        GoodCode: g.GoodCode,
        GoodName: g.GoodName,
        Brand: q?.Brand || matched.brand,
        ItemName: q?.ItemName || matched.itemName,
        UnitName: g.UnitName,
        Region: q?.Region || null,
        QuotaMatched: Boolean(q),
        BudgetQty: q ? Number(q.BudgetQty || 0) : 0,
        RemainingQty: q ? Number(q.RemainingQty || 0) - (committed.get(quotaKey(q)) || 0) : 0,
      };
    }).sort((a, b) => String(a.Brand).localeCompare(String(b.Brand), 'th') || String(a.GoodName).localeCompare(String(b.GoodName), 'th'));
    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/master/employees — พนักงาน WINSpeed (EMEmp) สำหรับ map EmpId
router.get('/employees', async (req, res) => {
  try {
    const rows = await query(`
      SELECT EmpID, EmpCode, EmpName, EmpNameEng,
             CASE WHEN EmpResignDate IS NULL THEN 1 ELSE 0 END AS IsActive
      FROM dbo.EMEmp WITH (NOLOCK)
      ORDER BY EmpCode
    `);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/prices — ราคา NET ล่าสุดที่มีผล (ต่อสินค้า)
// เลือกราคาที่ดีที่สุด: ลูกค้าเฉพาะก่อน → ราคากลาง (CustID NULL), เอา list ล่าสุด (BeginDate <= targetDate)
// FR-2: รองรับ asOf=YYYY-MM-DD เพื่อค้นหาราคาประกาศที่มีผล ณ วันที่ระบุ (เทียบเท่า resolveAuthoritativePrice)
// R10.7-5: ใช้วันที่กรุงเทพ (Bangkok Date) เป็นค่าเริ่มต้นเมื่อไม่ระบุ asOf
router.get('/prices', async (req, res) => {
  try {
    const { custId, goodId, includeExpired, asOf } = req.query;
    const targetDate = asOf ? String(asOf).slice(0, 10) : getBangkokDateString();
    const inputs = {
      custId: { type: sql.NVarChar(20), value: custId || null },
      targetDate: { type: sql.Date, value: targetDate },
    };
    let goodFilter = '';
    if (goodId) {
      goodFilter = `AND (dt.ListID = @goodId OR g.GoodCode = @goodId)`;
      inputs.goodId = { type: sql.NVarChar(50), value: String(goodId).trim() };
    }
    const dateFilter = includeExpired === 'true'
      ? ''
      : 'AND hd.BeginDate <= @targetDate AND (hd.EndDate IS NULL OR hd.EndDate >= @targetDate)';

    const rows = await query(`
      ;WITH ranked AS (
        SELECT dt.SetPriceID, dt.ListNo, dt.ListID AS GoodID, g.GoodCode, dt.GoodPriceNet, hd.CustID, hd.BeginDate, hd.EndDate,
               dt.startgoodqty, dt.endgoodqty,
               ROW_NUMBER() OVER (
                 PARTITION BY dt.ListID
                 ORDER BY CASE WHEN hd.CustID = @custId THEN 0 ELSE 1 END,
                          CASE WHEN hd.BeginDate <= @targetDate AND (hd.EndDate IS NULL OR hd.EndDate >= @targetDate) THEN 0 ELSE 1 END,
                          hd.BeginDate DESC, dt.startgoodqty ASC
               ) AS rn
        FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
        JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
        WHERE dt.GoodPriceNet > 0
          AND (hd.CustID = @custId OR hd.CustID IS NULL)
          ${dateFilter}
          ${goodFilter}
      )
      SELECT SetPriceID, ListNo, GoodID, GoodCode, GoodPriceNet, CustID, BeginDate, EndDate, startgoodqty, endgoodqty,
             CASE WHEN EndDate < @targetDate THEN 1 ELSE 0 END AS IsExpired
      FROM ranked WHERE rn <= 5
      ORDER BY GoodID
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/master/prices — แก้ไขราคาและวันที่ (อัปเดตตรงเข้า ERP)
router.patch('/prices', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { SetPriceID, ListNo, GoodPriceNet, BeginDate, EndDate } = req.body;
    if (!SetPriceID || !ListNo) return res.status(400).json({ message: 'Missing SetPriceID or ListNo' });
    if (!(Number(GoodPriceNet) > 0)) return res.status(400).json({ message: 'ราคาต้องมากกว่า 0 (GoodPriceNet > 0)' });
    if (BeginDate && EndDate && String(BeginDate).slice(0, 10) > String(EndDate).slice(0, 10)) {
      return res.status(400).json({ message: 'BeginDate ต้องน้อยกว่าหรือเท่ากับ EndDate' });
    }
    if (await hasMasterProcs()) {
      const r = await execMasterProc('wf.sp_MasterUpdatePrice', {
        SetPriceID: { type: sql.Int, value: Number(SetPriceID) },
        ListNo: { type: sql.Int, value: Number(ListNo) },
        GoodPriceNet: { type: sql.Decimal(18, 4), value: Number(GoodPriceNet) },
        BeginDate: { type: sql.Date, value: BeginDate || null },
        EndDate: { type: sql.Date, value: EndDate || null },
      }, AFFECTED_OUT);
      if (!Number(r.Affected || 0)) return res.status(404).json({ message: 'ไม่พบรายการราคาที่ระบุ (SetPriceID หรือ ListNo ไม่ถูกต้อง)' });
      return res.json({ ok: true });
    }

    const dtRes = await dboWrite(`
      UPDATE dbo.EMSetPriceDT 
      SET GoodPriceNet = @price 
      WHERE SetPriceID = @setId AND ListNo = @listNo
    `, {
      price: { type: sql.Decimal(18, 4), value: GoodPriceNet },
      setId: { type: sql.Int, value: SetPriceID },
      listNo: { type: sql.Int, value: ListNo }
    });
    if (!affected(dtRes)) return res.status(404).json({ message: 'ไม่พบรายการราคาที่ระบุ (SetPriceID หรือ ListNo ไม่ถูกต้อง)' });
    
    if (BeginDate || EndDate) {
      const sets = [];
      const hdInputs = { setId: { type: sql.Int, value: SetPriceID } };
      
      if (BeginDate) {
        sets.push(`BeginDate = @beginDate`);
        hdInputs.beginDate = { type: sql.Date, value: BeginDate };
      }
      if (EndDate) {
        sets.push(`EndDate = @endDate`);
        hdInputs.endDate = { type: sql.Date, value: EndDate };
      }
      
      await dboWrite(`
        UPDATE dbo.EMSetPriceHD
        SET ${sets.join(', ')}
        WHERE SetPriceID = @setId
      `, hdInputs);
    }

    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/master/prices — สร้างเอกสารราคาใหม่ (Extend Price)
router.post('/prices', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { GoodID, CustID, GoodPriceNet, BeginDate, EndDate, startgoodqty, endgoodqty } = req.body || {};
    
    // U-1 Validation: Validate GoodID, GoodPriceNet > 0, BeginDate <= EndDate BEFORE MAX or insert
    if (!GoodID) {
      return res.status(400).json({ message: 'กรุณาระบุรหัสสินค้า (GoodID)' });
    }
    const priceNum = Number(GoodPriceNet);
    if (GoodPriceNet === undefined || GoodPriceNet === null || isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({ message: 'ราคาต้องมากกว่า 0 (GoodPriceNet > 0)' });
    }
    if (!BeginDate || !EndDate) {
      return res.status(400).json({ message: 'กรุณาระบุ BeginDate และ EndDate' });
    }
    const bStr = String(BeginDate).slice(0, 10);
    const eStr = String(EndDate).slice(0, 10);
    if (bStr > eStr) {
      return res.status(400).json({ message: 'BeginDate ต้องน้อยกว่าหรือเท่ากับ EndDate' });
    }

    if (await hasMasterProcs()) {
      const r = await execMasterProc('wf.sp_MasterCreatePrice', {
        GoodID: { type: sql.Int, value: parseInt(GoodID, 10) },
        CustID: { type: sql.VarChar(20), value: CustID || null },
        GoodPriceNet: { type: sql.Decimal(18, 4), value: priceNum },
        BeginDate: { type: sql.Date, value: bStr },
        EndDate: { type: sql.Date, value: eStr },
        StartQty: { type: sql.Decimal(18, 4), value: startgoodqty || 1 },
        EndQty: { type: sql.Decimal(18, 4), value: endgoodqty || 999999 },
      }, [{ name: 'NewSetPriceID', sqlType: 'INT' }, { name: 'DocuNo', sqlType: 'VARCHAR(50)' }]);
      return res.json({ ok: true, SetPriceID: r.NewSetPriceID, DocuNo: r.DocuNo });
    }

    // 1. Get New SetPriceID
    const maxIdRes = await query(`SELECT ISNULL(MAX(SetPriceID), 1000) AS MaxId FROM dbo.EMSetPriceHD`);
    const newSetPriceId = maxIdRes[0].MaxId + 1;
    
    // 2. Generate DocuNo (WEB-YYYYMMDD-XXXX)
    const dStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const countRes = await query(`SELECT COUNT(*) AS Cnt FROM dbo.EMSetPriceHD WHERE DocuNo LIKE 'WEB-' + @dStr + '-%'`, { dStr: { type: sql.VarChar, value: dStr }});
    const seq = String(countRes[0].Cnt + 1).padStart(4, '0');
    const docuNo = `WEB-${dStr}-${seq}`;
    
    // 3. Insert into EMSetPriceHD
    await query(`
      INSERT INTO dbo.EMSetPriceHD (
        SetPriceID, DocuType, BrchID, DocuNo, DocuDate, BeginDate, EndDate, CustID,
        SetPriceFlag, CustFlag, GoodFlag, DocuFlag, PromotionFlag, GoldenTimeFlag, ChangedDate
      ) VALUES (
        @setId, 133, 1, @docuNo, CAST(GETDATE() AS DATE), @beginDate, @endDate, @custId,
        'Y', 'A', 'C', 'Y', 'N', 'N', GETDATE()
      )
    `, {
      setId: { type: sql.Int, value: newSetPriceId },
      docuNo: { type: sql.VarChar(50), value: docuNo },
      beginDate: { type: sql.Date, value: BeginDate },
      endDate: { type: sql.Date, value: EndDate },
      custId: { type: sql.VarChar(20), value: CustID || null }
    });
    
    // 4. Insert into EMSetPriceDT
    await query(`
      INSERT INTO dbo.EMSetPriceDT (
        SetPriceID, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty,
        ListFlag, EditFlag
      ) VALUES (
        @setId, 1, @goodId, @price, @startqty, @endqty,
        'A', 'N'
      )
    `, {
      setId: { type: sql.Int, value: newSetPriceId },
      goodId: { type: sql.Int, value: parseInt(GoodID) || GoodID }, // Handle both string IDs mapping to INT if needed
      price: { type: sql.Decimal(18,4), value: GoodPriceNet },
      startqty: { type: sql.Decimal(18,4), value: startgoodqty || 1 },
      endqty: { type: sql.Decimal(18,4), value: endgoodqty || 999999 }
    });
    
    res.json({ ok: true, SetPriceID: newSetPriceId });
  } catch (e) {
    console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message });
  }
});

// POST /api/master/prices/bulk-extend — สร้างเอกสารราคาใหม่แบบกลุ่ม
router.post('/prices/bulk-extend', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Empty items array' });
    for (const [i, item] of items.entries()) {
      if (!item.GoodID || !(Number(item.GoodPriceNet) > 0) || !item.BeginDate || !item.EndDate
          || String(item.BeginDate).slice(0, 10) > String(item.EndDate).slice(0, 10)) {
        return res.status(400).json({ message: `รายการที่ ${i + 1}: ต้องมีรหัสสินค้า ราคามากกว่า 0 และวันเริ่มไม่เกินวันสิ้นสุด` });
      }
    }
    if (await hasMasterProcs()) {
      const created = [];
      for (const item of items) {
        const r = await execMasterProc('wf.sp_MasterCreatePrice', {
          GoodID: { type: sql.Int, value: parseInt(item.GoodID, 10) },
          CustID: { type: sql.VarChar(20), value: item.CustID || null },
          GoodPriceNet: { type: sql.Decimal(18, 4), value: Number(item.GoodPriceNet) },
          BeginDate: { type: sql.Date, value: String(item.BeginDate).slice(0, 10) },
          EndDate: { type: sql.Date, value: String(item.EndDate).slice(0, 10) },
          StartQty: { type: sql.Decimal(18, 4), value: item.startgoodqty || 1 },
          EndQty: { type: sql.Decimal(18, 4), value: item.endgoodqty || 999999 },
        }, [{ name: 'NewSetPriceID', sqlType: 'INT' }, { name: 'DocuNo', sqlType: 'VARCHAR(50)' }]);
        created.push(r.NewSetPriceID);
      }
      return res.json({ ok: true, createdCount: created.length, SetPriceIDs: created });
    }
    
    // Get starting SetPriceID
    const maxIdRes = await query(`SELECT ISNULL(MAX(SetPriceID), 1000) AS MaxId FROM dbo.EMSetPriceHD`);
    let currentSetPriceId = maxIdRes[0].MaxId;
    
    // Get starting DocuNo Sequence
    const dStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const countRes = await query(`SELECT COUNT(*) AS Cnt FROM dbo.EMSetPriceHD WHERE DocuNo LIKE 'WEB-' + @dStr + '-%'`, { dStr: { type: sql.VarChar, value: dStr }});
    let currentSeq = countRes[0].Cnt;
    
    let createdIds = [];

    for (const item of items) {
      currentSetPriceId++;
      currentSeq++;
      
      const docuNo = `WEB-${dStr}-${String(currentSeq).padStart(4, '0')}`;
      
      await query(`
        INSERT INTO dbo.EMSetPriceHD (
          SetPriceID, DocuType, BrchID, DocuNo, DocuDate, BeginDate, EndDate, CustID,
          SetPriceFlag, CustFlag, GoodFlag, DocuFlag, PromotionFlag, GoldenTimeFlag, ChangedDate
        ) VALUES (
          @setId, 133, 1, @docuNo, CAST(GETDATE() AS DATE), @beginDate, @endDate, @custId,
          'Y', 'A', 'C', 'Y', 'N', 'N', GETDATE()
        )
      `, {
        setId: { type: sql.Int, value: currentSetPriceId },
        docuNo: { type: sql.VarChar(50), value: docuNo },
        beginDate: { type: sql.Date, value: item.BeginDate },
        endDate: { type: sql.Date, value: item.EndDate },
        custId: { type: sql.VarChar(20), value: item.CustID || null }
      });
      
      await query(`
        INSERT INTO dbo.EMSetPriceDT (
          SetPriceID, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty,
          ListFlag, EditFlag
        ) VALUES (
          @setId, 1, @goodId, @price, @startqty, @endqty,
          'A', 'N'
        )
      `, {
        setId: { type: sql.Int, value: currentSetPriceId },
        goodId: { type: sql.Int, value: parseInt(item.GoodID) || item.GoodID },
        price: { type: sql.Decimal(18,4), value: item.GoodPriceNet },
        startqty: { type: sql.Decimal(18,4), value: item.startgoodqty || 1 },
        endqty: { type: sql.Decimal(18,4), value: item.endgoodqty || 999999 }
      });
      
      createdIds.push(currentSetPriceId);
    }
    
    res.json({ ok: true, createdCount: createdIds.length, SetPriceIDs: createdIds });
  } catch (e) {
    console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message });
  }
});

// GET /api/master/control-tickets — ตั๋วคุม & คูปอง (Universal Native Control Tickets)
router.get('/control-tickets', async (req, res) => {
  try {
    const { custId, includeCompleted, tab, q, page, pageSize, paginated } = req.query;
    const isPaginated = paginated === 'true' || page !== undefined || pageSize !== undefined;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    // Allow higher limit for customer-scoped queries to prevent silent truncation in CreateSODialog (R3-03 Point B)
    const maxLimit = custId ? 2000 : 500;
    const defaultLimit = custId ? 1000 : (isPaginated ? 50 : 200);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(pageSize, 10) || defaultLimit));
    const offset = (pageNum - 1) * limit;

    const inputs = {};
    if (custId) inputs.custId = { type: sql.NVarChar(50), value: String(custId).trim() };
    if (q) inputs.q = { type: sql.NVarChar(100), value: `%${String(q).trim()}%` };
    const ctVisible = custId ? { all: true } : await getVisibleScope(req.user);
    const ctScope = scopeFilter(ctVisible, { empCol: 'h104.EmpID', prefix: 'ct' });
    const ctPending = scopeFilter(ctVisible, { empCol: 'h.EmpID', prefix: 'cp' });
    const ctDraft = scopeFilter(ctVisible, { userCol: 'so.SalesUserId', prefix: 'cd' });
    Object.assign(inputs, ctScope.inputs, ctPending.inputs, ctDraft.inputs);

    // 1. Query Issued Coupons from WFCoupon linked to 104 and 103
    const couponQuery = `
      SELECT 
        c.CouponID,
        c.CouponNo,
        c.CouponNo AS DocuNo,
        c.CouponNo AS DisplayDocuNo,
        h103.DocuNo AS BookingDocuNo,
        h103.AppvDocuNo,
        h104.DocuNo AS DeliveryDocuNo,
        c.DocuID AS DeliverySOID,
        ISNULL(h103.SOID, h104.SOID) AS SOID,
        c.RefListno AS ListNo,
        h104.CustID,
        h104.CustName,
        ISNULL(h104.TransRegistration, h103.TransRegistration) AS TruckPlate,
        h104.DocuDate,
        h103.AppvFlag,
        h103.AppvDate,
        h104.DocuStatus,
        c.GoodID,
        g.GoodCode,
        c.GoodName,
        c.GoodPrice,
        u.GoodUnitName,
        CAST(c.GoodQty AS DECIMAL(12, 3)) AS TotalQtyTon,
        CAST(c.GoodQty AS DECIMAL(12, 3)) AS IssuedQtyTon,
        CAST(c.RemaQty AS DECIMAL(12, 3)) AS NativeRemainingQtyTon,
        CAST(ISNULL(res.TotalReserved, 0) AS DECIMAL(12, 3)) AS ReservedQtyTon,
        CAST(c.RemaQty - ISNULL(res.TotalReserved, 0) AS DECIMAL(12, 3)) AS AvailableQtyTon,
        CAST(c.GoodQty - (c.RemaQty - ISNULL(res.TotalReserved, 0)) AS DECIMAL(12, 3)) AS DrawnQtyTon,
        CASE
          WHEN c.RemaQty < 0 OR (c.RemaQty - ISNULL(res.TotalReserved, 0)) < 0 THEN 'NEGATIVE'
          WHEN c.RemaQty = 0 THEN 'ZERO'
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0 AND c.RemaQty > 0 THEN 'RESERVED_FULL'
          WHEN (c.RemaQty - ISNULL(res.TotalReserved, 0)) > 0 THEN 'POSITIVE'
          ELSE 'UNKNOWN'
        END AS BalanceState,
        CASE
          WHEN h104.DocuStatus = 'C' THEN 'CANCELLED'
          ELSE 'ISSUED'
        END AS Lifecycle,
        ov.ExpiryDate,
        ov.ExpiryType,
        ov.StrictOverrideFlag,
        ov.ReasonCode,
        ov.ReasonText
      FROM dbo.WFCoupon c WITH (NOLOCK)
      JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = c.DocuID AND h104.DocuType = 104
      LEFT JOIN dbo.SODT d104 WITH (NOLOCK) ON d104.SOID = c.DocuID AND d104.ListNo = c.RefListno
      LEFT JOIN dbo.SOHD h103 WITH (NOLOCK) ON h103.SOID = d104.RefSOID AND h103.DocuType = 103
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = c.GoodUnitID
      LEFT JOIN (
        SELECT CouponId, SUM(ReservedQty) AS TotalReserved
        FROM wf.CouponReservation WITH (NOLOCK)
        WHERE Status = 'RESERVED' AND (ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE())
        GROUP BY CouponId
      ) res ON res.CouponId = c.CouponID
      OUTER APPLY (
        SELECT TOP 1
          ov.ExpiryDate,
          ov.ExpiryType,
          ov.StrictOverrideFlag,
          ov.ReasonCode,
          ov.ReasonText
        FROM wf.ControlTicketOverlay ov WITH (NOLOCK)
        WHERE (ov.DocuId = c.CouponID)
           OR (ov.DocuNo = c.CouponNo AND (ov.DocuId IS NULL OR ov.DocuId = 0 OR ov.DocuId = c.CouponID))
           OR (h103.DocuNo IS NOT NULL AND ov.DocuNo = h103.DocuNo)
           OR (h103.AppvDocuNo IS NOT NULL AND ov.DocuNo = h103.AppvDocuNo)
        ORDER BY
          CASE
            WHEN ov.DocuId = c.CouponID THEN 1
            WHEN ov.DocuNo = c.CouponNo THEN 2
            WHEN h103.DocuNo IS NOT NULL AND ov.DocuNo = h103.DocuNo THEN 3
            WHEN h103.AppvDocuNo IS NOT NULL AND ov.DocuNo = h103.AppvDocuNo THEN 4
            ELSE 5
          END ASC,
          ov.UpdatedAt DESC
      ) ov
      WHERE ${ctScope.sql}
        ${custId ? `AND (h104.CustID = @custId OR h103.CustID = @custId)` : ''}
        ${q ? `AND (c.CouponNo LIKE @q OR h103.DocuNo LIKE @q OR h103.AppvDocuNo LIKE @q OR h104.DocuNo LIKE @q OR h104.CustName LIKE @q OR c.GoodName LIKE @q)` : ''}
    `;

    // 2. Query Pending Approved Booking (103 with AI but no 104 issued)
    const pendingQuery = `
      SELECT
        NULL AS CouponID,
        NULL AS CouponNo,
        h.DocuNo,
        ISNULL(h.AppvDocuNo, h.DocuNo) AS DisplayDocuNo,
        h.DocuNo AS BookingDocuNo,
        h.AppvDocuNo,
        NULL AS DeliveryDocuNo,
        NULL AS DeliverySOID,
        h.SOID,
        dt.ListNo AS ListNo,
        h.CustID,
        h.CustName,
        h.TransRegistration AS TruckPlate,
        h.DocuDate,
        h.AppvFlag,
        h.AppvDate,
        h.DocuStatus,
        dt.GoodID,
        g.GoodCode,
        dt.GoodName,
        dt.GoodPrice2 AS GoodPrice,
        u.GoodUnitName,
        CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12, 3)) AS TotalQtyTon,
        CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12, 3)) AS IssuedQtyTon,
        NULL AS NativeRemainingQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS ReservedQtyTon,
        NULL AS AvailableQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS DrawnQtyTon,
        'PENDING_ISSUE' AS BalanceState,
        'APPROVED_NOT_ISSUED' AS Lifecycle,
        ov.ExpiryDate,
        ov.ExpiryType,
        ov.StrictOverrideFlag,
        ov.ReasonCode,
        ov.ReasonText
      FROM dbo.SOHD h WITH (NOLOCK)
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = h.SOID
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = dt.GoodUnitID2
      OUTER APPLY (
        SELECT TOP 1
          ov.ExpiryDate,
          ov.ExpiryType,
          ov.StrictOverrideFlag,
          ov.ReasonCode,
          ov.ReasonText
        FROM wf.ControlTicketOverlay ov WITH (NOLOCK)
        WHERE (ov.DocuNo = h.DocuNo)
           OR (h.AppvDocuNo IS NOT NULL AND ov.DocuNo = h.AppvDocuNo)
        ORDER BY
          CASE
            WHEN ov.DocuNo = h.DocuNo THEN 1
            WHEN h.AppvDocuNo IS NOT NULL AND ov.DocuNo = h.AppvDocuNo THEN 2
            ELSE 3
          END ASC,
          ov.UpdatedAt DESC
      ) ov
      WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND ${ctPending.sql}
        AND (h.AppvDocuNo LIKE 'AI%' OR h.TransRegistration = N'ตั๋วคุม')
        AND NOT EXISTS (
          SELECT 1 FROM dbo.SODT d2 WITH (NOLOCK)
          JOIN dbo.SOHD h2 WITH (NOLOCK) ON h2.SOID = d2.SOID AND h2.DocuType = 104 AND h2.DocuStatus <> 'C'
          WHERE d2.RefSOID = h.SOID
        )
        ${custId ? `AND h.CustID = @custId` : ''}
        ${q ? `AND (h.DocuNo LIKE @q OR h.AppvDocuNo LIKE @q OR h.CustName LIKE @q OR dt.GoodName LIKE @q)` : ''}
    `;

    // 3. Query Draft Tickets from wf.SalesOrder
    const draftQuery = `
      SELECT
        NULL AS CouponID,
        NULL AS CouponNo,
        so.WfRef AS DocuNo,
        so.WfRef AS DisplayDocuNo,
        so.WfRef AS BookingDocuNo,
        so.WfRef AS AppvDocuNo,
        NULL AS DeliveryDocuNo,
        NULL AS DeliverySOID,
        so.Id AS SOID,
        wfl.LineNum AS ListNo,
        so.CustId AS CustID,
        so.CustName,
        so.TruckPlate,
        so.CreatedAt AS DocuDate,
        'N' AS AppvFlag,
        NULL AS AppvDate,
        'DRAFT' AS DocuStatus,
        wfl.GoodId AS GoodID,
        g.GoodCode,
        wfl.GoodName,
        wfl.PricePerTon AS GoodPrice,
        N'ตัน' AS GoodUnitName,
        CAST(ISNULL(wfl.QtyTon, 0) AS DECIMAL(12, 3)) AS TotalQtyTon,
        CAST(ISNULL(wfl.QtyTon, 0) AS DECIMAL(12, 3)) AS IssuedQtyTon,
        NULL AS NativeRemainingQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS ReservedQtyTon,
        NULL AS AvailableQtyTon,
        CAST(0 AS DECIMAL(12, 3)) AS DrawnQtyTon,
        'DRAFT' AS BalanceState,
        'DRAFT' AS Lifecycle,
        NULL AS ExpiryDate,
        NULL AS ExpiryType,
        CAST(0 AS BIT) AS StrictOverrideFlag,
        NULL AS ReasonCode,
        NULL AS ReasonText
      FROM wf.SalesOrder so WITH (NOLOCK)
      JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = so.Id
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = wfl.GoodId
      WHERE so.SoPrefix = 'AI' AND so.Status = 'DRAFT' AND ${ctDraft.sql}
        ${custId ? `AND so.CustId = @custId` : ''}
        ${q ? `AND (so.WfRef LIKE @q OR so.CustName LIKE @q OR wfl.GoodName LIKE @q)` : ''}
    `;

    const selectedTab = String(tab || (includeCompleted === 'true' ? 'ALL' : 'ACTIVE')).toUpperCase();

    let subqueries = [];
    if (selectedTab === 'PENDING') {
      subqueries = [pendingQuery, draftQuery];
    } else if (selectedTab === 'HISTORY' || selectedTab === 'USED_UP') {
      // HISTORY: normally exhausted (RemaQty = 0 AND NetAvailable = 0) OR cancelled, strictly excluding anomalies (R3-03 Point 3)
      const historyCouponQuery = `${couponQuery} AND (((c.RemaQty = 0 AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0)) OR (c.RemaQty > 0 AND h104.DocuStatus = 'C')) AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) >= 0 AND c.RemaQty >= 0`;
      subqueries = [historyCouponQuery];
    } else if (selectedTab === 'ACTIVE') {
      const activeCouponQuery = `${couponQuery} AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) > 0 AND c.RemaQty > 0 AND h104.DocuStatus <> 'C'`;
      subqueries = [activeCouponQuery];
    } else if (selectedTab === 'RESERVED_FULL') {
      const reservedCouponQuery = `${couponQuery} AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) = 0 AND c.RemaQty > 0 AND h104.DocuStatus <> 'C'`;
      subqueries = [reservedCouponQuery];
    } else if (selectedTab === 'ALERTS' || selectedTab === 'EXPIRED_ALERT') {
      inputs.alertDays = { type: sql.Int, value: parseInt(req.query.alertDays, 10) || 7 };
      const alertCouponQuery = `${couponQuery} 
        AND ov.ExpiryDate IS NOT NULL 
        AND ov.ExpiryDate <= DATEADD(day, @alertDays, CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
        AND (ov.StrictOverrideFlag IS NULL OR ov.StrictOverrideFlag = 0)
        AND (c.RemaQty - ISNULL(res.TotalReserved, 0)) > 0 
        AND c.RemaQty > 0 
        AND h104.DocuStatus <> 'C'`;
      subqueries = [alertCouponQuery];
    } else if (selectedTab === 'UNKNOWN' || selectedTab === 'REVIEW') {
      // REVIEW: anomaly remaining or negative available (R3-03 Point 3)
      const reviewCouponQuery = `${couponQuery} AND (c.RemaQty < 0 OR (c.RemaQty - ISNULL(res.TotalReserved, 0)) < 0)`;
      subqueries = [reviewCouponQuery];
    } else {
      subqueries = [couponQuery, pendingQuery, draftQuery];
    }

    inputs.offset = { type: sql.Int, value: offset };
    inputs.limit = { type: sql.Int, value: limit };

    const fullUnionSql = `
      WITH AllControlItems AS (
        ${subqueries.join('\n UNION ALL \n')}
      ),
      PagingCTE AS (
        SELECT 
          *,
          COUNT(*) OVER() AS TotalFilteredCount,
          ROW_NUMBER() OVER (
            ORDER BY 
              DocuDate DESC, 
              DocuNo DESC, 
              ISNULL(CouponID, 0) DESC, 
              ISNULL(SOID, 0) DESC, 
              ISNULL(ListNo, 0) ASC
          ) AS RowNum
        FROM AllControlItems
      )
      SELECT * FROM PagingCTE
      WHERE RowNum > @offset AND RowNum <= (@offset + @limit)
      ORDER BY RowNum ASC
    `;

    const rawRows = await query(fullUnionSql, inputs);
    let totalCount = 0;
    if (rawRows && rawRows.length > 0) {
      totalCount = Number(rawRows[0].TotalFilteredCount || rawRows.length);
    } else if (isPaginated && pageNum > 1) {
      const countRes = await query(`
        WITH AllControlItems AS (
          ${subqueries.join('\n UNION ALL \n')}
        )
        SELECT COUNT(*) AS TotalCount FROM AllControlItems
      `, inputs);
      totalCount = Number(countRes[0]?.TotalCount || 0);
    }

    const { resolveTicketPolicy, evaluateTicketExpiry, evaluateTicketEligibility } = require('../services/ticket-policy');
    const policy = await resolveTicketPolicy();

    // Enrich with multi-axis status & policy
    const enriched = (rawRows || []).map(r => {
      const expiryEval = evaluateTicketExpiry(
        r.ExpiryDate,
        null,
        policy.alertDays,
        policy.strictMode,
        Boolean(r.StrictOverrideFlag)
      );

      const eligibilityEval = evaluateTicketEligibility({
        couponId: r.CouponID,
        lifecycle: r.Lifecycle,
        balanceState: r.BalanceState,
        availableQtyTon: r.AvailableQtyTon,
        nativeRemainingQtyTon: r.NativeRemainingQtyTon,
        expiryEval,
        strictOverride: Boolean(r.StrictOverrideFlag),
        strictMode: policy.strictMode,
      });

      const balanceState = r.BalanceState;
      const lifecycle = r.Lifecycle;
      const expiryState = expiryEval.status === 'EXPIRED' ? 'EXPIRED' : (expiryEval.status === 'NEAR_EXPIRY' ? 'EXPIRING' : (r.ExpiryDate ? 'VALID' : 'UNKNOWN'));

      const isCoupon = r.CouponID != null;
      const entityType = isCoupon ? 'COUPON' : (lifecycle === 'APPROVED_NOT_ISSUED' ? 'BOOKING' : 'DRAFT');
      const exactId = r.CouponID || r.SOID;
      const entityKey = isCoupon 
        ? `coupon:${r.CouponID}` 
        : (lifecycle === 'APPROVED_NOT_ISSUED' 
            ? `booking:${r.SOID}:${r.ListNo || 1}` 
            : `draft:${r.SOID}:${r.ListNo || 1}`);

      return {
        ...r,
        entityType,
        exactId,
        entityKey,
        BalanceState: balanceState,
        Lifecycle: lifecycle,
        ExpiryState: expiryState,
        Eligibility: eligibilityEval.eligibility,
        Reasons: eligibilityEval.reasons,
        expiry: expiryEval,
        expiryStatus: expiryEval.status,
        expiryDate: expiryEval.expiryDate,
        daysRemaining: expiryEval.daysRemaining,
        strictMode: policy.strictMode,
        strictOverride: Boolean(r.StrictOverrideFlag),
        isBlocked: eligibilityEval.isBlocked,
        isSpendable: eligibilityEval.isSpendable,
        warning: eligibilityEval.warnings?.length > 0 ? eligibilityEval.warnings.join('; ') : null,
        error: eligibilityEval.isBlocked ? (eligibilityEval.reasons?.join('; ') || eligibilityEval.error) : null,
        customerCandidate: {
          candidateCustId: r.CustID,
          candidateCustName: r.CustName,
          isPrefixCandidateOnly: true,
          note: 'Prefix ลูกค้าเป็น candidate เท่านั้น ไม่ใช่สิทธิ์เบิกข้ามลูกค้าอัตโนมัติ',
        },
      };
    });

    res.setHeader('X-Total-Count', totalCount);
    if (totalCount > limit) {
      res.setHeader('X-Truncated', 'true');
    }

    if (isPaginated) {
      return res.json({
        total: totalCount,
        page: pageNum,
        pageSize: limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
        data: enriched
      });
    }

    // Preserve plain array return for non-paginated callers (e.g. CreateSODialog.tsx:322)
    res.json(enriched);

  } catch (e) {
    console.error('[master/control-tickets]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/master/control-tickets/alerts — รายการแจ้งเตือนตั๋วคุมใกล้หมดอายุ / หมดอายุ (SO-04) ──
router.get('/control-tickets/alerts', async (req, res) => {
  try {
    const { listTicketAlerts } = require('../services/ticket-policy');
    const alerts = await listTicketAlerts();
    res.json(alerts);
  } catch (e) {
    console.error('[master/control-tickets/alerts]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/master/control-tickets/:docuNo/trace — สืบย้อนเส้นทาง native chain (SO-04) ──
router.get('/control-tickets/:docuNo/trace', async (req, res) => {
  try {
    const { traceNativeTicketChain } = require('../services/ticket-policy');
    const { exactId, entityType } = req.query;

    let cleanExactId = null;
    if (exactId !== undefined && exactId !== null) {
      const rawStr = String(exactId).trim();
      if (!/^\d+$/.test(rawStr)) {
        return res.status(400).json({ message: `INVALID_EXACT_ID: exactId "${exactId}" ต้องเป็นเลขจำนวนเต็มบวก 32-bit เท่านั้น` });
      }
      const parsed = Number(rawStr);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
        return res.status(400).json({ message: `INVALID_EXACT_ID: exactId "${exactId}" อยู่นอกช่วงจำนวนเต็มบวก 32-bit` });
      }
      cleanExactId = parsed;
    }

    const trace = await traceNativeTicketChain(req.params.docuNo, { exactId: cleanExactId, entityType });
    if (!trace || !await nativeChainInScope(await getVisibleScope(req.user), trace)) {
      return res.status(404).json({ message: `ไม่พบข้อมูลตั๋วคุม ${req.params.docuNo}` });
    }
    res.json(trace);
  } catch (e) {
    console.error('[master/control-tickets/trace]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// ── PATCH /api/master/control-tickets/:docuNo/expiry — บันทึก/แก้ไขวันหมดอายุและ Strict Override (SO-04) ──
// R12 O-4: a team-scoped user changes the expiry only of a ticket sold by someone in their scope. The ticket is a
// WFCoupon row; its owner is the salesperson of the document that issued it (UAT batch 8, F-03: one salesperson
// could move another's ticket expiry).
async function requireTicketInScope(req, res, next) {
  try {
    const { getVisibleScope, inScope } = require('../services/visible-scope');
    const scope = await getVisibleScope(req.user);
    if (scope.all) return next();
    const exactId = req.body?.exactId || req.query?.exactId;
    const rows = (await query(`
      SELECT CAST(s.EmpID AS VARCHAR(20)) AS EmpID
      FROM dbo.WFCoupon c WITH (NOLOCK) JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
      WHERE ${exactId ? 'c.CouponID = @cid' : 'c.CouponNo = @no'}`, {
      cid: { type: sql.Int, value: Number(exactId) || 0 },
      no: { type: sql.VarChar(30), value: String(req.params.docuNo || '').trim() },
    })) || [];
    if (!rows.length || !rows.every(r => inScope(scope, { empId: r.EmpID }))) {
      return res.status(404).json({ message: 'ไม่พบตั๋วคุมนี้' });
    }
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

router.patch('/control-tickets/:docuNo/expiry', requireRole('SALES', 'ADMIN', 'C_LEVEL', 'MANAGER'), requireTicketInScope, async (req, res) => {
  try {
    const { updateTicketExpiryOverlay } = require('../services/ticket-policy');
    const { expiryDate, strictOverride, reasonCode, reasonText, exactId } = req.body || {};
    const exactCouponId = exactId || req.query?.exactId;

    const result = await updateTicketExpiryOverlay({
      docuNo: req.params.docuNo,
      exactId: exactCouponId,
      expiryDate,
      strictOverride: Boolean(strictOverride),
      reasonCode,
      reasonText,
      userId: req.user?.sub || req.user?.username || 'SYSTEM',
      userRole: req.user?.role,
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (e) {
    console.error('[master/control-tickets/expiry]', e);
    res.status(400).json({ message: e.message });
  }
});

// ── GET /api/master/control-tickets/typed/:entityType/:id — Resolve by typed identity ──
router.get('/control-tickets/typed/:entityType/:id', async (req, res) => {
  try {
    const { entityType, id } = req.params;
    const { resolveNativeDocumentChain } = require('../services/native-document-resolver');
    const result = await resolveNativeDocumentChain({
      entityType: String(entityType).toUpperCase(),
      exactId: id
    });
    if (!await nativeChainInScope(await getVisibleScope(req.user), result)) {
      return res.status(404).json({ message: 'ไม่พบตั๋วคุมนี้' });
    }
    if (!result.resolved) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error('[master/control-tickets/typed]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// GET /api/master/control-tickets/:docuNo/draws — ประวัติการตัด (SO 104 หรือ WFRedemtion 116)
router.get('/control-tickets/:docuNo/draws', async (req, res) => {
  try {
    const drawScope = await getVisibleScope(req.user);
    const couponDrawScope = scopeFilter(drawScope, { empCol: 'h104.EmpID', prefix: 'dcp' });
    const deliveryDrawScope = scopeFilter(drawScope, { empCol: 'h2.EmpID', prefix: 'ddv' });
    const docuNo = String(req.params.docuNo).trim();
    const { exactId, entityType } = req.query;
    let parsedExactId = null;
    if (exactId !== undefined && exactId !== null) {
      const rawStr = String(exactId).trim();
      if (!/^\d+$/.test(rawStr)) {
        return res.status(400).json({ message: `INVALID_EXACT_ID: exactId "${exactId}" ต้องเป็นเลขจำนวนเต็มบวก 32-bit เท่านั้น` });
      }
      const parsed = Number(rawStr);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
        return res.status(400).json({ message: `INVALID_EXACT_ID: exactId "${exactId}" อยู่นอกช่วงจำนวนเต็มบวก 32-bit` });
      }
      parsedExactId = parsed;
    }

    // Check 1: If coupon (C or D), query WFRedemtionDT (116)
    if (/^[CD]\d+/i.test(docuNo) || entityType === 'COUPON') {
      const redInputs = {
        ...couponDrawScope.inputs,
        docuNo: { type: sql.NVarChar(50), value: docuNo },
        exactId: { type: sql.Int, value: parsedExactId },
      };
      const redRows = await query(`
        SELECT 
          rh.RedemtionID AS SOID, rh.DocuNo,
          CONVERT(VARCHAR(10), rh.DocuDate, 120) AS DocuDate,
          ISNULL(h104.CustName, rh.IssueName) AS CustName,
          rh.CarLicense AS TruckPlate,
          CAST(rd.GoodQty AS DECIMAL(12, 3)) AS DrawnQtyTon,
          1 AS LineCnt
        FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
        JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
        JOIN dbo.WFCoupon c WITH (NOLOCK) ON c.CouponID = rd.CouponID
        LEFT JOIN dbo.SOHD h104 WITH (NOLOCK) ON h104.SOID = c.DocuID
        WHERE ((@exactId IS NOT NULL AND c.CouponID = @exactId)
           OR (@exactId IS NULL AND (c.CouponNo = @docuNo OR rd.CouponNo = @docuNo)))
          AND ${couponDrawScope.sql}
        ORDER BY rh.DocuDate DESC
      `, redInputs);

      if (redRows.length > 0 || (parsedExactId && entityType === 'COUPON')) {
        return res.json(redRows);
      }
    }

    // Check 2: Native 104 deliveries
    const delInputs = {
      ...deliveryDrawScope.inputs,
      docuNo: { type: sql.NVarChar(30), value: docuNo },
      exactId: { type: sql.Int, value: parsedExactId },
    };
    const rows = await query(`
      SELECT h2.SOID, h2.DocuNo,
             CONVERT(VARCHAR(10), h2.DocuDate, 120) AS DocuDate,
             h2.CustName, h2.TransRegistration AS TruckPlate,
             SUM(d2.GoodQty2) AS DrawnQtyTon,
             COUNT(d2.ListNo) AS LineCnt
      FROM dbo.SOHD h2 WITH (NOLOCK)
      JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
      LEFT JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo
      WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
        AND ${deliveryDrawScope.sql}
        AND (
          (@exactId IS NOT NULL AND d2.RefSOID = @exactId)
          OR (@exactId IS NULL AND (RTRIM(h2.RefNo) = RTRIM(@docuNo) OR wfl.RefControlTicketNo = RTRIM(@docuNo)))
        )
      GROUP BY h2.SOID, h2.DocuNo, h2.DocuDate, h2.CustName, h2.TransRegistration
      ORDER BY h2.DocuDate DESC
    `, delInputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/control-tickets/:docuNo — ดึงรายการสินค้าของตั๋วคุม
router.get('/control-tickets/:docuNo', async (req, res) => {
  try {
    const detailScope = await getVisibleScope(req.user);
    const couponDetailScope = scopeFilter(detailScope, { empCol: 'issuer.EmpID', prefix: 'lcp' });
    const draftDetailScope = scopeFilter(detailScope, { userCol: 'h.SalesUserId', prefix: 'ldr' });
    const nativeDetailScope = scopeFilter(detailScope, { empCol: 'h.EmpID', prefix: 'lso' });
    const docuNo = String(req.params.docuNo).trim();
    const { exactId, entityType } = req.query;
    const parsedExactId = exactId ? parseInt(exactId, 10) : null;

    // Check 1: Coupon (C or D prefix or entityType === 'COUPON')
    if (/^[CD]\d+/i.test(docuNo) || entityType === 'COUPON') {
      const cpRows = await query(`
        SELECT 
          1 AS ListNo, c.GoodID, g.GoodCode, c.GoodName,
          CAST(c.RemaQty AS DECIMAL(12, 3)) AS QtyTon,
          CAST(c.GoodPrice AS DECIMAL(12, 2)) AS PricePerTon,
          ISNULL(gx.BagPerTon, 20) AS BagPerTon
        FROM dbo.WFCoupon c WITH (NOLOCK)
        LEFT JOIN dbo.SOHD issuer ON issuer.SOID = c.DocuID
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
        LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = c.GoodID
        WHERE ((@exactId IS NOT NULL AND c.CouponID = @exactId)
           OR (@exactId IS NULL AND c.CouponNo = @docuNo))
          AND ${couponDetailScope.sql}
      `, {
        ...couponDetailScope.inputs,
        docuNo: { type: sql.NVarChar(50), value: docuNo },
        exactId: { type: sql.Int, value: parsedExactId },
      });
      if (cpRows.length > 0 || (parsedExactId && entityType === 'COUPON')) {
        return res.json(cpRows);
      }
    }

    if ((docuNo.startsWith('AI') && docuNo.includes('-')) || entityType === 'DRAFT') {
      // Draft WfRef
      const draftCheck = await query(`
        SELECT 
          d.LineNum AS ListNo, d.GoodID, g.GoodCode, g.GoodName1 AS GoodName, 
          d.QtyTon AS QtyTon, d.PricePerTon AS PricePerTon, 
          ISNULL(gx.BagPerTon, 20) AS BagPerTon
        FROM wf.SalesOrder h WITH (NOLOCK)
        JOIN wf.SalesOrderLine d WITH (NOLOCK) ON h.Id = d.SoId
        JOIN dbo.EMGood g WITH (NOLOCK) ON d.GoodId = g.GoodID
        LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
        WHERE ((@exactId IS NOT NULL AND h.Id = @exactId)
           OR (@exactId IS NULL AND h.WfRef = @docuNo AND h.Status = 'DRAFT'))
          AND ${draftDetailScope.sql}
        ORDER BY d.LineNum ASC
      `, {
        ...draftDetailScope.inputs,
        docuNo: { type: sql.NVarChar(30), value: docuNo },
        exactId: { type: sql.Int, value: parsedExactId },
      });

      if (draftCheck.length > 0 || (parsedExactId && entityType === 'DRAFT')) {
        return res.json(draftCheck);
      }
    }

    const rows = await query(`
      SELECT 
        d.ListNo, d.GoodID, g.GoodCode, g.GoodName1 AS GoodName, 
        d.GoodQty2 AS QtyTon, d.GoodPrice2 AS PricePerTon, 
        ISNULL(gx.BagPerTon, 20) AS BagPerTon
      FROM dbo.SOHD h WITH (NOLOCK)
      JOIN dbo.SODT d WITH (NOLOCK) ON h.SOID = d.SOID
      JOIN dbo.EMGood g WITH (NOLOCK) ON d.GoodID = g.GoodID
      LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
      WHERE (
        (@exactId IS NOT NULL AND h.SOID = @exactId)
        OR (@exactId IS NULL AND (RTRIM(h.AppvDocuNo) = RTRIM(@docuNo) OR RTRIM(h.DocuNo) = RTRIM(@docuNo)))
      ) AND h.DocuType = 103 AND h.DocuStatus = 'Y'
        AND ${nativeDetailScope.sql}
      ORDER BY d.ListNo ASC
    `, {
      ...nativeDetailScope.inputs,
      docuNo: { type: sql.NVarChar(30), value: docuNo },
      exactId: { type: sql.Int, value: parsedExactId },
    });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/customers/:id/top-goods — สินค้าที่ลูกค้ารายนี้เคยซื้อ เรียงจากซื้อมากสุด บ่อยสุด ไปน้อยสุด
router.get('/customers/:id/top-goods', async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    if (!/^\d+$/.test(cleanId)) return res.json([]);

    const rows = await query(`
      SELECT TOP 50
        CAST(dt.GoodID AS VARCHAR(50)) AS GoodID,
        COALESCE(NULLIF(MAX(LTRIM(RTRIM(g.GoodName1))), ''), NULLIF(MAX(LTRIM(RTRIM(dt.GoodName))), '')) AS GoodName,
        COUNT(DISTINCT hd.SOID) AS OrderCount,
        CAST(SUM(CASE WHEN ISNULL(dt.GoodQty2, 0) > 0 THEN dt.GoodQty2 ELSE ISNULL(dt.GoodQty1, 0) END) AS DECIMAL(18,3)) AS TotalQty,
        MAX(hd.DocuDate) AS LastOrderDate
      FROM dbo.SOHD hd WITH (NOLOCK)
      INNER JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
      INNER JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      WHERE hd.CustID = @cid
        AND ISNULL(hd.DocuStatus, '') <> 'C'
        AND (hd.DocuType = 104 OR (hd.DocuType = 103 AND ISNULL(hd.DocuStatus, '') <> 'Y'))
        AND ISNULL(g.Inactive, 'A') = 'A'
        AND g.GoodGroupID IN (1003, 1004, 1005)
        AND g.GoodName1 NOT LIKE N'%ไม่ใช้%'
        AND g.GoodName1 NOT LIKE N'%ยกเลิก%'
        AND dt.GoodID IS NOT NULL
      GROUP BY dt.GoodID
      ORDER BY TotalQty DESC, OrderCount DESC
    `, { cid: { type: sql.Int, value: Number(cleanId) } });

    res.json(rows || []);
  } catch (e) {
    console.error('Error fetching customer top goods:', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/master/truck-plates — ทะเบียนรถเก่าของลูกค้า (autocomplete)
router.get('/truck-plates', async (req, res) => {
  try {
    const { custId } = req.query;
    if (!custId) return res.json([]);
    
    const inputs = { custId: { type: sql.NVarChar(20), value: custId } };
    const rows = await query(`
      SELECT DISTINCT TruckPlate AS Plate
      FROM wf.v_AllSalesOrders
      WHERE CustId = @custId AND TruckPlate IS NOT NULL AND TruckPlate <> ''
    `, inputs);
    
    res.json(rows.map(r => r.Plate));
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/trucks-stats — สถิติรถบรรทุกทั้งหมด
router.get('/trucks-stats', async (req, res) => {
  try {
    const { q } = req.query;
    const where = q 
      ? `AND (TruckPlate LIKE N'%' + @q + '%' OR CustName LIKE N'%' + @q + '%')`
      : '';
    const inputs = q ? { q: { type: sql.NVarChar(100), value: q } } : {};
    
    const rows = await query(`
      SELECT TOP 100
        TruckPlate AS truckPlate,
        MAX(CustName) AS custName,
        COUNT(*) AS count,
        MAX(CreatedAt) AS lastVisit
      FROM (
        SELECT so.TruckPlate, so.CustName, so.CreatedAt
        FROM wf.SalesOrder so
        WHERE so.TruckPlate IS NOT NULL AND so.TruckPlate <> '' AND so.Status NOT IN ('DRAFT', 'CANCELLED')
          AND so.CreatedAt >= DATEADD(month, -12, GETDATE())
        UNION ALL
        SELECT hd.TransRegistration AS TruckPlate, hd.CustName, ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.TransRegistration IS NOT NULL AND hd.TransRegistration <> ''
          AND hd.DocuDate >= DATEADD(month, -12, GETDATE())
          AND hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
      ) T
      WHERE TruckPlate IS NOT NULL AND TruckPlate <> ''
      ${where}
      GROUP BY TruckPlate
      ORDER BY count DESC
    `, inputs);
    
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/trucks/:plate/history — ประวัติวิ่งงานรถบรรทุก
router.get('/trucks/:plate/history', async (req, res) => {
  try {
    const plate = req.params.plate;
    const inputs = { plate: { type: sql.NVarChar(30), value: plate } };
    
    const rows = await query(`
      SELECT TOP 100
        T.CreatedAt AS date,
        ISNULL(T.WfRef, CAST(T.Id AS VARCHAR(50))) AS so,
        CAST(T.Id AS VARCHAR(50)) AS soId,
        ISNULL(SUM(sol.QtyTon), 0) AS qtyTon
      FROM (
        SELECT CAST(so.Id AS VARCHAR(50)) AS Id, so.WfRef, so.CreatedAt
        FROM wf.SalesOrder so
        WHERE so.TruckPlate = @plate AND so.Status NOT IN ('DRAFT', 'CANCELLED')
        UNION ALL
        SELECT CAST(hd.SOID AS VARCHAR(50)) AS Id, ISNULL(ext.WfRef, hd.DocuNo) AS WfRef, ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.TransRegistration = @plate AND hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
      ) T
      LEFT JOIN wf.v_AllSalesOrderLines sol ON sol.SoId = T.Id
      GROUP BY T.Id, T.WfRef, T.CreatedAt
      ORDER BY T.CreatedAt DESC
    `, inputs);
    
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/invoices — ใบกำกับ 107 + 202 (read-only)
router.get('/invoices', async (req, res) => {
  try {
    const { custId, dateFrom, dateTo } = req.query;
    const conditions = [`h.DocuType IN (107, 202)`];
    const inputs = {};
    if (custId) { conditions.push(`h.ARID = @custId`); inputs.custId = { type: sql.NVarChar(20), value: custId }; }
    if (dateFrom) { conditions.push(`h.DocuDate >= @dateFrom`); inputs.dateFrom = { type: sql.Date, value: dateFrom }; }
    if (dateTo) { conditions.push(`h.DocuDate <= @dateTo`); inputs.dateTo = { type: sql.Date, value: dateTo }; }
    const invScope = scopeFilter(await getVisibleScope(req.user), { empCol: 'h.EmpID', prefix: 'iv' });
    conditions.push(invScope.sql); Object.assign(inputs, invScope.inputs);
    const rows = await query(`
      SELECT TOP 500
        h.SOInvID, h.DocuNo, h.DocuType, h.DocuDate, h.ARID AS CustID,
        c.CustName AS CustName, h.NetAmnt AS TotalAmt, h.PostGL
      FROM dbo.SOInvHD h WITH (NOLOCK)
      LEFT JOIN dbo.EMCust c ON c.CustID = h.ARID
      WHERE ${conditions.join(' AND ')}
      ORDER BY h.DocuDate DESC, h.SOInvID DESC
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/aging — dashboard SO คงค้าง (TOP 200, 2 ปีจาก Jan 1)
const { createReadCache, scopedReadKey } = require('../services/read-cache');
const agingCache = createReadCache();
const AGING_TTL = 5 * 60 * 1000;

router.get('/aging', async (req, res) => {
  try {
    const bust = req.query.bust === '1';
    const agingScope = await getVisibleScope(req.user);
    const ag = scopeFilter(agingScope, { empCol: 'hd.EmpID', prefix: 'ag' });
    const db = require('../db');
    const rows = await agingCache.get(scopedReadKey(db.getTarget(), db.getDbName(), agingScope), async () => {

    const { wfQuery: wq } = require('../db');
    const result = await wq(`
      WITH BaseCandidateSo AS (
        SELECT 
          hd.SOID AS SoIdKey,
          CAST(hd.SOID AS VARCHAR(50)) AS SoId,
          hd.DocuNo AS WfRef,
          hd.CustName,
          ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), 'ไม่ระบุรถ') AS TruckPlate,
          CAST(hd.DocuDate AS DATETIME2) AS CreatedAt,
          CASE WHEN hd.PkgStatus = 'Y' THEN 'PICKING' ELSE 'CONFIRMED' END AS BaseStatus,
          ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) as rn
        FROM dbo.SOHD hd WITH (NOLOCK)
        WHERE hd.DocuType IN (103, 104)
          AND ISNULL(hd.DocuStatus, '') <> 'C'
          AND ISNULL(hd.clearflag, 'N') <> 'Y'
          AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
          AND hd.DocuDate >= DATEADD(DAY, -180, GETDATE())
          AND ${ag.sql}
      ),
      CandidateSo AS (
        SELECT TOP 1000 * FROM BaseCandidateSo WHERE rn = 1
        ORDER BY CreatedAt ASC, SoId ASC
      ),
      OpenSo AS (
        SELECT TOP 200
          c.SoIdKey,
          c.SoId,
          c.WfRef,
          c.CustName,
          c.TruckPlate,
          c.CreatedAt,
          CASE WHEN ext.IsLoaded = 1 THEN 'LOADED' ELSE c.BaseStatus END AS Status
        FROM CandidateSo c
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON ext.SOID = c.SoId
        WHERE ext.WeighOutWeight IS NULL
        ORDER BY c.CreatedAt ASC, c.SoId ASC
      )
      SELECT
        o.CustName,
        CAST(ISNULL(line.GoodID, '') AS VARCHAR(50)) AS GoodCode,
        line.GoodName,
        ISNULL(line.QtyTon, 0) AS QtyTon,
        DATEDIFF(DAY, o.CreatedAt, GETUTCDATE()) AS DaysOpen,
        o.Status,
        o.WfRef,
        o.SoId,
        o.CreatedAt,
        o.TruckPlate
      FROM OpenSo o
      OUTER APPLY (
        SELECT 
          dt.GoodID,
          dt.GoodName,
          CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3)) AS QtyTon
        FROM dbo.SODT dt WITH (NOLOCK)
        WHERE dt.SOID = o.SoIdKey
      ) line
      ORDER BY DaysOpen DESC
    `, ag.inputs);
    return result.recordset || [];
    }, { ttl: agingScope.all ? AGING_TTL : 30000, force: bust });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/aging/search — full aging search with pagination
// query params: q (search), status (comma-sep), page (default 1), pageSize (default 50), dateFrom (YYYY-MM-DD)
router.get('/aging/search', async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const isExport = req.query.export === '1';
    const page     = Math.max(1, parseInt(req.query.page)     || 1);
    const pageSize = isExport ? 5000 : Math.min(200, Math.max(10, parseInt(req.query.pageSize) || 50));
    const q        = (req.query.q || '').trim();
    const isAllDates = req.query.all === '1' || req.query.allDates === '1';
    const dateFrom = req.query.dateFrom || (isAllDates ? '2000-01-01' : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    const dateTo   = req.query.dateTo || null;
    const minDays  = parseInt(req.query.minDays) || 0;
    const statusRaw = (req.query.status || '').trim();
    const statuses = statusRaw ? statusRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const offset   = isExport ? 0 : (page - 1) * pageSize;

    // Build WHERE clauses
    const conditions = [
      `hd.DocuDate >= @dateFrom`,
      `hd.DocuType IN (103, 104)`,
      `ISNULL(hd.DocuStatus, '') <> 'C'`,
      `ISNULL(hd.clearflag, 'N') <> 'Y'`,
      `ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'`,
    ];
    const inputs = { dateFrom: { type: sql.Date, value: new Date(dateFrom) } };
    if (dateTo) {
      conditions.push(`hd.DocuDate <= @dateTo`);
      inputs.dateTo = { type: sql.Date, value: new Date(dateTo) };
    }
    if (minDays > 0) {
      conditions.push(`DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME), GETDATE()) >= @minDays`);
      inputs.minDays = { type: sql.Int, value: minDays };
    }
    const searchScope = scopeFilter(await getVisibleScope(req.user), { empCol: 'hd.EmpID', prefix: 'as' });
    conditions.push(searchScope.sql);
    Object.assign(inputs, searchScope.inputs);
    if (statuses.length) {
      conditions.push(`CASE
        WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
        WHEN ext.IsLoaded = 1 THEN 'LOADED'
        WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
        ELSE 'CONFIRMED'
      END IN (${statuses.map(s => `'${s.replace(/'/g,"''"  )}'`).join(',')})`);
    }
    if (q) {
      conditions.push(`(hd.CustName LIKE @q OR hd.DocuNo LIKE @q OR CONVERT(NVARCHAR(50), dt.GoodID) LIKE @q OR dt.GoodName LIKE @q)`);
      inputs.q = { type: sql.NVarChar(200), value: `%${q}%` };
    }
    const where = conditions.join(' AND ');

    const countResult = await wq(`
      WITH BaseCandidateSo AS (
        SELECT 
          hd.SOID,
          hd.DocuNo,
          ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) as rn
        FROM dbo.SOHD hd WITH (NOLOCK)
        WHERE hd.DocuDate >= @dateFrom
          AND hd.DocuType IN (103, 104)
          AND ISNULL(hd.DocuStatus, '') <> 'C'
          AND ISNULL(hd.clearflag, 'N') <> 'Y'
          AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
      ),
      CandidateSo AS (
        SELECT SOID FROM BaseCandidateSo WHERE rn = 1
      )
      SELECT COUNT(DISTINCT hd.SOID) AS Total
      FROM dbo.SOHD hd WITH (NOLOCK)
      JOIN CandidateSo c ON c.SOID = hd.SOID
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
        ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
      WHERE ${where}
    `, inputs);
    const total = countResult.recordset[0]?.Total || 0;

    const dataResult = await wq(`
      WITH BaseCandidateSo AS (
        SELECT 
          hd.SOID,
          hd.DocuNo,
          ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) as rn
        FROM dbo.SOHD hd WITH (NOLOCK)
        WHERE hd.DocuDate >= @dateFrom
          AND hd.DocuType IN (103, 104)
          AND ISNULL(hd.DocuStatus, '') <> 'C'
          AND ISNULL(hd.clearflag, 'N') <> 'Y'
          AND ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'
      ),
      CandidateSo AS (
        SELECT SOID FROM BaseCandidateSo WHERE rn = 1
      ),
      RawItems AS (
        SELECT hd.CustName,
               CAST(dt.GoodID AS VARCHAR(50)) AS GoodCode,
               dt.GoodName,
               SUM(CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3))) AS QtyTon,
               DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME), GETDATE()) AS DaysOpen,
               CASE
                 WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
                 WHEN ext.IsLoaded = 1 THEN 'LOADED'
                 WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
                 ELSE 'CONFIRMED'
               END AS Status,
               hd.DocuNo AS WfRef,
               CAST(hd.SOID AS VARCHAR(50)) AS SoId,
               CONVERT(VARCHAR(10), hd.DocuDate, 120) AS CreatedAt,
               ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), 'ไม่ระบุรถ') AS TruckPlate
        FROM dbo.SOHD hd WITH (NOLOCK)
        JOIN CandidateSo c ON c.SOID = hd.SOID
        JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
        WHERE ${where}
        GROUP BY hd.CustName, dt.GoodID, dt.GoodName, hd.DocuDate, hd.PkgStatus,
                 ext.IsLoaded, ext.WeighOutWeight, hd.DocuNo, hd.SOID, hd.TransRegistration
      ),
      NumberedItems AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY DaysOpen DESC, SoId DESC, GoodCode DESC) AS RowNum
        FROM RawItems
      )
      SELECT CustName, GoodCode, GoodName, QtyTon, DaysOpen, Status, WfRef, SoId, CreatedAt, TruckPlate
      FROM NumberedItems
      WHERE RowNum > @offset AND RowNum <= (@offset + @pageSize)
      ORDER BY RowNum ASC
    `, { ...inputs, offset: { type: sql.Int, value: offset }, pageSize: { type: sql.Int, value: pageSize } });

    res.json({ total, page, pageSize, data: dataResult.recordset || [] });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/truck-types — รายการประเภทรถบรรทุก
router.get('/truck-types', async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const rows = await wq(`
      SELECT Id, Name, MaxWeightMain, MaxWeightTrailer, IsActive
      FROM wf.TruckType
      ORDER BY MaxWeightMain ASC
    `);
    res.json(rows.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/master/truck-types — สร้างประเภทรถบรรทุกใหม่
router.post('/truck-types', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const { Id, Name, MaxWeightMain, MaxWeightTrailer, IsActive } = req.body;
    
    await wq(`
      INSERT INTO wf.TruckType (Id, Name, MaxWeightMain, MaxWeightTrailer, IsActive)
      VALUES (@id, @name, @main, @trailer, @active)
    `, {
      id: { type: sql.VarChar(50), value: Id },
      name: { type: sql.NVarChar(100), value: Name },
      main: { type: sql.Decimal(10,2), value: MaxWeightMain },
      trailer: { type: sql.Decimal(10,2), value: MaxWeightTrailer ?? null },
      active: { type: sql.Bit, value: IsActive ?? 1 }
    });
    res.json({ ok: true, id: Id });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/master/truck-types/:id — อัปเดตประเภทรถบรรทุก
router.put('/truck-types/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const id = req.params.id;
    const { Name, MaxWeightMain, MaxWeightTrailer, IsActive } = req.body;
    
    const __rows = await dboWrite(`
      UPDATE wf.TruckType
      SET Name = @name, MaxWeightMain = @main, MaxWeightTrailer = @trailer, 
          IsActive = @active, UpdatedAt = GETUTCDATE()
      WHERE Id = @id
    `, {
      id: { type: sql.VarChar(50), value: id },
      name: { type: sql.NVarChar(100), value: Name },
      main: { type: sql.Decimal(10,2), value: MaxWeightMain },
      trailer: { type: sql.Decimal(10,2), value: MaxWeightTrailer ?? null },
      active: { type: sql.Bit, value: IsActive ?? 1 }
    });
    if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบประเภทรถนี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/master/truck-types/:id — ลบประเภทรถบรรทุก (ถ้าจำเป็น) หรือแค่ set inactive
router.delete('/truck-types/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const id = req.params.id;
    const __rows = await dboWrite(`DELETE FROM wf.TruckType WHERE Id = @id`, {
      id: { type: sql.VarChar(50), value: id }
    });
    if (!affected(__rows)) return res.status(404).json({ message: 'ไม่พบประเภทรถนี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/system-settings — อ่านตั้งค่าระบบครบทุกนโยบาย พร้อมข้อมูล Version และคำอธิบาย
router.get('/system-settings', async (req, res) => {
  try {
    const { getPolicySettings } = require('../services/policy-contract');
    const result = await getPolicySettings();
    res.json({
      ok: true,
      settings: result.settings,
      raw: result.raw,
      rows: result.rows,
      versions: result.versions,
      snapshots: result.snapshots,
      currentRevision: result.currentRevision,
      definitions: result.definitions,
    });
  } catch (e) {
    console.error('[master/system-settings:get]', e);
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/master/system-settings — ปรับเปลี่ยนค่าตั้งค่าระบบ (ADMIN Only + Whitelist + Versioned + Audit)
router.patch('/system-settings', requireCapability('settings.manage'), async (req, res) => {
  try {
    const { getPolicySettings, updatePolicySettings, clearSettingCache } = require('../services/policy-contract');
    const body = req.body || {};

    // Support payload as { updates: { ... }, reasonCode, reasonText } or flat { ...updates, reasonCode, reasonText }
    let updates = {};
    let reasonCode = body.reasonCode || body.reason || null;
    let reasonText = body.reasonText || body.note || null;
    let expectedRevision = body.expectedRevision;
    let effectiveFrom = body.effectiveFrom || null;

    if (body.updates && typeof body.updates === 'object') {
      updates = { ...body.updates };
    } else {
      for (const [k, v] of Object.entries(body)) {
        if (!['reasonCode', 'reasonText', 'reason', 'note', 'expectedRevision', 'effectiveFrom'].includes(k)) {
          updates[k] = v;
        }
      }
    }

    const userId = req.user?.sub || req.user?.username || req.user?.id || 'ADMIN';
    const auditRes = await updatePolicySettings({
      updates,
      userId,
      reasonCode,
      reasonText,
      expectedRevision,
      effectiveFrom,
      ipAddress: req.ip,
    });
    clearSettingCache();

    const refreshed = await getPolicySettings();
    res.json({
      ok: true,
      ...auditRes,
      settings: refreshed.settings,
      raw: refreshed.raw,
      versions: refreshed.versions,
      snapshots: refreshed.snapshots,
      currentRevision: refreshed.currentRevision,
    });
  } catch (e) {
    console.error('[master/system-settings:patch]', e);
    const status = e.status || 500;
    res.status(status).json({ message: e.message || 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่า' });
  }
});

module.exports = router;
