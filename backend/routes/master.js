/**
 * master.js — READ-ONLY master data จาก dbo (ผ่าน wf views)
 * ⚠ ห้ามเขียน dbo ใดๆ ในไฟล์นี้
 */
const router = require('express').Router();
const { sql, query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const CUSTOMER_FILTER_CANDIDATES = {
  salesperson: ['SalesID', 'SaleID', 'SalesEmpID', 'SaleEmpID', 'SalesmanID', 'SalesManID'],
  employee: ['EmpID', 'EmployeeID', 'StaffID'],
  area: ['AreaID', 'AreaCode', 'ZoneID', 'CustAreaID', 'RegionID'],
  group: ['CustGroupID', 'CustGroupCode', 'CustTypeID', 'GroupID', 'PriceGroupID'],
};

let customerFilterColumnCache = null;

function bracketIdent(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

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

async function getCustomerFilterOptionsFor(key, column) {
  if (!column) return [];
  const col = bracketIdent(column);
  const joins = ['salesperson', 'employee'].includes(key)
    ? `LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON CONVERT(NVARCHAR(50), emp.EmpID) = CONVERT(NVARCHAR(50), c.${col})`
    : '';
  const labelExpr = ['salesperson', 'employee'].includes(key)
    ? `COALESCE(NULLIF(emp.EmpName, ''), CONVERT(NVARCHAR(100), c.${col}))`
    : `CONVERT(NVARCHAR(100), c.${col})`;
  return query(`
    SELECT TOP 200
           CONVERT(NVARCHAR(50), c.${col}) AS value,
           MAX(${labelExpr}) AS label,
           COUNT(*) AS count
    FROM dbo.EMCust c WITH (NOLOCK)
    ${joins}
    WHERE c.${col} IS NOT NULL AND CONVERT(NVARCHAR(50), c.${col}) <> ''
      AND ISNULL(c.Inactive, 'A') <> 'I'
    GROUP BY CONVERT(NVARCHAR(50), c.${col})
    ORDER BY MAX(${labelExpr})
  `);
}

// GET /api/master/customer-filters
router.get('/customer-filters', async (req, res) => {
  try {
    const columns = await getCustomerFilterColumns();
    const [salesperson, employee, area, group] = await Promise.all([
      getCustomerFilterOptionsFor('salesperson', columns.salesperson),
      getCustomerFilterOptionsFor('employee', columns.employee),
      getCustomerFilterOptionsFor('area', columns.area),
      getCustomerFilterOptionsFor('group', columns.group),
    ]);
    res.json({ columns, salesperson, employee, area, group });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/customers
router.get('/customers', async (req, res) => {
  try {
    const { q, salesperson, area, group, employee } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 50), 2000);
    const columns = await getCustomerFilterColumns();
    const conditions = [`ISNULL(c.Inactive, 'A') <> 'I'`];
    const inputs = { limit: { type: sql.Int, value: limit } };
    if (q) {
      conditions.push(`(c.CustName LIKE N'%' + @q + '%' OR c.CustID LIKE N'%' + @q + '%')`);
      inputs.q = { type: sql.NVarChar(100), value: q };
    }
    for (const [key, value] of Object.entries({ salesperson, area, group, employee })) {
      const column = columns[key];
      if (!value || !column) continue;
      conditions.push(`CONVERT(NVARCHAR(50), c.${bracketIdent(column)}) = @${key}`);
      inputs[key] = { type: sql.NVarChar(50), value: String(value) };
    }
    const selectExt = Object.entries(columns)
      .map(([key, column]) => column ? `CONVERT(NVARCHAR(50), c.${bracketIdent(column)}) AS ${key}Id` : `CAST(NULL AS NVARCHAR(50)) AS ${key}Id`)
      .join(',\n             ');
    const salesJoin = columns.salesperson
      ? `LEFT JOIN dbo.EMEmp salesEmp WITH (NOLOCK) ON CONVERT(NVARCHAR(50), salesEmp.EmpID) = CONVERT(NVARCHAR(50), c.${bracketIdent(columns.salesperson)})`
      : '';
    const empJoin = columns.employee
      ? `LEFT JOIN dbo.EMEmp custEmp WITH (NOLOCK) ON CONVERT(NVARCHAR(50), custEmp.EmpID) = CONVERT(NVARCHAR(50), c.${bracketIdent(columns.employee)})`
      : '';
    const rows = await query(
      `SELECT TOP (@limit)
              c.CustID, c.CustName, c.ContTel AS Tel, c.ContTel1 AS Mobile,
              ISNULL(cx.Remark, '') AS Remark, c.Inactive, ISNULL(c.CreditDays, 0) AS CreditDays,
              ${selectExt},
              ${columns.salesperson ? `salesEmp.EmpName` : `CAST(NULL AS NVARCHAR(255))`} AS salespersonName,
              ${columns.employee ? `custEmp.EmpName` : `CAST(NULL AS NVARCHAR(255))`} AS employeeName
       FROM dbo.EMCust c WITH (NOLOCK) 
       LEFT JOIN wf.CustomerExt cx ON cx.CustId = c.CustID
       ${salesJoin}
       ${empJoin}
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.CustName`,
      inputs
    );
    res.json(rows);
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

// POST /api/master/customer-requests — app-owned request only, no dbo.EMCust insert
router.post('/customer-requests', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { CustName, ContactName, Tel, Mobile, TaxId, Address, Note } = req.body || {};
    if (!CustName || !String(CustName).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อลูกค้า' });
    }
    const r = await query(`
      INSERT INTO wf.CustomerRequest
        (CustName, ContactName, Tel, Mobile, TaxId, Address, Note, RequestedBy)
      OUTPUT inserted.Id
      VALUES
        (@custName, @contactName, @tel, @mobile, @taxId, @address, @note, @uid)
    `, {
      custName: { type: sql.NVarChar(255), value: String(CustName).trim() },
      contactName: { type: sql.NVarChar(255), value: ContactName || null },
      tel: { type: sql.NVarChar(50), value: Tel || null },
      mobile: { type: sql.NVarChar(50), value: Mobile || null },
      taxId: { type: sql.NVarChar(50), value: TaxId || null },
      address: { type: sql.NVarChar(500), value: Address || null },
      note: { type: sql.NVarChar(500), value: Note || null },
      uid: { type: sql.Int, value: req.user.sub },
    });
    res.status(201).json({ id: r.recordset[0].Id });
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
      id: { type: sql.Int, value: Number(req.params.id) },
      status: { type: sql.NVarChar(20), value: nextStatus },
      winspeedCustId: { type: sql.NVarChar(20), value: winspeedCustId || null },
      reviewNote: { type: sql.NVarChar(500), value: reviewNote || null },
      uid: { type: sql.Int, value: req.user.sub },
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/master/customers/:id
router.patch('/customers/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { CustName, Tel, Mobile, Remark } = req.body;
    // 1. Update ERP
    await query(`
      UPDATE dbo.EMCust 
      SET CustName = COALESCE(@name, CustName), 
          ContTel = COALESCE(@tel, ContTel),
          ContTel1 = COALESCE(@mob, ContTel1)
      WHERE CustID = @id
    `, {
      name: { type: sql.NVarChar(255), value: CustName },
      tel: { type: sql.NVarChar(50), value: Tel },
      mob: { type: sql.NVarChar(50), value: Mobile },
      id: { type: sql.VarChar(20), value: id }
    });
    
    // 2. Update Ext
    if (Remark !== undefined) {
      await query(`
        IF EXISTS (SELECT 1 FROM wf.CustomerExt WHERE CustId = @id)
          UPDATE wf.CustomerExt SET Remark = @remark, UpdatedAt = GETUTCDATE() WHERE CustId = @id
        ELSE
          INSERT INTO wf.CustomerExt (CustId, Remark) VALUES (@id, @remark)
      `, {
        remark: { type: sql.NVarChar(500), value: Remark },
        id: { type: sql.VarChar(20), value: id }
      });
    }
    
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/master/customers/:id (Soft Delete)
router.delete('/customers/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await query(`UPDATE dbo.EMCust SET Inactive = 'I', InactiveDate = GETDATE() WHERE CustID = @id`, {
      id: { type: sql.VarChar(20), value: id }
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/goods — ปุ๋ย FG เท่านั้น (StockFlag='Y', MainGoodUnitID=1002)
router.get('/goods', async (req, res) => {
  try {
    const { q, limit = 800 } = req.query;
    const safeLimit = Math.max(50, Math.min(Number(limit) || 800, 2000));
    const whereClause = q
      ? `AND (g.GoodCode LIKE N'%' + @q + '%' OR g.GoodName1 LIKE N'%' + @q + '%')`
      : '';
    const inputs = {
      limit: { type: sql.Int, value: safeLimit },
      ...(q ? { q: { type: sql.NVarChar(100), value: q } } : {}),
    };
    const rows = await query(`
      SELECT TOP (@limit)
             g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             ISNULL(gx.BagPerTon, 20)         AS BagPerTon,
             ISNULL(gx.WeightKgPerBag, 50.0)  AS WeightKgPerBag,
             gg.GoodGroupName,
             g.StockQty,
             g.RemaQty,
             CAST(0 AS DECIMAL(18,3)) AS TotalQtyTon,
             CAST(0 AS DECIMAL(18,3)) AS TotalQtyTonThisYear
      FROM dbo.EMGood g WITH (NOLOCK)
      LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON g.GoodGroupID = gg.GoodGroupID
      WHERE g.StockFlag = 'Y' AND g.MainGoodUnitID = 1002 AND g.Inactive = 'A'
      ${whereClause}
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
router.patch('/goods/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { GoodName, BagPerTon, WeightKgPerBag, ImageUrl } = req.body;
    
    if (GoodName !== undefined) {
      await query(`UPDATE dbo.EMGood SET GoodName1 = @name WHERE GoodID = @id`, {
        name: { type: sql.NVarChar(255), value: GoodName },
        id: { type: sql.VarChar(20), value: id }
      });
    }
    
    if (BagPerTon !== undefined || WeightKgPerBag !== undefined || ImageUrl !== undefined) {
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
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/master/goods/:id (Soft Delete)
router.delete('/goods/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await query(`UPDATE dbo.EMGood SET Inactive = 'I', InactiveDate = GETDATE() WHERE GoodID = @id`, {
      id: { type: sql.VarChar(20), value: id }
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/giveaway-goods — ของแถม (ดึงเฉพาะรายการที่ถูก Map ไว้ในระบบโควต้าแล้วเท่านั้น)
router.get('/giveaway-goods', async (req, res) => {
  try {
    const y = new Date().getFullYear();
    const rows = await query(`
      SELECT g.GoodID, g.GoodCode, g.GoodName1 AS GoodName, m.Brand, m.ItemName, u.GoodUnitName AS UnitName,
             ISNULL(b.RemainingQty, 0) AS RemainingQty
      FROM dbo.EMGood g WITH (NOLOCK)
      INNER JOIN wf.GiveawayItemMapping m WITH (NOLOCK) ON g.GoodID = m.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON g.MainGoodUnitID = u.GoodUnitID
      LEFT JOIN wf.v_GiveawayBudgetStatus b WITH (NOLOCK) 
        ON b.Brand = m.Brand AND b.ItemName = m.ItemName 
        AND b.SalesUserId = @su AND b.PeriodYear = @y
      ORDER BY m.Brand, m.ItemName
    `, { su: { type: sql.Int, value: req.user.sub }, y: { type: sql.Int, value: y } });
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
// เลือกราคาที่ดีที่สุด: ลูกค้าเฉพาะก่อน → ราคากลาง (CustID NULL), เอา list ล่าสุด (BeginDate <= วันนี้)
// หมายเหตุ: demo data price list หมดอายุ 2025-05-31 → ใช้ "ราคาล่าสุดที่มีผล" ไม่บังคับ EndDate
router.get('/prices', async (req, res) => {
  try {
    const { custId, goodId } = req.query;
    const inputs = { custId: { type: sql.NVarChar(20), value: custId || null } };
    let goodFilter = '';
    if (goodId) { goodFilter = `AND dt.ListID = @goodId`; inputs.goodId = { type: sql.NVarChar(20), value: goodId }; }
    const rows = await query(`
      ;WITH ranked AS (
        SELECT dt.SetPriceID, dt.ListNo, dt.ListID AS GoodID, dt.GoodPriceNet, hd.CustID, hd.BeginDate, hd.EndDate,
               dt.startgoodqty, dt.endgoodqty,
               ROW_NUMBER() OVER (
                 PARTITION BY dt.ListID
                 ORDER BY CASE WHEN hd.CustID = @custId THEN 0 ELSE 1 END,
                          hd.BeginDate DESC, dt.startgoodqty ASC
               ) AS rn
        FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
        JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
        WHERE dt.GoodPriceNet > 0
          AND (hd.CustID = @custId OR hd.CustID IS NULL)
          ${goodFilter}
      )
      SELECT SetPriceID, ListNo, GoodID, GoodPriceNet, CustID, BeginDate, EndDate, startgoodqty, endgoodqty,
             CASE WHEN EndDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsExpired
      FROM ranked WHERE rn <= 5
      ORDER BY GoodID
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/master/prices — แก้ไขราคาและวันที่ (อัปเดตตรงเข้า ERP)
router.patch('/prices', async (req, res) => {
  try {
    const { SetPriceID, ListNo, GoodPriceNet, BeginDate, EndDate } = req.body;
    if (!SetPriceID || !ListNo) return res.status(400).json({ message: 'Missing SetPriceID or ListNo' });
    
    await query(`
      UPDATE dbo.EMSetPriceDT 
      SET GoodPriceNet = @price 
      WHERE SetPriceID = @setId AND ListNo = @listNo
    `, {
      price: { type: sql.Decimal(18, 4), value: GoodPriceNet },
      setId: { type: sql.Int, value: SetPriceID },
      listNo: { type: sql.Int, value: ListNo }
    });
    
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
      
      await query(`
        UPDATE dbo.EMSetPriceHD
        SET ${sets.join(', ')}
        WHERE SetPriceID = @setId
      `, hdInputs);
    }

    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/master/prices — สร้างเอกสารราคาใหม่ (Extend Price)
router.post('/prices', async (req, res) => {
  try {
    const { GoodID, CustID, GoodPriceNet, BeginDate, EndDate, startgoodqty, endgoodqty } = req.body;
    
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
    console.error(e); res.status(500).json({ message: e.message });
  }
});

// POST /api/master/prices/bulk-extend — สร้างเอกสารราคาใหม่แบบกลุ่ม
router.post('/prices/bulk-extend', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Empty items array' });
    
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
    console.error(e); res.status(500).json({ message: e.message });
  }
});

// GET /api/master/control-tickets — ตั๋วคุม (AppvDocuNo ขึ้นต้นด้วย 'AI', DocuStatus='Y')
router.get('/control-tickets', async (req, res) => {
  try {
    const { custId, includeCompleted } = req.query;
    const where = custId ? `AND h.CustID = @custId` : '';
    const inputs = custId ? { custId: { type: sql.NVarChar(20), value: custId } } : {};
    const condition = includeCompleted === 'true' ? '' : 'WHERE TotalQtyTon > DrawnQtyTon';
    const rows = await query(`
      WITH Tickets AS (
        SELECT TOP 300
          h.SOID, h.DocuNo, h.AppvDocuNo, ISNULL(h.AppvDocuNo, h.DocuNo) AS DisplayDocuNo, h.DocuDate, h.CustID,
          h.CustName, h.TransRegistration AS TruckPlate,
          h.AppvFlag, h.AppvDate, h.Desc1, h.Desc2, h.DocuStatus
        FROM dbo.SOHD h WITH (NOLOCK)
        WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND (h.AppvDocuNo LIKE 'AI%' OR h.TransRegistration = N'ตั๋วคุม') ${where}
        ORDER BY h.DocuDate DESC
      ),
      DraftTickets AS (
        SELECT 
          so.Id AS SOID,
          so.WfRef AS DocuNo,
          so.WfRef AS AppvDocuNo,
          so.WfRef AS DisplayDocuNo,
          so.CreatedAt AS DocuDate,
          so.CustId AS CustID,
          so.CustName AS CustName,
          so.TruckPlate AS TruckPlate,
          'N' AS AppvFlag,
          NULL AS AppvDate,
          N'(แบบร่าง / ยังไม่ยืนยัน)' AS Desc1,
          NULL AS Desc2,
          'DRAFT' AS DocuStatus
        FROM wf.SalesOrder so WITH (NOLOCK)
        WHERE so.SoPrefix = 'AI' AND so.Status = 'DRAFT'
        ${custId ? `AND so.CustId = @custId` : ''}
      ),
      AllTickets AS (
        SELECT * FROM Tickets
        UNION ALL
        SELECT * FROM DraftTickets
      )
      SELECT * FROM (
        SELECT 
          t.*,
          ISNULL((
            SELECT SUM(d.GoodQty2)
            FROM dbo.SODT d WITH (NOLOCK)
            WHERE d.SOID = t.SOID
          ), 
            ISNULL((SELECT SUM(wfl.QtyTon) FROM wf.SalesOrderLine wfl WHERE wfl.SoId = t.SOID), 0)
          ) AS TotalQtyTon,
          (
            ISNULL((
              SELECT SUM(d2.GoodQty2)
              FROM dbo.SOHD h2 WITH (NOLOCK)
              JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
              WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
                AND (h2.RefNo = t.DocuNo OR h2.RefNo = t.AppvDocuNo)
            ), 0)
            +
            ISNULL((
              SELECT SUM(d2.GoodQty2)
              FROM dbo.SOHD h2 WITH (NOLOCK)
              JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
              JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo
              WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
                AND (wfl.RefControlTicketNo = t.DocuNo OR wfl.RefControlTicketNo = t.AppvDocuNo)
                AND (h2.RefNo IS NULL OR (h2.RefNo <> t.DocuNo AND h2.RefNo <> t.AppvDocuNo))
            ), 0)
            +
            ISNULL((
              SELECT SUM(wfl.QtyTon)
              FROM wf.SalesOrderLine wfl
              JOIN wf.SalesOrder so2 ON so2.Id = wfl.SoId
              WHERE so2.Status = 'DRAFT' AND (wfl.RefControlTicketNo = t.DocuNo OR wfl.RefControlTicketNo = t.AppvDocuNo)
            ), 0)
          ) AS DrawnQtyTon
        FROM AllTickets t
      ) final
      ${condition}
      ORDER BY DocuDate DESC
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/control-tickets/:docuNo — ดึงรายการสินค้าของตั๋วคุม
router.get('/control-tickets/:docuNo', async (req, res) => {
  try {
    const docuNo = String(req.params.docuNo).trim();
    if (docuNo.startsWith('AI') && docuNo.includes('-')) {
      // Might be a Draft WfRef
      const draftCheck = await query(`
        SELECT 
          d.LineNum AS ListNo, d.GoodID, g.GoodCode, g.GoodName1 AS GoodName, 
          d.QtyTon AS QtyTon, d.PricePerTon AS PricePerTon, 
          ISNULL(gx.BagPerTon, 20) AS BagPerTon
        FROM wf.SalesOrder h WITH (NOLOCK)
        JOIN wf.SalesOrderLine d WITH (NOLOCK) ON h.Id = d.SoId
        JOIN dbo.EMGood g WITH (NOLOCK) ON d.GoodId = g.GoodID
        LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
        WHERE h.WfRef = @docuNo AND h.Status = 'DRAFT'
        ORDER BY d.LineNum ASC
      `, { docuNo: { type: sql.NVarChar(30), value: docuNo } });

      if (draftCheck.length > 0) {
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
      WHERE (RTRIM(h.AppvDocuNo) = RTRIM(@docuNo) OR RTRIM(h.DocuNo) = RTRIM(@docuNo)) AND h.DocuType = 103 AND h.DocuStatus = 'Y'
      ORDER BY d.ListNo ASC
    `, { docuNo: { type: sql.NVarChar(30), value: docuNo } });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/control-tickets/:docuNo/draws — ประวัติการตัด (SO 104 ที่ตัดจากตั๋วคุมนี้) FR-021
router.get('/control-tickets/:docuNo/draws', async (req, res) => {
  try {
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
        AND (RTRIM(h2.RefNo) = RTRIM(@docuNo) OR wfl.RefControlTicketNo = RTRIM(@docuNo))
      GROUP BY h2.SOID, h2.DocuNo, h2.DocuDate, h2.CustName, h2.TransRegistration
      ORDER BY h2.DocuDate DESC
    `, { docuNo: { type: sql.NVarChar(30), value: String(req.params.docuNo).trim() } });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
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
let _agingCache = null;
let _agingCacheAt = 0;
const AGING_TTL = 5 * 60 * 1000;

router.get('/aging', async (req, res) => {
  try {
    const now = Date.now();
    const bust = req.query.bust === '1';
    if (!bust && _agingCache && now - _agingCacheAt < AGING_TTL) return res.json(_agingCache);

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
        WHERE CONVERT(VARCHAR(50), dt.SOID) = o.SoId
      ) line
      ORDER BY DaysOpen DESC
    `);
    _agingCache = result.recordset || [];
    _agingCacheAt = now;
    res.json(_agingCache);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/aging/search — full aging search with pagination
// query params: q (search), status (comma-sep), page (default 1), pageSize (default 50), dateFrom (YYYY-MM-DD)
router.get('/aging/search', async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const page     = Math.max(1, parseInt(req.query.page)     || 1);
    const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize) || 50));
    const q        = (req.query.q || '').trim();
    const dateFrom = req.query.dateFrom || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const statusRaw = (req.query.status || '').trim();
    const statuses = statusRaw ? statusRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const offset   = (page - 1) * pageSize;

    // Build WHERE clauses
    const conditions = [
      `hd.DocuDate >= @dateFrom`,
      `hd.DocuType IN (103, 104)`,
      `ISNULL(hd.DocuStatus, '') <> 'C'`,
      `ISNULL(hd.clearflag, 'N') <> 'Y'`,
      `ISNULL(NULLIF(LTRIM(RTRIM(hd.TransRegistration)), ''), '') <> N'ตั๋วคุม'`,
    ];
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
    }
    const where = conditions.join(' AND ');

    const inputs = { dateFrom: { type: sql.Date, value: new Date(dateFrom) } };
    if (q) inputs.q = { type: sql.NVarChar(200), value: `%${q}%` };

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
      )
      SELECT hd.CustName,
             CAST(dt.GoodID AS VARCHAR(50)) AS GoodCode,
             dt.GoodName,
             SUM(CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3))) AS QtyTon,
             DATEDIFF(DAY, CAST(hd.DocuDate AS DATETIME2), GETUTCDATE()) AS DaysOpen,
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
      ORDER BY DaysOpen DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
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
    
    await wq(`
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
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/master/truck-types/:id — ลบประเภทรถบรรทุก (ถ้าจำเป็น) หรือแค่ set inactive
router.delete('/truck-types/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { wfQuery: wq } = require('../db');
    const id = req.params.id;
    await wq(`DELETE FROM wf.TruckType WHERE Id = @id`, {
      id: { type: sql.VarChar(50), value: id }
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
