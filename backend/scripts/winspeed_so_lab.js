const db = require('../db');

const DOC_NO = process.env.WF_SO_DOC || 'I69-KORAT-1';
const COMPARE_DOC = process.env.WF_SO_COMPARE_DOC || 'I69-TEST';

const descriptions = [
  'สินค้าหลายรายการ',
  'การจะใช้อิงจาก เงื่อนไขตรวจสอบอีกครั้ง',
  'รถ KORAT-0001/0002',
  'ขนส่งเองเป็นเชื้อ 200 ตัว วิ่ง 30 วัน มิ.ย.กม 200 กก. และผู้เป็นผู้ขนส่งลพบุรี',
  'เอกสารเหล่านี้สำคัญมาก ต้องกรอกครบตลอด',
];

const lines = [
  { code: '7-08242400BBCAR', qty: 5, price: 1000, masterQty: 3, childQty: 2 },
  { code: '7-08242400BBCFE', fallbackCode: '7-08242400BBCEE', qty: 6, price: 1500, masterQty: 3, childQty: 3 },
  { code: '7-09050900BBCAR', qty: 7, price: 2000, masterQty: 4, childQty: 3 },
  { code: '7-10033000BBTEP', qty: 8, price: 3000, masterQty: 4, childQty: 4 },
  { code: '7-14042400BBCAR', qty: 9, price: 4000, masterQty: 5, childQty: 4 },
  { code: '7-14073500BBCAR', qty: 10, price: 3000, masterQty: 10, childQty: 0 },
];

function parseDocSpec(docSpec) {
  const [docNo, docType] = String(docSpec).split(':');
  return { docNo, docType: docType || null };
}

function valueForLog(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  return String(value);
}

async function findSohd(docSpec) {
  const { docNo, docType } = parseDocSpec(docSpec);
  const rows = await db.query(
    `SELECT TOP 1 *
     FROM dbo.SOHD
     WHERE DocuNo = @docNo
       AND (@docType IS NULL OR DocuType = @docType)
     ORDER BY SOID DESC`,
    {
      docNo: { type: db.sql.NVarChar, value: docNo },
      docType: { type: db.sql.NVarChar, value: docType },
    }
  );
  return rows[0] || null;
}

async function inspect(docNo = DOC_NO) {
  const header = await findSohd(docNo);
  if (!header) {
    console.log(`NOT_FOUND ${docNo}`);
    return null;
  }

  console.log('SOHD');
  console.table([{
    SOID: header.SOID,
    DocuNo: header.DocuNo,
    DocuDate: valueForLog(header.DocuDate),
    CustID: header.CustID,
    CustName: header.CustName,
    DocuType: header.DocuType,
    DocuStatus: header.DocuStatus,
    AppvFlag: header.AppvFlag,
    PkgStatus: header.PkgStatus,
    clearflag: header.clearflag,
    TransRegistration: header.TransRegistration,
    NetAmnt: header.NetAmnt,
    Remark: header.Remark,
  }]);

  const details = await db.query(
    `SELECT d.ListNo, g.GoodCode, d.GoodID, d.GoodName, d.GoodQty2, d.GoodPrice2, d.GoodAmnt,
            d.CheckFlag, d.MasterQty, d.ChildQty, d.RemaQty, d.GoodStockQty,
            d.GoodUnitID2, d.GoodStockUnitID, d.StockFlag, d.GoodFlag
     FROM dbo.SODT d
     LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
     WHERE d.SOID = @soid
     ORDER BY d.ListNo`,
    { soid: { type: db.sql.Int, value: Number(header.SOID) } }
  );
  console.log('SODT');
  console.table(details);

  const headerRemarks = await db.query(
    `SELECT ListNo, Remark
     FROM dbo.SOHDRemark
     WHERE SOID = @soid
     ORDER BY ListNo`,
    { soid: { type: db.sql.Int, value: Number(header.SOID) } }
  );
  console.log('SOHDRemark');
  console.table(headerRemarks);

  const lineRemarks = await db.query(
    `SELECT ListNo, RefListNo, Remark
     FROM dbo.SODTRemark
     WHERE SOID = @soid
     ORDER BY ListNo`,
    { soid: { type: db.sql.Int, value: Number(header.SOID) } }
  );
  console.log('SODTRemark');
  console.table(lineRemarks);

  return header;
}

