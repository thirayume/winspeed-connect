'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const PIPELINE_ROOT = __dirname;
const ENTERPRISE_ROOT = path.resolve(PIPELINE_ROOT, '..');
const REPO_ROOT = path.resolve(PIPELINE_ROOT, '..', '..', '..');
const CONFIG_PATH = path.join(PIPELINE_ROOT, 'source-alignment.config.json');
const REPORT_ROOT = path.join(PIPELINE_ROOT, 'reports');
const BASELINE_ROOT = path.join(PIPELINE_ROOT, 'baselines');
const ACCEPTED_BASELINE = path.join(BASELINE_ROOT, 'accepted-source-inventory.json');
const DOC_CONTROL = require(path.join(PIPELINE_ROOT, 'doc-control.js'));
const DOC_CONFIG = require(path.join(PIPELINE_ROOT, 'doc-control.config.json'));

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadConfig() {
  return readJson(CONFIG_PATH);
}

function reviewE2eEvidence(e2eConfig = {}, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const specRoot = path.join(repoRoot, e2eConfig.specRoot || 'e2e');
  const specFiles = walkFiles(specRoot)
    .filter(file => (e2eConfig.extensions || ['.ts']).includes(path.extname(file).toLowerCase()))
    .map(file => slash(path.relative(repoRoot, file)));
  const review = {
    status: e2eConfig.status || 'UNCONFIGURED',
    note: e2eConfig.note || '',
    specFiles,
    evidencePath: e2eConfig.evidenceFile || null,
    evidenceStatus: null,
    evidenceReviewed: false,
    completedAt: null,
    ageHours: null,
    counts: null,
    coverage: null,
    environment: null,
    sourceHashFileCount: 0,
    expectedSourceHashFileCount: 0,
  };
  const gaps = [];
  const issue = (severity, code, message, metadata = {}) => gaps.push({ severity, code, message, ...metadata });

  if (review.status === 'DEFERRED') {
    issue('WARNING', 'E2E_EVIDENCE_DEFERRED', review.note || 'E2E evidence is deferred.', { e2eDependency: true });
    return { review, gaps };
  }
  if (review.status !== 'REQUIRED') {
    issue('ERROR', 'E2E_EVIDENCE_POLICY_INVALID', `Unsupported E2E evidence policy status: ${review.status}.`);
    return { review, gaps };
  }

  const evidenceFile = path.join(repoRoot, ...String(e2eConfig.evidenceFile || '').split('/'));
  if (!e2eConfig.evidenceFile || !fs.existsSync(evidenceFile)) {
    issue('ERROR', 'E2E_EVIDENCE_MISSING', `Required E2E evidence file is missing: ${e2eConfig.evidenceFile || '(not configured)'}.`, { path: e2eConfig.evidenceFile || null });
    return { review, gaps };
  }

  let evidence;
  try {
    evidence = readJson(evidenceFile);
  } catch (error) {
    issue('ERROR', 'E2E_EVIDENCE_INVALID', `Cannot parse E2E evidence: ${error.message}`, { path: e2eConfig.evidenceFile });
    return { review, gaps };
  }
  review.evidenceStatus = evidence.status || null;
  review.completedAt = evidence.completedAt || null;
  review.counts = evidence.counts || null;
  review.coverage = evidence.coverage || null;
  review.environment = evidence.environment || null;

  const requiredStatus = e2eConfig.requiredEvidenceStatus || 'PASSED_COMPLETE';
  if (evidence.status !== requiredStatus || evidence.complete !== true || evidence.playwrightStatus !== 'passed') {
    issue('ERROR', 'E2E_EVIDENCE_NOT_COMPLETE', `E2E evidence must be ${requiredStatus} with complete=true and playwrightStatus=passed; received ${evidence.status || 'unknown'}.`, { path: e2eConfig.evidenceFile });
  }
  if (Number(evidence.schemaVersion || 1) >= 2 && evidence.sourceStability?.stable !== true) {
    issue('ERROR', 'E2E_SOURCE_CHANGED_DURING_RUN', 'Source files or Git commit changed while the E2E run was in progress.', { sourceStability: evidence.sourceStability || null });
  }
  const counts = evidence.counts || {};
  const minimumTestCount = Number(e2eConfig.minimumTestCount || 1);
  const nonPassing = ['failed', 'flaky', 'skipped', 'timedOut', 'interrupted', 'notRun'].reduce((sum, key) => sum + Number(counts[key] || 0), 0);
  if (Number(counts.total || 0) < minimumTestCount || Number(counts.passed || 0) !== Number(counts.total || 0) || nonPassing !== 0) {
    issue('ERROR', 'E2E_EVIDENCE_COUNTS_INVALID', `E2E evidence requires at least ${minimumTestCount} tests, all passed, and zero failed/flaky/skipped/timed-out/interrupted/not-run tests.`, { counts });
  }
  const selectedSpecs = new Set(evidence.coverage?.selectedSpecs || []);
  const missingSpecs = (e2eConfig.requiredSpecs || []).filter(spec => !selectedSpecs.has(spec));
  if (missingSpecs.length) issue('ERROR', 'E2E_REQUIRED_SPECS_MISSING', `E2E evidence does not include ${missingSpecs.length} required spec(s).`, { paths: missingSpecs });

  const completedMs = Date.parse(evidence.completedAt || '');
  if (!Number.isFinite(completedMs)) {
    issue('ERROR', 'E2E_EVIDENCE_TIMESTAMP_INVALID', 'E2E evidence completedAt is missing or invalid.', { path: e2eConfig.evidenceFile });
  } else {
    review.ageHours = Math.max(0, (now - completedMs) / 3_600_000);
    const maxAgeHours = Number(e2eConfig.maxAgeHours || 0);
    if (maxAgeHours > 0 && review.ageHours > maxAgeHours) issue('ERROR', 'E2E_EVIDENCE_STALE', `E2E evidence is ${review.ageHours.toFixed(1)} hours old; maximum is ${maxAgeHours}.`, { path: e2eConfig.evidenceFile });
  }

  const requiredEnvironment = e2eConfig.requiredEnvironment || {};
  if (requiredEnvironment.frontendOk === true && evidence.environment?.frontend?.ok !== true) issue('ERROR', 'E2E_FRONTEND_HEALTH_FAILED', 'E2E environment did not record a healthy frontend.');
  if (requiredEnvironment.apiOk === true && evidence.environment?.api?.ok !== true) issue('ERROR', 'E2E_API_HEALTH_FAILED', 'E2E environment did not record a healthy API.');
  if (requiredEnvironment.sqlserver && evidence.environment?.api?.body?.db?.sqlserver !== requiredEnvironment.sqlserver) issue('ERROR', 'E2E_SQLSERVER_HEALTH_FAILED', `E2E SQL Server health must be ${requiredEnvironment.sqlserver}.`);

  const hashEntries = Object.entries(evidence.fileHashes || {});
  review.sourceHashFileCount = hashEntries.length;
  let expectedHashPaths = null;
  try {
    expectedHashPaths = listEvidenceTrackedFiles(repoRoot, e2eConfig.evidenceManifestFile || 'e2e/evidence.config.json');
    review.expectedSourceHashFileCount = expectedHashPaths.length;
  } catch (error) {
    issue('ERROR', 'E2E_EVIDENCE_MANIFEST_INVALID', `Cannot enumerate the E2E evidence manifest: ${error.message}`, { path: e2eConfig.evidenceManifestFile || 'e2e/evidence.config.json' });
  }
  if (!hashEntries.length) {
    issue('ERROR', 'E2E_SOURCE_HASHES_MISSING', 'E2E evidence contains no source file hashes.', { path: e2eConfig.evidenceFile });
  } else {
    if (expectedHashPaths) {
      const actualPaths = new Set(hashEntries.map(([relative]) => slash(String(relative))));
      const expectedPaths = new Set(expectedHashPaths);
      const missingHashes = expectedHashPaths.filter(relative => !actualPaths.has(relative));
      const unexpectedHashes = [...actualPaths].filter(relative => !expectedPaths.has(relative)).sort((a, b) => a.localeCompare(b, 'en'));
      if (missingHashes.length) issue('ERROR', 'E2E_SOURCE_HASH_SET_INCOMPLETE', `${missingHashes.length} currently tracked source/test file(s) are missing from the E2E evidence.`, { paths: missingHashes });
      if (unexpectedHashes.length) issue('ERROR', 'E2E_SOURCE_HASH_SET_UNEXPECTED', `${unexpectedHashes.length} E2E hash entr${unexpectedHashes.length === 1 ? 'y is' : 'ies are'} outside the current evidence manifest.`, { paths: unexpectedHashes });
    }
    const drifted = hashEntries.filter(([relative, expected]) => {
      const current = path.join(repoRoot, ...String(relative).split('/'));
      return !expected || !fs.existsSync(current) || sha256(fs.readFileSync(current)) !== String(expected).toUpperCase();
    }).map(([relative]) => relative);
    if (drifted.length) issue('ERROR', 'E2E_EVIDENCE_SOURCE_DRIFT', `${drifted.length} source/test file(s) changed after the E2E evidence was captured.`, { paths: drifted });
  }

  review.evidenceReviewed = !gaps.some(gap => gap.severity === 'ERROR');
  return { review, gaps };
}

