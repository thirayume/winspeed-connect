'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFrontMatter,
  parseMetadata,
  compareInventories,
  buildImpactReport,
  stableJson,
  sha256,
  acceptanceBlockingIssues,
  versionCohorts,
  buildMergeReport,
} = require('./doc-control');

const config = {
  allowedStatuses: ['Draft', 'Review', 'Approved', 'Released', 'Superseded', 'Archived'],
  normativePrefixes: ['00-GOVERNANCE/', '01-REQUIREMENTS/'],
  releaseVersionStatuses: ['Review', 'Approved', 'Released'],
  unapprovedNormativeStatuses: ['Draft', 'Review'],
  impactRules: [
    {
      prefix: '00-GOVERNANCE/',
      severity: 'HIGH',
      artifacts: ['controlled-document-register'],
      reviewers: ['Quality Manager'],
    },
    {
      prefix: '01-REQUIREMENTS/',
      severity: 'HIGH',
      artifacts: ['srs', 'traceability-matrix'],
      reviewers: ['Product Owner'],
    },
  ],
};

function document(overrides = {}) {
  const base = {
    path: '01-REQUIREMENTS/SRS.md',
    documentId: 'WF-SRS-001',
    syntheticId: false,
    sha256: 'content-a',
    metadataSha256: 'metadata-a',
    normative: true,
  };
  return { ...base, ...overrides };
}

function inventory(documents, inventorySha256 = 'inventory') {
  return {
    generatedAt: '2026-07-21T00:00:00.000Z',
    inventorySha256,
    documents,
    controlFiles: [],
  };
}

test('parses YAML front matter lists and lifecycle metadata', () => {
  const markdown = [
    '---',
    'documentId: WF-SRS-001',
    'title: System Requirements Specification',
    'version: 1.2',
    'status: Review',
    'statusDetail: "Review candidate \"A\""',
    'sourceVersion: v8.0',
    'mergePolicy: latest-document-wins',
    'mergeDisposition: retained-unique-content',
    'mergedAt: 2026-07-21',
    'owner: Product Owner',
    'dependsOn:',
    '  - WF-GOV-001',
    'sourceRefs: [src, package.json]',
    'normative: true',
    '---',
    '# Body',
  ].join('\n');

  const parsed = parseFrontMatter(markdown);
  assert.equal(parsed.data.documentId, 'WF-SRS-001');
  assert.deepEqual(parsed.data.dependsOn, ['WF-GOV-001']);
  assert.deepEqual(parsed.data.sourceRefs, ['src', 'package.json']);

  const metadata = parseMetadata(markdown, '01-REQUIREMENTS/SRS.md', config);
  assert.equal(metadata.status, 'Review');
  assert.equal(metadata.statusDetail, 'Review candidate \"A\"');
  assert.equal(metadata.sourceVersion, 'v8.0');
  assert.equal(metadata.mergeDisposition, 'retained-unique-content');
  assert.equal(metadata.normative, true);
  assert.equal(metadata.syntheticId, false);
});

test('falls back to path identity without inventing an accepted document ID', () => {
  const metadata = parseMetadata('# Working Notes\n\nNo controlled metadata yet.', '08-OPERATIONS/NOTES.md', config);
  assert.equal(metadata.documentId, 'PATH:08-OPERATIONS/NOTES.md');
  assert.equal(metadata.syntheticId, true);
  assert.equal(metadata.normative, false);
});

test('does not treat a multi-column table header as document version metadata', () => {
  const markdown = '# Release form\n\n| Version | Deployer | Migrations | Change Summary |\n|---|---|---|---|';
  const metadata = parseMetadata(markdown, '06-QUALITY-OPERATIONS/FORM.md', config);
  assert.equal(metadata.version, '');
});

test('detects a rename and content/metadata modification by stable document ID', () => {
  const accepted = inventory([document()], 'accepted');
  const current = inventory([
    document({
      path: '01-REQUIREMENTS/SYSTEM-REQUIREMENTS.md',
      sha256: 'content-b',
      metadataSha256: 'metadata-b',
    }),
  ], 'current');

  const report = compareInventories(current, accepted);
  assert.equal(report.summary.changeCount, 1);
  assert.deepEqual(report.changes[0].types, ['RENAMED', 'MODIFIED', 'METADATA_MODIFIED']);
  assert.equal(report.changes[0].detection, 'DOCUMENT_ID');
});

