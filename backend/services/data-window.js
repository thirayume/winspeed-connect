'use strict';

// Shared boundary semantics for the data-window rollout. This module does not
// change any query or setting until each workflow is explicitly integrated.
const DEFAULT_START_DATE = '2026-01-01';
const BANGKOK_OFFSET_MINUTES = 7 * 60;

function isValidStartDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1753 || year > 9999) return false; // SQL Server 2008 datetime compatibility
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function boundaries(value) {
  if (!isValidStartDate(value)) throw Object.assign(new Error('INVALID_DATA_START_DATE'), { code: 'INVALID_DATA_START_DATE' });
  const [year, month, day] = value.split('-').map(Number);
  return {
    businessDate: value,
    // Use as a local wall-clock value only where a column is explicitly known to store Bangkok local time.
    bangkokLocal: `${value} 00:00:00`,
    // Use this UTC instant only for columns explicitly known to contain UTC timestamps.
    utcInstant: new Date(Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MINUTES * 60000),
  };
}

module.exports = { DEFAULT_START_DATE, isValidStartDate, boundaries };
