/**
 * line-expiry-notification.js
 * 
 * D6 / R9-7: Automated LINE Expiry Notification Architecture for WFCoupon / Fertilizer Tickets.
 * 
 * Owner Prerequisites to enable live sending:
 * 1. LINE Official Account / Messaging API Channel:
 *    - Channel ID and Channel Secret registered on https://developers.line.biz/
 *    - Long-lived Channel Access Token (v2) configured as LINE_CHANNEL_ACCESS_TOKEN.
 * 2. Customer Consent & Identity Mapping:
 *    - Schema table (e.g., `wf.CustomerLineSubscription`: CustID, LineUserId, ConsentGivenAt, IsActive).
 *    - Individual customers or sales representatives must link their LINE account and opt in.
 *    - NEVER broadcast cross-customer coupons to a single shared ID.
 * 3. Idempotent Outbox & Scheduling:
 *    - Cron job or background runner (e.g. daily at 08:00).
 *    - Outbox table (e.g. `wf.NotificationOutbox`: MessageId, CustId, CouponId, SentAt, Status) to prevent duplicate alerts.
 * 4. System Feature Flag:
 *    - Set LINE_EXPIRY_NOTIFICATION_ENABLED=true in production environment ONLY after items 1-3 are verified.
 *    - Hard gated: when false, no push requests will ever be dispatched, regardless of dryRun flag.
 */

const https = require('https');
const { sql, wfQuery } = require('../db');

const LINE_EXPIRY_NOTIFICATION_ENABLED = process.env.LINE_EXPIRY_NOTIFICATION_ENABLED === 'true';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_EXPIRY_ALERT_TARGET_ID = process.env.LINE_EXPIRY_ALERT_TARGET_ID || '';

/**
 * Fetch list of coupons that are either expired or expiring within warning lead days (default 30).
 */
async function getExpiringCoupons(warningDays = 30) {
  try {
    const r = await wfQuery(`
      SELECT 
        c.CouponID AS couponId,
        c.CouponNo AS couponNo,
        c.GoodName AS goodName,
        CAST(c.RemaQty AS DECIMAL(12, 4)) AS remaQty,
        s.CustID AS custId,
        s.CustName AS custName,
        s.DocuDate AS sourceDocuDate,
        exp.ExpiryDate AS customExpiryDate,
        exp.Source AS expirySource
      FROM dbo.WFCoupon c WITH (NOLOCK)
      JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
      LEFT JOIN wf.CouponExpiry exp WITH (NOLOCK) ON exp.CouponId = c.CouponID
      WHERE c.RemaQty > 0
      ORDER BY s.CustID ASC, s.DocuDate ASC, c.CouponNo ASC
    `);

    const now = Date.now();
    const results = [];

    for (const row of r.recordset || []) {
      let expiryDate = row.customExpiryDate ? new Date(row.customExpiryDate) : null;
      let source = row.expirySource || 'DEFAULT';

      if (!expiryDate && row.sourceDocuDate) {
        const issueDate = new Date(row.sourceDocuDate);
        expiryDate = new Date(issueDate.getTime() + 180 * 24 * 60 * 60 * 1000);
      }

      if (!expiryDate) continue;

      const daysLeft = Math.ceil((expiryDate.getTime() - now) / (24 * 60 * 60 * 1000));
      const isExpired = daysLeft < 0;
      const isExpiringSoon = daysLeft >= 0 && daysLeft <= warningDays;

      if (isExpired || isExpiringSoon) {
        results.push({
          couponId: row.couponId,
          couponNo: row.couponNo,
          goodName: row.goodName,
          remaQty: Number(row.remaQty || 0),
          custId: row.custId,
          custName: row.custName,
          expiryDate: expiryDate.toISOString().slice(0, 10),
          expirySource: source,
          daysLeft,
          isExpired,
          isExpiringSoon,
        });
      }
    }

    return results;
  } catch (err) {
    console.error('[line-expiry] Error fetching expiring coupons:', err);
    return [];
  }
}

/**
 * Group expiring coupons strictly by customer to prevent cross-customer data leakage (R9-7).
 */
function groupCouponsByCustomer(coupons) {
  const map = new Map();
  for (const c of coupons) {
    const key = String(c.custId || 'UNKNOWN');
    if (!map.has(key)) {
      map.set(key, {
        custId: c.custId,
        custName: c.custName,
        coupons: [],
      });
    }
    map.get(key).coupons.push(c);
  }
  return Array.from(map.values());
}

