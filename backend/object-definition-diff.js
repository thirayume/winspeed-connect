'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { splitBatches } = require('./run_migrations');

const MIGRATION_FILES = [
  '050_cleanup_and_truckplate_fix.sql',
  '052_sohd_remark_logistics.sql',
  '055_restore_all_sales_orders_contract.sql',
  '058_fix_shipped_status_clearflag.sql',
];

function normalizeDefinition(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function definitionHash(value) {
  return crypto.createHash('sha256').update(normalizeDefinition(value), 'utf8').digest('hex');
}

function parseQualifiedName(value) {
  const parts = value.replace(/[\[\]]/g, '').split('.');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) {
    throw new Error(`Unsupported SQL object name: ${value}`);
  }
  return { schema: parts[0], object: parts[1] };
}

function extractObjectDefinitions(sql) {
  const rows = [];
  const pattern = /\bCREATE\s+(?:OR\s+ALTER\s+)?(VIEW|PROCEDURE|PROC)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\.(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))/i;
  for (const batch of splitBatches(sql)) {
    const match = pattern.exec(batch);
    if (!match) continue;
    const name = parseQualifiedName(match[2]);
    rows.push({
      type: match[1].toUpperCase() === 'VIEW' ? 'VIEW' : 'PROCEDURE',
      schema: name.schema,
      object: name.object,
      definition: batch.slice(match.index).trim(),
    });
  }
  return rows;
}

async function readDatabaseDefinition(pool, object) {
  const result = await pool.request()
    .input('schemaName', object.schema)
    .input('objectName', object.object)
    .query(`
      SELECT o.type_desc, sm.definition
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      LEFT JOIN sys.sql_modules sm ON sm.object_id = o.object_id
      WHERE s.name = @schemaName
        AND o.name = @objectName
        AND o.type IN ('V', 'P')
    `);
  return result.recordset?.[0] || null;
}

async function buildDefinitionDiffRows(pool, migrationsDirectory) {
  const rows = [];
  for (const migration of MIGRATION_FILES) {
    const fullPath = path.join(migrationsDirectory, migration);
    const definitions = extractObjectDefinitions(fs.readFileSync(fullPath, 'utf8'));
    for (const source of definitions) {
      const current = await readDatabaseDefinition(pool, source);
      const sourceNormalized = normalizeDefinition(source.definition);
      const databaseNormalized = normalizeDefinition(current?.definition);
      rows.push({
        Migration: migration,
        Object: `${source.schema}.${source.object}`,
        ObjectType: source.type,
        SourceHash: definitionHash(source.definition),
        DatabaseHash: current ? definitionHash(current.definition) : null,
        DefinitionMatch: current && sourceNormalized === databaseNormalized ? 'MATCH' : 'MISMATCH',
        CurrentDbState: current ? current.type_desc : 'MISSING',
        SourceLength: sourceNormalized.length,
        DatabaseLength: current ? databaseNormalized.length : 0,
      });
    }
  }
  return rows;
}

async function run(argv = process.argv.slice(2)) {
  const unknown = argv.filter(arg => arg !== '--json');
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  const db = require('./db');
  await db.readerReady;
  try {
    const migrationsDirectory = path.join(__dirname, 'migrations');
    const rows = await buildDefinitionDiffRows(db.readerPool, migrationsDirectory);
    if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else console.table(rows);
    console.log('Read-only definition diff complete: no SQL definition text, data row, schema, transaction, or ledger change was emitted.');
    return rows;
  } finally {
    await Promise.all([db.readerPool.close(), db.ownerPool.close()]);
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(`Object definition diff failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATION_FILES,
  normalizeDefinition,
  definitionHash,
  extractObjectDefinitions,
  buildDefinitionDiffRows,
  run,
};