function listEvidenceTrackedFiles(repoRoot, manifestRelative) {
  const manifestPath = path.join(repoRoot, ...String(manifestRelative).split('/'));
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest is missing: ${manifestRelative}`);
  const manifest = readJson(manifestPath);
  const selected = new Set();
  for (const relative of manifest.requiredEvidenceFiles || []) {
    const full = path.join(repoRoot, ...String(relative).split('/'));
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`required evidence file is missing: ${relative}`);
    selected.add(slash(String(relative)));
  }
  for (const trackedRoot of manifest.trackedRoots || []) {
    const root = path.join(repoRoot, ...String(trackedRoot.root || '').split('/'));
    for (const full of walkFiles(root)) {
      const relativeToRoot = slash(path.relative(root, full));
      if (excluded(relativeToRoot, path.basename(full), trackedRoot)) continue;
      if (trackedRoot.extensions && !trackedRoot.extensions.includes(path.extname(full).toLowerCase())) continue;
      selected.add(slash(path.relative(repoRoot, full)));
    }
  }
  return [...selected].sort((a, b) => a.localeCompare(b, 'en'));
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function excluded(relativeToSet, basename, sourceSet) {
  if ((sourceSet.excludePrefixes || []).some(prefix => slash(relativeToSet).startsWith(prefix))) return true;
  return (sourceSet.excludeNamePatterns || []).some(pattern => new RegExp(pattern, 'i').test(basename));
}

function listSourceFiles(config) {
  const selected = new Map();
  for (const sourceSet of config.sourceSets) {
    for (const relative of sourceSet.files || []) {
      const full = path.join(REPO_ROOT, ...relative.split('/'));
      if (fs.existsSync(full) && fs.statSync(full).isFile()) selected.set(slash(relative), sourceSet.name);
    }
    if (!sourceSet.root) continue;
    const root = path.join(REPO_ROOT, ...sourceSet.root.split('/'));
    for (const full of walkFiles(root)) {
      const relativeToSet = slash(path.relative(root, full));
      if (excluded(relativeToSet, path.basename(full), sourceSet)) continue;
      if (sourceSet.extensions && !sourceSet.extensions.includes(path.extname(full).toLowerCase())) continue;
      selected.set(slash(path.relative(REPO_ROOT, full)), sourceSet.name);
    }
  }
  return [...selected.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

function gitSnapshot() {
  const run = args => childProcess.spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const head = run(['rev-parse', 'HEAD']);
  const status = run(['status', '--porcelain']);
  return {
    commit: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null,
  };
}

function extractRouteMounts(serverText) {
  const mounts = [];
  const expression = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)(?:\.router)?\s*\)/g;
  let match;
  while ((match = expression.exec(serverText))) mounts.push({ basePath: match[1], module: match[2] });
  return mounts.sort((a, b) => a.basePath.localeCompare(b.basePath, 'en'));
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function extractRouterEndpoints(routeText, basePath, file) {
  const endpoints = [];
  const expression = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;
  while ((match = expression.exec(routeText))) {
    const routePath = match[2] === '/' ? '' : match[2];
    endpoints.push({
      method: match[1].toUpperCase(),
      path: `${basePath}${routePath}` || '/',
      file,
      line: lineNumberAt(routeText, match.index),
    });
  }
  return endpoints;
}

function extractUnionValues(text, declaration) {
  const match = text.match(new RegExp(`(?:export\\s+)?type\\s+${declaration}\\s*=([\\s\\S]*?);`));
  if (!match) return [];
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1]);
}

function extractSqlWrites(text, file) {
  const writes = [];
  const expression = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE(?:\s+INTO)?)\s+((?:\[?[A-Za-z_][\w$]*\]?\.)?\[?[A-Za-z_][\w$]*\]?)/gi;
  let match;
  while ((match = expression.exec(text))) {
    const target = match[2].replace(/[\[\]]/g, '');
    writes.push({
      operation: match[1].replace(/\s+/g, ' ').toUpperCase(),
      target,
      file,
      line: lineNumberAt(text, match.index),
    });
  }
  return writes;
}

function packageVersions() {
  const files = ['package.json', 'backend/package.json', 'WSSale-App/package.json'];
  return files.map(file => ({ file, version: readJson(path.join(REPO_ROOT, ...file.split('/'))).version || null }));
}

function migrationSummary(files, policy = {}) {
  const migrations = files.filter(file => file.group === 'database-migrations').map(file => {
    const match = path.basename(file.path).match(/^(\d+)_/);
    return { path: file.path, sequence: match ? Number(match[1]) : null };
  });
  const sequenced = migrations.filter(item => item.sequence !== null);
  const grouped = sequenced.reduce((acc, item) => {
    acc[item.sequence] = acc[item.sequence] || [];
    acc[item.sequence].push(item.path);
    return acc;
  }, {});
  const duplicates = Object.entries(grouped)
    .filter(([, paths]) => paths.length > 1)
    .map(([sequence, paths]) => ({ sequence: Number(sequence), paths }));
  const expected = policy.legacyDuplicateSequences || {};
  const sequences = new Set([...duplicates.map(item => item.sequence), ...Object.keys(expected).map(Number)]);
  const duplicatePolicy = [...sequences].sort((a, b) => a - b).map(sequence => {
    const actualPaths = duplicates.find(item => item.sequence === sequence)?.paths || [];
    const actualFiles = actualPaths.map(item => path.basename(item)).sort();
    const expectedFiles = [...(expected[String(sequence)] || [])].sort();
    return {
      sequence,
      paths: actualPaths,
      expectedFiles,
      approved: actualFiles.length > 1 && actualFiles.join('\n') === expectedFiles.join('\n'),
    };
  });
  return {
    fileCount: migrations.length,
    sequencedCount: sequenced.length,
    latestSequence: sequenced.length ? Math.max(...sequenced.map(item => item.sequence)) : null,
    duplicates,
    approvedLegacyDuplicates: duplicatePolicy.filter(item => item.approved),
    unapprovedDuplicates: duplicatePolicy.filter(item => !item.approved),
    unsequenced: migrations.filter(item => item.sequence === null).map(item => item.path),
  };
}

function readSource(relativePath) {
  const file = path.join(REPO_ROOT, ...relativePath.split('/'));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
}

function scanOnce(config = loadConfig()) {
  const sourceFiles = listSourceFiles(config).map(([relativePath, group]) => {
    const full = path.join(REPO_ROOT, ...relativePath.split('/'));
    const buffer = fs.readFileSync(full);
    return { path: relativePath, group, bytes: buffer.length, sha256: sha256(buffer) };
  });
  const sourceInventorySha256 = sha256(stableJson(sourceFiles));
  const serverText = readSource('backend/server.js');
  const mounts = extractRouteMounts(serverText);
  const endpoints = [];
  for (const mount of mounts) {
    const file = `backend/routes/${mount.module}.js`;
    endpoints.push(...extractRouterEndpoints(readSource(file), mount.basePath, file));
  }
  endpoints.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.method.localeCompare(b.method, 'en'));
  const runtimeFiles = sourceFiles.filter(file => ['backend-runtime'].includes(file.group));
  const writes = runtimeFiles
    .filter(file => /^backend\/(routes|services)\//.test(file.path))
    .flatMap(file => extractSqlWrites(readSource(file.path), file.path));
  const roles = extractUnionValues(readSource('WSSale-App/src/types/index.ts'), 'UserRole');
  const portals = extractUnionValues(readSource('WSSale-App/src/App.tsx'), 'PortalKey');
  const versions = packageVersions();
  const migrationPolicy = config.migrationPolicyFile
    ? readJson(path.join(REPO_ROOT, ...config.migrationPolicyFile.split('/')))
    : {};
  const migrations = migrationSummary(sourceFiles, migrationPolicy);
  const git = gitSnapshot();
  return {
    schemaVersion: 1,
    kind: 'worldfert-source-inventory',
    generatedAt: new Date().toISOString(),
    sourceInventorySha256,
    git,
    summary: {
      fileCount: sourceFiles.length,
      groups: sourceFiles.reduce((acc, file) => { acc[file.group] = (acc[file.group] || 0) + 1; return acc; }, {}),
      packageVersions: versions,
      routeMountCount: mounts.length,
      endpointCount: endpoints.length,
      roleCount: roles.length,
      portalCount: portals.length,
      migrationFileCount: migrations.fileCount,
      latestMigrationSequence: migrations.latestSequence,
      sqlWriteCount: writes.length,
    },
    routeMounts: mounts,
    endpoints,
    roles,
    portals,
    migrations,
    sqlWrites: writes,
    files: sourceFiles,
  };
}

function collectSourceInventory(config = loadConfig()) {
  const first = scanOnce(config);
  const second = scanOnce(config);
  second.scanStable = first.sourceInventorySha256 === second.sourceInventorySha256;
  return second;
}

function loadAcceptedBaseline() {
  return fs.existsSync(ACCEPTED_BASELINE) ? readJson(ACCEPTED_BASELINE) : null;
}

function compareSourceInventories(current, accepted) {
  if (!accepted) {
    return {
      baselineState: 'MISSING',
      summary: { added: current.files.length, modified: 0, removed: 0, unchanged: 0 },
      changes: current.files.map(file => ({ type: 'ADDED', path: file.path, group: file.group })),
    };
  }
  const before = new Map((accepted.files || []).map(file => [file.path, file]));
  const after = new Map(current.files.map(file => [file.path, file]));
  const changes = [];
  let unchanged = 0;
  for (const file of current.files) {
    const previous = before.get(file.path);
    if (!previous) changes.push({ type: 'ADDED', path: file.path, group: file.group });
    else if (previous.sha256 !== file.sha256 || previous.group !== file.group) changes.push({ type: 'MODIFIED', path: file.path, group: file.group });
    else unchanged++;
  }
  for (const file of accepted.files || []) if (!after.has(file.path)) changes.push({ type: 'REMOVED', path: file.path, group: file.group });
  return {
    baselineState: current.sourceInventorySha256 === accepted.sourceInventorySha256 ? 'MATCHED' : 'DRIFTED',
    acceptedSourceInventorySha256: accepted.sourceInventorySha256,
    summary: {
      added: changes.filter(item => item.type === 'ADDED').length,
      modified: changes.filter(item => item.type === 'MODIFIED').length,
      removed: changes.filter(item => item.type === 'REMOVED').length,
      unchanged,
    },
    changes,
  };
}

function documentById(inventory) {
  return new Map(inventory.documents.map(doc => [doc.documentId, doc]));
}

function documentText(doc) {
  if (!doc) return '';
  const file = path.join(ENTERPRISE_ROOT, ...doc.path.split('/'));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
}

function frontMatterValue(text, key) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const line = match[1].split(/\r?\n/).find(value => value.startsWith(key + ':'));
  if (!line) return null;
  const raw = line.slice(line.indexOf(':') + 1).trim();
  const quote = raw.charCodeAt(0);
  if ((quote === 34 || quote === 39) && raw.charCodeAt(raw.length - 1) === quote) return raw.slice(1, -1).trim();
  return raw;
}
function sourceSetsForDocument(doc, config) {
  const override = config.documentOverrides[doc.documentId];
  if (override) return override;
  const rule = config.documentCoverageRules.find(item => doc.path.startsWith(item.prefix));
  return rule ? rule.sourceSets : [];
}

function addGap(gaps, severity, code, message, extra = {}) {
  gaps.push({ severity, code, message, ...extra });
}

function buildAlignmentReport(source, docs, config, accepted, drift) {
  const byId = documentById(docs);
  const candidates = docs.documents.filter(doc => doc.mergeDisposition === 'retained-unique-content' && doc.status === 'Review');
  const mappings = candidates.map(doc => ({
    documentId: doc.documentId,
    path: doc.path,
    sourceSets: sourceSetsForDocument(doc, config),
  }));
  const gaps = [];
  if (!source.scanStable) addGap(gaps, 'ERROR', 'SOURCE_SCAN_UNSTABLE', 'Source files changed while the inventory was being collected.');
  if (!accepted) addGap(gaps, 'WARNING', 'ACCEPTED_SOURCE_BASELINE_MISSING', 'No accepted source inventory exists yet.');
  if (source.git.dirty) addGap(gaps, 'WARNING', 'DIRTY_GIT_WORKTREE', 'Git working tree is dirty; source release-check will fail.');

  const versionValues = [...new Set(source.summary.packageVersions.map(item => item.version).filter(Boolean))];
  if (versionValues.length !== 1) addGap(gaps, 'ERROR', 'PACKAGE_VERSION_MISMATCH', 'Package versions differ: ' + source.summary.packageVersions.map(item => item.file + '=' + item.version).join(', '));
  const currentVersion = versionValues.length === 1 ? versionValues[0] : null;
  for (const id of config.claimDocuments.runtimeVersion || []) {
    const doc = byId.get(id);
    if (!doc || !currentVersion) continue;
    const declared = frontMatterValue(documentText(doc), 'runtimeVersion');
    if (!declared) addGap(gaps, 'WARNING', 'RUNTIME_VERSION_CLAIM_MISSING', id + ' does not declare runtimeVersion in front matter.', { documentId: id, path: doc.path });
    else if (declared.replace(/^v/i, '') !== currentVersion) addGap(gaps, 'WARNING', 'STALE_RUNTIME_VERSION_CLAIM', id + ' declares runtimeVersion ' + declared + ', while packages are ' + currentVersion + '.', { documentId: id, path: doc.path });
  }

  for (const id of config.claimDocuments.migrationBaseline || []) {
    const doc = byId.get(id);
    if (!doc || source.migrations.latestSequence === null) continue;
    const declared = Number(frontMatterValue(documentText(doc), 'sourceMigrationSequence'));
    if (!Number.isInteger(declared)) addGap(gaps, 'WARNING', 'MIGRATION_BASELINE_CLAIM_MISSING', id + ' does not declare an integer sourceMigrationSequence in front matter.', { documentId: id, path: doc.path });
    else if (declared !== source.migrations.latestSequence) addGap(gaps, 'WARNING', 'STALE_MIGRATION_BASELINE', id + ' declares migration sequence ' + declared + ', but source contains sequence ' + source.migrations.latestSequence + '.', { documentId: id, path: doc.path });
  }
  const apiDoc = byId.get((config.claimDocuments.apiContract || [])[0]);
  if (apiDoc) {
    const text = documentText(apiDoc);
    if (/Base:\s*\x60\/api\/v1\x60/i.test(text) && !source.routeMounts.some(item => item.basePath.startsWith('/api/v1'))) {
      addGap(gaps, 'ERROR', 'API_BASE_PATH_CONFLICT', apiDoc.documentId + ' declares /api/v1, but server mounts route modules directly under /api/*.', { documentId: apiDoc.documentId, path: apiDoc.path });
    }
    const tick = String.fromCharCode(96);
    const exact = source.endpoints.filter(endpoint => text.includes(tick + endpoint.path + tick)).length;
    const coverage = source.endpoints.length ? exact / source.endpoints.length : 1;
    if (coverage < 0.8) addGap(gaps, 'WARNING', 'API_ENDPOINT_COVERAGE_GAP', apiDoc.documentId + ' documents ' + exact + '/' + source.endpoints.length + ' exact current endpoint paths.', { documentId: apiDoc.documentId, path: apiDoc.path, exactEndpointCoverage: coverage });
    const snapshot = text.match(/Source inventory:\s*\x60([A-F0-9]{64})\x60/i);
    if (!snapshot) addGap(gaps, 'WARNING', 'API_SOURCE_SNAPSHOT_MISSING', apiDoc.documentId + ' does not identify the source inventory used for its generated endpoint block.', { documentId: apiDoc.documentId, path: apiDoc.path });
    else if (snapshot[1].toUpperCase() !== source.sourceInventorySha256) addGap(gaps, 'WARNING', 'API_SOURCE_SNAPSHOT_STALE', apiDoc.documentId + ' endpoint block was generated from a different source inventory.', { documentId: apiDoc.documentId, path: apiDoc.path });
  }

  const truckscaleWrites = source.sqlWrites.filter(write => /truckscale-db\.js$/i.test(write.file) && !/^wf\./i.test(write.target));
  const truckscaleTargets = [...new Set(truckscaleWrites.map(write => write.target.toLowerCase()))].sort();
  const boundaryDocs = (config.claimDocuments.databaseBoundary || []).map(id => byId.get(id)).filter(Boolean);
  for (const doc of boundaryDocs) {
    if (!truckscaleWrites.length) continue;
    const declared = String(frontMatterValue(documentText(doc), 'truckScaleWriteTargets') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean).sort();
    if (!declared.length) addGap(gaps, 'WARNING', 'TRUCKSCALE_WRITE_BOUNDARY_CLAIM_MISSING', doc.documentId + ' does not declare truckScaleWriteTargets in front matter.', { documentId: doc.documentId, path: doc.path });
    else if (declared.join(',') !== truckscaleTargets.join(',')) addGap(gaps, 'ERROR', 'TRUCKSCALE_WRITE_BOUNDARY_CONFLICT', doc.documentId + ' declares TruckScale write target(s) ' + declared.join(', ') + ', while source writes ' + truckscaleTargets.join(', ') + '.', { documentId: doc.documentId, path: doc.path });
  }
  const dbModule = readSource('backend/db.js');
  const dboWrites = source.sqlWrites.filter(write => /^dbo\./i.test(write.target));
  if (/dbo\s*=\s*READ-ONLY/i.test(dbModule) && dboWrites.length) {
    addGap(gaps, 'ERROR', 'SOURCE_DBO_BOUNDARY_MARKER_CONFLICT', `backend/db.js declares dbo READ-ONLY, but runtime source contains ${dboWrites.length} dbo write statement(s).`, { path: 'backend/db.js' });
  }

  if (source.migrations.unapprovedDuplicates.length) {
    addGap(gaps, 'WARNING', 'UNAPPROVED_DUPLICATE_MIGRATION_SEQUENCE', `Unapproved or changed duplicate migration sequence(s): ${source.migrations.unapprovedDuplicates.map(item => item.sequence).join(', ')}.`, { paths: source.migrations.unapprovedDuplicates.flatMap(item => item.paths) });
  }
  const diagramManifestPath = path.join(REPORT_ROOT, 'source-diagram-manifest.json');
  if (!fs.existsSync(diagramManifestPath)) {
    addGap(gaps, 'WARNING', 'SOURCE_DIAGRAM_MANIFEST_MISSING', 'Source-aligned diagram manifest is missing; run source-diagrams.js after source preflight.');
  } else {
    try {
      const diagramManifest = readJson(diagramManifestPath);
      if (diagramManifest.sourceInventorySha256 !== source.sourceInventorySha256) {
        addGap(gaps, 'WARNING', 'SOURCE_DIAGRAMS_STALE', 'Canonical Mermaid/Draw.io sources were generated from a different source inventory.');
      } else {
        const driftedOutputs = (diagramManifest.outputs || []).filter(output => {
          const outputPath = path.join(ENTERPRISE_ROOT, ...String(output.path || '').split('/'));
          return !fs.existsSync(outputPath) || sha256(fs.readFileSync(outputPath)) !== output.sha256;
        });
        if (driftedOutputs.length) addGap(gaps, 'WARNING', 'SOURCE_DIAGRAM_OUTPUT_DRIFT', `${driftedOutputs.length} canonical diagram source(s) differ from the diagram manifest.`, { paths: driftedOutputs.map(output => output.path) });
      }
    } catch (error) {
      addGap(gaps, 'WARNING', 'SOURCE_DIAGRAM_MANIFEST_INVALID', `Cannot validate source diagram manifest: ${error.message}`);
    }
  }
  const e2eAnalysis = reviewE2eEvidence(config.e2e);
  for (const gap of e2eAnalysis.gaps) addGap(gaps, gap.severity, gap.code, gap.message, gap);
  const unmapped = mappings.filter(item => !item.sourceSets.length);
  if (unmapped.length) addGap(gaps, 'WARNING', 'UNMAPPED_REVIEW_DOCUMENT', `${unmapped.length} review candidate(s) have no source-set mapping.`, { documentIds: unmapped.map(item => item.documentId) });

  const counts = gaps.reduce((acc, gap) => { acc[gap.severity] = (acc[gap.severity] || 0) + 1; return acc; }, {});
  return {
    schemaVersion: 1,
    kind: 'worldfert-source-alignment-report',
    generatedAt: source.generatedAt,
    sourceInventorySha256: source.sourceInventorySha256,
    documentInventorySha256: docs.inventorySha256,
    baselineState: drift.baselineState,
    e2e: e2eAnalysis.review,
    summary: {
      reviewCandidateCount: candidates.length,
      mappedReviewCandidateCount: mappings.length - unmapped.length,
      gapCount: gaps.length,
      counts,
      strictPassed: !gaps.some(gap => ['ERROR', 'WARNING'].includes(gap.severity)),
      passed: !gaps.some(gap => gap.severity === 'ERROR'),
    },
    facts: {
      sourceFileCount: source.summary.fileCount,
      packageVersions: source.summary.packageVersions,
      routeMounts: source.routeMounts,
      endpointCount: source.summary.endpointCount,
      roles: source.roles,
      portals: source.portals,
      migrations: source.migrations,
      dboWrites,
      truckscaleWrites,
    },
    documentMappings: mappings,
    sourceDrift: drift,
    gaps,
  };
}

function analyse(config = loadConfig()) {
  const source = collectSourceInventory(config);
  const docs = DOC_CONTROL.collectInventory(DOC_CONFIG);
  const accepted = loadAcceptedBaseline();
  const drift = compareSourceInventories(source, accepted);
  const alignment = buildAlignmentReport(source, docs, config, accepted, drift);
  return { config, source, docs, accepted, drift, alignment };
}

function escapeCell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderApiMarkdown(source) {
  const lines = [
    '# Extracted API Inventory', '',
    `- Generated: ${source.generatedAt}`,
    `- Source inventory: \`${source.sourceInventorySha256}\``,
    `- Route modules: ${source.summary.routeMountCount}`,
    `- Endpoints: ${source.summary.endpointCount}`, '',
    '| Method | Current path | Source evidence |',
    '|---|---|---|',
  ];
  for (const endpoint of source.endpoints) lines.push(`| ${endpoint.method} | \`${escapeCell(endpoint.path)}\` | \`${escapeCell(endpoint.file)}:${endpoint.line}\` |`);
  return `${lines.join('\n')}\n`;
}

