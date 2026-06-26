/**
 * master.js — READ-ONLY master data จาก dbo (ผ่าน wf views)
 * ⚠ ห้ามเขียน dbo ใดๆ ในไฟล์นี้
 */
const router = require('express').Router();
const { sql, query } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/master/customers
router.get('/customers', async (req, res) => {
  try {
    const { q } = req.query;
    const whereClause = q
      ? `WHERE CustName LIKE N'%' + @q + '%' OR CustID LIKE N'%' + @q + '%'`
      : '';
    const inputs = q ? { q: { type: sql.NVarChar(100), value: q } } : {};
    const rows = await query(
      `SELECT c.CustID, c.CustName, c.ContTel AS Tel, c.ContTel1 AS Mobile, ISNULL(cx.Remark, '') AS Remark, c.Inactive
       FROM dbo.EMCust c WITH (NOLOCK) 
       LEFT JOIN wf.CustomerExt cx ON cx.CustId = c.CustID
       ${whereClause} 
       ORDER BY c.CustName`,
      inputs
    );
    res.json(rows);
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
    const { q } = req.query;
    const whereClause = q
      ? `AND (g.GoodCode LIKE N'%' + @q + '%' OR g.GoodName1 LIKE N'%' + @q + '%')`
      : '';
    const inputs = q ? { q: { type: sql.NVarChar(100), value: q } } : {};
    const rows = await query(`
      SELECT g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             ISNULL(gx.BagPerTon, 20)         AS BagPerTon,
             ISNULL(gx.WeightKgPerBag, 50.0)  AS WeightKgPerBag,
             gg.GoodGroupName,
             g.StockQty,
             g.RemaQty,
             ISNULL(agg.TotalQtyTon, 0) AS TotalQtyTon,
             ISNULL(agg.QtyTonThisYear, 0) AS TotalQtyTonThisYear
      FROM dbo.EMGood g WITH (NOLOCK)
      LEFT JOIN wf.GoodExtra gx ON gx.GoodId = g.GoodID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON g.GoodGroupID = gg.GoodGroupID
      LEFT JOIN (
        SELECT 
          sol.GoodId,
          SUM(sol.QtyTon) AS TotalQtyTon,
          SUM(CASE WHEN YEAR(so.CreatedAt) = YEAR(GETUTCDATE()) THEN sol.QtyTon ELSE 0 END) AS QtyTonThisYear
        FROM wf.v_AllSalesOrderLines sol
        JOIN wf.v_AllSalesOrders so ON so.Id = sol.SoId
        WHERE so.Status NOT IN ('CANCELLED')
        GROUP BY sol.GoodId
      ) agg ON agg.GoodId = g.GoodID
      WHERE g.StockFlag = 'Y' AND g.MainGoodUnitID = 1002 AND g.Inactive = 'A'
      ${whereClause}
      ORDER BY ISNULL(agg.TotalQtyTon, 0) DESC, g.GoodCode
    `, inputs);
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

// GET /api/master/giveaway-goods — ของแถม
router.get('/giveaway-goods', async (req, res) => {
  try {
    // ของแถม/Souvenir จริง: P-prefix (เสื้อ/แบนเนอร์/ผ้า) + N-prefix (กระเป๋า)
    // หมายเหตุ: StockFlag='N' (ไม่ใช่ stocked FG) · ตัด misc/service (G-prefix)
    const rows = await query(`
      SELECT GoodID, GoodCode, GoodName1 AS GoodName
      FROM dbo.EMGood WITH (NOLOCK)
      WHERE GoodGroupID IS NULL AND MainGoodUnitID <> 1002
        AND (GoodCode LIKE 'P%' OR GoodCode LIKE 'N%')
      ORDER BY GoodCode
    `);
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
    const { custId } = req.query;
    const where = custId ? `AND h.CustID = @custId` : '';
    const inputs = custId ? { custId: { type: sql.NVarChar(20), value: custId } } : {};
    const rows = await query(`
      SELECT * FROM (
        SELECT TOP 100
          h.SOID, h.AppvDocuNo AS DocuNo, h.DocuDate, h.CustID,
          h.CustName, h.TransRegistration AS TruckPlate,
          h.AppvFlag, h.DocuNo AS OriginalDocuNo, h.AppvDate, h.Desc1, h.Desc2,
          (
            SELECT ISNULL(SUM(d.GoodQty2), 0)
            FROM dbo.SODT d WITH (NOLOCK)
            WHERE d.SOID = h.SOID
          ) AS TotalQtyTon,
          (
            SELECT ISNULL(SUM(d2.GoodQty2), 0)
            FROM dbo.SOHD h2 WITH (NOLOCK)
            JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
            LEFT JOIN wf.SalesOrderLine wfl WITH (NOLOCK) ON wfl.SoId = h2.SOID AND wfl.LineNum = d2.ListNo
            WHERE h2.DocuType = 104 AND h2.DocuStatus <> 'C'
              AND (h2.RefNo = h.AppvDocuNo OR wfl.RefControlTicketNo = h.AppvDocuNo)
          ) AS DrawnQtyTon
        FROM dbo.SOHD h WITH (NOLOCK)
        WHERE h.DocuType = 103 AND h.DocuStatus = 'Y' AND h.AppvDocuNo LIKE 'AI%' ${where}
        ORDER BY h.DocuDate DESC, h.SOID DESC
      ) t
      WHERE t.TotalQtyTon > t.DrawnQtyTon
    `, inputs);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/master/control-tickets/:docuNo — ดึงรายการสินค้าของตั๋วคุม
router.get('/control-tickets/:docuNo', async (req, res) => {
  try {
    const rows = await query(`
      SELECT 
        d.ListNo, d.GoodID, g.GoodCode, g.GoodName1 AS GoodName, 
        d.GoodQty2 AS QtyTon, d.GoodPrice2 AS PricePerTon, 
        ISNULL(gx.BagPerTon, 20) AS BagPerTon
      FROM dbo.SOHD h WITH (NOLOCK)
      JOIN dbo.SODT d WITH (NOLOCK) ON h.SOID = d.SOID
      JOIN dbo.EMGood g WITH (NOLOCK) ON d.GoodID = g.GoodID
      LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
      WHERE RTRIM(h.AppvDocuNo) = RTRIM(@docuNo) AND h.DocuType = 103 AND h.DocuStatus = 'Y'
      ORDER BY d.ListNo ASC
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
      SELECT 
        TruckPlate AS truckPlate,
        MAX(CustName) AS custName,
        COUNT(*) AS count,
        MAX(CreatedAt) AS lastVisit
      FROM wf.v_AllSalesOrders
      WHERE TruckPlate IS NOT NULL AND TruckPlate <> '' AND Status NOT IN ('DRAFT', 'CANCELLED')
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
      SELECT 
        so.CreatedAt AS date,
        ISNULL(so.WfRef, CAST(so.Id AS VARCHAR(50))) AS so,
        CAST(so.Id AS VARCHAR(50)) AS soId,
        ISNULL(SUM(sol.QtyTon), 0) AS qtyTon
      FROM wf.v_AllSalesOrders so
      LEFT JOIN wf.v_AllSalesOrderLines sol ON sol.SoId = so.Id
      WHERE so.TruckPlate = @plate AND so.Status NOT IN ('DRAFT', 'CANCELLED')
      GROUP BY so.Id, so.WfRef, so.CreatedAt
      ORDER BY so.CreatedAt DESC
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

// GET /api/master/aging — dashboard SO คงค้าง (เฉพาะ 180 วันล่าสุด, max 200 rows)
let _agingCache = null;
let _agingCacheAt = 0;
const AGING_TTL = 5 * 60 * 1000;

router.get('/aging', async (req, res) => {
  try {
    const now = Date.now();
    if (_agingCache && now - _agingCacheAt < AGING_TTL) return res.json(_agingCache);

    const { wfQuery: wq } = require('../db');
    const result = await wq(`
      SELECT TOP 200
             so.CustName, sol.GoodCode,
             SUM(sol.QtyTon)  AS QtyTon,
             DATEDIFF(DAY, so.CreatedAt, GETUTCDATE()) AS DaysOpen,
             so.Status, so.WfRef, CAST(so.Id AS VARCHAR(50)) AS SoId
      FROM wf.v_AllSalesOrders so
      JOIN wf.v_AllSalesOrderLines sol ON sol.SoId = so.Id
      WHERE so.Status NOT IN ('IMPORTED','CANCELLED')
        AND so.CreatedAt >= DATEADD(DAY, -180, GETUTCDATE())
      GROUP BY so.CustName, sol.GoodCode, so.CreatedAt, so.Status, so.WfRef, so.Id
      ORDER BY DaysOpen DESC
    `);
    _agingCache = result.recordset || [];
    _agingCacheAt = now;
    res.json(_agingCache);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