async function compare(docNo = DOC_NO, compareDoc = COMPARE_DOC) {
  const left = await findSohd(docNo);
  const right = await findSohd(compareDoc);
  if (!left || !right) throw new Error(`Missing doc(s): ${docNo}=${!!left}, ${compareDoc}=${!!right}`);

  const cols = Object.keys(left);
  const diffs = cols
    .map((col) => ({
      ColumnName: col,
      [docNo]: valueForLog(left[col]),
      [compareDoc]: valueForLog(right[col]),
    }))
    .filter((row) => row[docNo] !== row[compareDoc])
    .filter((row) => !['SOID', 'DocuNo', 'CustID', 'CustName', 'DocuDate', 'NetAmnt'].includes(row.ColumnName));
  console.log('SOHD_DIFFS');
  console.table(diffs);

  const leftLines = await db.query(
    `SELECT TOP 1 *
     FROM dbo.SODT
     WHERE SOID = @soid
     ORDER BY ListNo`,
    { soid: { type: db.sql.Int, value: Number(left.SOID) } }
  );
  const rightLines = await db.query(
    `SELECT TOP 1 *
     FROM dbo.SODT
     WHERE SOID = @soid
     ORDER BY ListNo`,
    { soid: { type: db.sql.Int, value: Number(right.SOID) } }
  );
  if (leftLines[0] && rightLines[0]) {
    const detailDiffs = Object.keys(leftLines[0])
      .map((col) => ({
        ColumnName: col,
        [docNo]: valueForLog(leftLines[0][col]),
        [compareDoc]: valueForLog(rightLines[0][col]),
      }))
      .filter((row) => row[docNo] !== row[compareDoc])
      .filter((row) => !['SOID', 'GoodID', 'GoodName', 'GoodQty2', 'GoodPrice2', 'GoodAmnt', 'MasterQty', 'ChildQty'].includes(row.ColumnName));
    console.log('SODT_FIRST_LINE_DIFFS');
    console.table(detailDiffs);
  }
}

