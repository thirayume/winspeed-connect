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
const { sql, query, dboWrite, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { getBangkokDateString } = require('../services/so-pickup-policy');
const { parseNullableAgingInput, getCreditAgingPolicyBounds } = require('../services/credit-service');
// R12 O-4: SALES/MANAGER see their own + team documents (ADMIN/C_LEVEL/ACCOUNTING and operational roles see all)
const { getVisibleScope, scopeFilter } = require('../services/visible-scope');
const { nativeChainInScope } = require('../services/native-document-scope');
const { hasRole } = require('../services/role-capabilities');
const { businessIds, actorPerspective } = require('../services/business-identity');
const { customerPredicate, customerVisible } = require('../services/secondary-customer-scope');
const { withActorScope } = require('../services/secondary-read-scope');
const { currentActorId, hasColumn } = require('../services/request-context');
const { logChangeEvent } = require('../services/policy-contract');

async function masterReadScopes(user) {
  const effective = await getVisibleScope(user);
  const actor = actorPerspective(user);
  return { effective, actor: actor === user ? effective : await getVisibleScope(actor) };
}

async function masterChainVisible(user, chain) {
  const scopes = await masterReadScopes(user);
  return await nativeChainInScope(scopes.effective, chain) && await nativeChainInScope(scopes.actor, chain);
}

async function visibleTicketTrace(res, result) {
  let window;
  try { window = await require('../services/global-data-window-store').readGlobalDataWindow(); }
  catch { res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); return false; }
  if (!require('../services/ticket-trace-window').traceWithinWindow(result, window.businessDate)) {
    res.status(409).json({ code: 'TICKET_TRACE_BEFORE_DATA_START', message: 'ซ่อนรายละเอียดเอกสารต้นทางที่เก่ากว่าวันเริ่มข้อมูลหรือยังตรวจสอบวันที่ไม่ได้ ตั๋วที่ยังมียอดสามารถเลือกใช้ได้ตามเงื่อนไขเดิม' });
    return false;
  }
  return true;
}

function intersectMasterScopes(scopes, empCol, prefix) {
  const effective = scopeFilter(scopes.effective, { empCol, prefix: `${prefix}Effective` });
  const actor = scopeFilter(scopes.actor, { empCol, prefix: `${prefix}Actor` });
  return { sql: `(${effective.sql}) AND (${actor.sql})`, inputs: { ...effective.inputs, ...actor.inputs } };
}

async function customerRequestAuditIdentity(user) {
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective) throw Object.assign(new Error('CUSTOMER_REQUEST_IDENTITY_REQUIRED'), { status: 401 });
  if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId'))) {
    throw Object.assign(new Error('CUSTOMER_REQUEST_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
  }
  return ids;
}

async function truckTypeAuditIdentity(user) {
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective) throw Object.assign(new Error('ไม่สามารถยืนยันตัวตนได้'), { status: 401 });
  if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId'))) {
    throw Object.assign(new Error('ไม่สามารถบันทึกตัวตนผู้ทำแทนได้'), { status: 503 });
  }
  return ids;
}

async function policyAuditIdentity(user) {
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective) throw Object.assign(new Error('ไม่สามารถยืนยันตัวตนได้'), { status: 401 });
  if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId'))) {
    throw Object.assign(new Error('ไม่สามารถบันทึกตัวตนผู้ทำแทนได้'), { status: 503 });
  }
  return ids;
}

async function readTruckType(tx, id) {
  const r = await transactionQuery(tx, `SELECT Id, Name, MaxWeightMain, MaxWeightTrailer, IsActive
    FROM wf.TruckType WITH (UPDLOCK, HOLDLOCK) WHERE Id=@id`, { id: { type: sql.VarChar(50), value: id } });
  return r.recordset?.[0] || null;
}

async function auditTruckType(tx, req, identity, id, action, before, after) {
  await logChangeEvent(tx, { entityType: 'TRUCK_TYPE', entityId: String(id), action,
    beforeJson: before, afterJson: after, userId: identity.effective, ipAddress: req.ip });
}

async function requireCustomerGroupProcs() {
  const r = await wfQuery(`SELECT CASE WHEN OBJECT_ID('wf.sp_CustomerGroupCreate','P') IS NOT NULL
    AND OBJECT_ID('wf.sp_CustomerGroupUpdate','P') IS NOT NULL
    AND OBJECT_ID('wf.sp_CustomerGroupDelete','P') IS NOT NULL THEN 1 ELSE 0 END AS Ready`);
  if (Number(r.recordset?.[0]?.Ready) !== 1)
    throw Object.assign(new Error('ฐานข้อมูลยังไม่พร้อมสำหรับการแก้ไขกลุ่มลูกค้า กรุณาติดต่อผู้ดูแลระบบ'), { status: 503 });
}

async function readCustomerGroup(tx, id) {
  const r = await transactionQuery(tx, `SELECT CustGroupID, CustGroupCode, CustGroupName, CustGroupNameEng, Remark
    FROM dbo.EMCustGroup WITH (UPDLOCK,HOLDLOCK) WHERE CustGroupID=@id`, { id: { type: sql.Int, value: id } });
  return r.recordset?.[0] || null;
}

async function execMasterTxProc(tx, proc, inputs, outputs) {
  const r = tx.request();
  for (const [name, value] of Object.entries(inputs)) r.input(name, value.type, value.value);
  for (const [name, type] of Object.entries(outputs)) r.output(name, type);
  const result = await r.execute(proc);
  return result.output || {};
}

async function auditCustomerGroup(tx, req, identity, id, action, before, after) {
  await logChangeEvent(tx, { entityType: 'CUSTOMER_GROUP', entityId: String(id), action,
    beforeJson: before, afterJson: after, userId: identity.effective, ipAddress: req.ip });
}

async function transactionQuery(tx, statement, inputs) {
  const request = tx.request();
  for (const [name, { type, value }] of Object.entries(inputs)) request.input(name, type, value);
  return request.query(statement);
}

async function requireCustomerMutationProcs() {
  const r = await wfQuery(`SELECT CASE WHEN OBJECT_ID('wf.sp_MasterUpdateCustomer','P') IS NOT NULL
    AND OBJECT_ID('wf.sp_MasterCustomerClassification','P') IS NOT NULL THEN 1 ELSE 0 END AS Ready`);
  if (Number(r.recordset?.[0]?.Ready) !== 1)
    throw Object.assign(new Error('ฐานข้อมูลยังไม่พร้อมสำหรับการแก้ไขลูกค้า กรุณาติดต่อผู้ดูแลระบบ'), { status: 503 });
}

async function customerMutationSnapshot(tx, id) {
  const r = await transactionQuery(tx, `SELECT c.CustID,c.CustName,c.ContTel,c.ContTel1,c.SaleAreaID,c.CustGroupID,c.BillEmp,c.Inactive,
    x.Remark,x.PrimaryPhone,x.SecondaryPhone,x.Email,x.LineId,x.CreditLimit AS ExtCreditLimit,x.AgingDays AS ExtAgingDays,
    x.SalespersonUserId,x.SaleAreaId AS ExtSaleAreaId,x.RegionCode,x.CustGroupId AS ExtCustGroupId,
    cm.CreditLimit,cm.AgingDays,cm.CreditHold
    FROM dbo.EMCust c WITH (UPDLOCK,HOLDLOCK)
    LEFT JOIN wf.CustomerExt x WITH (UPDLOCK,HOLDLOCK) ON x.CustId=c.CustID
    LEFT JOIN wf.CreditMaster cm WITH (UPDLOCK,HOLDLOCK) ON cm.CustId=CONVERT(VARCHAR(20),c.CustID)
    WHERE c.CustID=@id`, { id: { type: sql.VarChar(20), value: String(id) } });
  if ((r.recordset || []).length > 1) throw Object.assign(new Error('ข้อมูลลูกค้าซ้ำ กรุณาติดต่อผู้ดูแลระบบ'), { status: 409 });
  return r.recordset?.[0] || null;
}

async function customerMutationScope(tx, user, id, predicate) {
  const r = await transactionQuery(tx, `SELECT TOP 1 1 AS ok FROM dbo.EMCust c WITH (UPDLOCK,HOLDLOCK)
    LEFT JOIN wf.CustomerExt cx WITH (UPDLOCK,HOLDLOCK) ON cx.CustId=c.CustID
    WHERE c.CustID=@visibilityCustId AND ${predicate.sql}`, {
    ...predicate.inputs, visibilityCustId: { type: sql.Int, value: Number(id) },
  });
  if (!r.recordset?.length) throw Object.assign(new Error('ไม่พบรหัสลูกค้านี้'), { status: 404 });
}

async function masterPriceSnapshot(tx, id, listNo, lock = false) {
  const hint = lock ? ' WITH (UPDLOCK,HOLDLOCK)' : '';
  const result = await transactionQuery(tx, `SELECT hd.SetPriceID, hd.DocuNo, hd.CustID, hd.BeginDate, hd.EndDate,
    dt.ListNo, dt.ListID AS GoodID, dt.GoodPriceNet, dt.startgoodqty, dt.endgoodqty
    FROM dbo.EMSetPriceHD hd${hint} JOIN dbo.EMSetPriceDT dt${hint} ON dt.SetPriceID=hd.SetPriceID
    WHERE hd.SetPriceID=@id AND dt.ListNo=@listNo`, {
    id: { type: sql.Int, value: id }, listNo: { type: sql.Int, value: listNo },
  });
  if (result.recordset?.length > 1) throw new Error('PRICE_SNAPSHOT_AMBIGUOUS');
  return result.recordset?.[0] || null;
}

