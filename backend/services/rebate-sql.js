'use strict';

// Rebate services accept raw JS values in their parameter maps, while db.wfQuery
// requires explicit { type, value }. Bind both forms without interpolating SQL.
function normalizeInputs(sql, inputs = {}) {
  return Object.fromEntries(Object.entries(inputs).map(([name, value]) => {
    if (value && typeof value === 'object' && 'type' in value && 'value' in value) return [name, value];
    let type;
    if (value == null) type = sql.NVarChar(sql.MAX);
    else if (typeof value === 'boolean') type = sql.Bit;
    else if (value instanceof Date) type = sql.DateTime2;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`Invalid numeric parameter: ${name}`);
      type = Number.isInteger(value) ? (value >= -2147483648 && value <= 2147483647 ? sql.Int : sql.BigInt) : sql.Decimal(19, 4);
    } else if (typeof value === 'string') type = sql.NVarChar(value.length > 4000 ? sql.MAX : Math.max(1, value.length));
    else throw new TypeError(`Unsupported parameter: ${name}`);
    return [name, { type, value }];
  }));
}

function rebateQuery(query, sql) {
  return (text, inputs) => query(text, normalizeInputs(sql, inputs));
}

function transactionQuery(tx, sql) {
  return (text, inputs) => {
    const request = tx.request();
    for (const [name, { type, value }] of Object.entries(normalizeInputs(sql, inputs))) request.input(name, type, value);
    return request.query(text);
  };
}

const db = require('../db');
const defaultRebateQuery = rebateQuery(db.wfQuery, db.sql);
module.exports = { normalizeInputs, rebateQuery, transactionQuery, defaultRebateQuery };