const API_BLOCK_START = '<!-- BEGIN GENERATED:SOURCE-API-INVENTORY -->';
const API_BLOCK_END = '<!-- END GENERATED:SOURCE-API-INVENTORY -->';

function renderApiReferenceBlock(source) {
  const tick = String.fromCharCode(96);
  const lines = [
    API_BLOCK_START,
    '> ส่วนนี้สร้างจาก Express route source โดยอัตโนมัติ ห้ามแก้ตารางด้วยมือ; ให้รัน ' + tick + '../pipeline/source.ps1 sync-api' + tick + ' หลัง route เปลี่ยน', '',
    '- Source inventory: ' + tick + source.sourceInventorySha256 + tick,
    '- Route modules: ' + source.summary.routeMountCount,
    '- Endpoints: ' + source.summary.endpointCount, '',
    '| Method | Current path | Source evidence |',
    '|---|---|---|',
  ];
  for (const endpoint of source.endpoints) lines.push('| ' + escapeCell(endpoint.method) + ' | ' + tick + escapeCell(endpoint.path) + tick + ' | ' + tick + escapeCell(endpoint.file + ':' + endpoint.line) + tick + ' |');
  lines.push('', API_BLOCK_END);
  return lines.join('\n');
}

function replaceGeneratedBlock(text, startMarker, endMarker, replacement) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) throw new Error('Generated block markers are missing or invalid: ' + startMarker);
  const after = end + endMarker.length;
  return text.slice(0, start) + replacement + text.slice(after);
}

