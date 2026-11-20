'use strict';
// Giveaway Set Zero on every company database of this environment, from one screen (owner, 21 Nov 2026).
//
// What it changes: one wf.GiveawayZeroLog row and one wf.ChangeEvent row per company database. The budget view
// (migration 253) then counts withdrawals from that moment. Budgets, withdrawal history and every WinSpeed (dbo)
// row stay exactly as they are.
//
// The databases come from the reviewed deployment manifest (REBATE_RESET_DATABASES, the same list Rebate Reset
// uses), never from the browser. The caller must be an ADMIN on the primary database; the person's identity in
// each other database comes from the reviewed binding (wf.DatabaseIdentityBinding), as for Rebate Reset.
//
// Every database gets the same request id and the same moment. A retry with the same request id finishes the
// databases that did not complete and never adds a second row anywhere.
const crypto = require('crypto');

const validId = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const clean = v => String(v || '').trim().toLowerCase();
function fail(code, status, message) { throw Object.assign(new Error(message || code), { code, status }); }

function onprem(env) { return clean(env.DB_MODE) === 'onprem'; }

/** The company databases of this environment: [{ name, database, expectedServerName }], primary first. */
function companyTargets(env, resolve) {
  if (!onprem(env)) return [{ name: null, database: null, expectedServerName: null, local: true }];
  const targets = (resolve || require('./rebate-reset-targets').resolvePhysicalResetTargets)(env);
  const primary = clean(env.ONPREM_DB_NAME);
  const first = targets.find(t => clean(t.name) === primary);
  if (!first) fail('GIVEAWAY_ZERO_PRIMARY_MISSING', 503, 'รายชื่อฐานข้อมูลบริษัทไม่มีฐานหลัก');
  return [first, ...targets.filter(t => t !== first)];
}

function inTarget(db, target, fn) {
  return target.local ? fn() : db.runWithTarget('onprem', fn, target.name);
}

const STATE_SQL = `SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName,
    CASE WHEN OBJECT_ID('wf.GiveawayZeroLog','U') IS NULL THEN 0 ELSE 1 END AS HasLog,
    CASE WHEN COL_LENGTH('wf.GiveawayZeroLog','RequestId') IS NULL THEN 0 ELSE 1 END AS HasRequestId,
    CASE WHEN OBJECT_ID('wf.v_GiveawayBudgetStatus','V') IS NULL THEN 0 ELSE 1 END AS HasView`;

async function readState(db, target) {
  return inTarget(db, target, async () => {
    const s = (await db.wfQuery(STATE_SQL)).recordset?.[0];
    if (!s) fail('GIVEAWAY_ZERO_TARGET_UNAVAILABLE', 503, 'อ่านฐานข้อมูลไม่ได้');
    if (!target.local && (clean(s.DatabaseName) !== clean(target.database) || clean(s.ServerName) !== clean(target.expectedServerName)))
      fail('GIVEAWAY_ZERO_TARGET_MISMATCH', 503, `ฐานข้อมูล ${target.name} ไม่ตรงกับที่ตั้งค่าไว้`);
    const ready = Number(s.HasLog) === 1 && Number(s.HasRequestId) === 1 && Number(s.HasView) === 1;
    let usage = null, latest = null;
    if (ready) {
      usage = (await db.wfQuery(`SELECT COUNT(*) AS Lines, ISNULL(SUM(WithdrawnQty),0) AS Withdrawn FROM wf.v_GiveawayBudgetStatus`)).recordset?.[0];
      latest = (await db.wfQuery(`SELECT TOP 1 ZeroAt FROM wf.GiveawayZeroLog ORDER BY ZeroAt DESC, Id DESC`)).recordset?.[0]?.ZeroAt || null;
    }
    return { database: s.DatabaseName, ready, budgetLines: Number(usage?.Lines || 0), withdrawnCounted: Number(usage?.Withdrawn || 0), latestZeroAt: latest };
  });
}

/** Read-only: what a Set Zero would cover, per company database. */
async function previewSetZero({ env = process.env, db = require('../db'), resolveTargets } = {}) {
  const targets = companyTargets(env, resolveTargets);
  const out = [];
  for (const t of targets) out.push(await readState(db, t));
  return { databases: out, ready: out.every(d => d.ready) };
}

async function identityFor({ user, primary, target, db, resolveIdentity }) {
  const actorId = Number(user.actorSub || user.actorId || user.sub || user.id);
  const effectiveId = Number(user.sub || user.id);
  if (target.local) return { businessActorId: actorId, businessEffectiveId: effectiveId };
  const resolve = resolveIdentity || require('./rebate-reset-business-identity').resolveResetBusinessIdentity;
  try { return await resolve({ actorId, effectiveId, primaryTarget: primary, target, db }); }
  catch (_) { fail('GIVEAWAY_ZERO_IDENTITY_UNAVAILABLE', 503, `บัญชีนี้ยังไม่ได้ผูกกับฐาน ${target.name}`); }
}

