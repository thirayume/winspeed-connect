/**
 * rehearsal-safeguards.test.js
 *
 * Automated negative and invariant test suite for isolated recovery rehearsal.
 * Verifies that all safeguards prevent dangerous or erroneous restore actions
 * before any live execution can ever take place.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  assertTargetSafety,
  mapAllLogicalFiles,
  resolveVolumeMountPoint,
  verifyDiskCapacity,
  safeCleanupRehearsalDatabase,
  assertIsolatedConnection,
  writeManifest,
  readManifest,
  runRehearsal,
} = require('../scripts/rehearsal-isolated-restore.cjs');
const { pools } = require('../db');

test.after(async () => {
  try {
    const { readerPool, ownerPool } = pools();
    if (readerPool) await readerPool.close();
    if (ownerPool) await ownerPool.close();
  } catch {}
});

test.describe('Isolated Restore Rehearsal Safeguards & Invariants', () => {

  test('1. Target Safety Guard: Refuses active and production database targets', () => {
    const protectedTargets = [
      'dbwins_worldfert9',
      'dbwins_worldfert9_test_v2',
      'dbwins_worldfert9_test',
      'master',
      'tempdb',
      'msdb',
      'model'
    ];

    for (const target of protectedTargets) {
      assert.throws(
        () => assertTargetSafety(target),
        /protected active database/,
        `Must refuse protected target "${target}"`
      );
    }
  });

  test('2. Target Safety Guard: Refuses arbitrary database names without rehearsal prefix', () => {
    const invalidTargets = [
      'my_test_db',
      'rehearsal_unprefixed',
      'dbwins_worldfert9_backup',
      'production_copy',
    ];

    for (const target of invalidTargets) {
      assert.throws(
        () => assertTargetSafety(target),
        /must strictly start with prefix "dbwins_worldfert9_rehearsal_"/,
        `Must enforce rehearsal prefix for "${target}"`
      );
    }
  });

  test('3. Target Safety Guard: Accepts valid run-owned rehearsal database names', () => {
    const validTarget = `dbwins_worldfert9_rehearsal_${Date.now()}`;
    assert.doesNotThrow(() => assertTargetSafety(validTarget));
  });

  test('4. Logical File Mapping: Correctly maps multiple data and log files with .mdf, .ndf, .ldf', () => {
    const mockFiles = [
      { LogicalName: 'PrimaryData', Type: 'D', Size: 4_000_000_000 },
      { LogicalName: 'SecondaryData', Type: 'D', Size: 2_000_000_000 },
      { LogicalName: 'LogFile1', Type: 'L', Size: 1_000_000_000 },
      { LogicalName: 'LogFile2', Type: 'L', Size: 1_000_000_000 },
    ];

    const targetDb = 'dbwins_worldfert9_rehearsal_12345';
    const { mapped, moveClauses } = mapAllLogicalFiles(mockFiles, targetDb, 'C:\\Data', 'D:\\Logs');

    assert.equal(mapped.length, 4);
    assert.equal(moveClauses.length, 4);

    // Primary data gets .mdf on C:\Data
    assert.match(mapped[0].physPath, /C:\\Data\\dbwins_worldfert9_rehearsal_12345_PrimaryData\.mdf/);
    assert.equal(mapped[0].volume, 'C:\\');

    // Secondary data gets .ndf on C:\Data
    assert.match(mapped[1].physPath, /C:\\Data\\dbwins_worldfert9_rehearsal_12345_SecondaryData_data2\.ndf/);

    // Log files get .ldf on D:\Logs
    assert.match(mapped[2].physPath, /D:\\Logs\\dbwins_worldfert9_rehearsal_12345_LogFile1\.ldf/);
    assert.equal(mapped[2].volume, 'D:\\');
    assert.match(mapped[3].physPath, /D:\\Logs\\dbwins_worldfert9_rehearsal_12345_LogFile2_log2\.ldf/);
  });

  test('5. Logical File Mapping (Negative): Rejects unsupported file types (e.g. filestream / unknown)', () => {
    const mockFiles = [
      { LogicalName: 'Data1', Type: 'D', Size: 1_000_000 },
      { LogicalName: 'Log1', Type: 'L', Size: 1_000_000 },
      { LogicalName: 'Stream1', Type: 'F', Size: 500_000 }, // Unsupported Type 'F'
    ];

    assert.throws(
      () => mapAllLogicalFiles(mockFiles, 'dbwins_worldfert9_rehearsal_test', 'C:\\Data', 'C:\\Data'),
      /Unsupported logical file type "F"/
    );
  });

  test('6. Volume Free Space: Passes when volume has ample space', () => {
    const mapped = [
      { logicalName: 'Data1', size: 5_000_000_000, physPath: 'C:\\Data\\Data1.mdf' },
      { logicalName: 'Log1',  size: 5_000_000_000, physPath: 'C:\\Data\\Log1.ldf' },
    ];
    const volumeStats = [
      { volume_mount_point: 'C:\\', total_bytes: 500_000_000_000, available_bytes: 200_000_000_000 }
    ];

    const res = verifyDiskCapacity(mapped, volumeStats, 2_000_000_000);
    assert.equal(res.length, 1);
    assert.equal(res[0].ok, true);
  });

  test('7. Volume Free Space (Negative): Rejects when available bytes < required + safety margin', () => {
    const mapped = [
      { logicalName: 'Data1', size: 10_000_000_000, physPath: 'C:\\Data\\Data1.mdf' }, // 10 GB
      { logicalName: 'Log1',  size: 5_000_000_000,  physPath: 'C:\\Data\\Log1.ldf' },  // 5 GB -> Total 15 GB
    ];
    const volumeStats = [
      { volume_mount_point: 'C:\\', total_bytes: 100_000_000_000, available_bytes: 16_000_000_000 } // 16 GB available
    ];

    // Total needed: 15 GB + 2 GB safety margin = 17 GB. 16 GB is insufficient!
    assert.throws(
      () => verifyDiskCapacity(mapped, volumeStats, 2_000_000_000),
      /INSUFFICIENT DISK SPACE/
    );
  });

  test('8. Strict Volume Resolution (Negative): Fails closed on unknown/unsupported volume (NO fallback)', () => {
    // Only C:\ is reported by SQL Server
    const volumeStats = [
      { volume_mount_point: 'C:\\', total_bytes: 500_000_000_000, available_bytes: 200_000_000_000 }
    ];

    // File target is on D:\
    assert.throws(
      () => resolveVolumeMountPoint('D:\\SQLData\\rehearsal_Data.mdf', volumeStats),
      /UNSUPPORTED_OR_UNKNOWN_VOLUME.+Volume fallback is strictly forbidden/
    );

    // verifyDiskCapacity must also fail closed
    const mapped = [
      { logicalName: 'Data1', size: 1_000_000, physPath: 'D:\\SQLData\\rehearsal_Data.mdf' }
    ];
    assert.throws(
      () => verifyDiskCapacity(mapped, volumeStats, 2_000_000_000),
      /UNSUPPORTED_OR_UNKNOWN_VOLUME/
    );
  });

  test('9. Volume Resolution: Longest prefix matching for Linux mount points', () => {
    const linuxVolumeStats = [
      { volume_mount_point: '/', total_bytes: 100_000_000_000, available_bytes: 50_000_000_000 },
      { volume_mount_point: '/var/opt/mssql', total_bytes: 80_000_000_000, available_bytes: 40_000_000_000 },
    ];

    // /var/opt/mssql/data/db.mdf should match /var/opt/mssql, NOT root /
    const matched = resolveVolumeMountPoint('/var/opt/mssql/data/db.mdf', linuxVolumeStats);
    assert.equal(matched, '/var/opt/mssql');

    // /etc/config should match /
    const rootMatched = resolveVolumeMountPoint('/etc/config/foo', linuxVolumeStats);
    assert.equal(rootMatched, '/');
  });

  test('10. Mandatory Target Host Guard (Negative): Refuses execution or plan if target host is omitted', async () => {
    const origEnv = process.env.EXPECTED_SQL_HOST;
    delete process.env.EXPECTED_SQL_HOST;
    try {
      await assert.rejects(
        () => runRehearsal({ mode: '--plan' }),
        /MANDATORY_TARGET_HOST_REQUIRED/
      );
    } finally {
      if (origEnv) process.env.EXPECTED_SQL_HOST = origEnv;
    }
  });

  test('11. Host Identity Guard (Negative): Refuses execution or plan if target host mismatches SQL server', async () => {
    await assert.rejects(
      () => runRehearsal({ mode: '--plan', targetHost: 'NON_EXISTENT_OR_WRONG_SQL_HOST_NAME' }),
      /Host Identity Guard FAILED/
    );
  });

  test('12. Plan Lock Guard (Negative): Refuses --execute without approved plan manifest', async () => {
    await assert.rejects(
      () => runRehearsal({
        mode: '--execute',
        targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
        manifest: 'non_existent_manifest.json'
      }),
      /PLAN_LOCK_REQUIRED: Plan manifest file.+does not exist/
    );
  });

  test('13. Plan Lock Guard (Negative): Refuses --execute if manifest timestamp is invalid or unparseable', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_invalid_time_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: 'INVALID_TIMESTAMP_STRING',
      targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_LOCK_INVALID_TIMESTAMP: Manifest createdAt timestamp is invalid/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('14. Plan Lock Guard (Negative): Refuses --execute if manifest timestamp is in the future', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_future_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 mins in future
      targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_LOCK_INVALID_TIMESTAMP.+is in the future/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('15. Plan Lock Guard (Negative): Refuses --execute if manifest has expired (> 1 hour)', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_expired_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_LOCK_EXPIRED: Plan manifest has expired/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('16. Plan Lock Guard (Negative): Refuses --execute if manifest targetHost mismatches requested host', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_host_mismatch_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: new Date().toISOString(),
      targetHost: 'OTHER_HOST\\INSTANCE',
      serverIdentity: { ServerName: 'Amyou-Yoga7\\SQLEXPRESS' }
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_HOST_MISMATCH: Manifest target host "OTHER_HOST\\INSTANCE" does not match/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('17. Plan Lock Guard (Negative): Refuses --execute if manifest ServerName mismatches connected server', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_server_mismatch_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: new Date().toISOString(),
      targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
      serverIdentity: { ServerName: 'DIFFERENT_SQL_SERVER_NAME' }
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_HOST_MISMATCH: Manifest ServerName "DIFFERENT_SQL_SERVER_NAME" does not match/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('18. Plan Lock Guard (Negative): Refuses --execute if manifest backupSha256 mismatches source backup', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_hash_mismatch_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: new Date().toISOString(),
      targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
      serverIdentity: { ServerName: 'Amyou-Yoga7\\SQLEXPRESS' },
      backupSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_BACKUP_MISMATCH: Manifest backup SHA-256/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('19. Plan Lock Guard (Negative): Refuses --execute if manifest BackupSetGUID mismatches server header', async () => {
    const tmpManifestPath = path.resolve(__dirname, '../rehearsal-manifests/temp_guid_mismatch_manifest.json');
    fs.writeFileSync(tmpManifestPath, JSON.stringify({
      status: 'PLAN_VERIFIED',
      createdAt: new Date().toISOString(),
      targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
      serverIdentity: { ServerName: 'Amyou-Yoga7\\SQLEXPRESS' },
      backupSha256: '41C36EA663A172C0C98060032FBD29F3C62621DC39B4C9DFD1165289A812CD0F',
      backupSetGuid: 'WRONG-GUID-0000-0000-000000000000',
    }));

    try {
      await assert.rejects(
        () => runRehearsal({
          mode: '--execute',
          targetHost: 'Amyou-Yoga7\\SQLEXPRESS',
          manifest: tmpManifestPath
        }),
        /PLAN_BACKUP_MISMATCH: Manifest BackupSetGUID/
      );
    } finally {
      try { fs.unlinkSync(tmpManifestPath); } catch {}
    }
  });

  test('20. Pre-Cleanup Verification (Negative): Refuses DROP if manifest is missing or mismatched', async () => {
    const mockSql = { NVarChar: () => {} };
    const mockQuery = async () => ({ recordset: [] });

    // Missing manifest
    await assert.rejects(
      () => safeCleanupRehearsalDatabase('dbwins_worldfert9_rehearsal_123', null, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Manifest not found/
    );

    // Mismatched targetDbName
    await assert.rejects(
      () => safeCleanupRehearsalDatabase(
        'dbwins_worldfert9_rehearsal_123',
        { targetDbName: 'dbwins_worldfert9_rehearsal_999' },
        mockQuery,
        mockSql
      ),
      /CLEANUP_BLOCKED: Manifest not found/
    );
  });

  test('21. Pre-Cleanup Verification (Negative): Refuses DROP if expected files list in manifest is empty (< 2)', async () => {
    const mockSql = { NVarChar: () => {} };
    const mockQuery = async () => ({ recordset: [] });
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(
        targetDbName,
        { targetDbName, mappedFiles: [] },
        mockQuery,
        mockSql
      ),
      /CLEANUP_BLOCKED: Expected files list in manifest is empty or invalid/
    );
  });

  test('22. Pre-Cleanup Verification (Negative): Refuses DROP when creation receipt is completely absent in manifest', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const files = ['C:\\Data\\file1.mdf', 'C:\\Data\\file2.ldf'];
    const manifest = {
      targetDbName,
      createdAt: '2026-09-20T12:00:00.000Z',
      mappedFiles: files.map(physPath => ({ physPath }))
    };

    let destructiveQuery = false;
    const mockQuery = async (query) => {
      if (/DROP DATABASE/i.test(query)) destructiveQuery = true;
      return {
        recordset: files.map(physical_name => ({
          name: targetDbName,
          database_id: 101,
          create_date: '2026-09-20T12:05:00.000Z',
          physical_name
        }))
      };
    };

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Missing or invalid database_id in manifest creation receipt.+Manual recovery instructions/
    );
    assert.equal(destructiveQuery, false, 'Must never execute DROP when receipt is absent');
  });

  test('23. Pre-Cleanup Verification (Negative): Refuses DROP when creation receipt is missing dbInstanceId', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const files = ['C:\\Data\\file1.mdf', 'C:\\Data\\file2.ldf'];
    const manifest = {
      targetDbName,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: files.map(physPath => ({ physPath }))
    };

    let destructiveQuery = false;
    const mockQuery = async (query) => {
      if (/DROP DATABASE/i.test(query)) destructiveQuery = true;
      return {
        recordset: files.map(physical_name => ({
          name: targetDbName,
          database_id: 101,
          create_date: '2026-09-20T12:00:00.000Z',
          physical_name
        }))
      };
    };

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Missing or invalid database_id in manifest creation receipt.+Manual recovery instructions/
    );
    assert.equal(destructiveQuery, false, 'Must never execute DROP when dbInstanceId is missing');
  });

  test('24. Pre-Cleanup Verification (Negative): Refuses DROP when creation receipt is missing dbCreateDate', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const files = ['C:\\Data\\file1.mdf', 'C:\\Data\\file2.ldf'];
    const manifest = {
      targetDbName,
      dbInstanceId: 101,
      mappedFiles: files.map(physPath => ({ physPath }))
    };

    let destructiveQuery = false;
    const mockQuery = async (query) => {
      if (/DROP DATABASE/i.test(query)) destructiveQuery = true;
      return {
        recordset: files.map(physical_name => ({
          name: targetDbName,
          database_id: 101,
          create_date: '2026-09-20T12:00:00.000Z',
          physical_name
        }))
      };
    };

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Missing or invalid create_date in manifest creation receipt.+Manual recovery instructions/
    );
    assert.equal(destructiveQuery, false, 'Must never execute DROP when dbCreateDate is missing');
  });

  test('25. Pre-Cleanup Verification (Negative): Refuses DROP when dbInstanceId in creation receipt is invalid type', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const files = ['C:\\Data\\file1.mdf', 'C:\\Data\\file2.ldf'];
    const manifest = {
      targetDbName,
      dbInstanceId: '101', // String instead of number!
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: files.map(physPath => ({ physPath }))
    };

    let destructiveQuery = false;
    const mockQuery = async (query) => {
      if (/DROP DATABASE/i.test(query)) destructiveQuery = true;
      return {
        recordset: files.map(physical_name => ({
          name: targetDbName,
          database_id: 101,
          create_date: '2026-09-20T12:00:00.000Z',
          physical_name
        }))
      };
    };

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Missing or invalid database_id in manifest creation receipt.+Manual recovery instructions/
    );
    assert.equal(destructiveQuery, false, 'Must never execute DROP when dbInstanceId is not a number');
  });

  test('26. Pre-Cleanup Verification (Negative): Refuses DROP when dbCreateDate in creation receipt is unparseable', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const files = ['C:\\Data\\file1.mdf', 'C:\\Data\\file2.ldf'];
    const manifest = {
      targetDbName,
      dbInstanceId: 101,
      dbCreateDate: 'NOT_A_VALID_DATE',
      mappedFiles: files.map(physPath => ({ physPath }))
    };

    let destructiveQuery = false;
    const mockQuery = async (query) => {
      if (/DROP DATABASE/i.test(query)) destructiveQuery = true;
      return {
        recordset: files.map(physical_name => ({
          name: targetDbName,
          database_id: 101,
          create_date: '2026-09-20T12:00:00.000Z',
          physical_name
        }))
      };
    };

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Missing or invalid create_date in manifest creation receipt.+Manual recovery instructions/
    );
    assert.equal(destructiveQuery, false, 'Must never execute DROP when dbCreateDate is invalid');
  });

  test('27. Pre-Cleanup Verification: Returns { dropped: false, reason: "NOT_FOUND" } when database does not exist', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const files = ['C:\\Data\\file1.mdf', 'C:\\Data\\file2.ldf'];
    const manifest = {
      targetDbName,
      dbInstanceId: 101,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: files.map(physPath => ({ physPath }))
    };

    let destructiveQuery = false;
    const mockQuery = async (query) => {
      if (/DROP DATABASE/i.test(query)) destructiveQuery = true;
      return { recordset: [] }; // DB does not exist in catalog
    };

    const res = await safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql);
    assert.deepEqual(res, { dropped: false, reason: 'NOT_FOUND' });
    assert.equal(destructiveQuery, false, 'Must never execute DROP when DB is absent');
  });

  test('28. Pre-Cleanup Verification (Negative): Refuses DROP if database_id mismatches restore receipt', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const manifest = {
      targetDbName,
      dbInstanceId: 42,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: [
        { physPath: 'C:\\Data\\file1.mdf' },
        { physPath: 'C:\\Data\\file2.ldf' }
      ]
    };

    // DB has a different database_id (e.g. 99)
    const mockQuery = async () => ({
      recordset: [
        {
          name: targetDbName,
          database_id: 99,
          create_date: '2026-09-20T12:00:00.000Z',
          physical_name: 'C:\\Data\\file1.mdf'
        },
        {
          name: targetDbName,
          database_id: 99,
          create_date: '2026-09-20T12:00:00.000Z',
          physical_name: 'C:\\Data\\file2.ldf'
        }
      ]
    });

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Database \[.+\] database_id \(99\) does not match restore receipt \(42\)\. Database was replaced!/
    );
  });

  test('29. Pre-Cleanup Verification (Negative): Refuses DROP if database create_date is older than restore receipt', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const manifest = {
      targetDbName,
      dbInstanceId: 42,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: [
        { physPath: 'C:\\Data\\file1.mdf' },
        { physPath: 'C:\\Data\\file2.ldf' }
      ]
    };

    // Actual DB was created earlier (older replacement DB!)
    const mockQuery = async () => ({
      recordset: [
        {
          name: targetDbName,
          database_id: 42,
          create_date: '2026-09-20T11:50:00.000Z',
          physical_name: 'C:\\Data\\file1.mdf'
        },
        {
          name: targetDbName,
          database_id: 42,
          create_date: '2026-09-20T11:50:00.000Z',
          physical_name: 'C:\\Data\\file2.ldf'
        }
      ]
    });

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Database \[.+\] create_date \(.*\) does not match restore receipt \(.*2026-09-20T12:00:00\.000Z\)\. Older replacement database detected!/
    );
  });

  test('30. Pre-Cleanup Verification (Negative): Refuses DROP if database create_date is newer than restore receipt', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const manifest = {
      targetDbName,
      dbInstanceId: 42,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: [
        { physPath: 'C:\\Data\\file1.mdf' },
        { physPath: 'C:\\Data\\file2.ldf' }
      ]
    };

    // Actual DB was created later (newer replacement DB!)
    const mockQuery = async () => ({
      recordset: [
        {
          name: targetDbName,
          database_id: 42,
          create_date: '2026-09-20T12:15:00.000Z',
          physical_name: 'C:\\Data\\file1.mdf'
        },
        {
          name: targetDbName,
          database_id: 42,
          create_date: '2026-09-20T12:15:00.000Z',
          physical_name: 'C:\\Data\\file2.ldf'
        }
      ]
    });

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Database \[.+\] create_date \(.*\) does not match restore receipt \(.*2026-09-20T12:00:00\.000Z\)\. Newer replacement database detected!/
    );
  });

  test('31. Pre-Cleanup Verification (Negative): Refuses DROP if actual physical files contain extra files', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const manifest = {
      targetDbName,
      dbInstanceId: 42,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: [
        { physPath: 'C:\\Data\\file1.mdf' },
        { physPath: 'C:\\Data\\file2.ldf' }
      ]
    };

    // Actual DB in sys.master_files contains 3 files (1 EXTRA file!)
    const mockQuery = async () => ({
      recordset: [
        { name: targetDbName, database_id: 42, create_date: '2026-09-20T12:00:00.000Z', physical_name: 'c:\\data\\file1.mdf' },
        { name: targetDbName, database_id: 42, create_date: '2026-09-20T12:00:00.000Z', physical_name: 'c:\\data\\file2.ldf' },
        { name: targetDbName, database_id: 42, create_date: '2026-09-20T12:00:00.000Z', physical_name: 'c:\\data\\unexpected_extra.ndf' }
      ]
    });

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Physical file count mismatch.*Expected 2 files, found 3 files \(extra or missing files detected!\)/
    );
  });

  test('32. Pre-Cleanup Verification (Negative): Refuses DROP if actual physical files are missing expected files', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const manifest = {
      targetDbName,
      dbInstanceId: 42,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: [
        { physPath: 'C:\\Data\\file1.mdf' },
        { physPath: 'C:\\Data\\file2.ldf' }
      ]
    };

    // Actual DB in sys.master_files only has 1 file (missing log file!)
    const mockQuery = async () => ({
      recordset: [
        { name: targetDbName, database_id: 42, create_date: '2026-09-20T12:00:00.000Z', physical_name: 'c:\\data\\file1.mdf' }
      ]
    });

    await assert.rejects(
      () => safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql),
      /CLEANUP_BLOCKED: Physical file count mismatch.*Expected 2 files, found 1 files/
    );
  });

  test('33. Pre-Cleanup Verification: Executes DROP when manifest, exact identity, and exact file set match', async () => {
    const mockSql = { NVarChar: () => {} };
    const targetDbName = 'dbwins_worldfert9_rehearsal_123';
    const manifest = {
      targetDbName,
      dbInstanceId: 42,
      dbCreateDate: '2026-09-20T12:00:00.000Z',
      mappedFiles: [
        { physPath: 'C:\\Data\\file1.mdf' },
        { physPath: 'C:\\Data\\file2.ldf' }
      ]
    };

    const executedSql = [];
    const mockQuery = async (query) => {
      executedSql.push(query);
      if (query.includes('FROM sys.databases')) {
        return {
          recordset: [
            { name: targetDbName, database_id: 42, create_date: '2026-09-20T12:00:00.000Z', physical_name: 'c:\\data\\file1.mdf' },
            { name: targetDbName, database_id: 42, create_date: '2026-09-20T12:00:00.000Z', physical_name: 'c:\\data\\file2.ldf' }
          ]
        };
      }
      return { recordset: [] };
    };

    const result = await safeCleanupRehearsalDatabase(targetDbName, manifest, mockQuery, mockSql);
    assert.equal(result.dropped, true);
    assert.ok(executedSql.some(sql => sql.includes(`DROP DATABASE [${targetDbName}]`)));
  });

  test('34. Ownership Manifest: Writes and reads durable run receipt', () => {
    const testDbName = `dbwins_worldfert9_rehearsal_manifest_test_${Date.now()}`;
    const testData = {
      runId: 'test_run_01',
      targetDbName: testDbName,
      status: 'PLAN_VERIFIED',
      createdAt: new Date().toISOString(),
    };

    const manifestFile = writeManifest(testDbName, testData);
    assert.ok(fs.existsSync(manifestFile), 'Manifest file must exist on disk');

    const readBack = readManifest(testDbName);
    assert.equal(readBack.runId, 'test_run_01');
    assert.equal(readBack.targetDbName, testDbName);

    try { fs.unlinkSync(manifestFile); } catch {}
  });

  test('35. Plan Execution: runRehearsal("--plan") completes with PLAN_VERIFIED and zero side-effects', async () => {
    const targetHost = process.env.EXPECTED_SQL_HOST || 'Amyou-Yoga7\\SQLEXPRESS';
    const plan = await runRehearsal({ mode: '--plan', targetHost });
    assert.equal(plan.status, 'PLAN_VERIFIED');
    assert.ok(plan.targetDbName.startsWith('dbwins_worldfert9_rehearsal_'));
    assert.ok(Array.isArray(plan.mappedFiles) && plan.mappedFiles.length >= 2);
    assert.ok(plan.serverIdentity && plan.serverIdentity.ServerName);
    assert.ok(fs.existsSync(plan.manifestPath), 'Manifest receipt must be created for verified plan');
  });

  test('36. Isolated Connection Guard (Negative): Rejects connection to protected active databases', () => {
    const protectedTargets = [
      'dbwins_worldfert9',
      'dbwins_worldfert9_test_v2',
      'dbwins_worldfert9_test',
      'master',
      'tempdb',
    ];

    for (const target of protectedTargets) {
      assert.throws(
        () => assertIsolatedConnection(target, target, 'Amyou-Yoga7\\SQLEXPRESS', 'Amyou-Yoga7\\SQLEXPRESS'),
        /protected active database/,
        `Must refuse connection to protected active target "${target}"`
      );
    }
  });

  test('37. Isolated Connection Guard (Negative): Rejects connection when connected database mismatches expected target', () => {
    assert.throws(
      () => assertIsolatedConnection(
        'dbwins_worldfert9_rehearsal_11111',
        'dbwins_worldfert9_rehearsal_22222',
        'Amyou-Yoga7\\SQLEXPRESS',
        'Amyou-Yoga7\\SQLEXPRESS'
      ),
      /ISOLATED_CONNECTION_MISMATCH: Connected to database \[.+], but expected isolated rehearsal DB is \[.+]/
    );
  });

  test('38. Isolated Connection Guard (Negative): Rejects connection when connected server mismatches expected host', () => {
    assert.throws(
      () => assertIsolatedConnection(
        'dbwins_worldfert9_rehearsal_12345',
        'dbwins_worldfert9_rehearsal_12345',
        'OTHER_SERVER\\INSTANCE',
        'Amyou-Yoga7\\SQLEXPRESS'
      ),
      /ISOLATED_CONNECTION_HOST_MISMATCH: Connected to server \[.+], expected host \[.+]/
    );
  });

  test('39. Isolated Connection Guard: Accepts connection when rehearsal DB and host match expected isolated target', () => {
    assert.doesNotThrow(() => {
      assertIsolatedConnection(
        'dbwins_worldfert9_rehearsal_12345',
        'dbwins_worldfert9_rehearsal_12345',
        'Amyou-Yoga7\\SQLEXPRESS',
        'Amyou-Yoga7\\SQLEXPRESS'
      );
    });
  });

});
