/**
 * request-context.js — who is really acting (R12 item 4).
 *
 * requireAuth runs the rest of the request inside this context, so audit writers
 * can record the Access As actor next to the effective user without every route
 * passing it down. Outside a request (jobs, scripts) there is no context.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function runWithUser(user, fn) {
  const effectiveId = Number(user?.sub ?? user?.id) || null;
  const actorId = Number(user?.actorSub ?? user?.actorId ?? effectiveId) || null;
  return als.run({ effectiveId, actorId }, fn);
}

/** Actor user id of the current request (the admin behind Access As, or the user themself). */
function currentActorId() {
  return als.getStore()?.actorId ?? null;
}

// Column checks are cached per process: the audit columns only appear after migration 144.
const columnCache = new Map();
async function hasColumn(queryFn, table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  let present = false;
  try {
    const r = await queryFn(`SELECT CASE WHEN COL_LENGTH('${table}', '${column}') IS NULL THEN 0 ELSE 1 END AS HasCol`);
    present = Number(r?.recordset?.[0]?.HasCol || 0) === 1;
  } catch { present = false; }
  columnCache.set(key, present);
  return present;
}

module.exports = { runWithUser, currentActorId, hasColumn };
