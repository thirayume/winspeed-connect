/**
 * credit-service.js — Verification of Customer Credit Limit and AR Aging
 *
 * Checks:
 * 1. Monetary Credit Limit: Outstanding balance + Order amount vs Credit Limit
 * 2. Aging Days: Unpaid invoices from WinSpeed dbo schema vs Customer Aging Limit (default 60 days)
 * 3. Enforces Strict Mode (blocks order) or Soft Warning Mode (logs abnormal event) based on System Settings
 */

const { sql, wfQuery } = require('../db');
const { getSettingValue } = require('./policy-contract');

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Check customer credit limit and aging status from WinSpeed dbo schema and wf policy
 * @param {string|number} custId
 * @param {number} [orderAmount=0]
 * @returns {Promise<object>} Credit and Aging evaluation result
 */
async function checkCustomerCreditAndAging(custId, orderAmount = 0) {
  const cid = String(custId || '').trim();
  if (!cid) {
    return {
      ok: true,
      blocked: false,
      warnings: [],
      anomalies: [],
      creditLimit: 0,
      totalOutstanding: 0,
      agingLimitDays: 60,
      maxAgingDays: 0,
    };
  }

  // 1. Fetch Customer Master & Settings
  const custRes = await wfQuery(`
    SELECT TOP 1
      c.CustID,
      c.CustName,
      COALESCE(cx.CreditLimit, cm.CreditLimit, c.CreditAmnt, 0) AS CustLimit,
      g.CreditAmnt AS GroupLimit,
      COALESCE(cx.AgingDays, cm.AgingDays, c.CreditDays, 60) AS AgingDaysLimit,
      ISNULL(cm.CreditHold, 0) AS CreditHold
    FROM dbo.EMCust c WITH (NOLOCK)
    LEFT JOIN wf.CustomerExt cx WITH (NOLOCK) ON cx.CustId = c.CustID
    LEFT JOIN wf.CreditMaster cm WITH (NOLOCK) ON cm.CustId = c.CustID
    LEFT JOIN dbo.EMCustGroup g WITH (NOLOCK) ON g.CustGroupID = c.CustGroupID
    WHERE c.CustID = @cid
  `, { cid: { type: sql.NVarChar(20), value: cid } });

  const custRow = custRes.recordset?.[0];
  const custName = custRow?.CustName || cid;
  const custLimit = Number(custRow?.CustLimit || 0);
  const groupLimit = Number(custRow?.GroupLimit || 0);
  const creditLimit = custLimit > 0 ? custLimit : (groupLimit > 0 ? groupLimit : 0);
  const rawAgingDays = Number(custRow?.AgingDaysLimit);
  const creditHold = Boolean(custRow?.CreditHold);

  // 2. Fetch Policies from SystemSetting
  const [strictCreditSetting, strictAgingSetting, defaultAgingSetting] = await Promise.all([
    getSettingValue('CREDIT_LIMIT_STRICT_MODE'),
    getSettingValue('CREDIT_AGING_STRICT_MODE'),
    getSettingValue('CREDIT_AGING_DEFAULT_DAYS'),
  ]);

  const strictCreditMode = String(strictCreditSetting).toLowerCase() === 'true';
  const strictAgingMode = String(strictAgingSetting).toLowerCase() === 'true';
  const defaultAgingDays = Number(defaultAgingSetting) > 0 ? Number(defaultAgingSetting) : 60;
  const agingLimitDays = rawAgingDays > 0 ? rawAgingDays : defaultAgingDays;

  // 3. Fetch Unpaid Invoices and Aging from WinSpeed dbo schema
  const invRes = await wfQuery(`
    SELECT 
      i.SOInvID,
      i.DocuNo,
      CONVERT(VARCHAR(10), i.DocuDate, 120) AS DocuDate,
      CAST(i.NetAmnt AS DECIMAL(14,2)) AS NetAmnt,
      CAST(ISNULL(r.Received, 0) AS DECIMAL(14,2)) AS ReceivedAmnt,
      CAST((i.NetAmnt - ISNULL(r.Received, 0)) AS DECIMAL(14,2)) AS UnpaidAmnt,
      DATEDIFF(day, i.DocuDate, GETDATE()) AS AgeDays
    FROM dbo.SOInvHD i WITH (NOLOCK)
    OUTER APPLY (
      SELECT SUM(d.ReceAmnt) AS Received 
      FROM dbo.ARReceDT d WITH (NOLOCK)
      WHERE d.SOInvID = i.SOInvID
    ) r
    WHERE i.CustID = @cid
      AND i.Docutype IN ('202', '107')
      AND ISNULL(i.DocuStatus, '') <> 'C'
      AND (i.NetAmnt - ISNULL(r.Received, 0)) > 0.01
    ORDER BY i.DocuDate ASC
  `, { cid: { type: sql.NVarChar(20), value: cid } });

  const unpaidInvoices = invRes.recordset || [];
  let totalOutstanding = 0;
  let maxAgingDays = 0;
  const overdueInvoices = [];
  let overdueAmount = 0;

  for (const inv of unpaidInvoices) {
    const unpaid = Number(inv.UnpaidAmnt || 0);
    const age = Number(inv.AgeDays || 0);
    totalOutstanding += unpaid;
    if (age > maxAgingDays) maxAgingDays = age;
    if (age > agingLimitDays) {
      overdueInvoices.push({
        docuNo: inv.DocuNo,
        docuDate: inv.DocuDate,
        unpaidAmnt: unpaid,
        ageDays: age,
        overdueDays: age - agingLimitDays,
      });
      overdueAmount += unpaid;
    }
  }

  const amt = Number(orderAmount || 0);
  const totalWithOrder = totalOutstanding + amt;
  const isCreditLimitExceeded = creditLimit > 0 && totalWithOrder > creditLimit;
  const creditExcessAmount = isCreditLimitExceeded ? (totalWithOrder - creditLimit) : 0;
  const isAgingExceeded = overdueInvoices.length > 0;

  const warnings = [];
  const anomalies = [];
  const blockReasons = [];

  if (creditHold) {
    blockReasons.push(`ลูกค้ารายนี้ถูกระงับเครดิต (Credit Hold) โดยฝ่ายการเงิน`);
  }

  if (isCreditLimitExceeded) {
    const msg = `เกินวงเงินเครดิต ${fmt(creditExcessAmount)} บาท (วงเงิน ${fmt(creditLimit)} · ค้างชำระ ${fmt(totalOutstanding)} · ใบนี้ ${fmt(amt)})`;
    if (strictCreditMode) {
      blockReasons.push(`[Strict Rule] ${msg} — ไม่อนุญาตให้เปิดบิลขาย`);
    } else {
      warnings.push(msg);
      anomalies.push({
        type: 'CREDIT_LIMIT_EXCEEDED',
        action: 'CREDIT_LIMIT_EXCEEDED',
        title: 'เกินวงเงินเครดิต',
        message: msg,
        details: {
          custId: cid,
          custName,
          creditLimit,
          totalOutstanding,
          orderAmount: amt,
          excessAmount: creditExcessAmount,
        },
      });
    }
  }

  if (isAgingExceeded) {
    const overdueDays = maxAgingDays - agingLimitDays;
    const invCount = overdueInvoices.length;
    const topDocuNos = overdueInvoices.slice(0, 3).map(x => x.docuNo).join(', ');
    const msg = `ลูกค้ามีหนี้ค้างชำระเกินกำหนด Aging ${maxAgingDays} วัน (เกินเกณฑ์ ${overdueDays} วัน จากกำหนด ${agingLimitDays} วัน) จำนวน ${invCount} ใบ (${topDocuNos}${invCount > 3 ? '...' : ''}) ยอดค้างชำระ ${fmt(overdueAmount)} บาท`;
    if (strictAgingMode) {
      blockReasons.push(`[Strict Rule] ${msg} — ไม่อนุญาตให้เปิดบิลขาย`);
    } else {
      warnings.push(msg);
      anomalies.push({
        type: 'AGING_LIMIT_EXCEEDED',
        action: 'AGING_LIMIT_EXCEEDED',
        title: 'หนี้ค้างชำระเกินกำหนด Aging',
        message: msg,
        details: {
          custId: cid,
          custName,
          agingLimitDays,
          maxAgingDays,
          overdueDays,
          overdueAmount,
          overdueInvoices,
        },
      });
    }
  }

  const blocked = blockReasons.length > 0;

  return {
    ok: !blocked,
    blocked,
    blockReasons,
    warnings,
    anomalies,
    custId: cid,
    custName,
    creditLimit,
    creditHold,
    totalOutstanding,
    orderAmount: amt,
    totalWithOrder,
    isCreditLimitExceeded,
    creditExcessAmount,
    agingLimitDays,
    maxAgingDays,
    isAgingExceeded,
    overdueAmount,
    overdueInvoices,
    unpaidCount: unpaidInvoices.length,
    strictCreditMode,
    strictAgingMode,
  };
}

module.exports = {
  checkCustomerCreditAndAging,
  fmt,
};

