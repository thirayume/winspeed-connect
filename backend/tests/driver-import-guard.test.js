'use strict';

/**
 * backend/tests/driver-import-guard.test.js
 *
 * Offline Architectural Guard Test (R10.3)
 *
 * Enforces driver isolation:
 * Direct require or import of 'mssql' or 'mssql/msnodesqlv8' is strictly FORBIDDEN
 * in runtime application code (routes/, services/, middleware/, server.js).
 *
 * 'backend/db.js' is the ONLY sanctioned place allowed to require the SQL Server driver.
 * All other modules must import { sql } from '../db' (or './db').
 *
 * Why this is critical:
 * On Windows, db.js uses 'mssql/msnodesqlv8' for Windows Auth support.
 * Requiring plain 'mssql' in any downstream service reconfigures the global driver
 * singleton to tedious, causing subsequent native calls to crash with "connection.on is not a function".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');

// Scan targets subject to the strict driver ban:
const FORBIDDEN_DIRS = [
  path.join(BACKEND_ROOT, 'routes'),
  path.join(BACKEND_ROOT, 'services'),
  path.join(BACKEND_ROOT, 'middleware'),
];
const FORBIDDEN_FILES = [
  path.join(BACKEND_ROOT, 'server.js'),
];

// Regex matching direct imports of mssql or mssql/msnodesqlv8
const DRIVER_REQUIRE_REGEX = /require\s*\(\s*['"]mssql(?:\/msnodesqlv8)?['"]\s*\)/;
const DRIVER_IMPORT_REGEX = /from\s+['"]mssql(?:\/msnodesqlv8)?['"]/;

function getFilesRecursively(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
      files.push(fullPath);
    }
  }
  return files;
}

test('Driver Import Guard: db.js is the only runtime module importing mssql drivers', () => {
  const allTargetFiles = [
    ...FORBIDDEN_FILES.filter(f => fs.existsSync(f)),
    ...FORBIDDEN_DIRS.flatMap(d => getFilesRecursively(d)),
  ];

  assert.ok(allTargetFiles.length > 0, 'Target files must be found in routes/, services/, middleware/, server.js');

  const violations = [];

  for (const filePath of allTargetFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // Ignore comment-only lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return;
      }

      if (DRIVER_REQUIRE_REGEX.test(line) || DRIVER_IMPORT_REGEX.test(line)) {
        const relativePath = path.relative(BACKEND_ROOT, filePath).replace(/\\/g, '/');
        violations.push(`${relativePath}:${idx + 1} -> ${trimmed}`);
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    `Found direct mssql driver imports in runtime application code (must use require('../db').sql):\n${violations.join('\n')}`
  );
});

test('Driver Import Guard: db.js properly exports the shared sql instance', () => {
  const dbFile = path.join(BACKEND_ROOT, 'db.js');
  assert.ok(fs.existsSync(dbFile), 'backend/db.js must exist');

  const content = fs.readFileSync(dbFile, 'utf8');
  assert.match(
    content,
    /module\.exports\s*=\s*\{[^}]*\bsql\b/,
    'backend/db.js must export { sql }'
  );
});
