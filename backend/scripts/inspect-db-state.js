const { wfQuery, runWithTarget, pools } = require('../db');

async function inspect() {
  await runWithTarget('remote_b', async () => {
    try {
      console.log('--- Inspecting wf.SystemSetting on remote_b ---');
      const settings = await wfQuery(`SELECT SettingKey, SettingValue FROM wf.SystemSetting ORDER BY SettingKey`);
      console.log('SETTINGS COUNT:', settings.recordset.length);
      for (const s of settings.recordset) {
        console.log(`  ${s.SettingKey} = ${s.SettingValue}`);
      }

      console.log('--- Inspecting snapshot JSON content ---');
      const jsonSnaps = await wfQuery(`SELECT SnapshotId, PolicyName, RevisionNumber, SnapshotJson FROM wf.PolicySnapshot ORDER BY SnapshotId`);
      for (const row of jsonSnaps.recordset) {
        console.log(`SnapshotId ${row.SnapshotId} (${row.PolicyName} rev ${row.RevisionNumber}):`, row.SnapshotJson);
      }

      console.log('--- Inspecting wf.PolicyVersion (latest 15) ---');
      const versions = await wfQuery(`SELECT TOP 15 VersionId, SettingKey, SettingValue, RevisionNumber, ChangedBy, ReasonCode, ReasonText, ChangedAt FROM wf.PolicyVersion ORDER BY VersionId DESC`);
      console.table(versions.recordset);
    } catch (err) {
      console.error('Inspection error:', err);
    }
  });
  process.exit(0);
}

inspect();
