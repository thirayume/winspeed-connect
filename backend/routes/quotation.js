/**
 * quotation.js - wf.Quotation + native WINSpeed Sale Quotation.
 *
 * Native WINSpeed mapping verified from local documents:
 *   QU6907-00001 = dbo.SOHD/SODT DocuType 102, AppvFlag W, DocuStatus N
 *   QU6907-00002 = dbo.SOHD/SODT DocuType 102, AppvFlag Y, DocuStatus Y
 *   QC69-00002   = dbo.SOHD/SODT DocuType 113, RefNo = QU6907-00002
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction, pools, getTarget } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../services/socket');

router.use(requireAuth);

async function hasQuoteSourceTable() {
  const r = await wfQuery(`SELECT CASE WHEN OBJECT_ID('wf.QuotationSourceSO', 'U') IS NULL THEN 0 ELSE 1 END AS HasTable`);
  return Number(r.recordset?.[0]?.HasTable || 0) === 1;
}

async function hasQuoteLineGiveawayColumn() {
  const r = await wfQuery(`SELECT CASE WHEN COL_LENGTH('wf.QuotationLine', 'IsGiveaway') IS NULL THEN 0 ELSE 1 END AS HasColumn`);
  return Number(r.recordset?.[0]?.HasColumn || 0) === 1;
}

async function getNativeQuotationReadiness() {
  const target = getTarget();
  const r = await wfQuery(`
    SELECT
      CASE WHEN OBJECT_ID('dbo.SOHD', 'U') IS NOT NULL
             AND OBJECT_ID('dbo.SODT', 'U') IS NOT NULL
             AND OBJECT_ID('dbo.SOHDRemark', 'U') IS NOT NULL
           THEN 1 ELSE 0 END AS HasNativeTables,
      CASE WHEN COL_LENGTH('wf.Quotation', 'WinspeedQuoteSOID') IS NOT NULL
             AND COL_LENGTH('wf.Quotation', 'WinspeedQuoteNo') IS NOT NULL
             AND COL_LENGTH('wf.Quotation', 'WinspeedQuoteSyncedAt') IS NOT NULL
             AND COL_LENGTH('wf.Quotation', 'WinspeedConfirmSOID') IS NOT NULL
             AND COL_LENGTH('wf.Quotation', 'WinspeedConfirmNo') IS NOT NULL
             AND COL_LENGTH('wf.Quotation', 'WinspeedConfirmSyncedAt') IS NOT NULL
           THEN 1 ELSE 0 END AS HasLinkColumns
  `);
  const row = r.recordset?.[0] || {};
  const value = {
    target,
    hasNativeTables: Number(row.HasNativeTables || 0) === 1,
    hasLinkColumns: Number(row.HasLinkColumns || 0) === 1,
  };
  return value;
}

async function assertNativeQuotationReady() {
  const ready = await getNativeQuotationReadiness();
  if (!ready.hasNativeTables) {
    const err = new Error(`ไม่พบตาราง WINSpeed Sale Quotation ใน DB ${ready.target}: dbo.SOHD/SODT/SOHDRemark`);
    err.statusCode = 400;
    throw err;
  }
  if (!ready.hasLinkColumns) {
    const err = new Error(`ยังไม่ได้ apply migration 044_winspeed_native_quotation_link.sql ใน DB ${ready.target}`);
    err.statusCode = 400;
    throw err;
  }
}

function normalizeValidUntil(validUntil, validDays) {
  if (validUntil) return new Date(validUntil);
  const allowed = [7, 15, 20, 30, 45];
  const days = allowed.includes(Number(validDays)) ? Number(validDays) : 15;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function addIds(request, ids) {
  const names = [];
  ids.forEach((id, idx) => {
    const name = `id${idx}`;
    names.push(`@${name}`);
    request.input(name, sql.Int, Number(id));
  });
  return names.join(',');
}

function addTextValues(request, values, prefix = 'txt') {
  const names = [];
  values.forEach((value, idx) => {
    const name = `${prefix}${idx}`;
    names.push(`@${name}`);
    request.input(name, sql.NVarChar(100), String(value));
  });
  return names.join(',');
}

async function ownerRequest() {
  const pl = pools();
  await pl.ready;
  return pl.ownerPool.request();
}

function toIntOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value, max) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function bracketIdent(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

async function getTableColumnSet(tx, tableName) {
  const r = await tx.request()
    .input('tableName', sql.NVarChar(128), tableName)
    .query(`
      SELECT c.name
      FROM sys.columns c WITH (NOLOCK)
      WHERE c.object_id = OBJECT_ID(@tableName)
    `);
  return new Set((r.recordset || []).map(row => String(row.name).toLowerCase()));
}

function optionalColumnExpr(columnSet, candidates, alias, fallbackSql) {
  const column = candidates.find(name => columnSet.has(String(name).toLowerCase()));
  return column
    ? `c.${bracketIdent(column)} AS ${bracketIdent(alias)}`
    : `${fallbackSql} AS ${bracketIdent(alias)}`;
}

function buildInsertParts(columnSet, pairs) {
  const active = pairs.filter(([column]) => columnSet.has(String(column).toLowerCase()));
  return {
    columns: active.map(([column]) => bracketIdent(column)).join(',\n        '),
    values: active.map(([, valueSql]) => valueSql).join(',\n        '),
  };
}

function validDaysBetween(fromDate, toDate) {
  const to = toDate ? new Date(toDate) : normalizeValidUntil(null, 15);
  const from = fromDate ? new Date(fromDate) : new Date();
  const days = Math.ceil((to.getTime() - from.getTime()) / 86400000);
  return Math.max(1, Math.min(32767, Number.isFinite(days) ? days : 15));
}

async function keepNativeIdIfExists(tx, tableName, columnName, value) {
  const id = toIntOrNull(value);
  if (!id) return null;
  const r = await tx.request()
    .input('id', sql.Int, id)
    .query(`SELECT TOP 1 ${columnName} AS IdValue FROM ${tableName} WHERE ${columnName}=@id`);
  return r.recordset?.length ? id : null;
}

function nativeDocPrefix(kind, date = new Date()) {
  const yy = String(date.getFullYear() + 543 - 2500).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return kind === 'QC' ? `QC${yy}-` : `QU${yy}${mm}-`;
}

function matchesNativeDocNo(kind, docNo) {
  const pattern = kind === 'QC' ? /^QC\d{2}-\d{5}$/i : /^QU\d{4}-\d{5}$/i;
  return pattern.test(String(docNo || ''));
}

async function nextWinspeedSoid(tx) {
  const r = await tx.request().query(`
    SELECT ISNULL(MAX(CASE WHEN ISNUMERIC(CONVERT(VARCHAR(50), SOID)) = 1
                           THEN CAST(SOID AS INT) ELSE 0 END), 1000) + 1 AS NextId
    FROM dbo.SOHD WITH (UPDLOCK, HOLDLOCK)
  `);
  return Number(r.recordset?.[0]?.NextId || 1001);
}

async function nextNativeDocNo(tx, kind) {
  const prefix = nativeDocPrefix(kind);
  const r = await tx.request()
    .input('prefix', sql.NVarChar(20), prefix)
    .query(`
      SELECT ISNULL(MAX(SeqNo), 0) + 1 AS NextSeq
      FROM (
        SELECT CASE WHEN ISNUMERIC(RIGHT(DocuNo, 5)) = 1 THEN CAST(RIGHT(DocuNo, 5) AS INT) ELSE 0 END AS SeqNo
        FROM dbo.SOHD WITH (UPDLOCK, HOLDLOCK)
        WHERE DocuNo LIKE @prefix + '%'
        UNION ALL
        SELECT CASE WHEN ISNUMERIC(RIGHT(QuoteNo, 5)) = 1 THEN CAST(RIGHT(QuoteNo, 5) AS INT) ELSE 0 END
        FROM wf.Quotation WITH (UPDLOCK, HOLDLOCK)
        WHERE QuoteNo LIKE @prefix + '%'
        UNION ALL
        SELECT CASE WHEN ISNUMERIC(RIGHT(WinspeedQuoteNo, 5)) = 1 THEN CAST(RIGHT(WinspeedQuoteNo, 5) AS INT) ELSE 0 END
        FROM wf.Quotation WITH (UPDLOCK, HOLDLOCK)
        WHERE WinspeedQuoteNo LIKE @prefix + '%'
        UNION ALL
        SELECT CASE WHEN ISNUMERIC(RIGHT(WinspeedConfirmNo, 5)) = 1 THEN CAST(RIGHT(WinspeedConfirmNo, 5) AS INT) ELSE 0 END
        FROM wf.Quotation WITH (UPDLOCK, HOLDLOCK)
        WHERE WinspeedConfirmNo LIKE @prefix + '%'
      ) s
    `);
  return `${prefix}${String(r.recordset?.[0]?.NextSeq || 1).padStart(5, '0')}`;
}

async function loadQuotationNativeContext(tx, quoteId, hasGiveaway) {
  const q = (await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`
      SELECT q.*, u.EmpId AS SalesEmpId
      FROM wf.Quotation q
      LEFT JOIN wf.AppUser u ON u.Id = q.SalesUserId
      WHERE q.Id=@id
    `)).recordset?.[0];
  if (!q) throw new Error('ไม่พบใบเสนอราคาสำหรับ sync เข้า WINSpeed');

  const lineRows = (await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`
      SELECT LineNum, GoodId, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon,
             ${hasGiveaway ? 'ISNULL(IsGiveaway, 0)' : 'CAST(0 AS bit)'} AS IsGiveaway
      FROM wf.QuotationLine
      WHERE QuoteId=@id
      ORDER BY LineNum
    `)).recordset || [];
  const lines = lineRows.filter(l => !l.IsGiveaway);
  if (!lines.length) throw new Error('ไม่พบรายการขายจริงสำหรับเขียนใบเสนอราคาเข้า WINSpeed');

  const custId = toIntOrNull(q.CustId);
  if (!custId) throw new Error(`CustId ${q.CustId || ''} ไม่ใช่รหัสลูกค้า WINSpeed ที่ถูกต้อง`);
  const custColumns = await getTableColumnSet(tx, 'dbo.EMCust');
  const custSelect = [
    'c.CustID',
    'c.CustName',
    optionalColumnExpr(custColumns, ['SaleAreaID'], 'SaleAreaID', 'CAST(NULL AS INT)'),
    optionalColumnExpr(custColumns, ['CreditDays'], 'CreditDays', 'CAST(NULL AS INT)'),
    optionalColumnExpr(custColumns, ['VATGroupID', 'VatGroupID'], 'VATGroupID', 'CAST(NULL AS INT)'),
    optionalColumnExpr(custColumns, ['VatType', 'VATType'], 'VatType', `CAST(NULL AS NVARCHAR(10))`),
    optionalColumnExpr(custColumns, ['BillAddr1', 'ShipToAddr1', 'Addr1', 'Address1'], 'BillAddr1', `CAST(NULL AS NVARCHAR(255))`),
    optionalColumnExpr(custColumns, ['BillAddr2', 'ShipToAddr2', 'Addr2', 'Address2'], 'BillAddr2', `CAST(NULL AS NVARCHAR(255))`),
    optionalColumnExpr(custColumns, ['District'], 'District', `CAST(NULL AS NVARCHAR(100))`),
    optionalColumnExpr(custColumns, ['Amphur', 'Amphoe'], 'Amphur', `CAST(NULL AS NVARCHAR(100))`),
    optionalColumnExpr(custColumns, ['Province'], 'Province', `CAST(NULL AS NVARCHAR(100))`),
    optionalColumnExpr(custColumns, ['PostCode', 'ZipCode'], 'PostCode', `CAST(NULL AS NVARCHAR(20))`),
    optionalColumnExpr(custColumns, ['Tel', 'ContTel', 'ContTel1', 'Mobile'], 'Tel', `CAST(NULL AS NVARCHAR(100))`),
    optionalColumnExpr(custColumns, ['Fax', 'ContFax'], 'Fax', `CAST(NULL AS NVARCHAR(100))`),
  ].join(',\n             ');
  const cust = (await tx.request()
    .input('custId', sql.Int, custId)
    .query(`
      SELECT TOP 1 ${custSelect}
      FROM dbo.EMCust c WITH (NOLOCK)
      WHERE c.CustID=@custId
    `)).recordset?.[0];
  if (!cust) throw new Error(`ไม่พบลูกค้า WINSpeed CustID=${custId}`);

  const defaults = (await tx.request().query(`
    SELECT
      (SELECT TOP 1 BrchID FROM dbo.EMBrch WITH (NOLOCK) ORDER BY BrchID) AS BrchID,
      (SELECT TOP 1 VATGroupID FROM dbo.EMVATGroup WITH (NOLOCK) ORDER BY VATGroupID) AS VATGroupID,
      (SELECT TOP 1 InveID FROM dbo.EMLoca WITH (NOLOCK) ORDER BY LocaID) AS InveID,
      (SELECT TOP 1 LocaID FROM dbo.EMLoca WITH (NOLOCK) ORDER BY LocaID) AS LocaID
  `)).recordset?.[0] || {};
  if (!defaults.BrchID) throw new Error('ไม่พบ dbo.EMBrch สำหรับสร้าง WINSpeed Quotation');
  if (!defaults.InveID || !defaults.LocaID) throw new Error('ไม่พบ dbo.EMLoca สำหรับสร้างรายการ WINSpeed Quotation');

  return { q, lines, cust, defaults, custId };
}

async function syncNativeQuotation(tx, quoteId, sourceRefs = [], opts = {}) {
  const hasGiveaway = opts.hasGiveawayColumn === true;
  const { q, lines, cust, defaults, custId } = await loadQuotationNativeContext(tx, quoteId, hasGiveaway);
  if (q.WinspeedQuoteSOID) {
    return { quoteSoid: q.WinspeedQuoteSOID, quoteNo: q.WinspeedQuoteNo };
  }

  const quoteSoid = await nextWinspeedSoid(tx);
  const quoteNo = matchesNativeDocNo('QU', q.QuoteNo) ? cleanText(q.QuoteNo, 30) : await nextNativeDocNo(tx, 'QU');
  const docDate = new Date();
  const expireDate = q.ValidUntil ? new Date(q.ValidUntil) : normalizeValidUntil(null, 15);
  const validDays = validDaysBetween(docDate, expireDate);
  const totalAmount = lines.reduce((sum, l) => sum + (Number(l.QtyTon || 0) * Number(l.PricePerTon || 0)), 0);
  const vatGroupId = await keepNativeIdIfExists(tx, 'dbo.EMVATGroup', 'VATGroupID', cust.VATGroupID) || Number(defaults.VATGroupID || 0) || null;
  const saleAreaId = await keepNativeIdIfExists(tx, 'dbo.EMSaleArea', 'SaleAreaID', cust.SaleAreaID);
  const empId = await keepNativeIdIfExists(tx, 'dbo.EMEmp', 'EmpID', q.SalesEmpId);
  const vatType = cleanText(cust.VatType || cust.VATType || '3', 1) || '3';
  const creditDays = Number(cust.CreditDays || 30);
  const sohdColumns = await getTableColumnSet(tx, 'dbo.SOHD');
  const headerInsert = buildInsertParts(sohdColumns, [
    ['SOID', '@SOID'],
    ['SaleAreaID', '@SaleAreaID'],
    ['DeptID', '@DeptID'],
    ['DocuNo', '@DocuNo'],
    ['CustID', '@CustID'],
    ['CustName', '@CustName'],
    ['DocuDate', '@DocuDate'],
    ['ValidDays', '@ValidDays'],
    ['ExpireDate', '@ExpireDate'],
    ['ShipDate', '@ShipDate'],
    ['CreditDays', '@CreditDays'],
    ['NetAmnt', '@NetAmnt'],
    ['AppvFlag', `'W'`],
    ['PkgStatus', `'N'`],
    ['clearflag', `'N'`],
    ['EmpID', '@EmpID'],
    ['BrchID', '@BrchID'],
    ['DocuType', `'102'`],
    ['OnHold', `'N'`],
    ['VatRate', '@VATRate'],
    ['VatType', '@VATType'],
    ['VATGroupID', '@VATGroupID'],
    ['GoodType', `'1'`],
    ['ExchRate', '1'],
    ['ShipToAddr1', '@BillAddr1'],
    ['ShipToAddr2', '@BillAddr2'],
    ['District', '@District'],
    ['Amphur', '@Amphur'],
    ['Province', '@Province'],
    ['Tel', '@Tel'],
    ['PostCode', '@PostCode'],
    ['Fax', '@Fax'],
    ['SumIncludeAmnt', '0'],
    ['SumExcludeAmnt', '0'],
    ['SumGoodAmnt', '@NetAmnt'],
    ['BaseDiscAmnt', '0'],
    ['BillDiscFormula', `''`],
    ['BillDiscAmnt', '0'],
    ['BillAftrDiscAmnt', '@NetAmnt'],
    ['TotaExcludeAmnt', '0'],
    ['TotaBaseAmnt', '0'],
    ['VATAmnt', '0'],
    ['CustPONo', `''`],
    ['CommissionAmnt', '0'],
    ['MiscChargAmnt', '0'],
    ['ResvAmnt1', '0'],
    ['ResvAmnt2', '0'],
    ['ResvAmnt3', '0'],
    ['ResvAmnt4', '0'],
    ['ShipToCode', `''`],
    ['ContactnameShip', `''`],
    ['ClearSO', `'N'`],
    ['MultiCurrency', `'N'`],
    ['DocuStatus', `'N'`],
    ['AlertFlag', `'N'`],
    ['QuotStatus', '@QuotStatus'],
    ['Refeflag', `'N'`],
    ['CouponFlag', `'N'`],
    ['BeginningFlag', `'N'`],
    ['Remark', '@Remark'],
    ['StatusRemark', `''`],
  ]);

  await tx.request()
    .input('SOID', sql.VarChar(50), String(quoteSoid))
    .input('SaleAreaID', sql.Int, saleAreaId)
    .input('DeptID', sql.Int, 1000)
    .input('DocuNo', sql.NVarChar(30), quoteNo)
    .input('CustID', sql.Int, custId)
    .input('CustName', sql.NVarChar(200), cleanText(q.CustName || cust.CustName, 200))
    .input('DocuDate', sql.DateTime, docDate)
    .input('ValidDays', sql.SmallInt, validDays)
    .input('ExpireDate', sql.DateTime, expireDate)
    .input('ShipDate', sql.DateTime, docDate)
    .input('CreditDays', sql.SmallInt, Number.isFinite(creditDays) ? creditDays : 30)
    .input('NetAmnt', sql.Decimal(18, 2), totalAmount)
    .input('EmpID', sql.Int, empId || 1000)
    .input('BrchID', sql.Int, Number(defaults.BrchID))
    .input('VATRate', sql.Float, 0)
    .input('VATType', sql.VarChar(1), vatType)
    .input('VATGroupID', sql.Int, vatGroupId)
    .input('BillAddr1', sql.NVarChar(255), cleanText(cust.BillAddr1, 255))
    .input('BillAddr2', sql.NVarChar(255), cleanText(cust.BillAddr2, 255))
    .input('District', sql.NVarChar(100), cleanText(cust.District, 100))
    .input('Amphur', sql.NVarChar(100), cleanText(cust.Amphur, 100))
    .input('Province', sql.NVarChar(100), cleanText(cust.Province, 100))
    .input('PostCode', sql.VarChar(20), cleanText(cust.PostCode, 20))
    .input('Tel', sql.NVarChar(100), cleanText(cust.Tel, 100))
    .input('Fax', sql.NVarChar(100), cleanText(cust.Fax, 100))
    .input('Remark', sql.NVarChar(255), cleanText(q.Remark, 255))
    .input('QuotStatus', sql.NVarChar(100), 'รอผู้ใหญ่ตัดสินใจ')
    .query(`
      INSERT INTO dbo.SOHD (
        ${headerInsert.columns}
      )
      VALUES (
        ${headerInsert.values}
      )
    `);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const goodId = toIntOrNull(line.GoodId);
    if (!goodId) throw new Error(`GoodId ${line.GoodId || ''} ไม่ถูกต้อง`);
    const good = (await tx.request()
      .input('goodId', sql.Int, goodId)
      .query(`SELECT TOP 1 GoodID, GoodName1, MainGoodUnitID, VatType FROM dbo.EMGood WITH (NOLOCK) WHERE GoodID=@goodId`)).recordset?.[0];
    if (!good) throw new Error(`ไม่พบสินค้า WINSpeed GoodID=${line.GoodId || ''}`);
    const goodUnitId = await keepNativeIdIfExists(tx, 'dbo.EMGoodUnit', 'GoodUnitID', good.MainGoodUnitID) || 1002;
    const qty = Number(line.QtyTon || 0);
    const price = Number(line.PricePerTon || 0);
    await tx.request()
      .input('SOID', sql.VarChar(50), String(quoteSoid))
      .input('ListNo', sql.SmallInt, i + 1)
      .input('GoodID', sql.Int, good.GoodID)
      .input('GoodName', sql.NVarChar(255), cleanText(line.GoodName || good.GoodName1, 255))
      .input('InveID', sql.Int, Number(defaults.InveID))
      .input('LocaID', sql.Int, Number(defaults.LocaID))
      .input('GoodUnitID', sql.Int, goodUnitId)
      .input('GoodQty2', sql.Decimal(18, 3), qty)
      .input('GoodPrice2', sql.Decimal(18, 2), price)
      .input('GoodAmnt', sql.Decimal(18, 2), qty * price)
      .input('ShipDate', sql.DateTime, docDate)
      .input('VatType', sql.VarChar(1), cleanText(good.VatType || vatType, 1) || vatType)
      .query(`
        INSERT INTO dbo.SODT (
          SOID, ListNo, GoodID, GoodName, InveID, LocaID,
          GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
          GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
          GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
          DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
          RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
          GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
          RemaGoodStockQty, remaamnt
        )
        VALUES (
          @SOID, @ListNo, @GoodID, @GoodName, @InveID, @LocaID,
          NULL, 0, 0, @GoodUnitID, 0, @GoodQty2, @GoodPrice2,
          0, 0, 0, @GoodAmnt,
          0, @ShipDate, 0, 0, 0, 0, 0, @GoodAmnt,
          '102', 'N', 'N', '1', @VatType, '0', 'G',
          @GoodQty2, 0, 'N', 1, @GoodUnitID, @GoodQty2,
          0, @GoodQty2, 0, @GoodQty2, @GoodQty2, 'N', 'N',
          0, @GoodAmnt
        )
      `);
  }

  const remarks = [
    q.Remark || null,
    sourceRefs.length ? `Source SO: ${sourceRefs.join(', ')}` : null,
  ].filter(Boolean).map(text => cleanText(text, 255));
  for (let i = 0; i < remarks.length; i++) {
    await tx.request()
      .input('SOID', sql.VarChar(50), String(quoteSoid))
      .input('ListNo', sql.SmallInt, i + 1)
      .input('Remark', sql.NVarChar(255), remarks[i])
      .query(`INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark) VALUES (@SOID, @ListNo, @Remark)`);
  }

  await tx.request()
    .input('qid', sql.Int, Number(quoteId))
    .input('soid', sql.Int, quoteSoid)
    .input('docNo', sql.NVarChar(30), quoteNo)
    .query(`
      UPDATE wf.Quotation
      SET WinspeedQuoteSOID=@soid,
          WinspeedQuoteNo=@docNo,
          WinspeedQuoteSyncedAt=SYSUTCDATETIME(),
          UpdatedAt=GETUTCDATE()
      WHERE Id=@qid
    `);

  return { quoteSoid, quoteNo };
}

async function confirmNativeQuotation(tx, quoteId, approvedByUserId) {
  let q = (await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`SELECT * FROM wf.Quotation WHERE Id=@id`)).recordset?.[0];
  if (!q) throw new Error('ไม่พบใบเสนอราคา');
  if (!q.WinspeedQuoteSOID) {
    await syncNativeQuotation(tx, quoteId, [], { hasGiveawayColumn: await hasQuoteLineGiveawayColumn() });
    q = (await tx.request()
      .input('id', sql.Int, Number(quoteId))
      .query(`SELECT * FROM wf.Quotation WHERE Id=@id`)).recordset?.[0];
  }
  if (q.WinspeedConfirmSOID) {
    return { confirmSoid: q.WinspeedConfirmSOID, confirmNo: q.WinspeedConfirmNo };
  }

  const quoteSoid = Number(q.WinspeedQuoteSOID);
  const quoteNo = cleanText(q.WinspeedQuoteNo || q.QuoteNo, 30);
  const existing = (await tx.request()
    .input('quoteNo', sql.NVarChar(30), quoteNo)
    .query(`
      SELECT TOP 1 SOID, DocuNo
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE DocuType='113'
        AND RefNo=@quoteNo
        AND AppvFlag='Y'
        AND ISNULL(DocuStatus, 'N') <> 'C'
      ORDER BY SOID DESC
    `)).recordset?.[0];
  if (existing) {
    await tx.request()
      .input('qid', sql.Int, Number(quoteId))
      .input('soid', sql.Int, Number(existing.SOID))
      .input('docNo', sql.NVarChar(30), existing.DocuNo)
      .query(`
        UPDATE wf.Quotation
        SET Status='ACCEPTED',
            WinspeedConfirmSOID=@soid,
            WinspeedConfirmNo=@docNo,
            WinspeedConfirmSyncedAt=SYSUTCDATETIME(),
            UpdatedAt=GETUTCDATE()
        WHERE Id=@qid
      `);
    return { confirmSoid: Number(existing.SOID), confirmNo: existing.DocuNo };
  }

  const confirmSoid = await nextWinspeedSoid(tx);
  const confirmNo = await nextNativeDocNo(tx, 'QC');
  const approvedEmp = (await tx.request()
    .input('uid', sql.Int, Number(approvedByUserId || q.SalesUserId || 0))
    .query(`
      SELECT TOP 1 CASE WHEN ISNUMERIC(EmpId) = 1 THEN CAST(EmpId AS INT) ELSE NULL END AS EmpId
      FROM wf.AppUser
      WHERE Id=@uid
    `)).recordset?.[0]?.EmpId || null;
  const sohdColumns = await getTableColumnSet(tx, 'dbo.SOHD');
  const confirmHeaderInsert = buildInsertParts(sohdColumns, [
    ['SOID', '@confirmSoid'],
    ['SaleAreaID', 'SaleAreaID'],
    ['TranspID', 'TranspID'],
    ['DeptID', 'DeptID'],
    ['DocuNo', '@confirmNo'],
    ['CustID', 'CustID'],
    ['CustName', 'CustName'],
    ['DocuDate', 'DocuDate'],
    ['ValidDays', 'ValidDays'],
    ['ExpireDate', 'ExpireDate'],
    ['ShipDate', 'ShipDate'],
    ['CreditDays', 'CreditDays'],
    ['NetAmnt', 'NetAmnt'],
    ['AppvFlag', `'Y'`],
    ['PkgStatus', `'N'`],
    ['clearflag', `'N'`],
    ['EmpID', 'EmpID'],
    ['BrchID', 'BrchID'],
    ['DocuType', `'113'`],
    ['OnHold', 'OnHold'],
    ['VatRate', 'VatRate'],
    ['VatType', 'VatType'],
    ['VATGroupID', 'VATGroupID'],
    ['GoodType', 'GoodType'],
    ['ExchRate', 'ExchRate'],
    ['ShipToAddr1', 'ShipToAddr1'],
    ['ShipToAddr2', 'ShipToAddr2'],
    ['District', 'District'],
    ['Amphur', 'Amphur'],
    ['Province', 'Province'],
    ['Tel', 'Tel'],
    ['PostCode', 'PostCode'],
    ['Fax', 'Fax'],
    ['SumIncludeAmnt', 'SumIncludeAmnt'],
    ['SumExcludeAmnt', 'SumExcludeAmnt'],
    ['SumGoodAmnt', 'SumGoodAmnt'],
    ['BaseDiscAmnt', 'BaseDiscAmnt'],
    ['BillDiscFormula', 'BillDiscFormula'],
    ['BillDiscAmnt', 'BillDiscAmnt'],
    ['BillAftrDiscAmnt', 'BillAftrDiscAmnt'],
    ['TotaExcludeAmnt', 'TotaExcludeAmnt'],
    ['TotaBaseAmnt', 'TotaBaseAmnt'],
    ['VATAmnt', 'VATAmnt'],
    ['CustPONo', 'CustPONo'],
    ['CommissionAmnt', 'CommissionAmnt'],
    ['MiscChargAmnt', 'MiscChargAmnt'],
    ['ResvAmnt1', 'ResvAmnt1'],
    ['ResvAmnt2', 'ResvAmnt2'],
    ['ResvAmnt3', 'ResvAmnt3'],
    ['ResvAmnt4', 'ResvAmnt4'],
    ['ShipToCode', 'ShipToCode'],
    ['ContactnameShip', 'ContactnameShip'],
    ['ClearSO', 'ClearSO'],
    ['MultiCurrency', 'MultiCurrency'],
    ['DocuStatus', `'N'`],
    ['AlertFlag', 'AlertFlag'],
    ['QuotStatus', 'QuotStatus'],
    ['Refeflag', 'Refeflag'],
    ['CouponFlag', 'CouponFlag'],
    ['BeginningFlag', 'BeginningFlag'],
    ['RefNo', '@quoteNo'],
    ['RefDate', 'DocuDate'],
    ['FromFlag', `'102'`],
    ['Remark', 'Remark'],
    ['StatusRemark', 'StatusRemark'],
    ['Appvid', '@appvid'],
  ]);

  await tx.request()
    .input('quoteSoid', sql.VarChar(50), String(quoteSoid))
    .input('confirmSoid', sql.VarChar(50), String(confirmSoid))
    .input('confirmNo', sql.NVarChar(30), confirmNo)
    .input('quoteNo', sql.NVarChar(30), quoteNo)
    .input('appvid', sql.Int, approvedEmp)
    .query(`
      UPDATE dbo.SOHD
      SET AppvFlag='Y',
          DocuStatus='Y',
          RefNo=ISNULL(RefNo, ''),
          StatusRemark=ISNULL(StatusRemark, '')
      WHERE SOID=@quoteSoid AND DocuType='102';

      UPDATE dbo.SODT
      SET RemaQty=0
      WHERE SOID=@quoteSoid AND DocuType='102';

      INSERT INTO dbo.SOHD (
        ${confirmHeaderInsert.columns}
      )
      SELECT
        ${confirmHeaderInsert.values}
      FROM dbo.SOHD
      WHERE SOID=@quoteSoid AND DocuType='102';

      INSERT INTO dbo.SODT (
        SOID, RefSOID, ListNo, DocuType, Refno, RefListNo,
        GoodID, GoodName, InveID, LocaID,
        GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
        GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
        GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
        LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
        RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
        GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
        RemaGoodStockQty, remaamnt
      )
      SELECT
        @confirmSoid, @quoteSoid, ListNo, '113', @quoteNo, ListNo,
        GoodID, GoodName, InveID, LocaID,
        GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
        GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
        GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
        LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
        GoodQty2, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
        GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
        RemaGoodStockQty, remaamnt
      FROM dbo.SODT
      WHERE SOID=@quoteSoid AND DocuType='102';

      INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark)
      SELECT @confirmSoid, ListNo, Remark
      FROM dbo.SOHDRemark
      WHERE SOID=@quoteSoid;
    `);

  await tx.request()
    .input('qid', sql.Int, Number(quoteId))
    .input('soid', sql.Int, confirmSoid)
    .input('docNo', sql.NVarChar(30), confirmNo)
    .query(`
      UPDATE wf.Quotation
      SET Status='ACCEPTED',
          WinspeedConfirmSOID=@soid,
          WinspeedConfirmNo=@docNo,
          WinspeedConfirmSyncedAt=SYSUTCDATETIME(),
          UpdatedAt=GETUTCDATE()
      WHERE Id=@qid
    `);

  return { confirmSoid, confirmNo };
}

async function updateNativeQuotationStatus(tx, quoteId, status) {
  if (status !== 'CANCELLED') return;
  const q = (await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`SELECT WinspeedQuoteSOID, WinspeedConfirmSOID FROM wf.Quotation WHERE Id=@id`)).recordset?.[0];
  if (!q?.WinspeedQuoteSOID) return;
  await tx.request()
    .input('quoteSoid', sql.VarChar(50), String(q.WinspeedQuoteSOID))
    .input('confirmSoid', sql.VarChar(50), q.WinspeedConfirmSOID ? String(q.WinspeedConfirmSOID) : null)
    .input('remark', sql.NVarChar(255), 'Cancelled by WS-Sale-App')
    .query(`
      UPDATE dbo.SOHD
      SET DocuStatus='C',
          StatusRemark=@remark
      WHERE SOID=@quoteSoid AND DocuType='102';

      UPDATE dbo.SOHD
      SET DocuStatus='C',
          StatusRemark=@remark
      WHERE @confirmSoid IS NOT NULL AND SOID=@confirmSoid AND DocuType='113';
    `);
}

async function restoreSourceSalesOrdersToDraft(tx, quoteId) {
  const sourceRows = (await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`
      SELECT SoId, SourceWfRef
      FROM wf.QuotationSourceSO WITH (NOLOCK)
      WHERE QuoteId=@id
    `)).recordset || [];
  if (!sourceRows.length) return [];

  await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`
      UPDATE so
      SET Status='DRAFT',
          UpdatedAt=GETUTCDATE()
      FROM wf.SalesOrder so
      INNER JOIN wf.QuotationSourceSO src ON src.SoId = so.Id
      WHERE src.QuoteId=@id
        AND so.Status <> 'CANCELLED';

      UPDATE hd
      SET PkgStatus='N',
          DocuStatus='N'
      FROM dbo.SOHD hd
      INNER JOIN wf.QuotationSourceSO src
        ON src.SoId = CASE
            WHEN ISNUMERIC(CONVERT(VARCHAR(50), hd.SOID)) = 1 THEN CAST(hd.SOID AS INT)
            ELSE NULL
          END
      WHERE src.QuoteId=@id
        AND hd.DocuType = 103
        AND ISNULL(hd.DocuStatus, 'N') <> 'C';

      UPDATE ext
      SET IsUnlocked=1,
          UpdatedAt=GETUTCDATE()
      FROM wf.SalesOrderExt ext
      INNER JOIN wf.QuotationSourceSO src
        ON src.SoId = CASE
            WHEN ISNUMERIC(CONVERT(VARCHAR(50), ext.SOID)) = 1 THEN CAST(ext.SOID AS INT)
            ELSE NULL
          END
      INNER JOIN dbo.SOHD hd
        ON CONVERT(VARCHAR(50), hd.SOID) = CONVERT(VARCHAR(50), ext.SOID)
      WHERE src.QuoteId=@id
        AND hd.DocuType = 103
        AND ISNULL(hd.DocuStatus, 'N') <> 'C';
    `);

  return sourceRows;
}

async function updateNativeQuotationValidity(tx, quoteId, validUntil) {
  const q = (await tx.request()
    .input('id', sql.Int, Number(quoteId))
    .query(`SELECT WinspeedQuoteSOID, WinspeedConfirmSOID FROM wf.Quotation WHERE Id=@id`)).recordset?.[0];
  if (!q?.WinspeedQuoteSOID) return;
  await tx.request()
    .input('quoteSoid', sql.VarChar(50), String(q.WinspeedQuoteSOID))
    .input('confirmSoid', sql.VarChar(50), q.WinspeedConfirmSOID ? String(q.WinspeedConfirmSOID) : null)
    .input('vu', sql.DateTime, validUntil)
    .query(`
      UPDATE dbo.SOHD
      SET ExpireDate=@vu,
          ValidDays=CASE
            WHEN DATEDIFF(day, DocuDate, @vu) < 1 THEN 1
            WHEN DATEDIFF(day, DocuDate, @vu) > 32767 THEN 32767
            ELSE DATEDIFF(day, DocuDate, @vu)
          END
      WHERE SOID IN (@quoteSoid, @confirmSoid)
        AND DocuType IN ('102', '113')
    `);
}

async function nativeQuotationApproved(q) {
  if (!q?.WinspeedQuoteSOID) return false;
  const r = await wfQuery(`
    SELECT TOP 1
      CASE WHEN qu.AppvFlag='Y'
             AND qu.DocuStatus='Y'
             AND EXISTS (
               SELECT 1 FROM dbo.SOHD qc WITH (NOLOCK)
               WHERE qc.DocuType='113'
                 AND qc.RefNo=qu.DocuNo
                 AND qc.AppvFlag='Y'
                 AND ISNULL(qc.DocuStatus, 'N') <> 'C'
             )
           THEN 1 ELSE 0 END AS IsApproved
    FROM dbo.SOHD qu WITH (NOLOCK)
    WHERE qu.SOID=@soid AND qu.DocuType='102'
  `, { soid: { type: sql.VarChar(50), value: String(q.WinspeedQuoteSOID) } });
  return Number(r.recordset?.[0]?.IsApproved || 0) === 1;
}

function nativeQuoteStatusSql(alias = 'qu', qcAlias = 'qc') {
  return `
    CASE
      WHEN ${alias}.DocuStatus = 'C' THEN 'CANCELLED'
      WHEN ${qcAlias}.SOID IS NOT NULL THEN 'ACCEPTED'
      WHEN ${alias}.AppvFlag = 'Y' AND ${alias}.DocuStatus = 'Y' THEN 'ACCEPTED'
      WHEN ${alias}.ExpireDate IS NOT NULL AND CAST(${alias}.ExpireDate AS DATE) < CAST(GETDATE() AS DATE) THEN 'EXPIRED'
      ELSE 'SENT'
    END
  `;
}

async function loadNativeQuotationBySoid(soid) {
  const r = await wfQuery(`
    SELECT TOP 1
      -CAST(qu.SOID AS INT) AS Id,
      CAST(1 AS BIT) AS IsNativeOnly,
      CAST(qu.SOID AS INT) AS NativeQuoteSOID,
      qu.DocuNo AS QuoteNo,
      CAST(qu.CustID AS NVARCHAR(20)) AS CustId,
      qu.CustName,
      CAST(qu.ExpireDate AS DATE) AS ValidUntil,
      ${nativeQuoteStatusSql('qu', 'qc')} AS Status,
      CAST(NULL AS INT) AS SalesUserId,
      CAST(NULL AS INT) AS ConvertedSoId,
      CAST(qu.Remark AS NVARCHAR(500)) AS Remark,
      CAST(qu.DocuDate AS DATETIME2) AS CreatedAt,
      CAST(qu.DocuDate AS DATETIME2) AS UpdatedAt,
      CAST(qu.SOID AS INT) AS WinspeedQuoteSOID,
      qu.DocuNo AS WinspeedQuoteNo,
      CAST(NULL AS DATETIME2) AS WinspeedQuoteSyncedAt,
      CAST(qc.SOID AS INT) AS WinspeedConfirmSOID,
      qc.DocuNo AS WinspeedConfirmNo,
      CAST(NULL AS DATETIME2) AS WinspeedConfirmSyncedAt,
      CAST(qu.SOID AS INT) AS WinspeedEstimateID,
      qu.DocuNo AS WinspeedEstimateNo,
      CAST(NULL AS DATETIME2) AS WinspeedEstimateSyncedAt,
      CAST(ISNULL(qc.SOID, qu.SOID) AS VARCHAR(50)) AS LineSourceSOID
    FROM dbo.SOHD qu WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1 qc2.SOID, qc2.DocuNo
      FROM dbo.SOHD qc2 WITH (NOLOCK)
      WHERE qc2.DocuType = '113'
        AND qc2.RefNo = qu.DocuNo
        AND ISNULL(qc2.DocuStatus, 'N') <> 'C'
      ORDER BY qc2.SOID DESC
    ) qc
    WHERE qu.DocuType = '102'
      AND ISNUMERIC(CONVERT(VARCHAR(50), qu.SOID)) = 1
      AND CAST(qu.SOID AS INT) = @soid
  `, { soid: { type: sql.Int, value: Number(soid) } });
  const q = r.recordset?.[0];
  if (!q) return null;

  const lines = (await wfQuery(`
    SELECT
      CAST(NULL AS INT) AS Id,
      d.ListNo AS LineNum,
      CAST(d.GoodID AS NVARCHAR(20)) AS GoodId,
      ISNULL(g.GoodCode, CAST(d.GoodID AS NVARCHAR(50))) AS GoodCode,
      ISNULL(NULLIF(d.GoodName, ''), g.GoodName1) AS GoodName,
      CAST(ISNULL(d.GoodQty2, 0) AS DECIMAL(12,3)) AS QtyTon,
      CAST(ISNULL(d.GoodPrice2, 0) AS DECIMAL(12,2)) AS PricePerTon,
      CAST(ISNULL(d.GoodPrice2, 0) AS DECIMAL(12,2)) AS NetPricePerTon,
      CAST(ISNULL(d.GoodAmnt, ISNULL(d.GoodQty2, 0) * ISNULL(d.GoodPrice2, 0)) AS DECIMAL(18,2)) AS LineAmount
    FROM dbo.SODT d WITH (NOLOCK)
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = d.GoodID
    WHERE CONVERT(VARCHAR(50), d.SOID) = @soid
    ORDER BY d.ListNo
  `, { soid: { type: sql.VarChar(50), value: String(q.LineSourceSOID) } })).recordset || [];

  const totalTon = lines.reduce((sum, line) => sum + Number(line.QtyTon || 0), 0);
  const totalAmount = lines.reduce((sum, line) => sum + Number(line.LineAmount || (Number(line.QtyTon || 0) * Number(line.PricePerTon || 0))), 0);
  return {
    ...q,
    lines,
    LineCount: lines.length,
    TotalTon: totalTon,
    TotalAmount: totalAmount,
    SourceSoCount: 0,
  };
}

// GET /api/quotation
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const hasSource = await hasQuoteSourceTable();
    const where = status ? 'WHERE q.Status = @st' : '';
    const inputs = status ? { st: { type: sql.NVarChar(20), value: status } } : {};
    const r = await wfQuery(`
      WITH Rows AS (
        SELECT
          q.Id,
          CAST(0 AS BIT) AS IsNativeOnly,
          q.QuoteNo,
          q.CustId,
          q.CustName,
          q.ValidUntil,
          q.Status,
          q.SalesUserId,
          q.ConvertedSoId,
          q.Remark,
          q.CreatedAt,
          q.UpdatedAt,
          q.WinspeedQuoteSOID,
          q.WinspeedQuoteNo,
          q.WinspeedQuoteSyncedAt,
          q.WinspeedConfirmSOID,
          q.WinspeedConfirmNo,
          q.WinspeedConfirmSyncedAt,
          q.WinspeedQuoteSOID AS WinspeedEstimateID,
          q.WinspeedQuoteNo AS WinspeedEstimateNo,
          q.WinspeedQuoteSyncedAt AS WinspeedEstimateSyncedAt,
          u.DisplayName AS SalesName,
          CASE WHEN ISNULL(appAgg.LineCount, 0) > 0 THEN appAgg.LineCount ELSE ISNULL(nativeAgg.LineCount, 0) END AS LineCount,
          CASE WHEN ISNULL(appAgg.LineCount, 0) > 0 THEN ISNULL(appAgg.TotalTon, 0) ELSE ISNULL(nativeAgg.TotalTon, 0) END AS TotalTon,
          CASE WHEN ISNULL(appAgg.LineCount, 0) > 0 THEN ISNULL(appAgg.TotalAmount, 0) ELSE ISNULL(nativeAgg.TotalAmount, 0) END AS TotalAmount,
          ${hasSource ? `(SELECT COUNT(1) FROM wf.QuotationSourceSO src WHERE src.QuoteId = q.Id)` : `CAST(0 AS INT)`} AS SourceSoCount
        FROM wf.Quotation q WITH (NOLOCK)
        LEFT JOIN wf.AppUser u WITH (NOLOCK) ON u.Id = q.SalesUserId
        OUTER APPLY (
          SELECT COUNT(1) AS LineCount,
                 SUM(CAST(ISNULL(l.QtyTon, 0) AS DECIMAL(18,3))) AS TotalTon,
                 SUM(CAST(ISNULL(l.QtyTon, 0) * ISNULL(l.PricePerTon, 0) AS DECIMAL(18,2))) AS TotalAmount
          FROM wf.QuotationLine l WITH (NOLOCK)
          WHERE l.QuoteId = q.Id
        ) appAgg
        OUTER APPLY (
          SELECT COUNT(1) AS LineCount,
                 SUM(CAST(ISNULL(d.GoodQty2, 0) AS DECIMAL(18,3))) AS TotalTon,
                 SUM(CAST(ISNULL(d.GoodAmnt, ISNULL(d.GoodQty2, 0) * ISNULL(d.GoodPrice2, 0)) AS DECIMAL(18,2))) AS TotalAmount
          FROM dbo.SODT d WITH (NOLOCK)
          WHERE q.WinspeedQuoteSOID IS NOT NULL
            AND CONVERT(VARCHAR(50), d.SOID) = CONVERT(VARCHAR(50), q.WinspeedQuoteSOID)
        ) nativeAgg

        UNION ALL

        SELECT
          -CAST(qu.SOID AS INT) AS Id,
          CAST(1 AS BIT) AS IsNativeOnly,
          qu.DocuNo AS QuoteNo,
          CAST(qu.CustID AS NVARCHAR(20)) AS CustId,
          qu.CustName,
          CAST(qu.ExpireDate AS DATE) AS ValidUntil,
          ${nativeQuoteStatusSql('qu', 'qc')} AS Status,
          CAST(NULL AS INT) AS SalesUserId,
          CAST(NULL AS INT) AS ConvertedSoId,
          CAST(qu.Remark AS NVARCHAR(500)) AS Remark,
          CAST(qu.DocuDate AS DATETIME2) AS CreatedAt,
          CAST(qu.DocuDate AS DATETIME2) AS UpdatedAt,
          CAST(qu.SOID AS INT) AS WinspeedQuoteSOID,
          qu.DocuNo AS WinspeedQuoteNo,
          CAST(NULL AS DATETIME2) AS WinspeedQuoteSyncedAt,
          CAST(qc.SOID AS INT) AS WinspeedConfirmSOID,
          qc.DocuNo AS WinspeedConfirmNo,
          CAST(NULL AS DATETIME2) AS WinspeedConfirmSyncedAt,
          CAST(qu.SOID AS INT) AS WinspeedEstimateID,
          qu.DocuNo AS WinspeedEstimateNo,
          CAST(NULL AS DATETIME2) AS WinspeedEstimateSyncedAt,
          CAST(NULL AS NVARCHAR(200)) AS SalesName,
          ISNULL(agg.LineCount, 0) AS LineCount,
          ISNULL(agg.TotalTon, 0) AS TotalTon,
          ISNULL(agg.TotalAmount, 0) AS TotalAmount,
          CAST(0 AS INT) AS SourceSoCount
        FROM dbo.SOHD qu WITH (NOLOCK)
        OUTER APPLY (
          SELECT TOP 1 qc2.SOID, qc2.DocuNo
          FROM dbo.SOHD qc2 WITH (NOLOCK)
          WHERE qc2.DocuType = '113'
            AND qc2.RefNo = qu.DocuNo
            AND ISNULL(qc2.DocuStatus, 'N') <> 'C'
          ORDER BY qc2.SOID DESC
        ) qc
        OUTER APPLY (
          SELECT COUNT(1) AS LineCount,
                 SUM(CAST(ISNULL(d.GoodQty2, 0) AS DECIMAL(18,3))) AS TotalTon,
                 SUM(CAST(ISNULL(d.GoodAmnt, ISNULL(d.GoodQty2, 0) * ISNULL(d.GoodPrice2, 0)) AS DECIMAL(18,2))) AS TotalAmount
          FROM dbo.SODT d WITH (NOLOCK)
          WHERE CONVERT(VARCHAR(50), d.SOID) = CONVERT(VARCHAR(50), ISNULL(qc.SOID, qu.SOID))
        ) agg
        WHERE qu.DocuType = '102'
          AND ISNUMERIC(CONVERT(VARCHAR(50), qu.SOID)) = 1
          AND NOT EXISTS (
            SELECT 1
            FROM wf.Quotation q WITH (NOLOCK)
            WHERE q.WinspeedQuoteSOID = CAST(qu.SOID AS INT)
               OR q.WinspeedQuoteNo = qu.DocuNo
          )
      )
      SELECT q.*
      FROM Rows q
      ${where}
      ORDER BY q.CreatedAt DESC, q.Id DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/quotation/:id
router.get('/:id', async (req, res) => {
  try {
    const hasSource = await hasQuoteSourceTable();
    const id = Number(req.params.id);
    if (Number.isInteger(id) && id < 0) {
      const native = await loadNativeQuotationBySoid(Math.abs(id));
      if (!native) return res.status(404).json({ message: 'quotation not found' });
      return res.json(native);
    }

    const q = (await wfQuery(`SELECT * FROM wf.Quotation WHERE Id=@id`, { id: { type: sql.Int, value: id } })).recordset?.[0];
    if (!q) return res.status(404).json({ message: 'ไม่พบใบเสนอราคา' });
    let lines = (await wfQuery(`SELECT * FROM wf.QuotationLine WHERE QuoteId=@id ORDER BY LineNum`, { id: { type: sql.Int, value: q.Id } })).recordset || [];
    if (!lines.length && q.WinspeedQuoteSOID) {
      const native = await loadNativeQuotationBySoid(q.WinspeedQuoteSOID);
      lines = native?.lines || [];
    }
    const sourceSos = hasSource
      ? (await wfQuery(`
          SELECT src.SoId, src.SourceWfRef, so.Status, so.CustId, so.CustName, so.TruckPlate
          FROM wf.QuotationSourceSO src
          LEFT JOIN wf.SalesOrder so ON so.Id = src.SoId
          WHERE src.QuoteId=@id
          ORDER BY src.Id
        `, { id: { type: sql.Int, value: q.Id } })).recordset || []
      : [];
    const totalTon = lines.reduce((sum, line) => sum + Number(line.QtyTon || 0), 0);
    const totalAmount = lines.reduce((sum, line) => sum + Number(line.LineAmount || (Number(line.QtyTon || 0) * Number(line.PricePerTon || 0))), 0);
    res.json({ ...q, lines, sourceSos, LineCount: lines.length, TotalTon: totalTon, TotalAmount: totalAmount });
  } catch (e) { res.status(e.statusCode || 500).json({ message: e.message }); }
});

// POST /api/quotation
router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    await assertNativeQuotationReady();
    const { custId, custName, validUntil, validDays, remark, lines, salesUserId: impersonatedId } = req.body;
    if (!custId || !lines?.length) return res.status(400).json({ message: 'custId และ lines จำเป็น' });
    const hasGiveaway = await hasQuoteLineGiveawayColumn();
    const normalizedValidUntil = normalizeValidUntil(validUntil, validDays);

    const result = await wfTransaction(async tx => {
      const quoteNo = await nextNativeDocNo(tx, 'QU');
      const qr = tx.request();
      qr.input('no', sql.NVarChar(30), quoteNo);
      qr.input('cid', sql.NVarChar(20), custId);
      qr.input('cnm', sql.NVarChar(200), custName || '');
      qr.input('vu', sql.Date, normalizedValidUntil);
      qr.input('rm', sql.NVarChar(500), remark || null);
      const actualSalesUserId = (req.user.role === 'ADMIN' && impersonatedId) ? Number(impersonatedId) : req.user.sub;
      qr.input('su', sql.Int, actualSalesUserId);
      const qres = await qr.query(`
        INSERT INTO wf.Quotation (QuoteNo, CustId, CustName, ValidUntil, Remark, SalesUserId, Status)
        OUTPUT inserted.Id VALUES (@no, @cid, @cnm, @vu, @rm, @su, 'DRAFT')`);
      const qid = qres.recordset[0].Id;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const lr = tx.request();
        lr.input('q', sql.Int, qid); lr.input('n', sql.Int, i + 1);
        lr.input('gid', sql.NVarChar(20), l.goodId); lr.input('gc', sql.NVarChar(50), l.goodCode || '');
        lr.input('gn', sql.NVarChar(200), l.goodName || '');
        lr.input('qt', sql.Decimal(12,3), Number(l.qtyTon));
        lr.input('pp', sql.Decimal(12,2), Number(l.pricePerTon));
        lr.input('np', sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
        if (hasGiveaway) lr.input('ig', sql.Bit, l.isGiveaway ? 1 : 0);
        await lr.query(`INSERT INTO wf.QuotationLine (QuoteId, LineNum, GoodId, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon${hasGiveaway ? ', IsGiveaway' : ''})
          VALUES (@q,@n,@gid,@gc,@gn,@qt,@pp,@np${hasGiveaway ? ',@ig' : ''})`);
      }
      const native = await syncNativeQuotation(tx, qid, [], { hasGiveawayColumn: hasGiveaway });
      return { id: qid, quoteNo, native };
    });
    res.json({
      id: result.id,
      quoteNo: result.quoteNo,
      winspeedQuoteSoid: result.native?.quoteSoid,
      winspeedQuoteNo: result.native?.quoteNo,
      winspeedEstimateId: result.native?.quoteSoid,
      winspeedEstimateNo: result.native?.quoteNo,
    });
  } catch (e) { console.error(e); res.status(e.statusCode || 500).json({ message: e.message }); }
});

// POST /api/quotation/from-so-trip
router.post('/from-so-trip', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const soIds = [...new Set(Array.isArray(req.body?.soIds)
      ? req.body.soIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [])];
    const sourceRefs = [...new Set(Array.isArray(req.body?.sourceRefs)
      ? req.body.sourceRefs.map(ref => String(ref || '').trim()).filter(Boolean)
      : [])];
    if (!soIds.length && !sourceRefs.length) return res.status(400).json({ message: 'ต้องเลือก SO อย่างน้อย 1 ใบ' });
    if (!(await hasQuoteSourceTable())) {
      return res.status(400).json({ message: 'ยังไม่ได้ apply migration 042_so_trip_quotation.sql' });
    }
    await assertNativeQuotationReady();

    const orderReq = await ownerRequest();
    const matchByRef = sourceRefs.length > 0;
    const orderMatch = matchByRef
      ? {
          app: `so.WfRef IN (${addTextValues(orderReq, sourceRefs, 'oref')})`,
          native: `(ISNULL(ext.WfRef, hd.DocuNo) IN (${sourceRefs.map((_, i) => `@oref${i}`).join(',')}) OR hd.DocuNo IN (${sourceRefs.map((_, i) => `@oref${i}`).join(',')}))`,
          expectedCount: sourceRefs.length,
        }
      : {
          app: `so.Id IN (${addIds(orderReq, soIds)})`,
          native: `ISNUMERIC(CONVERT(VARCHAR(50), hd.SOID)) = 1 AND CAST(hd.SOID AS INT) IN (${soIds.map((_, i) => `@id${i}`).join(',')})`,
          expectedCount: soIds.length,
        };
    const orders = (await orderReq.query(`
      SELECT SourceKind, Id, WfRef, CustId, CustName, Status, SalesUserId, TruckPlate, DeliveryDate
      FROM (
        SELECT
          'APP' AS SourceKind,
          CAST(so.Id AS INT) AS Id,
          so.WfRef,
          so.CustId,
          so.CustName,
          so.Status,
          so.SalesUserId,
          so.TruckPlate,
          so.DeliveryDate
        FROM wf.SalesOrder so WITH (NOLOCK)
        WHERE ${orderMatch.app}

        UNION ALL

        SELECT
          'WINSPEED' AS SourceKind,
          CAST(hd.SOID AS INT) AS Id,
          ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
          CAST(hd.CustID AS NVARCHAR(20)) AS CustId,
          hd.CustName,
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          ext.SalesUserId,
          hd.TransRegistration AS TruckPlate,
          ISNULL(ext.DeliveryDate, CAST(hd.DocuDate AS DATE)) AS DeliveryDate
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.DocuType IN (103, 104)
          AND ISNUMERIC(CONVERT(VARCHAR(50), hd.SOID)) = 1
          AND ${orderMatch.native}
      ) src
      ORDER BY Id
    `)).recordset || [];

    if (orders.length !== orderMatch.expectedCount) return res.status(404).json({ message: 'พบ SO ไม่ครบตามที่เลือก' });
    const nonDraft = orders.find(o => o.Status !== 'DRAFT');
    if (nonDraft) return res.status(400).json({ message: `SO ${nonDraft.WfRef || nonDraft.Id} ต้องเป็นสถานะร่างก่อนทำใบเสนอราคา` });

    const custId = String(orders[0].CustId || '');
    const differentCustomer = orders.find(o => String(o.CustId || '') !== custId);
    if (differentCustomer) return res.status(400).json({ message: 'สร้างใบเสนอราคาจากหลายลูกค้าในใบเดียวไม่ได้' });

    const sourceSoIds = orders.map(o => Number(o.Id)).filter(n => Number.isInteger(n) && n > 0);
    const existingReq = await ownerRequest();
    const existingIn = addIds(existingReq, sourceSoIds);
    const existing = (await existingReq.query(`
      SELECT TOP 1 q.QuoteNo, q.Status, src.SourceWfRef
      FROM wf.QuotationSourceSO src
      INNER JOIN wf.Quotation q ON q.Id = src.QuoteId
      WHERE src.SoId IN (${existingIn})
        AND q.Status IN ('DRAFT', 'SENT', 'ACCEPTED')
      ORDER BY q.Id DESC
    `)).recordset?.[0];
    if (existing) {
      return res.status(400).json({ message: `SO ${existing.SourceWfRef || ''} ถูกผูกกับใบเสนอราคา ${existing.QuoteNo} (${existing.Status}) อยู่แล้ว` });
    }

    const lineReq = await ownerRequest();
    const appIds = orders.filter(o => o.SourceKind === 'APP').map(o => Number(o.Id));
    const winspeedIds = orders.filter(o => o.SourceKind === 'WINSPEED').map(o => String(o.Id));
    const appLineWhere = appIds.length ? `WHERE sol.SoId IN (${addIds(lineReq, appIds)})` : 'WHERE 1 = 0';
    const winspeedLineWhere = winspeedIds.length ? `WHERE CONVERT(VARCHAR(50), dt.SOID) IN (${addTextValues(lineReq, winspeedIds, 'wid')})` : 'WHERE 1 = 0';
    const rawLines = (await lineReq.query(`
      SELECT
        CAST(sol.GoodId AS NVARCHAR(20)) AS GoodId,
        sol.GoodCode,
        sol.GoodName,
        sol.QtyTon,
        sol.PricePerTon,
        sol.NetPricePerTon,
        ISNULL(sol.IsGiveaway, 0) AS IsGiveaway
      FROM wf.SalesOrderLine sol WITH (NOLOCK)
      ${appLineWhere}

      UNION ALL

      SELECT
        CAST(dt.GoodID AS NVARCHAR(20)) AS GoodId,
        ISNULL(g.GoodCode, CAST(dt.GoodID AS NVARCHAR(50))) AS GoodCode,
        ISNULL(NULLIF(dt.GoodName, ''), g.GoodName1) AS GoodName,
        CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3)) AS QtyTon,
        CAST(ISNULL(dt.GoodPrice2, 0) AS DECIMAL(12,2)) AS PricePerTon,
        CAST(ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS DECIMAL(12,2)) AS NetPricePerTon,
        CAST(CASE WHEN ISNULL(ext.IsGiveaway, 0) = 1 OR ISNULL(dt.FreeFlag, 'N') = 'Y' THEN 1 ELSE 0 END AS BIT) AS IsGiveaway
      FROM dbo.SODT dt WITH (NOLOCK)
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      LEFT JOIN wf.SalesOrderLineExt ext WITH (NOLOCK)
        ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), dt.SOID)
       AND ext.ListNo = dt.ListNo
      ${winspeedLineWhere}
    `)).recordset || [];

    const merged = new Map();
    for (const l of rawLines) {
      if (l.IsGiveaway) continue;
      const key = [l.GoodId, l.GoodCode, l.GoodName, Number(l.PricePerTon || 0), Number(l.NetPricePerTon || 0)].join('|');
      if (!merged.has(key)) {
        merged.set(key, {
          goodId: String(l.GoodId || ''),
          goodCode: String(l.GoodCode || ''),
          goodName: String(l.GoodName || ''),
          qtyTon: 0,
          pricePerTon: Number(l.PricePerTon || 0),
          netPricePerTon: Number(l.NetPricePerTon || 0),
        });
      }
      merged.get(key).qtyTon += Number(l.QtyTon || 0);
    }
    const quoteLines = Array.from(merged.values()).filter(l => l.qtyTon > 0);
    if (!quoteLines.length) return res.status(400).json({ message: 'ไม่พบรายการขายจริงสำหรับทำใบเสนอราคา (ของแถมจะไม่ถูกนำไปเสนอราคา)' });

    const validUntil = normalizeValidUntil(req.body?.validUntil, req.body?.validDays);
    const remark = req.body?.remark || `สร้างจาก Sale Trip: ${orders.map(o => o.WfRef).join(', ')}`;
    const salesUserId = (req.user.role === 'ADMIN' && req.body?.salesUserId) ? Number(req.body.salesUserId) : (orders[0].SalesUserId || req.user.sub);

    const result = await wfTransaction(async tx => {
      const quoteNo = await nextNativeDocNo(tx, 'QU');
      const qr = tx.request();
      qr.input('no', sql.NVarChar(30), quoteNo);
      qr.input('cid', sql.NVarChar(20), custId);
      qr.input('cnm', sql.NVarChar(200), orders[0].CustName || '');
      qr.input('vu', sql.Date, validUntil);
      qr.input('rm', sql.NVarChar(500), remark);
      qr.input('su', sql.Int, salesUserId);
      const qres = await qr.query(`
        INSERT INTO wf.Quotation (QuoteNo, CustId, CustName, ValidUntil, Remark, SalesUserId, Status)
        OUTPUT inserted.Id
        VALUES (@no, @cid, @cnm, @vu, @rm, @su, 'DRAFT')
      `);
      const qid = qres.recordset[0].Id;

      for (let i = 0; i < quoteLines.length; i++) {
        const l = quoteLines[i];
        await tx.request()
          .input('q', sql.Int, qid)
          .input('n', sql.Int, i + 1)
          .input('gid', sql.NVarChar(20), l.goodId)
          .input('gc', sql.NVarChar(50), l.goodCode)
          .input('gn', sql.NVarChar(200), l.goodName)
          .input('qt', sql.Decimal(12, 3), l.qtyTon)
          .input('pp', sql.Decimal(12, 2), l.pricePerTon)
          .input('np', sql.Decimal(12, 2), l.netPricePerTon)
          .query(`INSERT INTO wf.QuotationLine (QuoteId, LineNum, GoodId, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon)
                  VALUES (@q,@n,@gid,@gc,@gn,@qt,@pp,@np)`);
      }

      for (const o of orders) {
        await tx.request()
          .input('q', sql.Int, qid)
          .input('s', sql.Int, o.Id)
          .input('ref', sql.NVarChar(30), o.WfRef || null)
          .query(`INSERT INTO wf.QuotationSourceSO (QuoteId, SoId, SourceWfRef) VALUES (@q,@s,@ref)`);
      }

      const native = await syncNativeQuotation(tx, qid, orders.map(o => o.WfRef).filter(Boolean), { hasGiveawayColumn: false });
      return { id: qid, quoteNo, native };
    });

    res.json({
      id: result.id,
      quoteNo: result.quoteNo,
      winspeedQuoteSoid: result.native?.quoteSoid,
      winspeedQuoteNo: result.native?.quoteNo,
      winspeedEstimateId: result.native?.quoteSoid,
      winspeedEstimateNo: result.native?.quoteNo,
      sourceSoIds: orders.map(o => o.Id),
      sourceWfRefs: orders.map(o => o.WfRef),
      lineCount: quoteLines.length,
      validUntil: validUntil.toISOString().slice(0, 10),
    });
  } catch (e) { console.error(e); res.status(e.statusCode || 500).json({ message: e.message }); }
});

// PATCH /api/quotation/:id/status
router.patch('/:id/status', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].includes(status))
      return res.status(400).json({ message: 'status ไม่ถูกต้อง' });

    let native = null;
    let restoredSources = [];
    if (status === 'ACCEPTED') {
      await assertNativeQuotationReady();
      native = await wfTransaction(async tx => {
        const q = (await tx.request()
          .input('id', sql.Int, Number(req.params.id))
          .query(`SELECT WinspeedQuoteSOID FROM wf.Quotation WHERE Id=@id`)).recordset?.[0];
        if (!q) {
          const err = new Error('ไม่พบใบเสนอราคา');
          err.statusCode = 404;
          throw err;
        }
        if (!q.WinspeedQuoteSOID) {
          await syncNativeQuotation(tx, Number(req.params.id), [], { hasGiveawayColumn: await hasQuoteLineGiveawayColumn() });
        }
        return await confirmNativeQuotation(tx, Number(req.params.id), req.user.sub);
      });
    } else {
      const ready = await getNativeQuotationReadiness();
      restoredSources = await wfTransaction(async tx => {
        await tx.request()
          .input('s', sql.NVarChar(20), status)
          .input('id', sql.Int, Number(req.params.id))
          .query(`UPDATE wf.Quotation SET Status=@s, UpdatedAt=GETUTCDATE() WHERE Id=@id`);
        if (ready.hasNativeTables && ready.hasLinkColumns) {
          await updateNativeQuotationStatus(tx, Number(req.params.id), status);
        }
        if (status === 'CANCELLED' && await hasQuoteSourceTable()) {
          return await restoreSourceSalesOrdersToDraft(tx, Number(req.params.id));
        }
        return [];
      });
    }

    if (status === 'CANCELLED' && restoredSources.length) {
      for (const src of restoredSources) {
        broadcast('so_updated', { id: src.SoId, wfRef: src.SourceWfRef, action: 'quotation_cancelled_restore_draft' });
      }
    }

    let sourceSoCount = 0;
    if (status === 'CANCELLED' && await hasQuoteSourceTable()) {
      const r = await wfQuery(`SELECT COUNT(1) AS Cnt FROM wf.QuotationSourceSO WHERE QuoteId=@id`,
        { id: { type: sql.Int, value: Number(req.params.id) } });
      sourceSoCount = Number(r.recordset?.[0]?.Cnt || 0);
    }
    res.json({ id: Number(req.params.id), status, sourceSoCount, restoredSoCount: restoredSources.length, ...native });
  } catch (e) { res.status(e.statusCode || 500).json({ message: e.message }); }
});

// PATCH /api/quotation/:id/valid-until
router.patch('/:id/valid-until', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const validUntil = normalizeValidUntil(req.body?.validUntil, req.body?.validDays);
    const ready = await getNativeQuotationReadiness();
    await wfTransaction(async tx => {
      await tx.request()
        .input('vu', sql.Date, validUntil)
        .input('id', sql.Int, Number(req.params.id))
        .query(`UPDATE wf.Quotation SET ValidUntil=@vu, UpdatedAt=GETUTCDATE() WHERE Id=@id`);
      if (ready.hasNativeTables && ready.hasLinkColumns) {
        await updateNativeQuotationValidity(tx, Number(req.params.id), validUntil);
      }
    });
    res.json({ id: Number(req.params.id), validUntil: validUntil.toISOString().slice(0, 10) });
  } catch (e) { res.status(e.statusCode || 500).json({ message: e.message }); }
});

// POST /api/quotation/:id/convert - create a draft app SO from an accepted quotation.
router.post('/:id/convert', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const { soPrefix } = req.body;
    const prefix = ['I', 'K', 'AI'].includes(soPrefix) ? soPrefix : 'I';
    const q = (await wfQuery(`SELECT * FROM wf.Quotation WHERE Id=@id`, { id: { type: sql.Int, value: Number(req.params.id) } })).recordset?.[0];
    if (!q) return res.status(404).json({ message: 'ไม่พบใบเสนอราคา' });
    if (q.Status === 'CONVERTED') return res.status(400).json({ message: 'แปลงเป็น SO แล้ว' });
    if (q.Status !== 'ACCEPTED') return res.status(400).json({ message: 'ใบเสนอราคาต้องได้รับการยืนยัน/อนุมัติก่อนจึงจะแปลงเป็น SO ได้' });
    if (!(await nativeQuotationApproved(q))) {
      return res.status(400).json({ message: 'WINSpeed ยังไม่มีเอกสารยืนยันใบเสนอราคา (QC) หรือ QU ยังไม่อนุมัติ' });
    }

    const lines = (await wfQuery(`SELECT * FROM wf.QuotationLine WHERE QuoteId=@id ORDER BY LineNum`, { id: { type: sql.Int, value: q.Id } })).recordset || [];
    const seqR = await wfQuery(`SELECT NEXT VALUE FOR wf.WfRefSeq AS Seq`);
    const seq = String(seqR.recordset[0].Seq).padStart(6, '0');
    const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
    const ref = `WF${yy}${prefix}-${seq}`;

    const soId = await wfTransaction(async tx => {
      const sr = tx.request();
      sr.input('ref', sql.NVarChar(30), ref); sr.input('pfx', sql.NVarChar(5), prefix);
      sr.input('cid', sql.NVarChar(20), q.CustId); sr.input('cnm', sql.NVarChar(200), q.CustName);
      sr.input('rm', sql.NVarChar(500), `จากใบเสนอราคา ${q.QuoteNo}`); sr.input('su', sql.Int, q.SalesUserId);
      const sres = await sr.query(`
        INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Remark, SalesUserId, Status)
        OUTPUT inserted.Id VALUES (@ref,@pfx,@cid,@cnm,@rm,@su,'DRAFT')`);
      const sid = sres.recordset[0].Id;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const lr = tx.request();
        lr.input('s', sql.Int, sid); lr.input('n', sql.Int, i + 1);
        lr.input('gid', sql.NVarChar(20), l.GoodId); lr.input('gc', sql.NVarChar(50), l.GoodCode);
        lr.input('gn', sql.NVarChar(200), l.GoodName);
        lr.input('qt', sql.Decimal(12,3), Number(l.QtyTon)); lr.input('qb', sql.Int, Math.round(Number(l.QtyTon) * 20));
        lr.input('pp', sql.Decimal(12,2), Number(l.PricePerTon)); lr.input('np', sql.Decimal(12,2), Number(l.NetPricePerTon));
        lr.input('ig', sql.Bit, l.IsGiveaway ? 1 : 0);
        await lr.query(`INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway)
          VALUES (@s,@n,@gid,@gc,@gn,@qt,@qb,@pp,@np,@ig)`);
      }
      return sid;
    });

    await wfQuery(`UPDATE wf.Quotation SET Status='CONVERTED', ConvertedSoId=@so, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { so: { type: sql.Int, value: soId }, id: { type: sql.Int, value: q.Id } });
    res.json({ quoteId: q.Id, soId, wfRef: ref });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