async function createMasterPriceInTransaction(tx, req, identity, item) {
  const values = {
    GoodID: { type: sql.Int, value: Number(item.GoodID) },
    CustID: { type: sql.VarChar(20), value: item.CustID || null },
    GoodPriceNet: { type: sql.Decimal(18, 4), value: Number(item.GoodPriceNet) },
    BeginDate: { type: sql.Date, value: String(item.BeginDate).slice(0, 10) },
    EndDate: { type: sql.Date, value: String(item.EndDate).slice(0, 10) },
    StartQty: { type: sql.Decimal(18, 4), value: item.startgoodqty || 1 },
    EndQty: { type: sql.Decimal(18, 4), value: item.endgoodqty || 999999 },
  };
  const result = await execMasterTxProc(tx, 'wf.sp_MasterCreatePrice', values,
    { NewSetPriceID: sql.Int, DocuNo: sql.VarChar(50) });
  const id = Number(result.NewSetPriceID);
  if (!Number.isSafeInteger(id) || id <= 0 || !result.DocuNo) throw new Error('PRICE_CREATE_OUTPUT_INVALID');
  const after = await masterPriceSnapshot(tx, id, 1);
  if (!after) throw new Error('PRICE_CREATE_SNAPSHOT_INVALID');
  await logChangeEvent(tx, { entityType: 'MASTER_PRICE', entityId: String(id), action: 'CREATE', beforeJson: null,
    afterJson: after, userId: identity.effective, ipAddress: req.ip });
  return { id, docuNo: result.DocuNo };
}

router.use(requireAuth);

// ถ้าไม่ตรวจว่ามีแถวถูกแก้จริง endpoint จะตอบ 200 ทั้งที่ไม่มีอะไรเปลี่ยน
// ซึ่งเท่ากับสร้างหลักฐานของสิ่งที่ไม่เคยเกิดขึ้น
const affected = result => Number(result?.rowsAffected?.[0] || 0);

// R12 items 14–16 (O-2): master-data writes go through wf procedures (migration 146) when present —
// the least-privilege app login has no UPDATE/INSERT on dbo.EMCust / EMGood / EMSetPrice*.
async function hasMasterProcs() {
  const { wfQuery } = require('../db');
  try {
    const r = await wfQuery("SELECT CASE WHEN OBJECT_ID('wf.sp_MasterCreatePrice', 'P') IS NOT NULL AND OBJECT_ID('wf.sp_MasterUpdateCustomer', 'P') IS NOT NULL THEN 1 ELSE 0 END AS HasProcs");
    return Number(r.recordset?.[0]?.HasProcs || 0) === 1;
  } catch { return false; }
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
const masterGoods = require('../services/master-goods');
function sendMasterError(res, e) {
  const err = masterGoods.toHttpError(e);
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message, code: err.code });
  console.error(e);
  const m = masterWriteStatus(e);
  res.status(m.status).json({ message: m.message });
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

// Cache metadata per live connection pool, not globally by table name. A
// replaced pool after a database profile change must discover its own schema.
const customerFilterColumnsByPool = new WeakMap();


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
  let pool = null;
  try { pool = require('../db').pools(); } catch { /* isolated tests can run without a pool */ }
  if (pool && customerFilterColumnsByPool.has(pool)) return customerFilterColumnsByPool.get(pool);
  const load = (async () => {
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
    return found;
  })();
  if (pool) customerFilterColumnsByPool.set(pool, load);
  try { return await load; } catch (err) { if (pool) customerFilterColumnsByPool.delete(pool); throw err; }
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
    // Customer rows include contact and credit information. Check both the
    // effective and actual actor on every database, retaining unassigned customers.
    const predicate = await customerPredicate(req.user);
    conditions.push(predicate.sql);
    Object.assign(inputs, predicate.inputs);
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
    const identity = await policyAuditIdentity(req.user);
    await requireCustomerGroupProcs();
    const created = await wfTransaction(async tx => {
      const result = await execMasterTxProc(tx, 'wf.sp_CustomerGroupCreate', {
        Code: { type: sql.VarChar(20), value: CustGroupCode ? String(CustGroupCode).trim() : null },
        Name: { type: sql.VarChar(100), value: nameVal },
        NameEng: { type: sql.VarChar(100), value: CustGroupNameEng || '' },
        Remark: { type: sql.VarChar(255), value: Remark || null },
      }, { NewId: sql.Int, NewCode: sql.VarChar(20) });
      const nextId = Number(result.NewId);
      if (!Number.isSafeInteger(nextId) || nextId <= 0) throw new Error('ไม่สามารถยืนยันกลุ่มลูกค้าใหม่');
      const after = await readCustomerGroup(tx, nextId);
      if (!after) throw new Error('ไม่สามารถตรวจผลการสร้างกลุ่มลูกค้า');
      await auditCustomerGroup(tx, req, identity, nextId, 'CREATE', null, after);
      return { id: nextId, code: result.NewCode };
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    res.status(201).json({ ok: true, CustGroupID: created.id, CustGroupCode: created.code, CustGroupName: nameVal });
  } catch (e) { console.error(e); res.status(e.status || (e.number === 2627 || e.number === 2601 ? 409 : 500)).json({ message: e.message }); }
});

