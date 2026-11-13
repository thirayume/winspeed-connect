'use strict';

// Read from the selected business database without the process-wide setting
// cache. A missing row uses the documented default; a database error or an
// invalid value must not silently change a financial decision.
async function readRebateCycleMonths(query, { lock = false } = {}) {
  const r = await query(`SELECT SettingValue FROM wf.SystemSetting ${lock ? 'WITH (HOLDLOCK)' : ''}
    WHERE SettingKey=@key`, { key: 'REBATE_CYCLE_MONTHS' });
  const raw = r.recordset?.[0]?.SettingValue;
  const value = raw == null || String(raw).trim() === '' ? 12 : Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 1 || value > 24) {
    throw Object.assign(new Error('Invalid rebate cycle setting'), { code: 'INVALID_REBATE_CYCLE', status: 503 });
  }
  return value;
}
module.exports = { readRebateCycleMonths };
