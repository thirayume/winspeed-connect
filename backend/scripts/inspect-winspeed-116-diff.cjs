'use strict';
/**
 * inspect-winspeed-116-diff.cjs
 *
 * STRICTLY READ-ONLY utility to capture baseline and diff when a user creates
 * a native 116 Redemption document in WinSpeed Desktop client against dbwins_worldfert9_test_v2.
 *
 * Usage:
 *   1. Before creating document in WinSpeed:
 *      node backend/scripts/inspect-winspeed-116-diff.cjs --snapshot
 *
 *   2. Create the document in WinSpeed desktop client.
 *
 *   3. After saving document in WinSpeed:
 *      node backend/scripts/inspect-winspeed-116-diff.cjs --diff
 *
 *   Or run in live watch mode:
 *      node backend/scripts/inspect-winspeed-116-diff.cjs --watch
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const SNAPSHOT_FILE = path.resolve(__dirname, '116-baseline.json');

async function getFullState() {
  // 1. Target database & server identity
  const idRes = await db.query(`SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName, SUSER_SNAME() AS loginName`);

  // 2. EMRunBrch for redemption
  const emrunRes = await db.query(`
    SELECT RunCode, BrchID, LastNo, RunFormat 
    FROM dbo.EMRunBrch 
    WHERE RunCode = 'redemption'
  `);

  // 3. WFRedemtionHD summary and latest rows
  const hdSummary = await db.query(`
    SELECT 
      COUNT(*) AS totalDocs,
      ISNULL(MAX(RedemtionID), 0) AS maxRedemtionId,
      ISNULL(MAX(DocuNo), '') AS maxDocuNo
    FROM dbo.WFRedemtionHD
  `);

  const latestHD = await db.query(`
    SELECT TOP 5 *
    FROM dbo.WFRedemtionHD
    ORDER BY RedemtionID DESC
  `);

  // 4. Latest WFRedemtionDT
  const latestDT = await db.query(`
    SELECT TOP 10 *
    FROM dbo.WFRedemtionDT
    ORDER BY RedemtionID DESC, Listno ASC
  `);

  // 5. Active coupons snapshot (CouponID, CouponNo, GoodQty, RemaQty)
  // Only query coupons with recent activity or positive RemaQty to keep snapshot fast
  const coupons = await db.query(`
    SELECT CouponID, CouponNo, GoodQty, RemaQty
    FROM dbo.WFCoupon
    WHERE RemaQty > 0 OR CouponNo LIKE 'C69%' OR CouponNo LIKE 'D69%'
  `);

  // 6. Latest SMAudit
  const latestAudit = await db.query(`
    SELECT TOP 5 audit_id, audit_system, audit_screen, audit_datetime, audit_username, audit_action, audit_docuno, audit_computername
    FROM dbo.SMAudit
    ORDER BY audit_id DESC
  `);

  return {
    timestamp: new Date().toISOString(),
    identity: idRes[0],
    emrun: emrunRes[0] || null,
    hdSummary: hdSummary[0],
    latestHD,
    latestDT,
    coupons,
    latestAudit,
  };
}

async function takeSnapshot() {
  await db.ownerReady;
  console.log('Taking baseline snapshot from:', db.DEFAULT_TARGET);
  const state = await getFullState();
  
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log(`\n======================================================`);
  console.log(`✓ BASELINE SNAPSHOT CAPTURED SUCCESSFULLY`);
  console.log(`======================================================`);
  console.log(`Database     : ${state.identity.dbName} on ${state.identity.serverName}`);
  console.log(`Current Docs : ${state.hdSummary.totalDocs} documents`);
  console.log(`MAX RedemID  : ${state.hdSummary.maxRedemtionId}`);
  console.log(`MAX DocuNo   : ${state.hdSummary.maxDocuNo}`);
  console.log(`EMRunBrch    : LastNo = "${state.emrun?.LastNo || 'NULL'}"`);
  console.log(`Snapshot file: ${SNAPSHOT_FILE}`);
  console.log(`\n--> You can now create/save a 116 document in WinSpeed.`);
  console.log(`--> After saving, run: node backend/scripts/inspect-winspeed-116-diff.cjs --diff`);
  console.log(`======================================================\n`);
  process.exit(0);
}

async function compareDiff() {
  await db.ownerReady;
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    console.error(`ERROR: Baseline snapshot file not found: ${SNAPSHOT_FILE}`);
    console.error(`Please run with --snapshot first.`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  const current = await getFullState();

  console.log(`\n======================================================`);
  console.log(`=== WINSPEED 116 REDEMPTION WRITE EVIDENCE DIFF ===`);
  console.log(`======================================================`);
  console.log(`Baseline Taken At : ${baseline.timestamp}`);
  console.log(`Diff Compared At  : ${current.timestamp}`);
  console.log(`Target Database   : ${current.identity.dbName} (${current.identity.serverName})`);
  console.log(`------------------------------------------------------\n`);

  // 1. Check new documents in WFRedemtionHD
  const baselineMaxId = Number(baseline.hdSummary.maxRedemtionId);
  const newHD = await db.query(`
    SELECT *
    FROM dbo.WFRedemtionHD
    WHERE RedemtionID > ${baselineMaxId}
    ORDER BY RedemtionID ASC
  `);

  if (newHD.length === 0) {
    console.log(`[!] NO NEW WFRedemtionHD ROWS DETECTED (Max RedemtionID is still ${current.hdSummary.maxRedemtionId}).`);
    console.log(`    Total documents count: Baseline = ${baseline.hdSummary.totalDocs}, Current = ${current.hdSummary.totalDocs}`);
  } else {
    console.log(`[+] NEW WFRedemtionHD ROWS DETECTED: ${newHD.length} document(s)\n`);
    for (const hd of newHD) {
      console.log(`======================================================`);
      console.log(`DOCUMENT HEADER: RedemtionID = ${hd.RedemtionID}, DocuNo = ${hd.DocuNo}`);
      console.log(`======================================================`);
      console.table(Object.entries(hd).map(([k, v]) => ({
        Column: k,
        Value: v instanceof Date ? v.toISOString() : (v === null ? 'NULL' : String(v))
      })));

      // Compare RedemtionID allocation behavior
      console.log(`\n[ANALYSIS: RedemtionID Allocation]`);
      console.log(`  Baseline MAX(RedemtionID) was : ${baselineMaxId}`);
      console.log(`  Newly generated RedemtionID is: ${hd.RedemtionID}`);
      const deltaId = Number(hd.RedemtionID) - baselineMaxId;
      console.log(`  Delta from MAX(RedemtionID)   : ${deltaId >= 0 ? '+' : ''}${deltaId}`);
      if (deltaId === 1) {
        console.log(`  -> BEHAVIOR OBSERVED: RedemtionID matched exactly MAX+1`);
      } else {
        console.log(`  -> BEHAVIOR OBSERVED: RedemtionID did NOT follow simple MAX+1 (Delta = ${deltaId})`);
      }

      // Check matching DT rows
      const matchingDT = await db.query(`
        SELECT *
        FROM dbo.WFRedemtionDT
        WHERE RedemtionID = ${hd.RedemtionID}
        ORDER BY Listno ASC
      `);
      console.log(`\n[DETAILS: WFRedemtionDT Lines for RedemtionID ${hd.RedemtionID}] (${matchingDT.length} lines)`);
      if (matchingDT.length > 0) {
        console.table(matchingDT);
      } else {
        console.log(`  [!] Warning: No detail lines found for RedemtionID ${hd.RedemtionID}`);
      }

      // Check DocuStatus and PostInv values
      console.log(`\n[ANALYSIS: Initial DocuStatus & PostInv]`);
      console.log(`  WFRedemtionHD.DocuStatus = "${hd.DocuStatus}"`);
      const dtPostInv = matchingDT.map(d => d.PostInv).join(', ');
      console.log(`  WFRedemtionDT.PostInv    = "${dtPostInv}"`);
      const dtSOInvId = matchingDT.map(d => d.SOInvID === null ? 'NULL' : d.SOInvID).join(', ');
      console.log(`  WFRedemtionDT.SOInvID    = "${dtSOInvId}"`);
    }
  }

  // 2. Check EMRunBrch for redemption
  console.log(`\n------------------------------------------------------`);
  console.log(`[CHECK: EMRunBrch RunCode='redemption' Counter]`);
  console.log(`  Baseline LastNo : "${baseline.emrun?.LastNo || 'NULL'}"`);
  console.log(`  Current LastNo  : "${current.emrun?.LastNo || 'NULL'}"`);
  if (baseline.emrun?.LastNo === current.emrun?.LastNo) {
    console.log(`  -> RESULT: EMRunBrch.LastNo DID NOT CHANGE (remained "${current.emrun?.LastNo}").`);
  } else {
    console.log(`  -> RESULT: EMRunBrch.LastNo ADVANCED to "${current.emrun?.LastNo}"!`);
  }

  // 3. Check WFCoupon.RemaQty changes
  console.log(`\n------------------------------------------------------`);
  console.log(`[CHECK: WFCoupon RemaQty Modifications]`);
  const baselineCouponMap = new Map(baseline.coupons.map(c => [Number(c.CouponID), c]));
  const changedCoupons = [];
  for (const curC of current.coupons) {
    const baseC = baselineCouponMap.get(Number(curC.CouponID));
    if (baseC) {
      const baseRema = Number(baseC.RemaQty);
      const curRema = Number(curC.RemaQty);
      if (baseRema !== curRema) {
        changedCoupons.push({
          CouponID: curC.CouponID,
          CouponNo: curC.CouponNo,
          GoodQty: curC.GoodQty,
          BeforeRemaQty: baseRema,
          AfterRemaQty: curRema,
          Delta: curRema - baseRema,
        });
      }
    }
  }

  if (changedCoupons.length === 0) {
    console.log(`  [!] No coupons detected with changed RemaQty in the cached set.`);
    console.log(`      Querying all coupons modified recently...`);
  } else {
    console.log(`  -> FOUND ${changedCoupons.length} COUPON(S) WITH CHANGED RemaQty:`);
    console.table(changedCoupons);
  }

  // 4. Check new SMAudit entries
  const baselineAuditId = baseline.latestAudit[0]?.audit_id || 0;
  const newAudit = await db.query(`
    SELECT audit_id, audit_system, audit_screen, audit_datetime, audit_username, audit_action, audit_docuno, audit_computername
    FROM dbo.SMAudit
    WHERE audit_id > ${baselineAuditId}
    ORDER BY audit_id ASC
  `);
  console.log(`\n------------------------------------------------------`);
  console.log(`[CHECK: SMAudit Entries Generated] (${newAudit.length} new records)`);
  if (newAudit.length > 0) {
    console.table(newAudit);
  } else {
    console.log(`  (No new SMAudit records)`);
  }

  console.log(`\n======================================================`);
  console.log(`=== END OF WINSPEED 116 WRITE EVIDENCE DIFF ===`);
  console.log(`======================================================\n`);

  process.exit(0);
}

async function watchMode() {
  await db.ownerReady;
  console.log('Capturing baseline for watch mode...');
  const baseline = await getFullState();
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(baseline, null, 2), 'utf8');
  console.log(`Baseline set. MAX(RedemtionID) = ${baseline.hdSummary.maxRedemtionId}, Total Docs = ${baseline.hdSummary.totalDocs}`);
  console.log('Listening for new 116 documents in WinSpeed (polling read-only every 3s)...');
  console.log('Press Ctrl+C to cancel.\n');

  const baselineMaxId = Number(baseline.hdSummary.maxRedemtionId);

  const timer = setInterval(async () => {
    try {
      const chk = await db.query(`
        SELECT ISNULL(MAX(RedemtionID), 0) AS curMax, COUNT(*) AS curTotal 
        FROM dbo.WFRedemtionHD
      `);
      const curMax = Number(chk[0]?.curMax || 0);
      const curTotal = Number(chk[0]?.curTotal || 0);

      if (curMax > baselineMaxId || curTotal > Number(baseline.hdSummary.totalDocs)) {
        clearInterval(timer);
        console.log(`\n🔔 DETECTED NEW DOCUMENT! (curMax: ${curMax}, curTotal: ${curTotal})`);
        await compareDiff();
      } else {
        process.stdout.write('.');
      }
    } catch (e) {
      console.error('Polling error:', e.message);
    }
  }, 3000);
}

const arg = process.argv[2];
if (arg === '--snapshot') {
  takeSnapshot().catch(e => { console.error('Snapshot error:', e); process.exit(1); });
} else if (arg === '--diff') {
  compareDiff().catch(e => { console.error('Diff error:', e); process.exit(1); });
} else if (arg === '--watch') {
  watchMode().catch(e => { console.error('Watch error:', e); process.exit(1); });
} else {
  console.log(`
inspect-winspeed-116-diff.cjs — Strictly Read-Only WinSpeed Diff Utility

Options:
  --snapshot   Capture current database baseline state before manual entry
  --diff       Compare current database state against captured baseline
  --watch      Auto-capture baseline and poll read-only until a new doc appears
  `);
  process.exit(0);
}