// PUT /api/master/customer-groups/:id — แก้ไขกลุ่มลูกค้า
router.put('/customer-groups/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { CustGroupName, CustGroupNameEng, Remark } = req.body || {};
    if (!CustGroupName || !String(CustGroupName).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อกลุ่มลูกค้า' });
    }
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'รหัสกลุ่มลูกค้าไม่ถูกต้อง' });
    const identity = await policyAuditIdentity(req.user);
    await requireCustomerGroupProcs();
    const changed = await wfTransaction(async tx => {
      const before = await readCustomerGroup(tx, id);
      if (!before) return false;
      const result = await execMasterTxProc(tx, 'wf.sp_CustomerGroupUpdate', {
        Id: { type: sql.Int, value: id },
        Name: { type: sql.VarChar(100), value: String(CustGroupName).trim() },
        NameEng: { type: sql.VarChar(100), value: CustGroupNameEng !== undefined ? CustGroupNameEng : null },
        Remark: { type: sql.VarChar(255), value: Remark || null },
      }, { Affected: sql.Int });
      if (Number(result.Affected) !== 1) throw Object.assign(new Error('ข้อมูลกลุ่มลูกค้าเปลี่ยนแปลง กรุณาลองใหม่'), { status: 409 });
      const after = await readCustomerGroup(tx, id);
      if (!after) throw new Error('ไม่สามารถตรวจผลการแก้กลุ่มลูกค้า');
      await auditCustomerGroup(tx, req, identity, id, 'UPDATE', before, after);
      return true;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    if (!changed) return res.status(404).json({ message: 'ไม่พบกลุ่มลูกค้า' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// DELETE /api/master/customer-groups/:id — ลบกลุ่มลูกค้า (มี Safeguard ตรวจสอบว่าไม่มีลูกค้าผูกอยู่)
router.delete('/customer-groups/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'รหัสกลุ่มลูกค้าไม่ถูกต้อง' });
    const identity = await policyAuditIdentity(req.user);
    await requireCustomerGroupProcs();
    const changed = await wfTransaction(async tx => {
      const before = await readCustomerGroup(tx, id);
      if (!before) return false;
      const result = await execMasterTxProc(tx, 'wf.sp_CustomerGroupDelete', {
        Id: { type: sql.Int, value: id },
      }, { Affected: sql.Int, Blocked: sql.Int });
      if (Number(result.Blocked) > 0) throw Object.assign(new Error('ไม่สามารถลบกลุ่มลูกค้าที่มีข้อมูลอ้างอิงอยู่'), { status: 400 });
      if (Number(result.Affected) !== 1) throw Object.assign(new Error('ข้อมูลกลุ่มลูกค้าเปลี่ยนแปลง กรุณาลองใหม่'), { status: 409 });
      await auditCustomerGroup(tx, req, identity, id, 'DELETE', before, null);
      return true;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    if (!changed) return res.status(404).json({ message: 'ไม่พบกลุ่มลูกค้า' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// GET /api/master/customer-requests
router.get('/customer-requests', async (req, res) => {
  try {
    let dataWindow;
    try { dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow(); }
    catch { return res.status(503).json({ code:'DATA_WINDOW_UNAVAILABLE', message:'ไม่สามารถอ่านวันเริ่มข้อมูลได้' }); }
    const ids=businessIds(req.user);
    if (!ids.actor || !ids.effective) return res.status(401).json({message:'ไม่พบผู้ใช้'});
    const actor=actorPerspective(req.user);
    const conditions=['cr.CreatedAt >= @globalStartUtc'];
    const inputs={globalStartUtc:{type:sql.DateTime2,value:dataWindow.utcInstant}};
    if (!hasRole(req.user,'ADMIN','MANAGER')) { conditions.push('cr.RequestedBy = @uid'); inputs.uid={type:sql.Int,value:ids.effective}; }
    if (!hasRole(actor,'ADMIN','MANAGER')) { conditions.push('cr.RequestedBy = @actor'); inputs.actor={type:sql.Int,value:ids.actor}; }
    const rows = await query(`
      SELECT TOP 200
             cr.*,
             requester.DisplayName AS RequestedByName,
             reviewer.DisplayName AS ReviewedByName
      FROM wf.CustomerRequest cr
      LEFT JOIN wf.AppUser requester ON requester.Id = cr.RequestedBy
      LEFT JOIN wf.AppUser reviewer ON reviewer.Id = cr.ReviewedBy
      WHERE ${conditions.join(' AND ')}
      ORDER BY CASE WHEN cr.Status = 'PENDING' THEN 0 ELSE 1 END, cr.CreatedAt DESC
    `, inputs);
    res.json(rows);
  } catch (e) {
    if (e.code === 'IDENTITY_BINDING_INVALID') return res.status(409).json({code:e.code});
    console.error('[customer-requests/list]', e); res.status(500).json({ message:'โหลดคำขอลูกค้าไม่สำเร็จ' });
  }
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

    const ids = await customerRequestAuditIdentity(req.user);
    const id = await wfTransaction(async tx => {
    const result = await transactionQuery(tx, `
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
      uid: { type: sql.Int, value: ids.effective },
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
    const id = Number(result.recordset?.[0]?.Id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('CUSTOMER_REQUEST_INSERT_FAILED');
    await logChangeEvent(tx, { entityType: 'CUSTOMER_REQUEST', entityId: String(id), action: 'CREATE',
      afterJson: { status: 'PENDING' }, reasonCode: 'CUSTOMER_REQUEST', userId: String(ids.effective) });
    return id;
    });
    res.status(201).json({ id });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
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
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return res.status(400).json({ message: 'รหัสคำขอไม่ถูกต้อง' });
    const ids = await customerRequestAuditIdentity(req.user);
    let dataWindow;
    try { dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow(); }
    catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถอ่านวันเริ่มข้อมูลได้' }); }
    await wfTransaction(async tx => {
    // Hold the row until the request, linked master data and audit commit together.
    const reqRow = (await transactionQuery(tx, `SELECT * FROM wf.CustomerRequest WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id AND CreatedAt >= @globalStartUtc`, {
      id: { type: sql.Int, value: id }, globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant }
    })).recordset?.[0];
    if (!reqRow) throw Object.assign(new Error('ไม่พบคำขอนี้'), { status: 404 });

    // The first decision stands. Under the row lock a second reviewer sees the status the
    // first one committed and is refused instead of overwriting it. Allowed moves:
    // PENDING -> APPROVED / REJECTED / COMPLETED, APPROVED -> COMPLETED. REJECTED and
    // COMPLETED are final. A client may also send the status it was looking at.
    const currentStatus = String(reqRow.Status || '').trim().toUpperCase();
    const allowedMoves = { PENDING: ['APPROVED', 'REJECTED', 'COMPLETED'], APPROVED: ['COMPLETED'] };
    const expectedStatus = req.body?.expectedStatus == null ? null : String(req.body.expectedStatus).trim().toUpperCase();
    if ((expectedStatus && expectedStatus !== currentStatus) || !(allowedMoves[currentStatus] || []).includes(nextStatus)) {
      throw Object.assign(new Error(`คำขอนี้ถูกพิจารณาไปแล้ว (สถานะปัจจุบัน ${currentStatus}) กรุณาโหลดข้อมูลใหม่`),
        { status: 409, code: 'CUSTOMER_REQUEST_ALREADY_REVIEWED' });
    }

    const finalWinspeedCustId = winspeedCustId || reqRow.WinspeedCustId;

    await transactionQuery(tx, `
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
      uid: { type: sql.Int, value: ids.effective },
    });

    // If completed and has WINSpeed CustID, sync metadata into wf.CustomerExt and wf.CreditMaster
    if (nextStatus === 'COMPLETED' && finalWinspeedCustId) {
        await transactionQuery(tx, `
          IF EXISTS (SELECT 1 FROM wf.CustomerExt WITH (UPDLOCK, HOLDLOCK) WHERE CustId = @custId)
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

          MERGE wf.CreditMaster WITH (HOLDLOCK) AS t USING (SELECT @custId AS CustId) AS s ON t.CustId = s.CustId
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
          uid: { type: sql.Int, value: ids.effective },
        });
    }
    await logChangeEvent(tx, { entityType: 'CUSTOMER_REQUEST', entityId: String(id), action: 'REVIEW',
      beforeJson: { status: reqRow.Status }, afterJson: { status: nextStatus, masterSynced: Boolean(nextStatus === 'COMPLETED' && finalWinspeedCustId) },
      reasonCode: 'CUSTOMER_REQUEST', userId: String(ids.effective) });
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
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
    if (CreditHold !== undefined && typeof CreditHold !== 'boolean')
      return res.status(400).json({ message: 'สถานะระงับเครดิตไม่ถูกต้อง' });
    if (CreditLimit != null && (!Number.isFinite(Number(CreditLimit)) || Number(CreditLimit)<0))
      return res.status(400).json({ message: 'วงเงินเครดิตไม่ถูกต้อง' });
    if (AgingDays != null && String(AgingDays).trim()!=='' && (!Number.isInteger(Number(AgingDays)) || Number(AgingDays)<0))
      return res.status(400).json({ message: 'จำนวนวันเครดิตไม่ถูกต้อง' });

    const primaryPhoneVal = PrimaryPhone !== undefined ? PrimaryPhone : Tel;
    const secondaryPhoneVal = SecondaryPhone !== undefined ? SecondaryPhone : Mobile;

    const identity = await customerRequestAuditIdentity(req.user);
    await requireCustomerMutationProcs();
    const predicate = await customerPredicate(req.user);
    await wfTransaction(async tx => {
    const query = async (text, inputs) => (await transactionQuery(tx, text, inputs || {})).recordset || [];
    await customerMutationScope(tx, req.user, id, predicate);
    const before = await customerMutationSnapshot(tx, id);
    if (!before) throw Object.assign(new Error('ไม่พบรหัสลูกค้านี้'), { status: 404 });

    // 1. Update ERP
    const __rows = affectedOf(await execMasterTxProc(tx, 'wf.sp_MasterUpdateCustomer', {
          CustID: { type: sql.VarChar(20), value: id },
          CustName: { type: sql.NVarChar(255), value: CustName ?? null },
          Tel: { type: sql.NVarChar(50), value: primaryPhoneVal ?? null },
          Mobile: { type: sql.NVarChar(50), value: secondaryPhoneVal ?? null },
        }, { Affected: sql.Int }));
    if (!affected(__rows)) throw Object.assign(new Error('ไม่พบรหัสลูกค้านี้'), { status: 404 });

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

    // Lookup salesperson user info if salespersonId provided
    const spId = salespersonId !== undefined ? salespersonId : employeeId;
    let spUser = null;
    if (spId) {
      const uRes = await query(`SELECT Id, DisplayName, EmpId FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id = @uid AND IsActive=1`, { uid: { type: sql.Int, value: Number(spId) } });
      spUser = uRes?.[0] || null;
      if (!spUser || !Number.isSafeInteger(Number(spUser.EmpId)) || Number(spUser.EmpId)<=0)
        throw Object.assign(new Error('ผู้ดูแลลูกค้ายังไม่มีรหัสพนักงาน WinSpeed ที่ใช้งานได้'), { status: 409 });
    }
    if (areaId && resolvedAreaId === null) throw Object.assign(new Error('ไม่พบเขตการขาย'), { status: 400 });
    if (groupId && (!Number.isSafeInteger(Number(groupId)) || Number(groupId)<=0)) throw Object.assign(new Error('กลุ่มลูกค้าไม่ถูกต้อง'), { status: 400 });
    if (areaId !== undefined || groupId !== undefined || salespersonId !== undefined || employeeId !== undefined) {
      const changed = await execMasterTxProc(tx, 'wf.sp_MasterCustomerClassification', {
        CustID: { type: sql.VarChar(20), value: id }, HasArea: { type: sql.Bit, value: areaId !== undefined },
        AreaId: { type: sql.Int, value: resolvedAreaId }, HasGroup: { type: sql.Bit, value: groupId !== undefined },
        GroupId: { type: sql.Int, value: groupId ? Number(groupId) : null },
        HasBillEmp: { type: sql.Bit, value: salespersonId !== undefined || employeeId !== undefined },
        BillEmp: { type: sql.Int, value: spUser ? Number(spUser.EmpId) : null },
        HasInactive: { type: sql.Bit, value: false }, Inactive: { type: sql.Bit, value: null },
      }, { Affected: sql.Int });
      if (Number(changed.Affected)!==1) throw new Error('CUSTOMER_CLASSIFICATION_UPDATE_FAILED');
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
        uid: { type: sql.Int, value: identity.effective },
      });
    }
    const after = await customerMutationSnapshot(tx, id);
    if (!after) throw new Error('CUSTOMER_SNAPSHOT_UNAVAILABLE');
    await logChangeEvent(tx, { entityType:'CUSTOMER', entityId:String(id), action:'UPDATE',
      beforeJson:before, afterJson:after, userId:identity.effective, ipAddress:req.ip });
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    res.json({ ok: true });
  } catch (e) { console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message }); }
});

// DELETE /api/master/customers/:id (Soft Delete)
router.delete('/customers/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสลูกค้านี้' });
    const identity = await customerRequestAuditIdentity(req.user);
    const ready = await wfQuery("SELECT CASE WHEN OBJECT_ID('wf.sp_MasterSetCustomerInactive','P') IS NULL THEN 0 ELSE 1 END AS Ready");
    if (Number(ready.recordset?.[0]?.Ready) !== 1)
      return res.status(503).json({ message: 'ฐานข้อมูลยังไม่พร้อมสำหรับการปิดใช้งานลูกค้า กรุณาติดต่อผู้ดูแลระบบ' });
    await wfTransaction(async tx => {
      const params = { id: { type: sql.VarChar(20), value: id } };
      const read = async () => (await transactionQuery(tx, `SELECT CustID, Inactive, InactiveDate
        FROM dbo.EMCust WITH (UPDLOCK,HOLDLOCK) WHERE CustID=@id`, params)).recordset?.[0] || null;
      const before = await read();
      if (!before) throw Object.assign(new Error('ไม่พบรหัสลูกค้านี้'), { status: 404 });
      const result = await execMasterTxProc(tx, 'wf.sp_MasterSetCustomerInactive',
        { CustID: { type: sql.VarChar(20), value: id } }, { Affected: sql.Int });
      if (Number(result.Affected) !== 1) throw new Error('CUSTOMER_INACTIVE_UPDATE_FAILED');
      const after = await read();
      if (!after || after.Inactive !== 'I') throw new Error('CUSTOMER_INACTIVE_SNAPSHOT_INVALID');
      await logChangeEvent(tx, { entityType: 'CUSTOMER', entityId: String(id), action: 'DEACTIVATE',
        beforeJson: before, afterJson: after, userId: identity.effective, ipAddress: req.ip });
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
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
    if ([salespersonUserId,areaId,groupId,creditHold,inactive].every(value=>value===undefined))
      return res.status(400).json({ message: 'กรุณาระบุข้อมูลที่ต้องการแก้ไข' });
    if ((creditHold !== undefined && typeof creditHold !== 'boolean') || (inactive !== undefined && typeof inactive !== 'boolean'))
      return res.status(400).json({ message: 'สถานะเครดิตหรือสถานะใช้งานไม่ถูกต้อง' });
    const rawCustIds = custIds.map(String);
    const validIds = rawCustIds.every(id => isMasterId(id) && Number.isSafeInteger(Number(id)) && Number(id)>0 && Number(id)<=2147483647);
    const cleanCustIds = rawCustIds.map(id=>String(Number(id))).sort((a,b)=>Number(a)-Number(b));
    if (!validIds || cleanCustIds.length > 1000 || new Set(cleanCustIds).size !== cleanCustIds.length) {
      return res.status(400).json({ message: 'ไม่พบรหัสลูกค้าที่ถูกต้อง' });
    }

    const identity = await customerRequestAuditIdentity(req.user);
    await requireCustomerMutationProcs();
    const predicate = await customerPredicate(req.user);
    await wfTransaction(async tx => {
    const query = async (text, inputs) => (await transactionQuery(tx, text, inputs || {})).recordset || [];

    // Lookup salesperson if provided
    let spUser = null;
    if (salespersonUserId) {
      const uRes = await query(`SELECT Id, DisplayName, EmpId FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id = @uid AND IsActive=1`, { uid: { type: sql.Int, value: Number(salespersonUserId) } });
      spUser = uRes?.[0] || null;
      if (!spUser || !Number.isSafeInteger(Number(spUser.EmpId)) || Number(spUser.EmpId)<=0)
        throw Object.assign(new Error('ผู้ดูแลลูกค้ายังไม่มีรหัสพนักงาน WinSpeed ที่ใช้งานได้'), { status: 409 });
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

    if (areaId && resolvedAreaId === null) throw Object.assign(new Error('ไม่พบเขตการขาย'), { status: 400 });
    if (groupId && (!Number.isSafeInteger(Number(groupId)) || Number(groupId)<=0)) throw Object.assign(new Error('กลุ่มลูกค้าไม่ถูกต้อง'), { status: 400 });
    const uid = identity.effective;

    // Process all customers
    for (const custId of cleanCustIds) {
      await customerMutationScope(tx, req.user, custId, predicate);
      const before = await customerMutationSnapshot(tx, custId);
      if (!before) throw Object.assign(new Error('ไม่พบรหัสลูกค้านี้'), { status: 404 });
      // Native changes and app-side changes must succeed with the same audit.
      if (hasArea || hasGroup || hasSp || hasInactive) {
        const changed = await execMasterTxProc(tx, 'wf.sp_MasterCustomerClassification', {
          CustID: { type: sql.VarChar(20), value: custId }, HasArea: { type: sql.Bit, value: hasArea },
          AreaId: { type: sql.Int, value: resolvedAreaId }, HasGroup: { type: sql.Bit, value: hasGroup },
          GroupId: { type: sql.Int, value: groupId ? Number(groupId) : null }, HasBillEmp: { type: sql.Bit, value: hasSp },
          BillEmp: { type: sql.Int, value: spUser ? Number(spUser.EmpId) : null },
          HasInactive: { type: sql.Bit, value: hasInactive }, Inactive: { type: sql.Bit, value: hasInactive ? Boolean(inactive) : null },
        }, { Affected: sql.Int });
        if (Number(changed.Affected)!==1) throw new Error('CUSTOMER_CLASSIFICATION_UPDATE_FAILED');
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
      const after = await customerMutationSnapshot(tx, custId);
      if (!after) throw new Error('CUSTOMER_SNAPSHOT_UNAVAILABLE');
      await logChangeEvent(tx, { entityType:'CUSTOMER', entityId:String(custId), action:'BATCH_UPDATE',
        beforeJson:before, afterJson:after, userId:identity.effective, ipAddress:req.ip });
    }
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });

    res.json({ ok: true, count: cleanCustIds.length, message: `อัปเดตข้อมูลลูกค้า ${cleanCustIds.length} รายสำเร็จ` });
  } catch (e) {
    console.error('[master/customers:batch-edit]', e);
    const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message });
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

// PATCH /api/master/goods/:id — code, name, group (WinSpeed, through wf.sp_MasterUpdateGood) and Sale-App extras
router.patch('/goods/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const keys = ['GoodCode', 'GoodName', 'GoodGroupID', 'BagPerTon', 'WeightKgPerBag', 'ImageUrl'];
    if (!keys.some(k => body[k] !== undefined)) return res.status(400).json({ message: 'ไม่มีข้อมูลที่ต้องแก้ไข' });
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    if (body.GoodName !== undefined && !String(body.GoodName ?? '').trim()) return res.status(400).json({ message: 'ชื่อสินค้าต้องไม่ว่าง' });
    if (body.GoodCode !== undefined && !String(body.GoodCode ?? '').trim()) return res.status(400).json({ message: 'รหัสสินค้าต้องไม่ว่าง' });
    res.json(await masterGoods.updateGood(req.user, id, body));
  } catch (e) { sendMasterError(res, e); }
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

// PATCH /api/master/goods/:id/status — เปิดจำหน่าย ('A') หรือ งดจำหน่าย ('I') (wf.sp_MasterSetGoodStatus)
router.patch('/goods/:id/status', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isMasterId(id)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    const statusVal = String(req.body?.inactive || 'I').toUpperCase() === 'A' ? 'A' : 'I';
    res.json(await masterGoods.setStatus(req.user, id, statusVal));
  } catch (e) { sendMasterError(res, e); }
});

// ── WinSpeed goods, goods groups and giveaway goods: create / delete (owner 18 Nov 2026) ──
// Rules: docs/sale-app/handover/WINSPEED-MASTER-DATA-RULES.md. Writes go through the wf procedures of
// migration 248 only (services/master-goods.js); nothing here writes dbo directly.

// DELETE /api/master/goods/:id/permanent — remove a good nothing uses (WinSpeed or Sale-App); else 409
router.delete('/goods/:id/permanent', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    if (!isMasterId(req.params.id)) return res.status(404).json({ message: 'ไม่พบรหัสสินค้านี้' });
    res.json(await masterGoods.deleteGood(req.user, req.params.id));
  } catch (e) { sendMasterError(res, e); }
});

// POST /api/master/goods — new good in any group, WinSpeed settings copied from a template good of that group
router.post('/goods', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try { res.status(201).json(await masterGoods.createGood(req.user, req.body || {})); }
  catch (e) { sendMasterError(res, e); }
});

// POST /api/master/giveaways — new giveaway good (group 1005); code PMnnnnn when none is given
router.post('/giveaways', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try { res.status(201).json(await masterGoods.createGiveaway(req.user, req.body || {})); }
  catch (e) { sendMasterError(res, e); }
});

router.get('/good-units', async (req, res) => {
  try { res.json(await masterGoods.listUnits()); } catch (e) { sendMasterError(res, e); }
});
router.get('/good-groups', async (req, res) => {
  try { res.json(await masterGoods.listGroups()); } catch (e) { sendMasterError(res, e); }
});
router.post('/good-groups', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try { res.status(201).json(await masterGoods.saveGroup(req.user, null, req.body || {})); } catch (e) { sendMasterError(res, e); }
});
router.put('/good-groups/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    if (!isMasterId(req.params.id)) return res.status(404).json({ message: 'ไม่พบกลุ่มสินค้านี้' });
    res.json(await masterGoods.saveGroup(req.user, Number(req.params.id), req.body || {}));
  } catch (e) { sendMasterError(res, e); }
});
router.delete('/good-groups/:id', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    if (!isMasterId(req.params.id)) return res.status(404).json({ message: 'ไม่พบกลุ่มสินค้านี้' });
    res.json(await masterGoods.deleteGroup(req.user, Number(req.params.id)));
  } catch (e) { sendMasterError(res, e); }
});

// GET /api/master/giveaway-goods — ของแถม (ดึงรายการที่ถูก Map หรือมี GoodGroupName='ของแถม' หรือรหัสของแถม)
router.get('/giveaway-goods', async (req, res) => {
  try {
    const { wfQuery } = require('../db');
    const { matchGiveawayItem, findMatchingQuota } = require('../services/giveaway-matcher');
    const { loadQuotaRows, committedOnOpenDrafts, quotaKey } = require('../services/giveaway-quota');
    let targetUserId = req.query.salesUserId ? Number(req.query.salesUserId) : req.user.sub;
    const excludeSoId = req.query.excludeSoId ? String(req.query.excludeSoId) : null;
    const { canViewSalesUser } = require('../services/visible-scope');
    if (req.user.identityMapping) {
      if (excludeSoId || (req.query.salesUserId && Number(req.query.salesUserId) !== Number(req.user.sub)))
        return res.status(409).json({ code: 'IDENTITY_MAPPING_REQUIRED' });
      targetUserId = businessIds(req.user).effective;
      const actor = actorPerspective(req.user);
      if (actor !== req.user && !await canViewSalesUser(actor, targetUserId))
        return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูโควต้าของพนักงานขาย' });
    }
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
        -- migration 249: an older giveaway good with a group-1005 twin is offered once, as the twin
        AND NOT EXISTS (SELECT 1 FROM wf.GiveawayGoodAlias ga WITH (NOLOCK) WHERE ga.OldGoodId = CONVERT(VARCHAR(50), g.GoodID))
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
    if (custId && !await customerVisible(req.user, custId))
      return res.status(404).json({ message: 'ไม่พบลูกค้า' });
    if (req.user.identityMapping && includeExpired === 'true')
      return res.status(403).json({ message: 'ไม่สามารถดูประวัติราคาในฐานนี้' });
    let window;
    try { window = await require('../services/global-data-window-store').readGlobalDataWindow(); }
    catch { return res.status(503).json({ message: 'ไม่สามารถอ่านวันเริ่มข้อมูลได้' }); }
    if (asOf && (!require('../services/data-window').isValidStartDate(String(asOf)) || String(asOf) < window.businessDate))
      return res.status(400).json({ message: 'วันที่ราคาต้องถูกต้องและไม่ก่อนวันเริ่มข้อมูล' });
    const targetDate = asOf ? String(asOf).slice(0, 10) : getBangkokDateString();
    const inputs = {
      custId: { type: sql.NVarChar(20), value: custId || null },
      targetDate: { type: sql.Date, value: targetDate },
      globalStartDate: { type: sql.Date, value: window.businessDate },
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
          AND (hd.EndDate IS NULL OR hd.EndDate >= @globalStartDate)
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

// PATCH /api/master/prices — update price and record the before/after atomically.
router.patch('/prices', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { SetPriceID, ListNo, GoodPriceNet, BeginDate, EndDate } = req.body || {};
    if (!isMasterId(SetPriceID) || !isMasterId(ListNo) || Number(SetPriceID) <= 0 || Number(ListNo) <= 0 || Number(SetPriceID) > 2147483647 || Number(ListNo) > 2147483647)
      return res.status(400).json({ message: 'Missing or invalid SetPriceID or ListNo' });
    if (!Number.isFinite(Number(GoodPriceNet)) || !(Number(GoodPriceNet) > 0)) return res.status(400).json({ message: 'ราคาต้องมากกว่า 0 (GoodPriceNet > 0)' });
    if (BeginDate && EndDate && String(BeginDate).slice(0, 10) > String(EndDate).slice(0, 10))
      return res.status(400).json({ message: 'BeginDate ต้องน้อยกว่าหรือเท่ากับ EndDate' });
    const identity = await policyAuditIdentity(req.user);
    if (!await hasMasterProcs()) return res.status(503).json({ message: 'ฐานข้อมูลยังไม่พร้อมสำหรับบันทึกราคา กรุณาติดต่อผู้ดูแลระบบ' });
    await wfTransaction(async tx => {
      const id = Number(SetPriceID), listNo = Number(ListNo);
      const before = await masterPriceSnapshot(tx, id, listNo, true);
      if (!before) throw Object.assign(new Error('ไม่พบรายการราคาที่ระบุ (SetPriceID หรือ ListNo ไม่ถูกต้อง)'), { status: 404 });
      const r = await execMasterTxProc(tx, 'wf.sp_MasterUpdatePrice', {
        SetPriceID: { type: sql.Int, value: id }, ListNo: { type: sql.Int, value: listNo },
        GoodPriceNet: { type: sql.Decimal(18, 4), value: Number(GoodPriceNet) },
        BeginDate: { type: sql.Date, value: BeginDate || null }, EndDate: { type: sql.Date, value: EndDate || null },
      }, { Affected: sql.Int });
      if (Number(r.Affected) !== 1) throw new Error('PRICE_UPDATE_AFFECTED_INVALID');
      const after = await masterPriceSnapshot(tx, id, listNo);
      if (!after) throw new Error('PRICE_UPDATE_SNAPSHOT_INVALID');
      await logChangeEvent(tx, { entityType: 'MASTER_PRICE', entityId: String(id), action: 'UPDATE',
        beforeJson: before, afterJson: after, userId: identity.effective, ipAddress: req.ip });
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    return res.json({ ok: true });
  } catch (e) { console.error(e); const m=masterWriteStatus(e); res.status(m.status).json({ message:m.message }); }
});

// POST /api/master/prices — create one WinSpeed price and audit in one transaction.
router.post('/prices', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const item = req.body || {};
    if (!isMasterId(item.GoodID) || Number(item.GoodID) <= 0 || Number(item.GoodID) > 2147483647)
      return res.status(400).json({ message: 'กรุณาระบุรหัสสินค้า (GoodID)' });
    if (!Number.isFinite(Number(item.GoodPriceNet)) || !(Number(item.GoodPriceNet) > 0))
      return res.status(400).json({ message: 'ราคาต้องมากกว่า 0 (GoodPriceNet > 0)' });
    if (!item.BeginDate || !item.EndDate) return res.status(400).json({ message: 'กรุณาระบุ BeginDate และ EndDate' });
    if (String(item.BeginDate).slice(0, 10) > String(item.EndDate).slice(0, 10))
      return res.status(400).json({ message: 'BeginDate ต้องน้อยกว่าหรือเท่ากับ EndDate' });
    const identity = await policyAuditIdentity(req.user);
    if (!await hasMasterProcs()) return res.status(503).json({ message: 'ฐานข้อมูลยังไม่พร้อมสำหรับบันทึกราคา กรุณาติดต่อผู้ดูแลระบบ' });
    const result = await wfTransaction(tx => createMasterPriceInTransaction(tx, req, identity, item),
      { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    return res.json({ ok:true, SetPriceID:result.id, DocuNo:result.docuNo });
  } catch (e) { console.error(e); const m=masterWriteStatus(e); res.status(m.status).json({ message:m.message }); }
});

// POST /api/master/prices/bulk-extend — all price documents and their audit commit together.
router.post('/prices/bulk-extend', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Empty items array' });
    for (const [i, item] of items.entries()) {
      if (!item || !isMasterId(item.GoodID) || Number(item.GoodID) <= 0 || Number(item.GoodID) > 2147483647 || !Number.isFinite(Number(item.GoodPriceNet)) || !(Number(item.GoodPriceNet) > 0)
          || !item.BeginDate || !item.EndDate || String(item.BeginDate).slice(0, 10) > String(item.EndDate).slice(0, 10)) {
        return res.status(400).json({ message: `รายการที่ ${i + 1}: ต้องมีรหัสสินค้า ราคามากกว่า 0 และวันเริ่มไม่เกินวันสิ้นสุด` });
      }
    }
    const identity = await policyAuditIdentity(req.user);
    if (!await hasMasterProcs()) {
      return res.status(503).json({ message: 'ฐานข้อมูลยังไม่พร้อมสำหรับบันทึกราคา กรุณาติดต่อผู้ดูแลระบบ' });
    }
    const created = await wfTransaction(async tx => {
      const ids = [];
      for (const item of items) {
        const result = await createMasterPriceInTransaction(tx, req, identity, item);
        ids.push(result.id);
      }
      return ids;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    return res.json({ ok: true, createdCount: created.length, SetPriceIDs: created });
  } catch (e) {
    console.error(e); const m = masterWriteStatus(e); res.status(m.status).json({ message: m.message });
  }
});

// GET /api/master/control-tickets — ตั๋วคุม & คูปอง (Universal Native Control Tickets)
router.get('/control-tickets', require('../services/control-ticket-list').listControlTickets);

// ── GET /api/master/control-tickets/alerts — รายการแจ้งเตือนตั๋วคุมใกล้หมดอายุ / หมดอายุ (SO-04) ──
router.get('/control-tickets/alerts', async (req, res) => {
  try {
    const { listTicketAlerts } = require('../services/ticket-policy');
    // The alert list has no owner column. It is shown only
    // when both identities see every record; otherwise it is empty, not an error.
    const scopes = await masterReadScopes(req.user);
    if (!scopes.effective.all || !scopes.actor.all) return res.json([]);
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
    if (!trace || !await masterChainVisible(req.user, trace)) {
      return res.status(404).json({ message: `ไม่พบข้อมูลตั๋วคุม ${req.params.docuNo}` });
    }
    if (!await visibleTicketTrace(res, trace)) return;
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
    const { inScope } = require('../services/visible-scope');
    const scopes = await masterReadScopes(req.user);
    if (scopes.effective.all && scopes.actor.all) return next();
    const exactId = req.body?.exactId || req.query?.exactId;
    const rows = (await query(`
      SELECT CAST(s.EmpID AS VARCHAR(20)) AS EmpID
      FROM dbo.WFCoupon c WITH (NOLOCK) JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
      WHERE ${exactId ? 'c.CouponID = @cid' : 'c.CouponNo = @no'}`, {
      cid: { type: sql.Int, value: Number(exactId) || 0 },
      no: { type: sql.VarChar(30), value: String(req.params.docuNo || '').trim() },
    })) || [];
    if (!rows.length || !rows.every(r => inScope(scopes.effective, { empId: r.EmpID }) && inScope(scopes.actor, { empId: r.EmpID }))) {
      return res.status(404).json({ message: 'ไม่พบตั๋วคุมนี้' });
    }
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

router.patch('/control-tickets/:docuNo/expiry', requireRole('SALES', 'ADMIN', 'C_LEVEL', 'MANAGER'), requireTicketInScope, async (req, res) => {
  try {
    const { updateTicketExpiryOverlay } = require('../services/ticket-policy');
    const identity = await customerRequestAuditIdentity(req.user);
    const { expiryDate, strictOverride, reasonCode, reasonText, exactId } = req.body || {};
    const exactCouponId = exactId || req.query?.exactId;

    const result = await updateTicketExpiryOverlay({
      docuNo: req.params.docuNo,
      exactId: exactCouponId,
      expiryDate,
      strictOverride: Boolean(strictOverride),
      reasonCode,
      reasonText,
      userId: identity.effective,
      userRole: req.user?.role,
      ipAddress: req.ip,
      authorizeInTransaction: async (tx, couponId) => {
        // Keep both the coupon and its issuing owner stable until audit and
        // overlay are committed; recheck both identities inside that lock.
        const locked = await transactionQuery(tx, `SELECT c.CouponID FROM dbo.WFCoupon c WITH (UPDLOCK,HOLDLOCK)
          JOIN dbo.SOHD h WITH (UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID WHERE c.CouponID=@cid`, {
          cid: { type: sql.Int, value: couponId },
        });
        const inTx = (text, inputs) => transactionQuery(tx, text, inputs || {});
        if (!locked.recordset?.length || !await require('../services/coupon-access-scope').couponVisible(req.user, couponId, inTx))
          throw Object.assign(new Error('ไม่พบตั๋วคุมนี้'), { status: 404 });
      },
    });

    res.json(result);
  } catch (e) {
    console.error('[master/control-tickets/expiry]', e);
    res.status(e.status || 400).json({ message: e.message });
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
    if (!await masterChainVisible(req.user, result)) {
      return res.status(404).json({ message: 'ไม่พบตั๋วคุมนี้' });
    }
    if (!result.resolved) {
      return res.status(404).json(result);
    }
    if (!await visibleTicketTrace(res, result)) return;
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
    const actor = actorPerspective(req.user);
    const drawActor = actor === req.user ? null : await getVisibleScope(actor);
    const couponDrawScope = withActorScope(scopeFilter(drawScope, { empCol: 'h104.EmpID', prefix: 'dcp' }), drawActor, { empCol: 'h104.EmpID' }, 'dcpa');
    const deliveryDrawScope = withActorScope(scopeFilter(drawScope, { empCol: 'h2.EmpID', prefix: 'ddv' }), drawActor, { empCol: 'h2.EmpID' }, 'ddva');
    let dataWindow;
    try { dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow(); }
    catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
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
        dataStart: { type: sql.Date, value: dataWindow.businessDate },
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
          AND rh.DocuDate >= @dataStart
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
      dataStart: { type: sql.Date, value: dataWindow.businessDate },
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
        AND h2.DocuDate >= @dataStart
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
    const actor = actorPerspective(req.user);
    const detailActor = actor === req.user ? null : await getVisibleScope(actor);
    const couponDetailScope = withActorScope(scopeFilter(detailScope, { empCol: 'issuer.EmpID', prefix: 'lcp' }), detailActor, { empCol: 'issuer.EmpID' }, 'lcpa');
    const draftDetailScope = withActorScope(scopeFilter(detailScope, { userCol: 'h.SalesUserId', prefix: 'ldr' }), detailActor, { userCol: 'h.SalesUserId' }, 'ldra');
    const nativeDetailScope = withActorScope(scopeFilter(detailScope, { empCol: 'h.EmpID', prefix: 'lso' }), detailActor, { empCol: 'h.EmpID' }, 'lsoa');
    const docuNo = String(req.params.docuNo).trim();
    const { exactId, entityType } = req.query;
    let parsedExactId = null;
    if (exactId !== undefined && exactId !== null) {
      if (!/^\d+$/.test(String(exactId).trim()) || !Number.isSafeInteger(Number(exactId)) || Number(exactId) <= 0 || Number(exactId) > 2147483647)
        return res.status(400).json({ message: 'INVALID_EXACT_ID' });
      parsedExactId = Number(exactId);
    }
    let dataWindow;
    try { dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow(); }
    catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
    const dataStart = { type: sql.Date, value: dataWindow.businessDate };
    const dataStartUtc = { type: sql.DateTime2, value: dataWindow.utcInstant };

    // Check 1: Coupon (C or D prefix or entityType === 'COUPON')
    if (/^[CD]\d+/i.test(docuNo) || entityType === 'COUPON') {
      const cpRows = await query(`
        SELECT 
          1 AS ListNo, c.CouponID AS _couponId, c.GoodID, g.GoodCode, c.GoodName,
          CAST(c.RemaQty AS DECIMAL(12, 3)) AS QtyTon,
          CAST(c.GoodPrice AS DECIMAL(12, 2)) AS PricePerTon,
          ISNULL(gx.BagPerTon, 20) AS BagPerTon
        FROM dbo.WFCoupon c WITH (READCOMMITTEDLOCK)
        JOIN dbo.SOHD issuer ON issuer.SOID = c.DocuID AND issuer.DocuType = 104
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
        LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = c.GoodID
        WHERE ((@exactId IS NOT NULL AND c.CouponID = @exactId)
           OR (@exactId IS NULL AND c.CouponNo = @docuNo))
          AND ${couponDetailScope.sql}
          AND (issuer.DocuDate >= @dataStart OR (c.RemaQty <> 0 AND ISNULL(issuer.DocuStatus, '') <> 'C'))
      `, {
        ...couponDetailScope.inputs,
        docuNo: { type: sql.NVarChar(50), value: docuNo },
        exactId: { type: sql.Int, value: parsedExactId },
        dataStart,
      });
      if (cpRows.length > 0 || (parsedExactId && entityType === 'COUPON')) {
        if (cpRows.length) {
          // Only inspect IDs returned by the actor/effective scope and window
          // query. Do not present an unsupported or changed settlement as an
          // apparently usable native quantity.
          const settlementSource=await require('../services/coupon-recovery-readiness').assertRecoveryReadiness(wfQuery);
          const schema = (await wfQuery("SELECT COL_LENGTH('wf.CouponReservation','ConsumedQty') AS ConsumedQtyColumn, OBJECT_ID('wf.CouponReservationSettlement','U') AS SettlementTable")).recordset?.[0];
          const hasSettlement = schema?.ConsumedQtyColumn != null && schema?.SettlementTable != null;
          const holds = require('../services/coupon-settlement-read-hold');
          if (!hasSettlement) await holds.assertLegacySettlementSchema(wfQuery);
          if (hasSettlement && (await holds.findSettlementSourceConflicts(wfQuery, cpRows.map(r => r._couponId),settlementSource)).size)
            throw Object.assign(new Error('พบตั๋วที่ต้องตรวจใบขนก่อนแสดงยอด กรุณาติดต่อผู้ดูแล'),
              { code: 'COUPON_SETTLEMENT_SOURCE_CHANGED', status: 409 });
        }
        return res.json(cpRows.map(({_couponId, ...row}) => row));
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
           OR (@exactId IS NULL AND h.WfRef = @docuNo))
          AND h.Status = 'DRAFT' AND h.CreatedAt >= @dataStartUtc
          AND ${draftDetailScope.sql}
        ORDER BY d.LineNum ASC
      `, {
        ...draftDetailScope.inputs,
        docuNo: { type: sql.NVarChar(30), value: docuNo },
        exactId: { type: sql.Int, value: parsedExactId },
        dataStartUtc,
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
        AND h.DocuDate >= @dataStart
        AND ${nativeDetailScope.sql}
      ORDER BY d.ListNo ASC
    `, {
      ...nativeDetailScope.inputs,
      docuNo: { type: sql.NVarChar(30), value: docuNo },
      exactId: { type: sql.Int, value: parsedExactId },
      dataStart,
    });
    res.json(rows);
  } catch (e) { console.error(e); res.status(e.status || 500).json({ code: e.code, message: e.message }); }
});

// GET /api/master/customers/:id/top-goods — สินค้าที่ลูกค้ารายนี้เคยซื้อ เรียงจากซื้อมากสุด บ่อยสุด ไปน้อยสุด
router.get('/customers/:id/top-goods', async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    if (!/^\d+$/.test(cleanId)) return res.json([]);
    if (!await customerVisible(req.user, cleanId))
      return res.status(404).json({ message: 'ไม่พบลูกค้า' });
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    let ownerWhere = '';
    const ownerInputs = {};
    {
      const actor = actorPerspective(req.user);
      const scopes = [await getVisibleScope(req.user), ...(actor === req.user ? [] : [await getVisibleScope(actor)])];
      for (const [index, scope] of scopes.entries()) {
        if (scope.all) continue;
        const owner = scopeFilter(scope, { userCol: 'topExt.SalesUserId', empCol: 'hd.EmpID', prefix: `topOwner${index}` });
        ownerWhere += ` AND ${owner.sql}`;
        Object.assign(ownerInputs, owner.inputs);
      }
    }

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
      LEFT JOIN wf.SalesOrderExt topExt WITH (NOLOCK) ON topExt.SOID = CONVERT(VARCHAR(50),hd.SOID)
      WHERE hd.CustID = @cid
        AND hd.DocuDate >= @globalStartDate
        AND ISNULL(hd.DocuStatus, '') <> 'C'
        AND (hd.DocuType = 104 OR (hd.DocuType = 103 AND ISNULL(hd.DocuStatus, '') <> 'Y'))
        AND ISNULL(g.Inactive, 'A') = 'A'
        AND g.GoodGroupID IN (1003, 1004, 1005)
        AND g.GoodName1 NOT LIKE N'%ไม่ใช้%'
        AND g.GoodName1 NOT LIKE N'%ยกเลิก%'
        AND dt.GoodID IS NOT NULL
        ${ownerWhere}
      GROUP BY dt.GoodID
      ORDER BY TotalQty DESC, OrderCount DESC
    `, { cid: { type: sql.Int, value: Number(cleanId) }, globalStartDate: { type: sql.Date, value: dataWindow.businessDate }, ...ownerInputs });

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
    if (!await customerVisible(req.user, custId))
      return res.status(404).json({ message: 'ไม่พบลูกค้า' });
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    // UAT 17 Nov 2026: reading wf.v_AllSalesOrders here (every native 103/104, joined on converted ids) ran past
    // the 30 s SQL limit on every call, and the bill screen's "เลือกรถ" waited on it. Read the two base tables by
    // customer instead (the same rows the view's two branches give), with the same window and visibility.
    let draftOwnerWhere = '', nativeOwnerWhere = '';
    const ownerInputs = {};
    {
      const actor = actorPerspective(req.user);
      const scopes = [await getVisibleScope(req.user), ...(actor === req.user ? [] : [await getVisibleScope(actor)])];
      for (const [index, scope] of scopes.entries()) {
        if (scope.all) continue;
        const draftOwner = scopeFilter(scope, { userCol: 's.SalesUserId', prefix: `plateDraft${index}` });
        const nativeOwner = scopeFilter(scope, { userCol: 'ext.SalesUserId', empCol: 'hd.EmpID', prefix: `plateNative${index}` });
        draftOwnerWhere += ` AND ${draftOwner.sql}`;
        nativeOwnerWhere += ` AND ${nativeOwner.sql}`;
        Object.assign(ownerInputs, draftOwner.inputs, nativeOwner.inputs);
      }
    }
    const custNo = /^\d{1,9}$/.test(String(custId).trim()) ? Number(String(custId).trim()) : null;
    const inputs = { custId: { type: sql.NVarChar(20), value: String(custId) }, custNo: { type: sql.Int, value: custNo },
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant }, globalStartDate: { type: sql.Date, value: dataWindow.businessDate }, ...ownerInputs };
    const rows = await query(`
      SELECT DISTINCT Plate FROM (
        SELECT s.TruckPlate AS Plate
        FROM wf.SalesOrder s WITH (NOLOCK)
        WHERE s.CustId = @custId AND s.TruckPlate IS NOT NULL AND s.TruckPlate <> ''
          AND NULLIF(LTRIM(RTRIM(s.ImportedDocuNo)), '') IS NULL AND s.CreatedAt >= @globalStartUtc
          ${draftOwnerWhere}
        UNION ALL
        SELECT hd.TransRegistration AS Plate
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
        WHERE @custNo IS NOT NULL AND hd.CustID = @custNo AND hd.DocuType IN (103, 104)
          AND hd.TransRegistration IS NOT NULL AND hd.TransRegistration <> '' AND hd.DocuDate >= @globalStartDate
          ${nativeOwnerWhere}
      ) p
    `, inputs);

    res.json(rows.map(r => r.Plate));
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/trucks-stats — สถิติรถบรรทุกทั้งหมด
router.get('/trucks-stats', async (req, res) => {
  try {
    const { q } = req.query;
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const where = q 
      ? `AND (TruckPlate LIKE N'%' + @q + '%' OR CustName LIKE N'%' + @q + '%')`
      : '';
    const inputs = { ...(q ? { q: { type: sql.NVarChar(100), value: q } } : {}),
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant }, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } };
    
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
          AND so.CreatedAt >= @globalStartUtc
        UNION ALL
        SELECT hd.TransRegistration AS TruckPlate, hd.CustName, ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.TransRegistration IS NOT NULL AND hd.TransRegistration <> ''
          AND hd.DocuDate >= DATEADD(month, -12, GETDATE())
          AND hd.DocuDate >= @globalStartDate
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
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const inputs = { plate: { type: sql.NVarChar(30), value: plate },
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant }, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } };
    
    const rows = await query(`
      SELECT TOP 100
        T.CreatedAt AS date,
        ISNULL(T.WfRef, CAST(T.Id AS VARCHAR(50))) AS so,
        CAST(T.Id AS VARCHAR(50)) AS soId,
        ISNULL(SUM(sol.QtyTon), 0) AS qtyTon
      FROM (
        SELECT CAST(so.Id AS VARCHAR(50)) AS Id, so.WfRef, so.CreatedAt
        FROM wf.SalesOrder so
        WHERE so.TruckPlate = @plate AND so.Status NOT IN ('DRAFT', 'CANCELLED') AND so.CreatedAt >= @globalStartUtc
        UNION ALL
        SELECT CAST(hd.SOID AS VARCHAR(50)) AS Id, ISNULL(ext.WfRef, hd.DocuNo) AS WfRef, ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.TransRegistration = @plate AND hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C' AND hd.DocuDate >= @globalStartDate
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
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const conditions = [`h.DocuType IN (107, 202)`, 'h.DocuDate >= @globalStartDate'];
    const inputs = { globalStartDate: { type: sql.Date, value: dataWindow.businessDate } };
    if (custId) { conditions.push(`h.ARID = @custId`); inputs.custId = { type: sql.NVarChar(20), value: custId }; }
    if (dateFrom) { conditions.push(`h.DocuDate >= @dateFrom`); inputs.dateFrom = { type: sql.Date, value: dateFrom }; }
    if (dateTo) { conditions.push(`h.DocuDate <= @dateTo`); inputs.dateTo = { type: sql.Date, value: dateTo }; }
    const invScope = intersectMasterScopes(await masterReadScopes(req.user), 'h.EmpID', 'iv');
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

// ── บิลค้างส่ง (aging) ────────────────────────────────────────────────────
// A bill counts as waiting to ship only while WinSpeed itself says goods are still to leave (owner, 18 Nov 2026:
// bills with a full 107 showed as 308 days outstanding). Before this, only a Sale-App weigh-out closed a bill, so
// every sale hauled through WinSpeed stayed "outstanding" for ever. The rules, checked on UAT data the same day:
//   103 booking   open while no sales order has taken it (DocuStatus Y means a 104 carries it: 7,762 of 7,762 had
//                 one) and while the scale has not weighed its truck out (dbo.WGHD Status 3, as the stock view does).
//                 The quantity is the booking's remaining quantity (SODT.RemaQty).
//   104 order     open while any fertilizer ticket still has quantity left (WFCoupon.RemaQty); the quantity is what
//                 the tickets still hold for that product. An order without tickets keeps its ordered quantity.
// A missing truck plate is normal in WinSpeed and plays no part. Bills are no longer de-duplicated by document
// number: the 103 and 104 counters overlap, and that hid about 360 open bookings behind unrelated orders.
const AGING_OPEN_EPSILON = 0.00005;
const agingTicketCtes = `
  TicketLeft AS (
    SELECT c.DocuID, c.GoodID, SUM(ISNULL(c.RemaQty, 0)) AS RemaQty
    FROM dbo.WFCoupon c WITH (NOLOCK)
    WHERE c.Docutype = 104
    GROUP BY c.DocuID, c.GoodID
  ),
  TicketBill AS (
    SELECT DocuID, SUM(RemaQty) AS RemaQty FROM TicketLeft GROUP BY DocuID
  )`;
const agingBaseConditions = [
  `hd.DocuType IN (103, 104)`,
  `ISNULL(hd.DocuStatus, '') <> 'C'`,
  `ISNULL(hd.clearflag, 'N') <> 'Y'`,
  `ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'`,
  `NOT (hd.DocuType = 103 AND RTRIM(ISNULL(hd.DocuStatus, '')) = 'Y')`,
  `NOT (hd.DocuType = 103 AND EXISTS (SELECT 1 FROM dbo.WGHD wg WITH (NOLOCK)
     WHERE wg.SPID = hd.SOID AND wg.WGType = 'SO' AND RTRIM(wg.Status) = '3'))`,
  `(hd.DocuType <> 104 OR tb.DocuID IS NULL OR tb.RemaQty > ${AGING_OPEN_EPSILON})`,
];
const agingStatusSql = `CASE
    WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
    WHEN ext.IsLoaded = 1 THEN 'LOADED'
    WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
    ELSE 'CONFIRMED'
  END`;
// One row per bill and product, with what is still to ship. `where` is ANDed with the rules above.
const agingItemsCte = (where) => `
  ${agingTicketCtes},
  RawItems AS (
    SELECT hd.CustName,
           CAST(dt.GoodID AS VARCHAR(50)) AS GoodCode,
           MAX(dt.GoodName) AS GoodName,
           CAST(CASE
             WHEN hd.DocuType = 104 AND tb.DocuID IS NOT NULL THEN ISNULL(MAX(tl.RemaQty), 0)
             WHEN hd.DocuType = 103 THEN SUM(ISNULL(dt.RemaQty, 0))
             ELSE SUM(ISNULL(dt.GoodQty2, 0))
           END AS DECIMAL(12,3)) AS QtyTon,
           DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME), GETDATE()) AS DaysOpen,
           ${agingStatusSql} AS Status,
           hd.DocuNo AS WfRef,
           CAST(hd.SOID AS VARCHAR(50)) AS SoId,
           CONVERT(VARCHAR(10), hd.DocuDate, 120) AS CreatedAt,
           NULLIF(LTRIM(RTRIM(hd.TransRegistration)), '') AS TruckPlate
    FROM dbo.SOHD hd WITH (NOLOCK)
    JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
    LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
    -- HASH: WFCoupon has no index on DocuID; a nested loop scans it once per line (9 s on UAT, 0.5 s hashed).
    LEFT HASH JOIN TicketBill tb ON tb.DocuID = hd.SOID
    LEFT HASH JOIN TicketLeft tl ON tl.DocuID = hd.SOID AND tl.GoodID = dt.GoodID
    WHERE ${[...agingBaseConditions, where].join(' AND ')}
    GROUP BY hd.CustName, dt.GoodID, hd.DocuDate, hd.DocuType, hd.PkgStatus, ext.IsLoaded, ext.WeighOutWeight,
             hd.DocuNo, hd.SOID, hd.TransRegistration, tb.DocuID
  ),
  OpenItems AS (
    SELECT * FROM RawItems WHERE QtyTon > ${AGING_OPEN_EPSILON}
  )`;

// GET /api/master/aging — dashboard: the 200 oldest open lines from the last 180 days
const { createReadCache, scopedReadKey } = require('../services/read-cache');
const agingCache = createReadCache();
const AGING_TTL = 5 * 60 * 1000;

router.get('/aging', async (req, res) => {
  try {
    const bust = req.query.bust === '1';
    const agingScopes = await masterReadScopes(req.user);
    const ag = intersectMasterScopes(agingScopes, 'hd.EmpID', 'ag');
    const db = require('../db');
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const cacheKey = JSON.stringify([scopedReadKey(db.getTarget(), db.getDbName(), agingScopes.effective),
      scopedReadKey(db.getTarget(), db.getDbName(), agingScopes.actor), dataWindow.businessDate]);
    const rows = await agingCache.get(cacheKey, async () => {
    const { wfQuery: wq } = require('../db');
    const where = [
      `hd.DocuDate >= DATEADD(DAY, -180, GETDATE())`,
      `hd.DocuDate >= @globalStartDate`,
      `ext.WeighOutWeight IS NULL`,
      ag.sql,
    ].join(' AND ');
    const result = await wq(`
      WITH ${agingItemsCte(where)}
      SELECT TOP 200 CustName, GoodCode, GoodName, QtyTon, DaysOpen, Status, WfRef, SoId, CreatedAt,
             ISNULL(TruckPlate, 'ไม่ระบุรถ') AS TruckPlate
      FROM OpenItems
      ORDER BY DaysOpen DESC, SoId ASC, GoodCode ASC
    `, { ...ag.inputs, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } });
    const agingRows = result.recordset || [];
    try { await require('../services/document-stage').attachAgingDocumentStages(agingRows, {query:wq,sql,dataWindow}); }
    catch (stageError) { console.warn('[aging] document stage unavailable:', stageError.code || '', stageError.message); }
    return agingRows;
    }, { ttl: agingScopes.effective.all && agingScopes.actor.all ? AGING_TTL : 30000, force: bust, staleMs: 10 * 60 * 1000 });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/aging/search — full aging search with pagination
// query params: q, status (comma-sep), page, pageSize (10–200), dateFrom/dateTo (YYYY-MM-DD), minDays, all, export
// total counts lines (bill × product), the unit the pages are cut in; bills and tons summarise the whole result.
const AGING_STATUSES = new Set(['CONFIRMED', 'LOADED', 'PICKING', 'SHIPPED']);
router.get('/aging/search', async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const isExport = req.query.export === '1';
    const page     = Math.max(1, parseInt(req.query.page)     || 1);
    const pageSize = isExport ? 5000 : Math.min(200, Math.max(10, parseInt(req.query.pageSize) || 50));
    const q        = (req.query.q || '').trim();
    const isAllDates = req.query.all === '1' || req.query.allDates === '1';
    const dateFrom = req.query.dateFrom || (isAllDates ? '2000-01-01' : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    const dateTo   = req.query.dateTo || null;
    const minDays  = parseInt(req.query.minDays) || 0;
    const statusRaw = (req.query.status || '').trim();
    const statuses = statusRaw ? statusRaw.split(',').map(s => s.trim().toUpperCase()).filter(s => AGING_STATUSES.has(s)) : [];
    const offset   = isExport ? 0 : (page - 1) * pageSize;

    const conditions = [`hd.DocuDate >= @dateFrom`, `hd.DocuDate >= @globalStartDate`];
    const inputs = { dateFrom: { type: sql.Date, value: new Date(dateFrom) },
      globalStartDate: { type: sql.Date, value: dataWindow.businessDate } };
    if (dateTo) {
      conditions.push(`hd.DocuDate <= @dateTo`);
      inputs.dateTo = { type: sql.Date, value: new Date(dateTo) };
    }
    if (minDays > 0) {
      conditions.push(`DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME), GETDATE()) >= @minDays`);
      inputs.minDays = { type: sql.Int, value: minDays };
    }
    const searchScope = intersectMasterScopes(await masterReadScopes(req.user), 'hd.EmpID', 'as');
    conditions.push(searchScope.sql);
    Object.assign(inputs, searchScope.inputs);
    // A truck weighed out in Sale-App has left; it shows only when the "shipped" filter asks for it.
    if (statuses.length) conditions.push(`${agingStatusSql} IN (${statuses.map(s => `'${s}'`).join(',')})`);
    else conditions.push(`ext.WeighOutWeight IS NULL`);
    if (q) {
      conditions.push(`(hd.CustName LIKE @q OR hd.DocuNo LIKE @q OR CONVERT(NVARCHAR(50), dt.GoodID) LIKE @q OR dt.GoodName LIKE @q)`);
      inputs.q = { type: sql.NVarChar(200), value: `%${q}%` };
    }
    const where = conditions.join(' AND ');

    const countResult = await wq(`
      WITH ${agingItemsCte(where)}
      SELECT COUNT(*) AS Total, COUNT(DISTINCT SoId) AS Bills, CAST(ISNULL(SUM(QtyTon), 0) AS DECIMAL(18,3)) AS Tons,
             ISNULL(MAX(DaysOpen), 0) AS MaxDays
      FROM OpenItems
    `, inputs);
    const summary = countResult.recordset[0] || {};
    const total = Number(summary.Total || 0);

    const dataResult = await wq(`
      WITH ${agingItemsCte(where)},
      NumberedItems AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY DaysOpen DESC, SoId DESC, GoodCode DESC) AS RowNum
        FROM OpenItems
      )
      SELECT CustName, GoodCode, GoodName, QtyTon, DaysOpen, Status, WfRef, SoId, CreatedAt,
             ISNULL(TruckPlate, 'ไม่ระบุรถ') AS TruckPlate
      FROM NumberedItems
      WHERE RowNum > @offset AND RowNum <= (@offset + @pageSize)
      ORDER BY RowNum ASC
    `, { ...inputs, offset: { type: sql.Int, value: offset }, pageSize: { type: sql.Int, value: pageSize } });

    const agingRows = dataResult.recordset || [];
    // Export may contain thousands of rows and does not display the chip.
    if (!isExport) {
      try { await require('../services/document-stage').attachAgingDocumentStages(agingRows, {query:wq,sql,dataWindow}); }
      catch (stageError) { console.warn('[aging-search] document stage unavailable:', stageError.code || '', stageError.message); }
    }
    res.json({ total, page, pageSize, bills: Number(summary.Bills || 0), tons: Number(summary.Tons || 0),
      maxDays: Number(summary.MaxDays || 0), data: agingRows });
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
    const { Id, Name, MaxWeightMain, MaxWeightTrailer, IsActive } = req.body;
    const identity = await truckTypeAuditIdentity(req.user);
    await wfTransaction(async tx => {
      if (await readTruckType(tx, Id)) throw Object.assign(new Error('ประเภทรถนี้มีอยู่แล้ว'), { status: 409 });
      await transactionQuery(tx, `INSERT INTO wf.TruckType (Id, Name, MaxWeightMain, MaxWeightTrailer, IsActive)
        VALUES (@id, @name, @main, @trailer, @active)`, {
      id: { type: sql.VarChar(50), value: Id },
      name: { type: sql.NVarChar(100), value: Name },
      main: { type: sql.Decimal(10,2), value: MaxWeightMain },
      trailer: { type: sql.Decimal(10,2), value: MaxWeightTrailer ?? null },
      active: { type: sql.Bit, value: IsActive ?? 1 }
      });
      const after = await readTruckType(tx, Id);
      if (!after) throw Object.assign(new Error('ไม่สามารถตรวจผลการสร้างประเภทรถ'), { status: 409 });
      await auditTruckType(tx, req, identity, Id, 'CREATE', null, after);
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    res.json({ ok: true, id: Id });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// PUT /api/master/truck-types/:id — อัปเดตประเภทรถบรรทุก
router.put('/truck-types/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = req.params.id;
    const { Name, MaxWeightMain, MaxWeightTrailer, IsActive } = req.body;
    const identity = await truckTypeAuditIdentity(req.user);
    const changed = await wfTransaction(async tx => {
      const before = await readTruckType(tx, id);
      if (!before) return false;
      const result = await transactionQuery(tx, `UPDATE wf.TruckType
      SET Name = @name, MaxWeightMain = @main, MaxWeightTrailer = @trailer, 
          IsActive = @active, UpdatedAt = GETUTCDATE()
      WHERE Id = @id`, {
      id: { type: sql.VarChar(50), value: id },
      name: { type: sql.NVarChar(100), value: Name },
      main: { type: sql.Decimal(10,2), value: MaxWeightMain },
      trailer: { type: sql.Decimal(10,2), value: MaxWeightTrailer ?? null },
      active: { type: sql.Bit, value: IsActive ?? 1 }
      });
      if (!affected(result)) throw Object.assign(new Error('ข้อมูลประเภทรถเปลี่ยนแปลง กรุณาลองใหม่'), { status: 409 });
      const after = await readTruckType(tx, id);
      if (!after) throw Object.assign(new Error('ไม่สามารถตรวจผลการแก้ไขประเภทรถ'), { status: 409 });
      await auditTruckType(tx, req, identity, id, 'UPDATE', before, after);
      return true;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    if (!changed) return res.status(404).json({ message: 'ไม่พบประเภทรถนี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// DELETE /api/master/truck-types/:id — ลบประเภทรถบรรทุก (ถ้าจำเป็น) หรือแค่ set inactive
router.delete('/truck-types/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = req.params.id;
    const identity = await truckTypeAuditIdentity(req.user);
    const changed = await wfTransaction(async tx => {
      const before = await readTruckType(tx, id);
      if (!before) return false;
      const result = await transactionQuery(tx, `DELETE FROM wf.TruckType WHERE Id = @id`, {
        id: { type: sql.VarChar(50), value: id }
      });
      if (!affected(result)) throw Object.assign(new Error('ข้อมูลประเภทรถเปลี่ยนแปลง กรุณาลองใหม่'), { status: 409 });
      await auditTruckType(tx, req, identity, id, 'DELETE', before, null);
      return true;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    if (!changed) return res.status(404).json({ message: 'ไม่พบประเภทรถนี้' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// GET /api/master/system-settings — อ่านตั้งค่าระบบครบทุกนโยบาย พร้อมข้อมูล Version และคำอธิบาย
// The global setting uses the deployment's primary DB, independent of a switched session.
router.get('/global-data-window', requireCapability('settings.manage'), async (req,res) => {
  if (req.user.isImpersonating) return res.status(403).json({message:'ไม่อนุญาตให้ตั้งค่าขณะทำรายการแทน'});
  try {
    const result=await require('../services/global-data-window-store').readGlobalDataWindow();
    res.set('Cache-Control','no-store').json({startDate:result.businessDate});
  } catch { res.status(503).json({message:'อ่านวันเริ่มข้อมูลจากฐานหลักไม่สำเร็จ'}); }
});
router.put('/global-data-window', requireCapability('settings.manage'), async (req,res) => {
  if (req.user.isImpersonating) return res.status(403).json({message:'ไม่อนุญาตให้ตั้งค่าขณะทำรายการแทน'});
  // Authorization and the audit actor must be resolved in the same primary DB that stores the policy.
  const db = require('../db');
  const primary = String(process.env.ONPREM_DB_NAME || '').trim();
  const current = db.getDbName();
  if (db.DEFAULT_TARGET === 'onprem' && current && current.toLowerCase() !== primary.toLowerCase()) {
    return res.status(409).json({message:'กรุณาสลับกลับฐานหลักของระบบก่อนแก้วันเริ่มข้อมูล'});
  }
  try {
    const {startDate,expectedStartDate}=req.body || {};
    const result=await require('../services/global-data-window-store').saveGlobalDataWindow({value:startDate,expectedValue:expectedStartDate,actorId:Number(req.user.sub)});
    res.set('Cache-Control','no-store').json({startDate:result.value,changed:result.changed});
  } catch(e) {
    const message=e.code==='STALE_DATA_WINDOW'?'วันเริ่มข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด':e.code==='INVALID_DATA_WINDOW'?'กรุณาระบุวันที่ที่ถูกต้อง':'บันทึกวันเริ่มข้อมูลไม่สำเร็จ';
    res.status(e.status||500).json({message});
  }
});

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

    const { effective: userId } = await policyAuditIdentity(req.user);
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