/**
 * Set Zero on every company database. Checks every database (schema, identity) before writing any of them.
 * Returns { requestId, zeroAt, databases: [{ database, replayed, before }] }.
 */
async function setZeroAllCompanies({ user, requestId, note }, { env = process.env, db = require('../db'), resolveTargets, resolveIdentity,
  logChangeEvent = require('./policy-contract').logChangeEvent } = {}) {
  const rid = clean(requestId || crypto.randomUUID());
  if (!validId(rid)) fail('GIVEAWAY_ZERO_REQUEST_INVALID', 400, 'รหัสคำขอไม่ถูกต้อง');
  const text = note ? String(note).trim().slice(0, 500) || null : null;
  const targets = companyTargets(env, resolveTargets);
  const primary = targets[0];

  // 1. Check every database before writing anything.
  const plan = [];
  for (const t of targets) {
    const state = await readState(db, t);
    if (!state.ready) fail('GIVEAWAY_ZERO_SCHEMA_MISSING', 503, `ฐาน ${state.database} ยังไม่มีตาราง Set Zero (migration 253-254)`);
    const ids = await identityFor({ user, primary, target: t, db, resolveIdentity });
    plan.push({ target: t, ids, database: state.database });
  }

  // 2. One moment for all databases: the moment of an earlier partial run of this request, or now on the primary.
  let zeroAt = null;
  for (const p of plan) {
    const row = await inTarget(db, p.target, async () => (await db.wfQuery(
      `SELECT TOP 1 ZeroAt FROM wf.GiveawayZeroLog WHERE RequestId = @rid`,
      { rid: { type: db.sql.UniqueIdentifier, value: rid } })).recordset?.[0]);
    if (row?.ZeroAt) { zeroAt = row.ZeroAt; break; }
  }
  if (!zeroAt) zeroAt = await inTarget(db, primary, async () => (await db.wfQuery('SELECT GETUTCDATE() AS Now')).recordset[0].Now);

  // 3. Write each database in its own transaction; a replay leaves a completed database untouched.
  const results = [];
  for (const p of plan) {
    try {
      const r = await inTarget(db, p.target, () => db.wfTransaction(async tx => {
        const existing = (await tx.request().input('rid', db.sql.UniqueIdentifier, rid)
          .query(`SELECT TOP 1 Id, ZeroAt FROM wf.GiveawayZeroLog WITH (UPDLOCK, HOLDLOCK) WHERE RequestId = @rid`)).recordset?.[0];
        if (existing) return { database: p.database, replayed: true, logId: existing.Id };
        const before = (await tx.request().query(`SELECT COUNT(*) AS Lines, ISNULL(SUM(WithdrawnQty),0) AS Withdrawn FROM wf.v_GiveawayBudgetStatus`)).recordset[0];
        const row = (await tx.request()
          .input('zeroAt', db.sql.DateTime2, zeroAt).input('note', db.sql.NVarChar(500), text)
          .input('actor', db.sql.Int, p.ids.businessActorId).input('rid', db.sql.UniqueIdentifier, rid)
          .query(`INSERT INTO wf.GiveawayZeroLog (ZeroAt, Note, ActorId, RequestId) OUTPUT inserted.Id
                  VALUES (@zeroAt, @note, @actor, @rid)`)).recordset[0];
        await logChangeEvent(tx, {
          entityType: 'GIVEAWAY_BUDGET', entityId: `ZERO:${row.Id}`, action: 'SET_ZERO',
          beforeJson: { lines: before.Lines, withdrawn: Number(before.Withdrawn) },
          afterJson: { zeroAt, withdrawn: 0, requestId: rid, databases: plan.length },
          reasonCode: 'GIVEAWAY_SET_ZERO', reasonText: text, userId: String(p.ids.businessEffectiveId),
        });
        return { database: p.database, replayed: false, logId: row.Id, before: { lines: Number(before.Lines), withdrawn: Number(before.Withdrawn) } };
      }));
      results.push(r);
    } catch (e) {
      // Report what finished; the caller retries with the same request id.
      throw Object.assign(new Error(`Set Zero ฐาน ${p.database} ไม่สำเร็จ กดอีกครั้งเพื่อทำต่อ`),
        { code: 'GIVEAWAY_ZERO_PARTIAL', status: 503, requestId: rid, completed: results, cause: e });
    }
  }
  return { requestId: rid, zeroAt, databases: results };
}

module.exports = { previewSetZero, setZeroAllCompanies, companyTargets };