function syncApiReference(source) {
  if (!source.scanStable) throw new Error('Source changed during scan; API reference was not modified.');
  const file = path.join(ENTERPRISE_ROOT, '04-DATA-INTEGRATION', 'API-REFERENCE.md');
  const before = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const after = replaceGeneratedBlock(before, API_BLOCK_START, API_BLOCK_END, renderApiReferenceBlock(source));
  if (after === before) {
    console.log('API Reference generated block is already current.');
    return false;
  }
  atomicWrite(file, after);
  console.log('Synchronized API Reference from ' + source.sourceInventorySha256 + '.');
  return true;
}
function renderDataBoundaryMarkdown(source) {
  const dboWrites = source.sqlWrites.filter(write => /^dbo\./i.test(write.target));
  const truckscaleWrites = source.sqlWrites.filter(write => /truckscale-db\.js$/i.test(write.file) && !/^wf\./i.test(write.target));
  const lines = [
    '# Extracted Data Write Boundary', '',
    `- Generated: ${source.generatedAt}`,
    `- Source inventory: \`${source.sourceInventorySha256}\``,
    `- Migration files: ${source.migrations.fileCount}; latest numeric sequence: ${source.migrations.latestSequence}`,
    `- Runtime dbo writes: ${dboWrites.length}`,
    `- TruckScale writes: ${truckscaleWrites.length}`, '',
    '| Boundary | Operation | Target | Source evidence |',
    '|---|---|---|---|',
  ];
  for (const write of [...dboWrites, ...truckscaleWrites]) {
    const boundary = /^dbo\./i.test(write.target) ? 'WINSpeed dbo' : 'TruckScale MySQL';
    lines.push(`| ${boundary} | ${escapeCell(write.operation)} | \`${escapeCell(write.target)}\` | \`${escapeCell(write.file)}:${write.line}\` |`);
  }
  if (!dboWrites.length && !truckscaleWrites.length) lines.push('| - | - | - | No external-boundary writes detected |');
  lines.push('', '## Duplicate migration sequences', '', '| Sequence | Files |', '|---|---|');
  for (const duplicate of source.migrations.duplicates) lines.push(`| ${duplicate.sequence} | ${escapeCell(duplicate.paths.join('<br/>'))} |`);
  if (!source.migrations.duplicates.length) lines.push('| - | None |');
  return `${lines.join('\n')}\n`;
}

