'use strict';

/**
 * Owner 2026-10-09: old WinSpeed bookings are hidden from the boards, bill lists, dashboard counts and the backlog
 * report. Bookings of 2019–2021 never went through WinSpeed approval, so they all read "awaiting WinSpeed" and their
 * open lines filled the backlog. LEGACY_DOC_CUTOFF_DATE (default 2022-01-01, editable in settings) sets the date.
 * A control ticket that still has tons open is always shown, whatever its date: it is live business.
 * Opening a bill by id is not affected.
 */
const { sql } = require('../db');
const { getSettingValue } = require('./policy-contract');

async function legacyCutoffInput() {
  const d = String(await getSettingValue('LEGACY_DOC_CUTOFF_DATE') || '').slice(0, 10);
  return { legacyCut: { type: sql.Date, value: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '1900-01-01' } };
}

/** SQL condition on a dbo.SOHD alias: on/after the cut-off, or an open control ticket */
function legacyCutoffSql(alias = 'hd') {
  return `(${alias}.DocuDate >= @legacyCut OR (RTRIM(${alias}.TransRegistration) = N'ตั๋วคุม'
    AND EXISTS (SELECT 1 FROM dbo.SODT lcd WITH (NOLOCK) WHERE lcd.SOID = ${alias}.SOID AND lcd.RemaQty > 0)))`;
}

module.exports = { legacyCutoffInput, legacyCutoffSql };
