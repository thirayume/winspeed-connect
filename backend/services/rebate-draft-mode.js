'use strict';

// NULL is deliberately preserved for existing drafts. A later booking gate
// must decide whether incomplete selections are allowed in that environment.
function normalizeRebatePricingMode(line = {}) {
  const raw=line.rebatePricingMode;
  if (raw===undefined || raw===null || raw==='') return null;
  if (typeof raw!=='string' || !['POOL','CASH'].includes(raw)) throw Object.assign(new Error('ประเภทรีเบทไม่ถูกต้อง'), { status:400, code:'REBATE_PRICING_MODE_INVALID' });
  if (line.isGiveaway || line.isCouponDrawn || line.isControlTicketDrawn) {
    throw Object.assign(new Error('รายการของแถมหรือตั๋วไม่ใช้ประเภทรีเบท'), { status:400, code:'REBATE_PRICING_MODE_NOT_APPLICABLE' });
  }
  return raw;
}
module.exports={normalizeRebatePricingMode};
