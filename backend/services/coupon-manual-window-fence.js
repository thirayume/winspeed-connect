'use strict';

// The global window belongs to the configured primary database. Hold its
// setting and the native document date until manual settlement commits.
const db = require('../db');
const { DEFAULT_START_DATE, isValidStartDate } = require('./data-window');
const { KEY } = require('./global-data-window-store');

function reject(code, status = 409) {
  const messages = {
    DATA_WINDOW_UNAVAILABLE: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้ กรุณาลองใหม่',
    DATA_WINDOW_CHANGED: 'วันเริ่มข้อมูลเปลี่ยนระหว่างทำรายการ กรุณาโหลดข้อมูลใหม่',
    REDEMPTION_ID_INVALID: 'รหัสใบขนหรือรหัสตั๋วไม่ถูกต้อง',
    PRIMARY_DATABASE_REQUIRED: 'ไม่สามารถตรวจฐานข้อมูลหลักได้',
    MANUAL_SETTLEMENT_PRIMARY_REQUIRED: 'ไม่สามารถบันทึกการจับคู่ในฐานข้อมูลนี้ได้',
    REDEMPTION_OUTSIDE_DATA_WINDOW: 'ไม่พบใบขนที่สามารถจับคู่ได้ในช่วงข้อมูล',
  };
  throw Object.assign(new Error(messages[code] || code), { code, status });
}

async function assertPrimaryDatabase(tx) {
  const primary = String(process.env.ONPREM_DB_NAME || '').trim();
  if (db.DEFAULT_TARGET === 'onprem') {
    if (!primary) reject('PRIMARY_DATABASE_REQUIRED', 503);
    const row = (await tx.request().query('SELECT DB_NAME() AS DatabaseName')).recordset?.[0];
    if (String(row?.DatabaseName || '').toLowerCase() !== primary.toLowerCase()) {
      reject('MANUAL_SETTLEMENT_PRIMARY_REQUIRED', 403);
    }
  }
}

async function validateManualSettlementWindow(tx, { window, redemptionId, couponId }) {
  if (!isValidStartDate(window?.businessDate)) reject('DATA_WINDOW_UNAVAILABLE', 503);
  if (![redemptionId, couponId].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647)) {
    reject('REDEMPTION_ID_INVALID', 400);
  }
  await assertPrimaryDatabase(tx);
  const rows = (await tx.request().input('key', db.sql.NVarChar(100), KEY)
    .query('SELECT SettingValue FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey=@key')).recordset || [];
  if (rows.length > 1) reject('DATA_WINDOW_UNAVAILABLE', 503);
  const current = rows[0]?.SettingValue == null || rows[0]?.SettingValue === ''
    ? DEFAULT_START_DATE : String(rows[0].SettingValue).trim();
  if (!isValidStartDate(current)) reject('DATA_WINDOW_UNAVAILABLE', 503);
  if (current !== window.businessDate) reject('DATA_WINDOW_CHANGED');
  const found = (await tx.request()
    .input('redemptionId', db.sql.Int, redemptionId)
    .input('couponId', db.sql.Int, couponId)
    .input('start', db.sql.Date, current)
    .query(`SELECT TOP 2 h.RedemtionID FROM dbo.WFRedemtionHD h WITH (HOLDLOCK)
      WHERE h.RedemtionID=@redemptionId AND h.DocuType=116 AND h.DocuDate>=@start
        AND ISNULL(LTRIM(RTRIM(h.DocuStatus)),'') IN ('N','Y')
        AND EXISTS (SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
          WHERE d.RedemtionID=h.RedemtionID AND d.CouponID=@couponId)`)).recordset || [];
  if (found.length !== 1) reject('REDEMPTION_OUTSIDE_DATA_WINDOW', 404);
}

module.exports = { validateManualSettlementWindow, assertPrimaryDatabase };
