#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const PIPELINE_ROOT = __dirname;
const ENTERPRISE_ROOT = path.resolve(PIPELINE_ROOT, '..');
const CONFIG_PATH = path.join(PIPELINE_ROOT, 'doc-control.config.json');
const REPORT_ROOT = path.join(PIPELINE_ROOT, 'reports');
const BASELINE_ROOT = path.join(PIPELINE_ROOT, 'baselines');
const ACCEPTED_BASELINE = path.join(BASELINE_ROOT, 'accepted-document-inventory.json');

const SEVERITY_ORDER = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

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

function slash(value) {
  return value.split(path.sep).join('/').normalize('NFC');
}

function cleanText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*>\s*/, '')
    .trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadConfig() {
  return readJson(CONFIG_PATH);
}

function execGit(repoRoot, args) {
  try {
    return childProcess.execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function findRepoRoot() {
  const found = execGit(ENTERPRISE_ROOT, ['rev-parse', '--show-toplevel']);
  return found ? path.resolve(found) : path.resolve(ENTERPRISE_ROOT, '..', '..');
}

function isExcluded(relativePath, config) {
  const rel = slash(relativePath);
  if ((config.excludeFiles || []).includes(rel)) return true;
  return (config.excludePrefixes || []).some(prefix => rel.startsWith(slash(prefix)));
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function listDocumentPaths(config) {
  const extensions = new Set((config.documentExtensions || ['.md']).map(x => x.toLowerCase()));
  return walkFiles(ENTERPRISE_ROOT)
    .filter(file => extensions.has(path.extname(file).toLowerCase()))
    .map(file => slash(path.relative(ENTERPRISE_ROOT, file)))
    .filter(rel => !isExcluded(rel, config))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function listControlPaths(config) {
  const extensions = new Set((config.controlFileExtensions || []).map(x => x.toLowerCase()));
  const prefixes = (config.controlFilePrefixes || []).map(slash);
  return walkFiles(ENTERPRISE_ROOT)
    .map(file => slash(path.relative(ENTERPRISE_ROOT, file)))
    .filter(rel => !isExcluded(rel, config))
    .filter(rel => prefixes.some(prefix => rel.startsWith(prefix)))
    .filter(rel => extensions.has(path.extname(rel).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en'));
}
function parseScalar(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const items = [];
    let token = '';
    let quote = '';
    for (let index = 0; index < inner.length; index += 1) {
      const character = inner[index];
      if (quote) {
        token += character;
        if (character === quote && inner[index - 1] !== '\\') quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
        token += character;
      } else if (character === ',') {
        items.push(parseScalar(token));
        token = '';
      } else {
        token += character;
      }
    }
    items.push(parseScalar(token));
    return items.filter(item => item !== '');
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseFrontMatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: text, raw: '' };
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { data: {}, body: text, raw: '' };
  const raw = normalized.slice(4, end);
  const data = {};
  let currentList = null;
  for (const line of raw.split('\n')) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentList) {
      data[currentList].push(parseScalar(listMatch[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    if (!rawValue.trim()) {
      data[key] = [];
      currentList = key;
    } else {
      data[key] = parseScalar(rawValue);
      currentList = null;
    }
  }
  return { data, body: normalized.slice(end + 5), raw };
}

function tableValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]*?)\\s*\\|\\s*$`, 'im'));
  return match ? cleanText(match[1]) : '';
}

function inlineField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*:\\s*([^·\\r\\n]+)`, 'i'));
  return match ? cleanText(match[1]) : '';
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeStatus(value, allowedStatuses) {
  const clean = cleanText(value);
  const matched = allowedStatuses.find(status => clean.toLowerCase().startsWith(status.toLowerCase()));
  return matched || clean;
}

function parseMetadata(text, relativePath, config) {
  const front = parseFrontMatter(text);
  const heading = front.body.match(/^#\s+(.+)$/m);
  const legacyId = (() => {
    const backtick = text.match(/Document ID[^\r\n`]*`([^`]+)`/i);
    return backtick ? backtick[1].trim() : tableValue(text, 'Document ID');
  })();
  const versionText = front.data.version || tableValue(text, 'Version') || inlineField(text, 'Version');
  const versionMatch = String(versionText || '').match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?/i);
  const statusText = front.data.status || tableValue(text, 'Status') || inlineField(text, 'Status');
  const documentId = cleanText(front.data.documentId || front.data.documentID || legacyId);
  const title = cleanText(front.data.title || (heading ? heading[1] : ''));
  const normative = typeof front.data.normative === 'boolean'
    ? front.data.normative
    : (config.normativePrefixes || []).some(prefix => relativePath.startsWith(slash(prefix)));

  return {
    documentId: documentId || `PATH:${relativePath}`,
    syntheticId: !documentId,
    title,
    version: versionMatch ? versionMatch[0] : cleanText(versionText),
    status: normalizeStatus(statusText, config.allowedStatuses || []),
    statusRaw: cleanText(statusText),
    statusDetail: cleanText(front.data.statusDetail),
    sourceVersion: cleanText(front.data.sourceVersion),
    mergePolicy: cleanText(front.data.mergePolicy),
    mergeDisposition: cleanText(front.data.mergeDisposition),
    supersededBy: cleanText(front.data.supersededBy),
    mergedAt: cleanText(front.data.mergedAt),
    owner: cleanText(front.data.owner || tableValue(text, 'Owner') || inlineField(text, 'Owner')),
    normative,
    sourceRefs: normalizeArray(front.data.sourceRefs),
    dependsOn: normalizeArray(front.data.dependsOn),
    outputs: normalizeArray(front.data.outputs),
    frontMatter: Object.keys(front.data).length > 0,
    body: front.body,
  };
}

function gitSnapshot(repoRoot) {
  const statusText = execGit(repoRoot, ['status', '--porcelain=v1']);
  const status = statusText ? statusText.split(/\r?\n/).filter(Boolean) : [];
  return {
    repoRoot: slash(repoRoot),
    commit: execGit(repoRoot, ['rev-parse', 'HEAD']),
    branch: execGit(repoRoot, ['branch', '--show-current']),
    dirty: status.length > 0,
    status,
  };
}

function versionCohorts(documents, config) {
  const releaseStatuses = new Set(config.releaseVersionStatuses || ['Review', 'Approved', 'Released']);
  const versions = [...new Set(documents.map(doc => doc.version).filter(Boolean))].sort();
  const activeVersions = [...new Set(documents.filter(doc => releaseStatuses.has(doc.status)).map(doc => doc.version).filter(Boolean))].sort();
  const historicalVersions = [...new Set(documents.filter(doc => !releaseStatuses.has(doc.status)).map(doc => doc.version).filter(Boolean))].sort();
  return { versions, activeVersions, historicalVersions };
}
function collectInventory(config = loadConfig()) {
  const repoRoot = findRepoRoot();
  const beforePaths = listDocumentPaths(config);
  const beforeControlPaths = listControlPaths(config);
  const concurrentChanges = [];
  const documents = [];

  for (const relativePath of beforePaths) {
    const fullPath = path.join(ENTERPRISE_ROOT, ...relativePath.split('/'));
    const before = fs.statSync(fullPath);
    const buffer = fs.readFileSync(fullPath);
    const after = fs.statSync(fullPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      concurrentChanges.push({ path: relativePath, reason: 'FILE_CHANGED_DURING_READ' });
    }
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const metadata = parseMetadata(text, relativePath, config);
    const metadataForHash = {
      documentId: metadata.documentId,
      title: metadata.title,
      version: metadata.version,
      status: metadata.status,
      statusDetail: metadata.statusDetail,
      sourceVersion: metadata.sourceVersion,
      mergePolicy: metadata.mergePolicy,
      mergeDisposition: metadata.mergeDisposition,
      supersededBy: metadata.supersededBy,
      mergedAt: metadata.mergedAt,
      owner: metadata.owner,
      normative: metadata.normative,
      sourceRefs: metadata.sourceRefs,
      dependsOn: metadata.dependsOn,
      outputs: metadata.outputs,
    };
    documents.push({
      documentId: metadata.documentId,
      syntheticId: metadata.syntheticId,
      path: relativePath,
      title: metadata.title,
      version: metadata.version,
      status: metadata.status,
      statusRaw: metadata.statusRaw,
      statusDetail: metadata.statusDetail,
      sourceVersion: metadata.sourceVersion,
      mergePolicy: metadata.mergePolicy,
      mergeDisposition: metadata.mergeDisposition,
      supersededBy: metadata.supersededBy,
      mergedAt: metadata.mergedAt,
      owner: metadata.owner,
      normative: metadata.normative,
      sourceRefs: metadata.sourceRefs,
      dependsOn: metadata.dependsOn,
      outputs: metadata.outputs,
      frontMatter: metadata.frontMatter,
      bytes: buffer.length,
      sha256: sha256(buffer),
      bodySha256: sha256(metadata.body.replace(/\r\n/g, '\n')),
      metadataSha256: sha256(stableJson(metadataForHash)),
      modifiedTimeUtc: after.mtime.toISOString(),
    });
  }

  const controlFiles = beforeControlPaths.map(relativePath => {
    const fullPath = path.join(ENTERPRISE_ROOT, ...relativePath.split('/'));
    const before = fs.statSync(fullPath);
    const buffer = fs.readFileSync(fullPath);
    const after = fs.statSync(fullPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      concurrentChanges.push({ path: relativePath, reason: 'CONTROL_FILE_CHANGED_DURING_READ' });
    }
    return {
      kind: 'control-file',
      documentId: `CONTROL:${relativePath}`,
      path: relativePath,
      normative: true,
      bytes: buffer.length,
      sha256: sha256(buffer),
      modifiedTimeUtc: after.mtime.toISOString(),
    };
  });
  const afterPaths = listDocumentPaths(config);
  if (stableJson(beforePaths) !== stableJson(afterPaths)) {
    concurrentChanges.push({
      reason: 'DOCUMENT_LIST_CHANGED_DURING_SCAN',
      before: beforePaths,
      after: afterPaths,
    });
  }

  const afterControlPaths = listControlPaths(config);
  if (stableJson(beforeControlPaths) !== stableJson(afterControlPaths)) {
    concurrentChanges.push({
      reason: 'CONTROL_FILE_LIST_CHANGED_DURING_SCAN',
      before: beforeControlPaths,
      after: afterControlPaths,
    });
  }
  documents.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const identity = documents.map(doc => ({
    documentId: doc.documentId,
    path: doc.path,
    sha256: doc.sha256,
    metadataSha256: doc.metadataSha256,
  }));
  const controlIdentity = controlFiles.map(file => ({
    path: file.path,
    sha256: file.sha256,
  }));
  const cohorts = versionCohorts(documents, config);
  const statuses = documents.reduce((acc, doc) => {
    const key = doc.status || '(missing)';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: 1,
    kind: 'worldfert-document-inventory',
    generatedAt: new Date().toISOString(),
    enterpriseRoot: slash(ENTERPRISE_ROOT),
    configSha256: sha256(fs.readFileSync(CONFIG_PATH)),
    source: gitSnapshot(repoRoot),
    scanStable: concurrentChanges.length === 0,
    concurrentChanges,
    summary: {
      documentCount: documents.length,
      controlFileCount: controlFiles.length,
      syntheticIdCount: documents.filter(doc => doc.syntheticId).length,
      normativeCount: documents.filter(doc => doc.normative).length,
      versions: cohorts.versions,
      activeVersions: cohorts.activeVersions,
      historicalVersions: cohorts.historicalVersions,
      statuses,
    },
    inventorySha256: sha256(stableJson({ documents: identity, controlFiles: controlIdentity })),
    documents,
    controlFiles,
  };
}

function loadAcceptedBaseline() {
  if (!fs.existsSync(ACCEPTED_BASELINE)) return null;
  return readJson(ACCEPTED_BASELINE);
}

function changeRecord(types, before, after, detection) {
  return {
    kind: after?.kind || before?.kind || 'document',
    types: [...new Set(types)],
    documentId: after?.documentId || before?.documentId || '',
    beforePath: before?.path || null,
    afterPath: after?.path || null,
    beforeSha256: before?.sha256 || null,
    afterSha256: after?.sha256 || null,
    normative: Boolean(after?.normative ?? before?.normative),
    detection,
  };
}

function compareInventories(current, accepted) {
  if (!accepted) {
    const changes = current.documents.map(doc => changeRecord(['ADDED'], null, doc, 'NO_ACCEPTED_BASELINE'));
    for (const file of current.controlFiles || []) {
      changes.push(changeRecord(['CONTROL_FILE_ADDED'], null, file, 'NO_ACCEPTED_BASELINE'));
    }
    return buildChangeReport(current, null, changes, 'MISSING');
  }

  const previousDocs = accepted.documents || [];
  const currentDocs = current.documents || [];
  const usedPrevious = new Set();
  const usedCurrent = new Set();
  const changes = [];

  const previousIdGroups = groupBy(previousDocs, doc => doc.documentId);
  const currentIdGroups = groupBy(currentDocs, doc => doc.documentId);

  for (let ci = 0; ci < currentDocs.length; ci += 1) {
    const now = currentDocs[ci];
    if (now.syntheticId) continue;
    const beforeGroup = previousIdGroups.get(now.documentId) || [];
    const nowGroup = currentIdGroups.get(now.documentId) || [];
    if (beforeGroup.length !== 1 || nowGroup.length !== 1) continue;
    const pi = previousDocs.indexOf(beforeGroup[0]);
    pairDocuments(previousDocs[pi], now, pi, ci, 'DOCUMENT_ID', usedPrevious, usedCurrent, changes);
  }

  for (let ci = 0; ci < currentDocs.length; ci += 1) {
    if (usedCurrent.has(ci)) continue;
    const now = currentDocs[ci];
    const pi = previousDocs.findIndex((before, index) => !usedPrevious.has(index) && before.path === now.path);
    if (pi < 0) continue;
    const before = previousDocs[pi];
    const types = before.documentId !== now.documentId ? ['DOCUMENT_ID_CHANGED'] : [];
    pairDocuments(before, now, pi, ci, 'PATH', usedPrevious, usedCurrent, changes, types);
  }

  for (let ci = 0; ci < currentDocs.length; ci += 1) {
    if (usedCurrent.has(ci)) continue;
    const now = currentDocs[ci];
    const pi = previousDocs.findIndex((before, index) => !usedPrevious.has(index) && before.sha256 === now.sha256);
    if (pi < 0) continue;
    pairDocuments(previousDocs[pi], now, pi, ci, 'CONTENT_HASH', usedPrevious, usedCurrent, changes, ['RENAMED']);
  }

  for (let ci = 0; ci < currentDocs.length; ci += 1) {
    if (!usedCurrent.has(ci)) changes.push(changeRecord(['ADDED'], null, currentDocs[ci], 'UNMATCHED_CURRENT'));
  }
  for (let pi = 0; pi < previousDocs.length; pi += 1) {
    if (!usedPrevious.has(pi)) changes.push(changeRecord(['REMOVED'], previousDocs[pi], null, 'UNMATCHED_BASELINE'));
  }

  const previousControlFiles = accepted.controlFiles || [];
  const currentControlFiles = current.controlFiles || [];
  const previousControlByPath = new Map(previousControlFiles.map(file => [file.path, file]));
  const currentControlByPath = new Map(currentControlFiles.map(file => [file.path, file]));
  for (const now of currentControlFiles) {
    const before = previousControlByPath.get(now.path);
    if (!before) changes.push(changeRecord(['CONTROL_FILE_ADDED'], null, now, 'CONTROL_PATH'));
    else if (before.sha256 !== now.sha256) changes.push(changeRecord(['CONTROL_FILE_MODIFIED'], before, now, 'CONTROL_PATH'));
  }
  for (const before of previousControlFiles) {
    if (!currentControlByPath.has(before.path)) changes.push(changeRecord(['CONTROL_FILE_REMOVED'], before, null, 'CONTROL_PATH'));
  }
  return buildChangeReport(current, accepted, changes, 'AVAILABLE');
}

function groupBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function pairDocuments(before, after, pi, ci, detection, usedPrevious, usedCurrent, changes, initialTypes = []) {
  const types = [...initialTypes];
  if (before.path !== after.path) types.push('RENAMED');
  if (before.sha256 !== after.sha256) types.push('MODIFIED');
  if (before.metadataSha256 !== after.metadataSha256) types.push('METADATA_MODIFIED');
  usedPrevious.add(pi);
  usedCurrent.add(ci);
  if (types.length) changes.push(changeRecord(types, before, after, detection));
}

function buildChangeReport(current, accepted, changes, baselineState) {
  const counts = {};
  for (const change of changes) {
    for (const type of change.types) counts[type] = (counts[type] || 0) + 1;
  }
  changes.sort((a, b) => (a.afterPath || a.beforePath || '').localeCompare(b.afterPath || b.beforePath || '', 'en'));
  return {
    schemaVersion: 1,
    kind: 'worldfert-document-change-report',
    generatedAt: current.generatedAt,
    baselineState,
    acceptedInventorySha256: accepted?.inventorySha256 || null,
    currentInventorySha256: current.inventorySha256,
    hasChanges: changes.length > 0,
    summary: { changeCount: changes.length, counts },
    changes,
  };
}

function maxSeverity(a, b) {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

function ruleForPath(relativePath, config) {
  const rules = (config.impactRules || [])
    .filter(rule => relativePath.startsWith(slash(rule.prefix)))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return rules[0] || { severity: 'LOW', artifacts: ['document-index'], reviewers: ['Document Owner'] };
}

function buildImpactReport(changeReport, config) {
  const impactedArtifacts = new Set();
  const reviewers = new Set();
  const severityCounts = {};
  const impacts = changeReport.changes.map(change => {
    const relativePath = change.afterPath || change.beforePath || '';
    const rule = ruleForPath(relativePath, config);
    let severity = rule.severity || 'LOW';
    const reasons = [`Matched policy prefix: ${rule.prefix || '(default)'}`];
    const controlChange = change.types.some(type => type.startsWith('CONTROL_FILE_'));
    if (controlChange) {
      severity = maxSeverity(severity, change.types.includes('CONTROL_FILE_REMOVED') ? 'CRITICAL' : 'HIGH');
      reasons.push('Documentation control/generation source changed; generated outputs and policy must be reviewed.');
    }    if (change.types.includes('ADDED')) {
      severity = maxSeverity(severity, 'MEDIUM');
      reasons.push('New document must be registered and assigned to outputs.');
    }
    if (change.types.includes('REMOVED')) {
      severity = maxSeverity(severity, change.normative ? 'CRITICAL' : 'HIGH');
      reasons.push(change.normative
        ? 'Normative document removal requires explicit replacement or retirement approval.'
        : 'Document removal requires link, index and retention review.');
    }
    if (change.types.includes('DOCUMENT_ID_CHANGED')) {
      severity = maxSeverity(severity, 'HIGH');
      reasons.push('Stable document identity changed.');
    }
    if (change.types.includes('RENAMED')) {
      severity = maxSeverity(severity, 'MEDIUM');
      reasons.push('Path changed; references and generated composition may be affected.');
    }
    if (/(SRS|ADR|API|SECURITY|UAT|TRACEABILITY|ACCEPTANCE|DATA-DESIGN|BUSINESS-RULES|DOCUMENT-CONTROL)/i.test(relativePath)) {
      severity = maxSeverity(severity, 'HIGH');
      reasons.push('High-impact controlled document name matched.');
    }
    const artifacts = [...new Set(rule.artifacts || ['document-index'])];
    const requiredReviewers = [...new Set(rule.reviewers || ['Document Owner'])];
    artifacts.forEach(item => impactedArtifacts.add(item));
    requiredReviewers.forEach(item => reviewers.add(item));
    severityCounts[severity] = (severityCounts[severity] || 0) + 1;
    return { ...change, severity, artifacts, requiredReviewers, reasons };
  });

  const overallSeverity = impacts.reduce((value, item) => maxSeverity(value, item.severity), 'INFO');
  return {
    schemaVersion: 1,
    kind: 'worldfert-document-impact-report',
    generatedAt: changeReport.generatedAt,
    baselineState: changeReport.baselineState,
    overallSeverity,
    reviewRequired: impacts.some(item => SEVERITY_ORDER[item.severity] >= SEVERITY_ORDER.MEDIUM),
    summary: {
      impactedDocumentCount: impacts.length,
      severityCounts,
      impactedArtifacts: [...impactedArtifacts].sort(),
      requiredReviewers: [...reviewers].sort(),
    },
    impacts,
  };
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function validateInventory(inventory, config, accepted) {
  const issues = [];
  const add = (severity, code, doc, message, line = null) => issues.push({
    severity,
    code,
    documentId: doc?.documentId || null,
    path: doc?.path || null,
    line,
    message,
  });
  const allowedStatuses = config.allowedStatuses || [];
  const byId = groupBy(inventory.documents.filter(doc => !doc.syntheticId), doc => doc.documentId);
  for (const [documentId, docs] of byId.entries()) {
    if (docs.length > 1) {
      docs.forEach(doc => add('ERROR', 'DUPLICATE_DOCUMENT_ID', doc, `Document ID ${documentId} is used by ${docs.length} files.`));
    }
  }

  const knownIds = new Set(inventory.documents.filter(doc => !doc.syntheticId).map(doc => doc.documentId));
  const repoRoot = inventory.source.repoRoot ? path.resolve(inventory.source.repoRoot) : findRepoRoot();

  for (const doc of inventory.documents) {
    const fullPath = path.join(ENTERPRISE_ROOT, ...doc.path.split('/'));
    const text = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
    if (doc.syntheticId) add('WARNING', 'MISSING_DOCUMENT_ID', doc, 'Add a stable documentId; path identity cannot reliably detect moves with content edits.');
    if (!doc.title) add('WARNING', 'MISSING_TITLE', doc, 'Document has no title in front matter or H1 heading.');
    if (!doc.owner) add('WARNING', 'MISSING_OWNER', doc, 'Document has no accountable owner metadata.');
    if (doc.normative && !doc.frontMatter) add('WARNING', 'MISSING_FRONT_MATTER', doc, 'Normative documents must use controlled YAML front matter.');
    if (!doc.version) add('WARNING', 'MISSING_VERSION', doc, 'Document has no version metadata.');
    if (!doc.status) add('WARNING', 'MISSING_STATUS', doc, 'Document has no lifecycle status metadata.');
    else if (!allowedStatuses.includes(doc.status)) add('WARNING', 'INVALID_STATUS', doc, `Status "${doc.statusRaw || doc.status}" is not one of: ${allowedStatuses.join(', ')}.`);
    if (doc.normative && (config.unapprovedNormativeStatuses || ['Draft', 'Review']).includes(doc.status)) {
      add('WARNING', 'UNAPPROVED_NORMATIVE_DOCUMENT', doc, `Normative document is ${doc.status}; approval is required before baseline acceptance.`);
    }
    if (doc.status === 'Superseded') {
      if (!doc.supersededBy) add('ERROR', 'SUPERSESSION_TARGET_MISSING', doc, 'Superseded document must identify supersededBy.');
      else if (!knownIds.has(doc.supersededBy)) add('ERROR', 'UNKNOWN_SUPERSESSION_TARGET', doc, `supersededBy references unknown document ID: ${doc.supersededBy}`);
    }
    if (doc.sourceVersion && !doc.mergePolicy) add('WARNING', 'MERGE_POLICY_MISSING', doc, 'Merged document with sourceVersion must declare mergePolicy.');
    if (doc.mergeDisposition === 'retained-unique-content' && !doc.sourceVersion) add('ERROR', 'MERGE_SOURCE_VERSION_MISSING', doc, 'Retained merge content must declare sourceVersion.');

    for (const dependency of doc.dependsOn || []) {
      if (!knownIds.has(dependency)) add('ERROR', 'UNKNOWN_DOCUMENT_DEPENDENCY', doc, `dependsOn references unknown document ID: ${dependency}`);
    }
    for (const sourceRef of doc.sourceRefs || []) {
      const sourcePath = path.resolve(repoRoot, ...String(sourceRef).replace(/\\/g, '/').split('/'));
      if (!fs.existsSync(sourcePath)) add('ERROR', 'MISSING_SOURCE_REFERENCE', doc, `sourceRefs path does not exist: ${sourceRef}`);
    }

    const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
      let target = match[1].trim();
      if (/^(https?:\/\/|mailto:|data:|#)/i.test(target)) continue;
      target = target.split('#')[0].trim().replace(/^<|>$/g, '');
      if (!target) continue;
      try { target = decodeURIComponent(target); } catch { /* keep original */ }
      const resolved = path.resolve(path.dirname(fullPath), ...target.replace(/\\/g, '/').split('/'));
      if (!fs.existsSync(resolved)) {
        add('ERROR', 'BROKEN_LOCAL_LINK', doc, `Local link target does not exist: ${match[1]}`, lineNumberAt(text, match.index));
      }
    }

    const mojibake = /เน€|โ€”|เธ[ก-๛]เธ|เธ™|เนˆ|เน‰|เธญ/g;
    const firstMojibake = mojibake.exec(text);
    if (firstMojibake) {
      const affectedLines = text.split(/\r?\n/).filter(line => /เน€|โ€”|เธ[ก-๛]เธ|เธ™|เนˆ|เน‰|เธญ/.test(line)).length;
      add('ERROR', 'MOJIBAKE_DETECTED', doc, `Probable broken Thai encoding detected on ${affectedLines} line(s).`, lineNumberAt(text, firstMojibake.index));
    }
  }

  if (!inventory.scanStable) add('ERROR', 'CONCURRENT_DOCUMENT_CHANGE', null, 'Document files changed while inventory was being collected; rerun the scan.');
  if (!accepted) add('WARNING', 'ACCEPTED_BASELINE_MISSING', null, 'No accepted document inventory exists yet.');
  if (inventory.source.dirty) add('WARNING', 'DIRTY_GIT_WORKTREE', null, 'Git working tree is dirty; release-check will fail.');
  if ((inventory.summary.activeVersions || []).length > 1) {
    add('WARNING', 'MIXED_ACTIVE_DOCUMENT_VERSIONS', null, `Multiple active/review document versions are present: ${inventory.summary.activeVersions.join(', ')}`);
  }

  issues.sort((a, b) => {
    const severityDelta = (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
    if (severityDelta) return severityDelta;
    return `${a.path || ''}:${a.line || 0}:${a.code}`.localeCompare(`${b.path || ''}:${b.line || 0}:${b.code}`, 'en');
  });
  const counts = issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    schemaVersion: 1,
    kind: 'worldfert-document-validation-report',
    generatedAt: inventory.generatedAt,
    inventorySha256: inventory.inventorySha256,
    baselineState: accepted ? 'AVAILABLE' : 'MISSING',
    passed: !issues.some(issue => issue.severity === 'ERROR'),
    strictPassed: issues.length === 0,
    summary: { issueCount: issues.length, counts },
    issues,
  };
}

function buildMergeReport(inventory) {
  const records = inventory.documents
    .filter(doc => doc.sourceVersion || doc.mergeDisposition || doc.supersededBy)
    .map(doc => ({
      documentId: doc.documentId,
      path: doc.path,
      version: doc.version,
      status: doc.status,
      sourceVersion: doc.sourceVersion || null,
      mergePolicy: doc.mergePolicy || null,
      mergeDisposition: doc.mergeDisposition || null,
      supersededBy: doc.supersededBy || null,
      mergedAt: doc.mergedAt || null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const dispositions = records.reduce((acc, record) => {
    const key = record.mergeDisposition || '(unspecified)';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    schemaVersion: 1,
    kind: 'worldfert-document-merge-report',
    generatedAt: inventory.generatedAt,
    inventorySha256: inventory.inventorySha256,
    policy: "latest-document-wins",
    summary: {
      recordCount: records.length,
      supersededCount: records.filter(record => record.status === 'Superseded').length,
      reviewCount: records.filter(record => record.status === 'Review').length,
      dispositions,
      activeVersions: inventory.summary.activeVersions || [],
      historicalVersions: inventory.summary.historicalVersions || [],
    },
    records,
  };
}
function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderChangeMarkdown(report) {
  const lines = [
    '# Document Change Report', '',
    `- Generated: ${report.generatedAt}`,
    `- Baseline: ${report.baselineState}`,
    `- Current inventory: \`${report.currentInventorySha256}\``,
    `- Changes: ${report.summary.changeCount}`, '',
    '| Change | Document ID | Before | After | Detection |',
    '|---|---|---|---|---|',
  ];
  for (const change of report.changes) {
    lines.push(`| ${escapeCell(change.types.join(' + '))} | ${escapeCell(change.documentId)} | ${escapeCell(change.beforePath || '-')} | ${escapeCell(change.afterPath || '-')} | ${escapeCell(change.detection)} |`);
  }
  if (!report.changes.length) lines.push('| No changes | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}

function renderImpactMarkdown(report) {
  const lines = [
    '# Document Change Impact Report', '',
    `- Generated: ${report.generatedAt}`,
    `- Overall severity: **${report.overallSeverity}**`,
    `- Review required: ${report.reviewRequired ? 'Yes' : 'No'}`,
    `- Impacted artefacts: ${report.summary.impactedArtifacts.join(', ') || '-'}`,
    `- Required reviewers: ${report.summary.requiredReviewers.join(', ') || '-'}`, '',
    '| Severity | Change | Document | Impacted artefacts | Reviewers |',
    '|---|---|---|---|---|',
  ];
  for (const impact of report.impacts) {
    lines.push(`| ${impact.severity} | ${escapeCell(impact.types.join(' + '))} | ${escapeCell(impact.afterPath || impact.beforePath)} | ${escapeCell(impact.artifacts.join(', '))} | ${escapeCell(impact.requiredReviewers.join(', '))} |`);
  }
  if (!report.impacts.length) lines.push('| INFO | No changes | - | - | - |');
  return `${lines.join('\n')}\n`;
}

function renderValidationMarkdown(report) {
  const lines = [
    '# Document Validation Report', '',
    `- Generated: ${report.generatedAt}`,
    `- Passed: ${report.passed ? 'Yes' : 'No'}`,
    `- Strict passed: ${report.strictPassed ? 'Yes' : 'No'}`,
    `- Issues: ${report.summary.issueCount}`, '',
    '| Severity | Code | File | Line | Message |',
    '|---|---|---|---:|---|',
  ];
  for (const issue of report.issues) {
    lines.push(`| ${issue.severity} | ${issue.code} | ${escapeCell(issue.path || '-')} | ${issue.line || '-'} | ${escapeCell(issue.message)} |`);
  }
  if (!report.issues.length) lines.push('| INFO | OK | - | - | No issues found |');
  return `${lines.join('\n')}\n`;
}

function renderMergeMarkdown(report) {
  const lines = [
    '# Document Merge and Conflict Review', '',
    `- Generated: ${report.generatedAt}`,
    `- Policy: **${report.policy}**`,
    `- Merge records: ${report.summary.recordCount}`,
    `- Superseded by latest: ${report.summary.supersededCount}`,
    `- Retained for review: ${report.summary.reviewCount}`,
    `- Active versions: ${report.summary.activeVersions.join(' ') || '-'}`,
    `- Historical/draft versions: ${report.summary.historicalVersions.join(' ') || '-'}`, '',
    '| Document ID | File | Current version/status | Source version | Disposition | Superseded by |',
    '|---|---|---|---|---|---|',
  ];
  for (const record of report.records) {
    lines.push(`| ${escapeCell(record.documentId)} | ${escapeCell(record.path)} | ${escapeCell(`${record.version} / ${record.status}`)} | ${escapeCell(record.sourceVersion || '-')} | ${escapeCell(record.mergeDisposition || '-')} | ${escapeCell(record.supersededBy || '-')} |`);
  }
  if (!report.records.length) lines.push('| - | No merge records | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}
function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, content) {
  ensureDirectory(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReports(command, analysis) {
  ensureDirectory(REPORT_ROOT);
  writeJson(path.join(REPORT_ROOT, 'document-inventory.json'), analysis.inventory);
  writeJson(path.join(REPORT_ROOT, 'document-change-report.json'), analysis.changes);
  atomicWrite(path.join(REPORT_ROOT, 'document-change-report.md'), renderChangeMarkdown(analysis.changes));
  writeJson(path.join(REPORT_ROOT, 'document-merge-report.json'), analysis.merge);
  atomicWrite(path.join(REPORT_ROOT, 'document-merge-report.md'), renderMergeMarkdown(analysis.merge));
  if (['impact', 'validate', 'preflight'].includes(command)) {
    writeJson(path.join(REPORT_ROOT, 'document-impact-report.json'), analysis.impact);
    atomicWrite(path.join(REPORT_ROOT, 'document-impact-report.md'), renderImpactMarkdown(analysis.impact));
  }
  if (['validate', 'preflight'].includes(command)) {
    writeJson(path.join(REPORT_ROOT, 'document-validation-report.json'), analysis.validation);
    atomicWrite(path.join(REPORT_ROOT, 'document-validation-report.md'), renderValidationMarkdown(analysis.validation));
  }
}

function analyse() {
  const config = loadConfig();
  const accepted = loadAcceptedBaseline();
  const inventory = collectInventory(config);
  const changes = compareInventories(inventory, accepted);
  const impact = buildImpactReport(changes, config);
  const merge = buildMergeReport(inventory);
  const validation = validateInventory(inventory, config, accepted);
  return { config, accepted, inventory, changes, impact, merge, validation };
}

function parseArgs(argv) {
  const options = { command: argv[2] || 'preflight', strict: false, noWrite: false, actor: '', reason: '' };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--no-write') options.noWrite = true;
    else if (arg === '--actor') options.actor = argv[++i] || '';
    else if (arg === '--reason') options.reason = argv[++i] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printSummary(analysis) {
  const { inventory, changes, impact, validation } = analysis;
  console.log('WorldFert Documentation Control');
  console.log(`  documents        : ${inventory.summary.documentCount}`);
  console.log(`  control files     : ${inventory.summary.controlFileCount}`);
  console.log(`  inventory SHA256 : ${inventory.inventorySha256}`);
  console.log(`  scan stable      : ${inventory.scanStable ? 'yes' : 'NO'}`);
  console.log(`  accepted baseline: ${changes.baselineState}`);
  console.log(`  changes          : ${changes.summary.changeCount}`);
  console.log(`  impact severity  : ${impact.overallSeverity}`);
  console.log(`  merge records    : ${analysis.merge.summary.recordCount}`);
  console.log(`  validation       : ${validation.summary.counts.ERROR || 0} error(s), ${validation.summary.counts.WARNING || 0} warning(s)`);
  console.log(`  git              : ${inventory.source.commit || '(not found)'}${inventory.source.dirty ? ' (dirty)' : ' (clean)'}`);
}

function acceptanceBlockingIssues(validation) {
  const allowedInitialWarnings = new Set(['ACCEPTED_BASELINE_MISSING', 'DIRTY_GIT_WORKTREE']);
  return validation.issues.filter(issue => issue.severity === 'ERROR' || !allowedInitialWarnings.has(issue.code));
}

function acceptBaseline(analysis, options) {
  if (!options.actor.trim() || !options.reason.trim()) {
    throw new Error('accept requires both --actor and --reason.');
  }
  const blockingIssues = acceptanceBlockingIssues(analysis.validation);
  if (blockingIssues.length) {
    const codes = [...new Set(blockingIssues.map(issue => issue.code))].join(', ');
    throw new Error(`Cannot accept an inventory with ${blockingIssues.length} blocking validation issue(s): ${codes}.`);
  }
  if (!analysis.inventory.scanStable) throw new Error('Cannot accept a baseline collected during concurrent document changes.');
  const accepted = {
    ...analysis.inventory,
    acceptedAt: new Date().toISOString(),
    acceptedBy: options.actor.trim(),
    acceptanceReason: options.reason.trim(),
  };
  const stamp = accepted.acceptedAt.replace(/[:.]/g, '-');
  const history = path.join(BASELINE_ROOT, 'history', `${stamp}-${accepted.inventorySha256.slice(0, 12)}.json`);
  writeJson(history, accepted);
  writeJson(ACCEPTED_BASELINE, accepted);
  console.log(`Accepted baseline: ${accepted.inventorySha256}`);
  console.log(`  actor : ${accepted.acceptedBy}`);
  console.log(`  reason: ${accepted.acceptanceReason}`);
}

function releaseCheck(analysis) {
  const failures = [];
  if (!analysis.accepted) failures.push('accepted baseline is missing');
  if (analysis.changes.hasChanges) failures.push(`${analysis.changes.summary.changeCount} unaccepted document change(s)`);
  if (!analysis.validation.strictPassed) failures.push(`${analysis.validation.summary.issueCount} validation issue(s)`);
  if (!analysis.inventory.scanStable) failures.push('documents changed during scan');
  if (!analysis.inventory.source.commit) failures.push('Git commit cannot be resolved');
  if (analysis.inventory.source.dirty) failures.push('Git working tree is dirty');
  if (failures.length) throw new Error(`Release check failed: ${failures.join('; ')}`);
  console.log(`Release check passed: ${analysis.inventory.inventorySha256}`);
}

function main() {
  try {
    const options = parseArgs(process.argv);
    const supported = new Set(['scan', 'impact', 'validate', 'preflight', 'status', 'accept', 'release-check']);
    if (!supported.has(options.command)) throw new Error(`Unsupported command: ${options.command}`);
    const analysis = analyse();
    printSummary(analysis);

    if (options.command === 'accept') {
      acceptBaseline(analysis, options);
      return;
    }
    if (options.command === 'release-check') {
      releaseCheck(analysis);
      return;
    }
    if (!options.noWrite && options.command !== 'status') writeReports(options.command, analysis);

    if (['validate', 'preflight'].includes(options.command)) {
      const failed = options.strict ? !analysis.validation.strictPassed : !analysis.validation.passed;
      if (failed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseFrontMatter,
  parseMetadata,
  compareInventories,
  buildImpactReport,
  validateInventory,
  collectInventory,
  stableJson,
  sha256,
  acceptanceBlockingIssues,
  versionCohorts,
  buildMergeReport,
};