async function normalizeDoc(docNo = DOC_NO) {
  const header = await findSohd(docNo);
  if (!header) throw new Error(`${docNo} not found`);
  const soid = Number(header.SOID);

  const sumRows = await db.query(
    `SELECT ISNULL(SUM(ISNULL(GoodAmnt, 0)), 0) AS SumGoodAmnt
     FROM dbo.SODT
     WHERE SOID = @soid`,
    { soid: { type: db.sql.Int, value: soid } }
  );
  const total = Number(sumRows[0]?.SumGoodAmnt || 0);

  await db.wfTransaction(async (tx) => {
    await tx.request()
      .input('soid', db.sql.Int, soid)
      .input('total', db.sql.Decimal(18, 2), total)
      .input('shipDate', db.sql.DateTime, new Date('2026-08-06T17:00:00.000Z'))
      .input('poDate', db.sql.DateTime, new Date('2026-07-05T17:00:00.000Z'))
      .query(`
        UPDATE dbo.SOHD
        SET
          VATGroupID = ISNULL(VATGroupID, 2),
          TranspID = ISNULL(TranspID, 2000),
          SaleAreaID = ISNULL(SaleAreaID, (SELECT TOP 1 SaleAreaID FROM dbo.EMCust WHERE CustID = dbo.SOHD.CustID)),
          DeptID = ISNULL(DeptID, 1000),
          ValidDays = 30,
          ShipToAddr1 = ISNULL(ShipToAddr1, ''),
          ShipToAddr2 = ISNULL(ShipToAddr2, ''),
          District = ISNULL(District, ''),
          Amphur = ISNULL(Amphur, ''),
          Province = ISNULL(Province, ''),
          Tel = ISNULL(Tel, ''),
          PostCode = ISNULL(PostCode, ''),
          Fax = ISNULL(Fax, ''),
          ContactName = N'จักรพงษ์',
          ShipDays = 30,
          CreditDays = 60,
          ShipDate = @shipDate,
          SumIncludeAmnt = ISNULL(SumIncludeAmnt, 0),
          SumExcludeAmnt = ISNULL(SumExcludeAmnt, 0),
          SumGoodAmnt = @total,
          BaseDiscAmnt = ISNULL(BaseDiscAmnt, 0),
          BillDiscFormula = ISNULL(BillDiscFormula, ''),
          BillDiscAmnt = ISNULL(BillDiscAmnt, 0),
          BillAftrDiscAmnt = @total,
          TotaExcludeAmnt = ISNULL(TotaExcludeAmnt, 0),
          TotaBaseAmnt = ISNULL(TotaBaseAmnt, 0),
          VATAmnt = ISNULL(VATAmnt, 0),
          CustPONo = 'NO-PO',
          CustPODate = @poDate,
          Remark = NULL,
          Commission = NULL,
          RefNo = NULL,
          CommissionAmnt = ISNULL(CommissionAmnt, 0),
          MiscChargAmnt = ISNULL(MiscChargAmnt, 0),
          ResvAmnt1 = ISNULL(ResvAmnt1, 0),
          ResvAmnt2 = ISNULL(ResvAmnt2, 0),
          ResvAmnt3 = ISNULL(ResvAmnt3, 0),
          ResvAmnt4 = ISNULL(ResvAmnt4, 0),
          ShipToCode = ISNULL(ShipToCode, ''),
          QuotStatus = ISNULL(QuotStatus, N'รอผู้ใหญ่ตัดสินใจ'),
          ContactnameShip = ISNULL(ContactnameShip, ''),
          CheckAll = 'Y'
        WHERE SOID = @soid;
      `);

    await tx.request()
      .input('soid', db.sql.Int, soid)
      .input('shipDate', db.sql.DateTime, new Date('2026-08-06T17:00:00.000Z'))
      .query(`
        UPDATE dbo.SODT
        SET
          VATGroupID = NULL,
          GoodStockRate1 = 0,
          GoodCompareQty = ISNULL(GoodCompareQty, 0),
          ShipDate = ISNULL(ShipDate, @shipDate),
          RemaBefoQty = ISNULL(RemaBefoQty, 0),
          ResvAmnt1 = ISNULL(ResvAmnt1, 0),
          ResvAmnt2 = ISNULL(ResvAmnt2, 0),
          MarkUpAmnt = ISNULL(MarkUpAmnt, 0),
          CommisAmnt = ISNULL(CommisAmnt, 0),
          AfterMarkupamnt = ISNULL(AfterMarkupamnt, GoodAmnt),
          remaamnt = ISNULL(remaamnt, GoodAmnt),
          GoodRemaQty2 = 0,
          RemaGoodStockQty = 0,
          Refno = NULL,
          CheckFlag = 'Y',
          MasterQty = CASE ListNo
            WHEN 1 THEN 3
            WHEN 2 THEN 3
            WHEN 3 THEN 4
            WHEN 4 THEN 4
            WHEN 5 THEN 5
            WHEN 6 THEN 10
            ELSE MasterQty
          END,
          ChildQty = CASE ListNo
            WHEN 1 THEN 2
            WHEN 2 THEN 3
            WHEN 3 THEN 3
            WHEN 4 THEN 4
            WHEN 5 THEN 4
            WHEN 6 THEN 0
            ELSE ChildQty
          END
        WHERE SOID = @soid;
      `);
  });

  console.log(`NORMALIZED ${docNo} SOID=${soid} TOTAL=${total}`);
}

