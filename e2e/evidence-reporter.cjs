const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = process.cwd();
const rel = value => path.relative(root, value).replaceAll('\\', '/');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : (entry.isFile() ? [absolute] : []);
  });
}

function collectTrackedFiles(policy, repoRoot = root) {
  const selected = new Set([...(policy.requiredEvidenceFiles || []), ...(policy.requiredSpecs || [])]);
  for (const trackedRoot of policy.trackedRoots || []) {
    const absoluteRoot = path.join(repoRoot, trackedRoot.root);
    const excludedPatterns = (trackedRoot.excludeNamePatterns || []).map(pattern => new RegExp(pattern, 'i'));
    for (const absolute of walkFiles(absoluteRoot)) {
      const relativeToRoot = path.relative(absoluteRoot, absolute).replaceAll('\\', '/');
      if ((trackedRoot.excludePrefixes || []).some(prefix => relativeToRoot.startsWith(prefix))) continue;
      if (excludedPatterns.some(pattern => pattern.test(path.basename(absolute)))) continue;
      if (trackedRoot.extensions && !trackedRoot.extensions.includes(path.extname(absolute).toLowerCase())) continue;
      selected.add(rel(absolute));
    }
  }
  return [...selected].sort();
}

class EvidenceReporter {
  constructor() {
    this.startedAt = null;
    this.tests = new Map();
    this.selected = [];
  }

  onBegin(config, suite) {
    this.startedAt = new Date();
    this.config = config;
    const policyPath = path.join(root, 'e2e/evidence.config.json');
    this.policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    this.trackedFiles = collectTrackedFiles(this.policy);
    this.startFileHashes = Object.fromEntries(this.trackedFiles.map(file => {
      const absolute = path.join(root, file);
      return [file, fs.existsSync(absolute) ? sha256(absolute) : null];
    }));
    try {
      this.startGitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch { this.startGitCommit = null; }
    this.selected = suite.allTests().map(test => ({
      id: test.id,
      file: rel(test.location.file),
      line: test.location.line,
      title: test.titlePath().slice(1).join(' > '),
      project: test.parent?.project()?.name || null,
    }));
  }

  onTestEnd(test, result) {
    this.tests.set(test.id, {
      id: test.id,
      file: rel(test.location.file),
      line: test.location.line,
      title: test.titlePath().slice(1).join(' > '),
      expectedStatus: test.expectedStatus,
      status: result.status,
      outcome: test.outcome(),
      retry: result.retry,
      durationMs: result.duration,
      errors: result.errors.map(error => ({ message: error.message || String(error), stack: error.stack || null })),
      attachments: result.attachments.map(attachment => ({
        name: attachment.name,
        contentType: attachment.contentType,
        path: attachment.path ? rel(attachment.path) : null,
      })),
      annotations: test.annotations,
    });
  }

  async onEnd(result) {
    const completedAt = new Date();
    const policy = this.policy;
    const tests = this.selected.map(item => this.tests.get(item.id) || { ...item, status: 'not-run', outcome: 'unexpected' });
    const selectedSpecs = [...new Set(this.selected.map(test => test.file))].sort();
    const missingSpecs = policy.requiredSpecs.filter(spec => !selectedSpecs.includes(spec));
    const counts = { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0, notRun: 0 };
    for (const test of tests) {
      if (test.outcome === 'flaky') counts.flaky += 1;
      if (test.status === 'passed') counts.passed += 1;
      else if (test.status === 'skipped') counts.skipped += 1;
      else if (test.status === 'timedOut') counts.timedOut += 1;
      else if (test.status === 'interrupted') counts.interrupted += 1;
      else if (test.status === 'not-run') counts.notRun += 1;
      else counts.failed += 1;
    }

    const fileHashes = Object.fromEntries(this.trackedFiles.map(file => {
      const absolute = path.join(root, file);
      return [file, fs.existsSync(absolute) ? sha256(absolute) : null];
    }));
    let git = { commit: null, dirty: null };
    try {
      git = {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
      };
    } catch { /* evidence remains useful outside git */ }
    let environment = null;
    const environmentPath = path.join(root, 'test-results/environment.json');
    if (fs.existsSync(environmentPath)) environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
    const changedFiles = this.trackedFiles.filter(file => this.startFileHashes[file] !== fileHashes[file]);
    const sourceStability = {
      stable: changedFiles.length === 0 && (!this.startGitCommit || !git.commit || this.startGitCommit === git.commit),
      startGitCommit: this.startGitCommit,
      endGitCommit: git.commit,
      changedFiles,
    };

    const complete = result.status === 'passed'
      && sourceStability.stable
      && counts.total >= policy.minimumTestCount
      && missingSpecs.length === 0
      && counts.failed === 0
      && counts.flaky === 0
      && counts.skipped === 0
      && counts.timedOut === 0
      && counts.interrupted === 0
      && counts.notRun === 0;
    const evidence = {
      schemaVersion: 2,
      kind: 'WS-Sale-App Playwright E2E Evidence',
      runId: this.startedAt.toISOString().replace(/[:.]/g, '-'),
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt - this.startedAt,
      status: complete ? 'PASSED_COMPLETE' : 'INCOMPLETE_OR_FAILED',
      playwrightStatus: result.status,
      complete,
      policy,
      coverage: { selectedSpecs, missingSpecs, selectedTestCount: counts.total },
      counts,
      environment,
      git,
      sourceStability,
      fileHashes,
      tests,
    };
    const output = path.join(root, 'test-results/e2e-evidence.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[evidence] ${evidence.status}: ${rel(output)}`);
  }
}

module.exports = EvidenceReporter;
module.exports.collectTrackedFiles = collectTrackedFiles;
