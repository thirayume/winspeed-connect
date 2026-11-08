'use strict';

// SQL Server 2008 supports COUNT_BIG OVER(). The count and rows use exactly the
// same filters/scope; no shared cache and no extra query for a normal page.
async function readPageTotal(records, offset, loadEmptyPageTotal) {
  const total = records.length ? Number(records[0].FilteredTotal)
    : offset > 0 ? await loadEmptyPageTotal() : 0;
  return { total, rows: records.map(({ FilteredTotal, ...row }) => row) };
}
module.exports = { readPageTotal };