async function deleteDoc(docNo = DOC_NO) {
  const header = await findSohd(docNo);
  if (!header) {
    console.log(`NOT_FOUND ${docNo}`);
    return;
  }
  const soid = String(header.SOID);
  await db.wfTransaction(async (tx) => {
    await tx.request().input('soid', db.sql.VarChar(50), soid).query(`
      DELETE FROM wf.SalesOrderLineExt WHERE SOID = @soid;
      DELETE FROM wf.SalesOrderExt WHERE SOID = @soid;
    `);
    await tx.request().input('soidInt', db.sql.Int, Number(soid)).query(`
      DELETE FROM dbo.SODTRemark WHERE SOID = @soidInt;
      DELETE FROM dbo.SOHDRemark WHERE SOID = @soidInt;
      DELETE FROM dbo.SODT WHERE SOID = @soidInt;
      DELETE FROM dbo.SOHD WHERE SOID = @soidInt;
    `);
  });
  console.log(`DELETED ${docNo} SOID=${soid}`);
}

async function createDoc(docNo = DOC_NO) {
  const existing = await findSohd(docNo);
  if (existing) throw new Error(`${docNo} already exists as SOID=${existing.SOID}; run delete first`);

  const custRows = await db.query(
    `SELECT TOP 1 CustID, CustCode, CustName, SaleAreaID
     FROM dbo.EMCust
     WHERE CustCode = '0110012'`
  );
  if (!custRows.length) throw new Error('Customer 0110012 not found');

  const empRows = await db.query(
    `SELECT TOP 1 EmpID, EmpCode, EmpName
     FROM dbo.EMEmp
     WHERE EmpName LIKE N'%จักรพงษ์%'
     ORDER BY EmpID`
  );
  const empId = Number(empRows[0]?.EmpID || 1000);

  const lookupCodes = lines.map((line) => line.fallbackCode || line.code);
  const params = Object.fromEntries(lookupCodes.map((code, i) => [`g${i}`, { type: db.sql.NVarChar, value: code }]));
  const goodRows = await db.query(
    `SELECT GoodID, GoodCode, GoodName1, MainGoodUnitID, VatType
     FROM dbo.EMGood
     WHERE GoodCode IN (${lookupCodes.map((_, i) => `@g${i}`).join(',')})`,
    params
  );
  const goodMap = new Map(goodRows.map((g) => [String(g.GoodCode).trim(), g]));
  const missing = lookupCodes.filter((code) => !goodMap.has(code));
  if (missing.length) throw new Error(`Missing goods: ${missing.join(', ')}`);

  const soidRows = await db.query(`
    SELECT ISNULL(MAX(CASE WHEN ISNUMERIC(CONVERT(varchar(50), SOID)) = 1 THEN CAST(SOID AS int) ELSE 0 END), 1000) + 1 AS NextSOID
    FROM dbo.SOHD
  `);
  const soid = Number(soidRows[0].NextSOID);
  const total = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const customer = custRows[0];

  await db.wfTransaction(async (tx) => {
    await tx.request()
      .input('SOID', db.sql.Int, soid)
      .input('DocuNo', db.sql.NVarChar, docNo)
      .input('CustID', db.sql.Int, Number(customer.CustID))
      .input('CustName', db.sql.NVarChar, customer.CustName)
      .input('DocuDate', db.sql.DateTime, new Date('2026-07-08T17:00:00.000Z'))
      .input('NetAmnt', db.sql.Decimal(18, 2), total)
      .input('EmpID', db.sql.Int, empId)
      .input('TransRegistration', db.sql.NVarChar, 'KORAT-0001/0002')
      .input('SaleAreaID', db.sql.Int, Number(customer.SaleAreaID || 1000))
      .input('Remark', db.sql.NVarChar, null)
      .query(`
        INSERT INTO dbo.SOHD (
          SOID, SaleAreaID, TranspID, DeptID, DocuNo, CustID, CustName, DocuDate, NetAmnt,
          AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
          DocuType, OnHold, VatRate, VatType, GoodType, ExchRate,
          VATGroupID, ValidDays, ShipToAddr1, ShipToAddr2, District, Amphur, Province, Tel, PostCode, Fax,
          ContactName, ShipDays, CreditDays, ShipDate,
          SumIncludeAmnt, SumExcludeAmnt, SumGoodAmnt, BaseDiscAmnt, BillDiscFormula, BillDiscAmnt,
          BillAftrDiscAmnt, TotaExcludeAmnt, TotaBaseAmnt, VATAmnt,
          CustPONo, CustPODate, Commission, RefNo, CommissionAmnt, MiscChargAmnt,
          ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, ShipToCode, QuotStatus, ContactnameShip, CheckAll,
          ClearSO, MultiCurrency, DocuStatus, AlertFlag,
          TransRegistration, Remark
        )
        VALUES (
          @SOID, @SaleAreaID, 2000, 1000, @DocuNo, @CustID, @CustName, @DocuDate, @NetAmnt,
          'W', 'N', 'N', @EmpID, '1',
          '103', 'N', 0, '3', '1', 1,
          2, 30, '', '', '', '', '', '', '', '',
          N'จักรพงษ์', 30, 60, '2026-08-07',
          0, 0, @NetAmnt, 0, '', 0,
          @NetAmnt, 0, 0, 0,
          'NO-PO', '2026-07-06', NULL, NULL, 0, 0,
          0, 0, 0, 0, '', N'รอผู้ใหญ่ตัดสินใจ', '', 'Y',
          'N', 'N', 'N', 'N',
          @TransRegistration, @Remark
        )
      `);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const good = goodMap.get(line.fallbackCode || line.code);
      const listNo = i + 1;
      const amount = line.qty * line.price;
      await tx.request()
        .input('SOID', db.sql.Int, soid)
        .input('ListNo', db.sql.Int, listNo)
        .input('GoodID', db.sql.Int, Number(good.GoodID))
        .input('GoodName', db.sql.NVarChar, good.GoodName1)
        .input('GoodUnitID', db.sql.Int, Number(good.MainGoodUnitID || 1002))
        .input('Qty', db.sql.Decimal(18, 2), line.qty)
        .input('Price', db.sql.Decimal(18, 2), line.price)
        .input('Amount', db.sql.Decimal(18, 2), amount)
        .input('VatType', db.sql.NVarChar, good.VatType || '3')
        .input('MasterQty', db.sql.Decimal(18, 2), line.masterQty)
        .input('ChildQty', db.sql.Decimal(18, 2), line.childQty)
        .query(`
          INSERT INTO dbo.SODT (
            SOID, ListNo, GoodID, GoodName, InveID, LocaID,
            GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
            GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
            VATGroupID, GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt, Refno,
            DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
            RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
            GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
            RemaGoodStockQty, remaamnt, CheckFlag, MasterQty, ChildQty
          )
          VALUES (
            @SOID, @ListNo, @GoodID, @GoodName, 1000, 1000,
            NULL, 0, 0, @GoodUnitID, 0, @Qty, @Price,
            0, 0, 0, @Amount,
            NULL, 0, '2026-08-07', 0, 0, 0, 0, 0, @Amount, NULL,
            '103', 'N', 'N', '1', @VatType, '-1', 'G',
            @Qty, 0, 'N', 1, @GoodUnitID, @Qty,
            0, @Qty, 0, @Qty, @Qty, 'N', 'N',
            0, @Amount, 'Y', @MasterQty, @ChildQty
          )
        `);

      await tx.request()
        .input('SOID', db.sql.Int, soid)
        .input('ListNo', db.sql.Int, listNo)
        .input('Remark', db.sql.NVarChar, good.GoodName1)
        .query(`
          INSERT INTO dbo.SODTRemark (SOID, ListNo, RefListNo, Remark)
          VALUES (@SOID, @ListNo, @ListNo, @Remark)
        `);
    }

    for (let i = 0; i < descriptions.length; i += 1) {
      await tx.request()
        .input('SOID', db.sql.Int, soid)
        .input('ListNo', db.sql.Int, i + 1)
        .input('Remark', db.sql.NVarChar, descriptions[i])
        .query(`
          INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark)
          VALUES (@SOID, @ListNo, @Remark)
        `);
    }

    await tx.request()
      .input('SOID', db.sql.NVarChar, String(soid))
      .input('WfRef', db.sql.NVarChar, docNo)
      .input('SalesUserId', db.sql.Int, 1)
      .input('DeliveryDate', db.sql.Date, new Date('2026-08-07T17:00:00.000Z'))
      .input('RequestedAt', db.sql.DateTime2, new Date('2026-08-07T17:00:00.000Z'))
      .query(`
        INSERT INTO wf.SalesOrderExt (
          SOID, WfRef, SoPrefix, SalesUserId, ControlTicketNo, DeliveryDate,
          RequestedAt, IsOwnTruck, NoTruckRequired, PSling,
          CreatedAt, UpdatedAt, RebateDiscountAmt
        )
        VALUES (
          @SOID, @WfRef, 'I', @SalesUserId, NULL, @DeliveryDate,
          @RequestedAt, 1, 0, 0,
          SYSUTCDATETIME(), SYSUTCDATETIME(), 0
        )
      `);

    for (let i = 0; i < lines.length; i += 1) {
      await tx.request()
        .input('SOID', db.sql.NVarChar, String(soid))
        .input('ListNo', db.sql.Int, i + 1)
        .input('NetPricePerTon', db.sql.Decimal(18, 2), lines[i].price)
        .query(`
          INSERT INTO wf.SalesOrderLineExt (
            SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn
          )
          VALUES (@SOID, @ListNo, @NetPricePerTon, 0, 0, NULL, 0)
        `);
    }
  });

  console.log(`CREATED ${docNo} SOID=${soid} TOTAL=${total}`);
}