test('detects a stable-path document ID change as a high-impact change', () => {
  const accepted = inventory([document()], 'accepted');
  const current = inventory([document({ documentId: 'WF-SRS-002', metadataSha256: 'metadata-b' })], 'current');
  const changes = compareInventories(current, accepted);
  const impact = buildImpactReport(changes, config);

  assert.deepEqual(changes.changes[0].types, ['DOCUMENT_ID_CHANGED', 'METADATA_MODIFIED']);
  assert.equal(impact.overallSeverity, 'HIGH');
  assert.ok(impact.summary.impactedArtifacts.includes('traceability-matrix'));
});

test('raises removal of a normative document to critical impact', () => {
  const accepted = inventory([
    document({ path: '00-GOVERNANCE/DOCUMENT-CONTROL.md', documentId: 'WF-GOV-001' }),
  ], 'accepted');
  const current = inventory([], 'current');
  const impact = buildImpactReport(compareInventories(current, accepted), config);

  assert.equal(impact.overallSeverity, 'CRITICAL');
  assert.equal(impact.impacts[0].severity, 'CRITICAL');
  assert.equal(impact.reviewRequired, true);
});

test('detects documentation control file changes as high impact', () => {
  const accepted = inventory([], 'accepted');
  accepted.controlFiles = [{ kind: 'control-file', documentId: 'CONTROL:pipeline/docs.ps1', path: 'pipeline/docs.ps1', sha256: 'a', normative: true }];
  const current = inventory([], 'current');
  current.controlFiles = [{ kind: 'control-file', documentId: 'CONTROL:pipeline/docs.ps1', path: 'pipeline/docs.ps1', sha256: 'b', normative: true }];
  const changes = compareInventories(current, accepted);
  const impact = buildImpactReport(changes, config);
  assert.deepEqual(changes.changes[0].types, ['CONTROL_FILE_MODIFIED']);
  assert.equal(impact.overallSeverity, 'HIGH');
});
test('version cohorts exclude superseded and draft documents from active versions', () => {
  const cohorts = versionCohorts([
    { version: 'v1.0', status: 'Released' },
    { version: 'v8.0', status: 'Superseded' },
    { version: '1.0-draft', status: 'Draft' },
  ], config);
  assert.deepEqual(cohorts.activeVersions, ['v1.0']);
  assert.deepEqual(cohorts.historicalVersions, ['1.0-draft', 'v8.0']);
});

test('merge report summarizes retained and superseded records', () => {
  const merged = { documentId: 'WF-A', path: 'a.md', version: 'v1.0', status: 'Review', sourceVersion: 'v8.0', mergePolicy: 'latest-document-wins', mergeDisposition: 'retained-unique-content', mergedAt: '2026-07-21' };
  const superseded = { documentId: 'WF-B', path: 'b.md', version: 'v8.0', status: 'Superseded', sourceVersion: 'v8.0', mergePolicy: 'latest-document-wins', mergeDisposition: 'superseded-by-latest', supersededBy: 'WF-A', mergedAt: '2026-07-21' };
  const report = buildMergeReport({ generatedAt: '2026-07-21T00:00:00Z', inventorySha256: 'hash', summary: { activeVersions: ['v1.0'], historicalVersions: ['v8.0'] }, documents: [merged, superseded] });
  assert.equal(report.summary.recordCount, 2);
  assert.equal(report.summary.supersededCount, 1);
  assert.equal(report.summary.reviewCount, 1);
});

test('initial acceptance ignores only baseline-missing and dirty-tree warnings', () => {
  const validation = { issues: [
    { severity: 'WARNING', code: 'ACCEPTED_BASELINE_MISSING' },
    { severity: 'WARNING', code: 'DIRTY_GIT_WORKTREE' },
    { severity: 'WARNING', code: 'MIXED_DOCUMENT_VERSIONS' },
  ] };
  const blocking = acceptanceBlockingIssues(validation);
  assert.deepEqual(blocking.map(issue => issue.code), ['MIXED_DOCUMENT_VERSIONS']);
});

test('stable JSON produces deterministic hashes regardless of object key order', () => {
  assert.equal(sha256(stableJson({ b: 2, a: 1 })), sha256(stableJson({ a: 1, b: 2 })));
});