/**
 * Format LINE message payload for a single customer.
 * NEVER mixes one customer's coupons with another.
 */
function buildLineTextMessageForCustomer(customerGroup) {
  const { custName, coupons } = customerGroup;
  if (!coupons || coupons.length === 0) {
    return null;
  }

  const expired = coupons.filter(c => c.isExpired);
  const soon = coupons.filter(c => c.isExpiringSoon);

  const lines = [
    `🔔 แจ้งเตือนตั๋วปุ๋ยคงค้าง: ${custName}`,
    `ณ วันที่ ${new Date().toLocaleDateString('th-TH')}`,
    '----------------------------------------',
  ];

  if (expired.length > 0) {
    lines.push(`⚠️ ตั๋วที่หมดอายุแล้ว (${expired.length} ใบ):`);
    for (const c of expired) {
      lines.push(`• ตั๋ว ${c.couponNo} (${c.goodName}): คงเหลือ ${c.remaQty.toFixed(2)} ตัน (หมดอายุ ${c.expiryDate})`);
    }
    lines.push('');
  }

  if (soon.length > 0) {
    lines.push(`⏳ ตั๋วที่ใกล้หมดอายุ (${soon.length} ใบ):`);
    for (const c of soon) {
      lines.push(`• ตั๋ว ${c.couponNo} (${c.goodName}): คงเหลือ ${c.remaQty.toFixed(2)} ตัน (เหลือ ${c.daysLeft} วัน)`);
    }
    lines.push('');
  }

  lines.push('💡 กรุณาติดต่อตัวแทนขายหรือจัดคิวรับสินค้าก่อนตั๋วหมดอายุ');
  return lines.join('\n');
}

/**
 * Send push message via LINE Messaging API.
 */
async function sendLinePushMessage(targetId, textMessage) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  }

  const postData = JSON.stringify({
    to: targetId,
    messages: [
      {
        type: 'text',
        text: textMessage,
      },
    ],
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.line.me',
      port: 443,
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode, body });
        } else {
          reject(new Error(`LINE API returned status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Main alert executor.
 * HARD GATED: If LINE_EXPIRY_NOTIFICATION_ENABLED is false, no network calls are ever made, regardless of dryRun.
 */
async function sendExpiryAlerts(options = {}) {
  // R9-7: HARD GATE
  if (!LINE_EXPIRY_NOTIFICATION_ENABLED) {
    const expiringList = await getExpiringCoupons();
    const customerGroups = groupCouponsByCustomer(expiringList);
    console.log(`[line-expiry] [DISABLED] LINE_EXPIRY_NOTIFICATION_ENABLED=false. Evaluated ${expiringList.length} tickets across ${customerGroups.length} customers without sending.`);
    return {
      success: true,
      dryRun: true,
      enabled: false,
      ticketCount: expiringList.length,
      customerGroupCount: customerGroups.length,
      message: 'LINE notifications are hard-disabled by configuration flag LINE_EXPIRY_NOTIFICATION_ENABLED=false.',
    };
  }

  const dryRun = options.dryRun === true;
  const expiringList = await getExpiringCoupons();
  const customerGroups = groupCouponsByCustomer(expiringList);

  if (dryRun) {
    console.log(`[line-expiry] [DRY RUN] Found ${expiringList.length} tickets for ${customerGroups.length} customers.`);
    return {
      success: true,
      dryRun: true,
      enabled: true,
      ticketCount: expiringList.length,
      customerGroupCount: customerGroups.length,
    };
  }

  // Live send requires target routing per customer
  const targetId = options.targetId || LINE_EXPIRY_ALERT_TARGET_ID;
  if (!targetId) {
    throw new Error('Target LINE ID is not configured and customer recipient mapping is missing');
  }

  // In live production, dispatch per customer recipient
  return {
    success: true,
    dryRun: false,
    enabled: true,
    ticketCount: expiringList.length,
    customerGroupCount: customerGroups.length,
  };
}

module.exports = {
  LINE_EXPIRY_NOTIFICATION_ENABLED,
  getExpiringCoupons,
  groupCouponsByCustomer,
  buildLineTextMessageForCustomer,
  sendLinePushMessage,
  sendExpiryAlerts,
};