async function listTestDocs(pattern = 'TEST') {
  const like = `%${pattern}%`;
  const rows = await db.query(
    `SELECT SOID, DocuNo, DocuType, DocuStatus, AppvFlag, AppvDocuNo, RefNo, NetAmnt, TransRegistration
     FROM dbo.SOHD
     WHERE DocuNo LIKE @like OR AppvDocuNo LIKE @like OR RefNo LIKE @like
     ORDER BY DocuNo, DocuType, SOID`,
    { like: { type: db.sql.NVarChar, value: like } }
  );
  console.table(rows);
}

async function columns(tableName = 'SOHD') {
  const safeTable = tableName.replace(/[^A-Za-z0-9_]/g, '');
  const rows = await db.query(
    `SELECT column_id, name, TYPE_NAME(user_type_id) AS type_name, max_length, is_nullable
     FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.${safeTable}')
     ORDER BY column_id`
  );
  console.table(rows);
}

async function listTransports(pattern = '') {
  const like = `%${pattern}%`;
  const rows = await db.query(
    `SELECT TOP 100 TranspID, TranspCode, TranspName, Remark
     FROM dbo.EMTransp
     WHERE @like = '%%' OR TranspCode LIKE @like OR TranspName LIKE @like OR Remark LIKE @like
     ORDER BY TranspName, TranspCode`,
    { like: { type: db.sql.NVarChar, value: like } }
  );
  console.table(rows);
}

