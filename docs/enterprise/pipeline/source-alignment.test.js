'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractRouteMounts,
  extractRouterEndpoints,
  extractUnionValues,
  extractSqlWrites,
  migrationSummary,
  compareSourceInventories,
  reviewE2eEvidence,
  acceptanceBlockingGaps,
  frontMatterValue,
  renderApiReferenceBlock,
  replaceGeneratedBlock,
} = require('./source-alignment');

test('extracts Express route mounts and endpoints', () => {
  const mounts = extractRouteMounts("app.use('/api/so', require('./routes/so'));\napp.use('/api/line', require('./routes/line').router);");
  assert.deepEqual(mounts, [
    { basePath: '/api/line', module: 'line' },
    { basePath: '/api/so', module: 'so' },
  ]);
  const endpoints = extractRouterEndpoints("router.get('/', handler);\nrouter.patch('/:id/ship', handler);", '/api/so', 'backend/routes/so.js');
  assert.deepEqual(endpoints.map(item => `${item.method} ${item.path}`), ['GET /api/so', 'PATCH /api/so/:id/ship']);
});

test('extracts TypeScript union values', () => {
  assert.deepEqual(extractUnionValues("export type UserRole = 'ADMIN' | 'SALES';", 'UserRole'), ['ADMIN', 'SALES']);
});

test('extracts SQL write boundaries with line evidence', () => {
  const writes = extractSqlWrites("SELECT 1;\nUPDATE dbo.SOHD SET X=1;\nINSERT INTO wf.Audit(Id) VALUES(1);", 'routes/so.js');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(item => item.target), ['dbo.SOHD', 'wf.Audit']);
  assert.equal(writes[0].line, 2);
});

test('summarizes migration sequences and validates exact legacy duplicate policy', () => {
  const files = [
    { path: 'backend/migrations/001_a.sql', group: 'database-migrations' },
    { path: 'backend/migrations/002_b.sql', group: 'database-migrations' },
    { path: 'backend/migrations/002_c.sql', group: 'database-migrations' },
    { path: 'backend/migrations/manual.sql', group: 'database-migrations' },
  ];
  const approved = migrationSummary(files, { legacyDuplicateSequences: { 2: ['002_b.sql', '002_c.sql'] } });
  assert.equal(approved.latestSequence, 2);
  assert.equal(approved.duplicates.length, 1);
  assert.equal(approved.approvedLegacyDuplicates.length, 1);
  assert.equal(approved.unapprovedDuplicates.length, 0);
  assert.deepEqual(approved.unsequenced, ['backend/migrations/manual.sql']);
  const changed = migrationSummary(files, { legacyDuplicateSequences: { 2: ['002_b.sql', '002_other.sql'] } });
  assert.deepEqual(changed.unapprovedDuplicates.map(item => item.sequence), [2]);
});

test('reads structured current claims without confusing historical provenance', () => {
  const text = '---\nruntimeVersion: 1.0.0\nsourceVersion: v8.0\nsourceMigrationSequence: 54\n---\nHistorical build v4.2.24';
  assert.equal(frontMatterValue(text, 'runtimeVersion'), '1.0.0');
  assert.equal(frontMatterValue(text, 'sourceVersion'), 'v8.0');
  assert.equal(frontMatterValue(text, 'sourceMigrationSequence'), '54');
});