function renderUiMarkdown(source) {
  const lines = [
    '# Extracted UI and RBAC Inventory', '',
    `- Generated: ${source.generatedAt}`,
    `- Source inventory: \`${source.sourceInventorySha256}\``,
    `- Portal keys: ${source.portals.length}`,
    `- Roles: ${source.roles.length}`, '',
    '## Roles', '',
    ...source.roles.map(role => `- \`${role}\``), '',
    '## Portal keys', '',
    ...source.portals.map(portal => `- \`${portal}\``), '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderAlignmentMarkdown(report) {
  const lines = [
    '# Source Code ↔ Documentation Alignment', '',
    `- Generated: ${report.generatedAt}`,
    `- Source inventory: \`${report.sourceInventorySha256}\``,
    `- Source baseline: **${report.baselineState}**`,
    `- Review candidates mapped: ${report.summary.mappedReviewCandidateCount}/${report.summary.reviewCandidateCount}`,
    `- Gaps: ${report.summary.gapCount} (ERROR ${report.summary.counts.ERROR || 0}, WARNING ${report.summary.counts.WARNING || 0})`,
    `- E2E evidence: **${report.e2e.evidenceStatus || report.e2e.status}** — ${report.e2e.evidenceReviewed ? 'reviewed and source-bound' : 'not accepted'}`, '',
    '## Current source facts', '',
    `- Packages: ${report.facts.packageVersions.map(item => `${item.file}=${item.version}`).join(', ')}`,
    `- API surface: ${report.facts.routeMounts.length} mounted route modules / ${report.facts.endpointCount} endpoints`,
    `- Frontend: ${report.facts.portals.length} portal keys / ${report.facts.roles.length} roles`,
    `- Migrations: ${report.facts.migrations.fileCount} files; latest numeric sequence ${report.facts.migrations.latestSequence}`,
    `- Runtime SQL writes: dbo=${report.facts.dboWrites.length}, TruckScale=${report.facts.truckscaleWrites.length}`, '',
    '## Gaps requiring review', '',
    '| Severity | Code | Document / path | Finding |',
    '|---|---|---|---|',
  ];
  for (const gap of report.gaps) lines.push(`| ${escapeCell(gap.severity)} | ${escapeCell(gap.code)} | ${escapeCell(gap.documentId || gap.path || '-')} | ${escapeCell(gap.message)} |`);
  if (!report.gaps.length) lines.push('| - | - | - | No source/document gaps detected |');
  lines.push('', '## Review-candidate source mapping', '', '| Document ID | File | Source sets |', '|---|---|---|');
  for (const mapping of report.documentMappings) lines.push(`| ${escapeCell(mapping.documentId)} | ${escapeCell(mapping.path)} | ${escapeCell(mapping.sourceSets.join(', '))} |`);
  lines.push('', '## E2E evidence', '', report.e2e.note, '',
    `- Policy: **${report.e2e.status}**`,
    `- Evidence: **${report.e2e.evidenceStatus || 'missing'}**`,
    `- Reviewed: **${report.e2e.evidenceReviewed ? 'yes' : 'no'}**`,
    `- Evidence file: \`${report.e2e.evidencePath || '-'}\``,
    `- Completed: ${report.e2e.completedAt || '-'}`,
    `- Tests: ${report.e2e.counts ? `${report.e2e.counts.passed}/${report.e2e.counts.total} passed` : '-'}`,
    `- Source/test hashes: ${report.e2e.sourceHashFileCount}`, '',
    ...report.e2e.specFiles.map(file => `- \`${file}\``), '');
  return `${lines.join('\n')}\n`;
}

function renderDriftMarkdown(source, drift) {
  const lines = [
    '# Source Inventory Drift', '',
    `- Generated: ${source.generatedAt}`,
    `- State: **${drift.baselineState}**`,
    `- Current SHA-256: \`${source.sourceInventorySha256}\``,
    `- Added: ${drift.summary.added}; modified: ${drift.summary.modified}; removed: ${drift.summary.removed}; unchanged: ${drift.summary.unchanged}`, '',
    '| Change | Source set | File |', '|---|---|---|',
  ];
  for (const change of drift.changes) lines.push(`| ${change.type} | ${escapeCell(change.group)} | ${escapeCell(change.path)} |`);
  if (!drift.changes.length) lines.push('| - | - | No drift |');
  return `${lines.join('\n')}\n`;
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, content) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, file);
}

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReports(command, analysis) {
  ensureDirectory(REPORT_ROOT);
  writeJson(path.join(REPORT_ROOT, 'source-inventory.json'), analysis.source);
  writeJson(path.join(REPORT_ROOT, 'source-drift-report.json'), { generatedAt: analysis.source.generatedAt, sourceInventorySha256: analysis.source.sourceInventorySha256, ...analysis.drift });
  atomicWrite(path.join(REPORT_ROOT, 'source-drift-report.md'), renderDriftMarkdown(analysis.source, analysis.drift));
  writeJson(path.join(REPORT_ROOT, 'source-alignment-report.json'), analysis.alignment);
  atomicWrite(path.join(REPORT_ROOT, 'source-alignment-report.md'), renderAlignmentMarkdown(analysis.alignment));
  atomicWrite(path.join(REPORT_ROOT, 'source-api-inventory.md'), renderApiMarkdown(analysis.source));
  atomicWrite(path.join(REPORT_ROOT, 'source-data-boundary-report.md'), renderDataBoundaryMarkdown(analysis.source));
  atomicWrite(path.join(REPORT_ROOT, 'source-ui-rbac-inventory.md'), renderUiMarkdown(analysis.source));
  atomicWrite(path.join(REPORT_ROOT, 'source-last-command.txt'), `${new Date().toISOString()} ${command} ${analysis.source.sourceInventorySha256}\n`);
}