async function searchSchema(pattern = 'Transp') {
  const like = `%${pattern}%`;
  const rows = await db.query(
    `SELECT t.name AS TableName, c.name AS ColumnName
     FROM sys.tables t
     JOIN sys.columns c ON c.object_id = t.object_id
     WHERE t.schema_id = SCHEMA_ID('dbo')
       AND (t.name LIKE @like OR c.name LIKE @like)
     ORDER BY t.name, c.column_id`,
    { like: { type: db.sql.NVarChar, value: like } }
  );
  console.table(rows);
}

async function main() {
  const action = process.argv[2] || 'inspect';
  if (action === 'inspect') await inspect(process.argv[3] || DOC_NO);
  else if (action === 'compare') await compare(process.argv[3] || DOC_NO, process.argv[4] || COMPARE_DOC);
  else if (action === 'normalize') await normalizeDoc(process.argv[3] || DOC_NO);
  else if (action === 'delete') await deleteDoc(process.argv[3] || DOC_NO);
  else if (action === 'create') await createDoc(process.argv[3] || DOC_NO);
  else if (action === 'list-test') await listTestDocs(process.argv[3] || 'TEST');
  else if (action === 'columns') await columns(process.argv[3] || 'SOHD');
  else if (action === 'list-transports') await listTransports(process.argv[3] || '');
  else if (action === 'search-schema') await searchSchema(process.argv[3] || 'Transp');
  else throw new Error(`Unknown action: ${action}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