test('renders and replaces a deterministic API reference block', () => {
  const source = {
    sourceInventorySha256: 'A'.repeat(64),
    summary: { routeMountCount: 1, endpointCount: 1 },
    endpoints: [{ method: 'GET', path: '/api/health', file: 'backend/routes/health.js', line: 7 }],
  };
  const block = renderApiReferenceBlock(source);
  assert.ok(block.includes(String.fromCharCode(96) + '/api/health' + String.fromCharCode(96)));
  assert.match(block, new RegExp('A{64}'));
  const current = 'before\n<!-- BEGIN GENERATED:SOURCE-API-INVENTORY -->\nold\n<!-- END GENERATED:SOURCE-API-INVENTORY -->\nafter';
  const replaced = replaceGeneratedBlock(current, '<!-- BEGIN GENERATED:SOURCE-API-INVENTORY -->', '<!-- END GENERATED:SOURCE-API-INVENTORY -->', block);
  assert.match(replaced, /^before\n/);
  assert.match(replaced, /after$/);
  assert.doesNotMatch(replaced, /\nold\n/);
});
test('detects source drift deterministically', () => {
  const current = { sourceInventorySha256: 'new', files: [
    { path: 'a', group: 'x', sha256: '2' },
    { path: 'b', group: 'x', sha256: '1' },
  ] };
  const accepted = { sourceInventorySha256: 'old', files: [
    { path: 'a', group: 'x', sha256: '1' },
    { path: 'c', group: 'x', sha256: '1' },
  ] };
  const drift = compareSourceInventories(current, accepted);
  assert.equal(drift.baselineState, 'DRIFTED');
  assert.deepEqual(drift.summary, { added: 1, modified: 1, removed: 1, unchanged: 0 });
});

test('initial source acceptance allows only missing baseline and dirty tree warnings', () => {
  const allowed = acceptanceBlockingGaps({ gaps: [
    { severity: 'WARNING', code: 'ACCEPTED_SOURCE_BASELINE_MISSING' },
    { severity: 'WARNING', code: 'DIRTY_GIT_WORKTREE' },
  ] });
  assert.equal(allowed.length, 0);
  const blocked = acceptanceBlockingGaps({ gaps: [
    { severity: 'WARNING', code: 'E2E_EVIDENCE_DEFERRED' },
  ] });
  assert.equal(blocked.length, 1);
});


test('accepts complete source-bound E2E evidence and rejects later source drift', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-e2e-evidence-'));
  fs.mkdirSync(path.join(repoRoot, 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'e2e/spec.ts'), 'test source', 'utf8');
  const completedAt = '2026-07-22T04:58:47.000Z';
  const evidence = {
    status: 'PASSED_COMPLETE', complete: true, playwrightStatus: 'passed', completedAt,
    counts: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0, notRun: 0 },
    coverage: { selectedSpecs: ['e2e/spec.ts'] },
    environment: { frontend: { ok: true }, api: { ok: true, body: { db: { sqlserver: 'up' } } } },
    fileHashes: { 'e2e/spec.ts': require('crypto').createHash('sha256').update('test source').digest('hex').toUpperCase() },
  };
  fs.writeFileSync(path.join(repoRoot, 'test-results/e2e-evidence.json'), JSON.stringify(evidence), 'utf8');
  const config = {
    status: 'REQUIRED', specRoot: 'e2e', extensions: ['.ts'], evidenceFile: 'test-results/e2e-evidence.json',
    requiredEvidenceStatus: 'PASSED_COMPLETE', minimumTestCount: 1, maxAgeHours: 72,
    requiredSpecs: ['e2e/spec.ts'], requiredEnvironment: { frontendOk: true, apiOk: true, sqlserver: 'up' },
  };
  const now = Date.parse(completedAt) + 3_600_000;
  const accepted = reviewE2eEvidence(config, { repoRoot, now });
  assert.equal(accepted.review.evidenceReviewed, true);
  assert.equal(accepted.gaps.length, 0);
  fs.writeFileSync(path.join(repoRoot, 'e2e/spec.ts'), 'changed', 'utf8');
  const drifted = reviewE2eEvidence(config, { repoRoot, now });
  assert.equal(drifted.review.evidenceReviewed, false);
  assert.ok(drifted.gaps.some(gap => gap.code === 'E2E_EVIDENCE_SOURCE_DRIFT'));
  fs.rmSync(repoRoot, { recursive: true, force: true });
});