function parseArgs(argv) {
  const options = { command: argv[2] || 'preflight', strict: false, noWrite: false, actor: '', reason: '' };
  for (let index = 3; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--no-write') options.noWrite = true;
    else if (arg === '--actor') options.actor = argv[++index] || '';
    else if (arg === '--reason') options.reason = argv[++index] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printSummary(analysis) {
  const counts = analysis.alignment.summary.counts;
  console.log('WorldFert Source Alignment');
  console.log(`  source files      : ${analysis.source.summary.fileCount}`);
  console.log(`  source SHA256     : ${analysis.source.sourceInventorySha256}`);
  console.log(`  scan stable       : ${analysis.source.scanStable ? 'yes' : 'NO'}`);
  console.log(`  source baseline   : ${analysis.drift.baselineState}`);
  console.log(`  API               : ${analysis.source.summary.routeMountCount} mounts / ${analysis.source.summary.endpointCount} endpoints`);
  console.log(`  UI                : ${analysis.source.summary.portalCount} portals / ${analysis.source.summary.roleCount} roles`);
  console.log(`  migrations        : ${analysis.source.summary.migrationFileCount} files / latest ${analysis.source.summary.latestMigrationSequence}`);
  console.log(`  review mapping    : ${analysis.alignment.summary.mappedReviewCandidateCount}/${analysis.alignment.summary.reviewCandidateCount}`);
  console.log(`  gaps              : ${counts.ERROR || 0} error(s), ${counts.WARNING || 0} warning(s)`);
  console.log(`  E2E evidence      : ${analysis.alignment.e2e.evidenceStatus || analysis.alignment.e2e.status} (reviewed=${analysis.alignment.e2e.evidenceReviewed ? 'yes' : 'no'})`);
}

function acceptanceBlockingGaps(alignment) {
  const allowed = new Set(['ACCEPTED_SOURCE_BASELINE_MISSING', 'DIRTY_GIT_WORKTREE']);
  return alignment.gaps.filter(gap => gap.severity === 'ERROR' || (gap.severity === 'WARNING' && !allowed.has(gap.code)));
}

function acceptBaseline(analysis, options) {
  if (!options.actor.trim() || !options.reason.trim()) throw new Error('Source baseline acceptance requires --actor and --reason.');
  const blockers = acceptanceBlockingGaps(analysis.alignment);
  if (blockers.length) throw new Error(`Source baseline acceptance blocked by ${blockers.map(item => item.code).join(', ')}`);
  const accepted = { ...analysis.source, acceptedAt: new Date().toISOString(), acceptedBy: options.actor.trim(), acceptanceReason: options.reason.trim() };
  ensureDirectory(BASELINE_ROOT);
  writeJson(ACCEPTED_BASELINE, accepted);
  const stamp = accepted.acceptedAt.replace(/[:.]/g, '-');
  writeJson(path.join(BASELINE_ROOT, 'history', `${stamp}-${accepted.sourceInventorySha256.slice(0, 12)}-source.json`), accepted);
  console.log(`Accepted source baseline ${accepted.sourceInventorySha256}`);
}

function releaseCheck(analysis) {
  const reasons = [];
  if (!analysis.accepted) reasons.push('accepted source baseline is missing');
  else if (analysis.drift.baselineState !== 'MATCHED') reasons.push(`${analysis.drift.changes.length} unaccepted source change(s)`);
  if (!analysis.alignment.summary.strictPassed) reasons.push(`${analysis.alignment.summary.gapCount} source-alignment gap(s)`);
  if (!analysis.source.git.commit) reasons.push('source commit is unavailable');
  if (analysis.source.git.dirty) reasons.push('Git working tree is dirty');
  if (reasons.length) throw new Error(`Source release check failed: ${reasons.join('; ')}`);
  console.log(`Source release check passed: ${analysis.source.sourceInventorySha256}`);
}

function main() {
  try {
    const options = parseArgs(process.argv);
    const supported = new Set(['scan', 'impact', 'validate', 'preflight', 'status', 'accept', 'release-check', 'sync-api']);
    if (!supported.has(options.command)) throw new Error('Unsupported command: ' + options.command);
    let analysis = analyse();
    printSummary(analysis);
    if (options.command === 'sync-api') {
      if (options.noWrite) console.log('No-write: API Reference was not modified.');
      else syncApiReference(analysis.source);
      analysis = analyse();
      if (!options.noWrite) writeReports(options.command, analysis);
      printSummary(analysis);
      return;
    }
    if (options.command === 'accept') return acceptBaseline(analysis, options);
    if (options.command === 'release-check') return releaseCheck(analysis);
    if (!options.noWrite && options.command !== 'status') writeReports(options.command, analysis);
    if (['validate', 'preflight'].includes(options.command)) {
      const failed = options.strict ? !analysis.alignment.summary.strictPassed : !analysis.alignment.summary.passed;
      if (failed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  slash,
  sha256,
  stableJson,
  extractRouteMounts,
  extractRouterEndpoints,
  extractUnionValues,
  extractSqlWrites,
  frontMatterValue,
  migrationSummary,
  compareSourceInventories,
  reviewE2eEvidence,
  buildAlignmentReport,
  acceptanceBlockingGaps,
  renderApiReferenceBlock,
  replaceGeneratedBlock,
};
