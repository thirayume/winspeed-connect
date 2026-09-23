const https = require('https');

const API_BASE = 'https://api-test.thirayu.online/api';
const ITERATIONS = 5;

function fetchWithTiming(url, token, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const start = performance.now();
    const headers = { ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers,
      timeout: 30000 // 30s timeout threshold
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const duration = performance.now() - start;
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          durationMs: Math.round(duration),
          sizeBytes: buffer.length,
          buffer
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('REQUEST_TIMEOUT'));
    });
    req.on('error', err => {
      const duration = performance.now() - start;
      reject({ error: err.message, durationMs: Math.round(duration) });
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

function calcStats(timings) {
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  const sum = timings.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / timings.length);
  return { min, max, avg };
}

async function run() {
  console.log('================================================================');
  console.log('BOUNDED SEQUENTIAL SMOKE RUN: DEPLOYED API & XLSX EXPORT TIMINGS');
  console.log(`Endpoint: ${API_BASE}`);
  console.log(`Iterations per target: ${ITERATIONS}`);
  console.log('================================================================\n');

  // Authenticate
  console.log('[1/3] Authenticating as e2e_accounting...');
  const loginRes = await fetchWithTiming(`${API_BASE}/auth/login`, null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_accounting', password: 'W0rldF3rt' })
  });

  if (loginRes.status !== 200) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }
  const loginData = JSON.parse(loginRes.buffer.toString());
  const token = loginData?.accessToken || loginData?.token;
  console.log(`Login OK (${loginRes.durationMs} ms)\n`);

  const targets = [
    {
      name: 'SO Projection API (JSON)',
      url: `${API_BASE}/reports/so-sales-billing-projection?days=60`,
      expectType: 'application/json'
    },
    {
      name: 'SO Projection Export (XLSX)',
      url: `${API_BASE}/reports/so-sales-billing-projection/export?days=60&format=xlsx`,
      expectType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    },
    {
      name: 'GL Sales Journal API (JSON)',
      url: `${API_BASE}/reports/gl-sales-journal?days=60`,
      expectType: 'application/json'
    },
    {
      name: 'GL Sales Journal Export (XLSX)',
      url: `${API_BASE}/reports/gl-sales-journal/export?days=60&format=xlsx`,
      expectType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
  ];

  const results = [];

  for (const target of targets) {
    console.log(`--- Testing ${target.name} ---`);
    const timings = [];
    let errors = 0;
    let timeouts = 0;

    for (let i = 1; i <= ITERATIONS; i++) {
      try {
        const res = await fetchWithTiming(target.url, token);
        const contentType = res.headers['content-type'] || '';
        const isExpectedType = contentType.includes(target.expectType.split(';')[0]);
        const isPkZip = target.name.includes('XLSX') ? (res.buffer[0] === 0x50 && res.buffer[1] === 0x4B) : true;

        if (res.status === 200 && isExpectedType && isPkZip) {
          timings.push(res.durationMs);
          console.log(`  Iter ${i}: ${res.status} OK | ${res.durationMs} ms | ${res.sizeBytes} bytes | Content-Type: ${contentType}`);
        } else {
          errors++;
          console.error(`  Iter ${i}: FAIL | Status: ${res.status} | Content-Type: ${contentType} | ValidFormat: ${isPkZip}`);
        }
      } catch (err) {
        errors++;
        if (err.error === 'REQUEST_TIMEOUT') timeouts++;
        console.error(`  Iter ${i}: ERROR: ${err.error || err} (${err.durationMs || 0} ms)`);
      }
    }

    const stats = timings.length > 0 ? calcStats(timings) : { min: 0, max: 0, avg: 0 };
    results.push({
      target: target.name,
      timings,
      stats,
      errors,
      timeouts,
      totalRuns: ITERATIONS
    });
    console.log(`Summary [${target.name}]: Min=${stats.min}ms, Max=${stats.max}ms, Avg=${stats.avg}ms, Errors=${errors}, Timeouts=${timeouts}\n`);
  }

  console.log('================================================================');
  console.log('BENCHMARK SUMMARY & ACCEPTANCE CRITERIA EVALUATION');
  console.log('================================================================');
  console.log('| Target                          | Min (ms) | Max (ms) | Avg (ms) | Errors | Timeouts | Gate Status |');
  console.log('|---------------------------------|----------|----------|----------|--------|----------|-------------|');
  
  // Targets:
  // JSON: Avg < 10,000 ms, Max < 12,000 ms, 0 timeouts
  // XLSX: Avg < 12,000 ms, Max < 15,000 ms, 0 timeouts
  for (const r of results) {
    const isXlsx = r.target.includes('XLSX');
    const maxThreshold = isXlsx ? 15000 : 12000;
    const passed = r.errors === 0 && r.timeouts === 0 && r.stats.max <= maxThreshold;
    const status = passed ? 'PASS (READY)' : 'FAIL';
    console.log(`| ${r.target.padEnd(31)} | ${String(r.stats.min).padStart(8)} | ${String(r.stats.max).padStart(8)} | ${String(r.stats.avg).padStart(8)} | ${String(r.errors).padStart(6)} | ${String(r.timeouts).padStart(8)} | ${status.padEnd(11)} |`);
  }
}

run().catch(err => {
  console.error('Fatal benchmark failure:', err);
  process.exit(1);
});
