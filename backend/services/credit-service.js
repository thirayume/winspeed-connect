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
 * Parse AgingDays input preserving 0 (cash only) and treating null/undefined/'' as null (inherit system default).
 */
function parseNullableAgingInput(val) {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * Read active Aging policy thresholds (standard default days and policy max warning days).
 */
async function getCreditAgingPolicyBounds(readSetting = getSettingValue) {
  const [defRaw, maxRaw] = await Promise.all([
    readSetting('CREDIT_AGING_DEFAULT_DAYS').catch(() => 60),
    readSetting('CREDIT_AGING_MAX_DAYS').catch(() => 90),
  ]);
  const defNum = Number(defRaw);
  const maxNum = Number(maxRaw);
  return {
    defaultAgingDays: Number.isFinite(defNum) && defNum >= 0 ? defNum : 60,
    maxPolicyAgingDays: Number.isFinite(maxNum) && maxNum >= 0 ? maxNum : 90,
  };
}

/**
 * Check customer credit limit and aging status from WinSpeed dbo schema and wf policy
 * @param {string|number} custId
 * @param {number} [orderAmount=0]
 * @returns {Promise<object>} Credit and Aging evaluation result
 */
async function checkCustomerCreditAndAging(custId, orderAmount = 0, deps = {}) {
  const queryFn = deps.wfQuery || wfQuery;
  const readSetting = deps.getSettingValue || getSettingValue;
  const cid = String(custId || '').trim();
  if (!cid) {
    return {
      ok: true,
      blocked: false,
      blockReasons: [],
      warnings: [],
      anomalies: [],
      creditLimit: 0,
      totalOutstanding: 0,
      orderAmount: 0,
      totalWithOrder: 0,
      projectedTotal: 0,
      isCreditLimitExceeded: false,
      isOverCreditLimit: false,
      creditExcessAmount: 0,
      rawAgingDays: null,
      agingLimitDays: 60,
      defaultAgingDays: 60,
      maxPolicyAgingDays: 90,
      agingAlertPopup: true,
      isUsingDefaultAging: true,
      isCashOnly: false,
      isConfiguredAgingOverPolicyMax: false,
      maxAgingDays: 0,
      isAgingExceeded: false,
      isOverAging: false,
      isOverPolicyMaxAging: false,
      overdueAmount: 0,
      overdueInvoices: [],
      unpaidCount: 0,
      strictCreditMode: false,
      strictAgingMode: false,
      strictCredit: false,
      strictAging: false,
    };
  }

  // 1. Fetch Customer Master & Settings
  const custRes = await queryFn(`
    SELECT TOP 1
      c.CustID,
      c.CustName,
      COALESCE(cx.CreditLimit, cm.CreditLimit, c.CreditAmnt, 0) AS CustLimit,
      g.CreditAmnt AS GroupLimit,
      COALESCE(cx.AgingDays, cm.AgingDays, c.CreditDays) AS AgingDaysLimit,
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
  const rawAgingVal = custRow?.AgingDaysLimit;
  const hasExplicitAging =
    rawAgingVal !== null &&
    rawAgingVal !== undefined &&
    String(rawAgingVal).trim() !== '' &&
    Number.isFinite(Number(rawAgingVal));
  const rawAgingDays = hasExplicitAging ? Math.max(0, Math.trunc(Number(rawAgingVal))) : null;
  const creditHold = Boolean(custRow?.CreditHold);

  // 2. Fetch Policies from SystemSetting
  const [
    strictCreditSetting,
    strictAgingSetting,
    defaultAgingSetting,
    maxPolicyAgingSetting,
    alertPopupSetting,
  ] = await Promise.all([
    readSetting('CREDIT_LIMIT_STRICT_MODE'),
    readSetting('CREDIT_AGING_STRICT_MODE'),
    readSetting('CREDIT_AGING_DEFAULT_DAYS'),
    readSetting('CREDIT_AGING_MAX_DAYS'),
    readSetting('CREDIT_AGING_ALERT_POPUP'),
  ]);

  const strictCreditMode = String(strictCreditSetting).toLowerCase() === 'true';
  const strictAgingMode = String(strictAgingSetting).toLowerCase() === 'true';
  const agingAlertPopup = String(alertPopupSetting).toLowerCase() !== 'false';
  const parsedDefault = Number(defaultAgingSetting);
  const defaultAgingDays = Number.isFinite(parsedDefault) && parsedDefault >= 0 ? parsedDefault : 60;
  const parsedMaxPolicy = Number(maxPolicyAgingSetting);
  const maxPolicyAgingDays = Number.isFinite(parsedMaxPolicy) && parsedMaxPolicy >= 0 ? parsedMaxPolicy : 90;

  // Semantics: 0 = cash only (no credit), NULL/unspecified = system default Aging days
  const isUsingDefaultAging = rawAgingDays === null;
  const agingLimitDays = isUsingDefaultAging ? defaultAgingDays : rawAgingDays;
  const isCashOnly = agingLimitDays === 0;
  const isConfiguredAgingOverPolicyMax = agingLimitDays > maxPolicyAgingDays;

  // 3. Fetch Unpaid Invoices and Aging from WinSpeed dbo schema
  const invRes = await queryFn(`
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
    // Cash-only (agingLimitDays === 0): any unpaid invoice (age >= 0) is considered overdue
    if (age > agingLimitDays || (isCashOnly && age >= 0)) {
      overdueInvoices.push({
        docuNo: inv.DocuNo,
        docuDate: inv.DocuDate,
        unpaidAmnt: unpaid,
        ageDays: age,
        overdueDays: Math.max(0, age - agingLimitDays),
      });
      overdueAmount += unpaid;
    }
  }

  const amt = Number(orderAmount || 0);
  const totalWithOrder = totalOutstanding + amt;
  const isCreditLimitExceeded = creditLimit > 0 && totalWithOrder > creditLimit;
  const creditExcessAmount = isCreditLimitExceeded ? (totalWithOrder - creditLimit) : 0;
  const isAgingExceeded = overdueInvoices.length > 0;
  const isOverPolicyMaxAging = unpaidInvoices.length > 0 && maxAgingDays > maxPolicyAgingDays;

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
    const overdueDays = Math.max(0, maxAgingDays - agingLimitDays);
    const invCount = overdueInvoices.length;
    const topDocuNos = overdueInvoices.slice(0, 3).map(x => x.docuNo).join(', ');
    const policySuffix = isOverPolicyMaxAging ? ` [เกินเพดานนโยบาย ${maxPolicyAgingDays} วัน!]` : '';
    const msg = isCashOnly
      ? `ลูกค้ากำหนดขายเงินสด (0 วัน) แต่มีหนี้ค้างชำระ (อายุหนี้สูงสุด ${maxAgingDays} วัน) จำนวน ${invCount} ใบ (${topDocuNos}${invCount > 3 ? '...' : ''}) ยอดค้างชำระ ${fmt(overdueAmount)} บาท${policySuffix}`
      : `ลูกค้ามีหนี้ค้างชำระเกินกำหนด Aging ${maxAgingDays} วัน (เกินเกณฑ์ ${overdueDays} วัน จากกำหนด ${agingLimitDays} วัน) จำนวน ${invCount} ใบ (${topDocuNos}${invCount > 3 ? '...' : ''}) ยอดค้างชำระ ${fmt(overdueAmount)} บาท${policySuffix}`;
    if (strictAgingMode) {
      blockReasons.push(`[Strict Rule] ${msg} — ไม่อนุญาตให้เปิดบิลขาย`);
    } else {
      warnings.push(msg);
      anomalies.push({
        type: 'AGING_LIMIT_EXCEEDED',
        action: 'AGING_LIMIT_EXCEEDED',
        title: isOverPolicyMaxAging ? 'หนี้ค้างชำระเกินเกณฑ์สูงสุดนโยบาย' : 'หนี้ค้างชำระเกินกำหนด Aging',
        message: msg,
        details: {
          custId: cid,
          custName,
          agingLimitDays,
          maxPolicyAgingDays,
          maxAgingDays,
          overdueDays,
          overdueAmount,
          overdueInvoices,
        },
      });
    }
  } else if (isOverPolicyMaxAging) {
    const msg = `ลูกค้ามีหนี้ค้างชำระอายุ ${maxAgingDays} วัน เกินเพดานสูงสุดตามนโยบาย (${maxPolicyAgingDays} วัน) แม้ยังไม่เกินกำหนดลูกค้า (${agingLimitDays} วัน) ยอดค้างรวม ${fmt(totalOutstanding)} บาท`;
    warnings.push(msg);
    anomalies.push({
      type: 'AGING_POLICY_MAX_EXCEEDED',
      action: 'AGING_POLICY_MAX_EXCEEDED',
      title: 'อายุหนี้เกินเกณฑ์สูงสุดตามนโยบาย',
      message: msg,
      details: {
        custId: cid,
        custName,
        agingLimitDays,
        maxPolicyAgingDays,
        maxAgingDays,
        totalOutstanding,
      },
    });
  }

  if (isConfiguredAgingOverPolicyMax) {
    warnings.push(`กำหนด Aging ของลูกค้า (${agingLimitDays} วัน) สูงกว่าเกณฑ์สูงสุดตามนโยบาย (${maxPolicyAgingDays} วัน) — กรุณาตรวจสอบความถูกต้อง`);
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
    projectedTotal: totalWithOrder,
    isCreditLimitExceeded,
    isOverCreditLimit: isCreditLimitExceeded,
    creditExcessAmount,
    rawAgingDays,
    agingLimitDays,
    defaultAgingDays,
    maxPolicyAgingDays,
    agingAlertPopup,
    isUsingDefaultAging,
    isCashOnly,
    isConfiguredAgingOverPolicyMax,
    maxAgingDays,
    isAgingExceeded,
    isOverAging: isAgingExceeded,
    isOverPolicyMaxAging,
    overdueAmount,
    overdueInvoices,
    unpaidCount: unpaidInvoices.length,
    strictCreditMode,
    strictAgingMode,
    strictCredit: strictCreditMode,
    strictAging: strictAgingMode,
  };
}

module.exports = {
  checkCustomerCreditAndAging,
  fmt,
  parseNullableAgingInput,
  getCreditAgingPolicyBounds,
};

