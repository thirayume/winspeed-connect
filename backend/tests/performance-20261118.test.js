'use strict';
// 18 Nov 2026: the dashboard looked locked; the counts query timed out at 30 s on a cached plan that ran in 0.3 s
// when planned for the actual values. Heavy list and dashboard reads now ask for a fresh plan, and the dashboard
// caches answer with the last value while one background read refreshes it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createReadCache } = require('../services/read-cache');

test('an expired entry is served at once while one background load refreshes it', async () => {
  const cache = createReadCache();
  let loads = 0;
  let release;
  const slow = () => { loads += 1; return new Promise(r => { release = r; }); };
  const first = cache.get('k', async () => { loads += 1; return 'v1'; }, { ttl: 1, staleMs: 60000 });
  assert.equal(await first, 'v1');
  await new Promise(r => setTimeout(r, 5));
  const a = await cache.get('k', slow, { ttl: 60000, staleMs: 60000 });
  const b = await cache.get('k', slow, { ttl: 60000, staleMs: 60000 });
  assert.equal(a, 'v1');
  assert.equal(b, 'v1');
  assert.equal(loads, 2, 'one background refresh, not one per reader');
  release('v2');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await cache.get('k', slow, { ttl: 60000, staleMs: 60000 }), 'v2');
});

test('a failed background refresh keeps the last value; force still waits for a fresh load', async () => {
  const cache = createReadCache();
  await cache.get('k', async () => 'v1', { ttl: 1, staleMs: 60000 });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await cache.get('k', async () => { throw new Error('timeout'); }, { ttl: 1, staleMs: 60000 }), 'v1');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await cache.get('k', async () => 'fresh', { force: true, staleMs: 60000 }), 'fresh');
});

test('without staleMs an expired entry is loaded again before answering (unchanged behaviour)', async () => {
  const cache = createReadCache();
  await cache.get('k', async () => 'v1', { ttl: 1 });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await cache.get('k', async () => 'v2', { ttl: 1 }), 'v2');
});

test('the dashboard counts, the bill list and the document board ask SQL Server for a fresh plan', () => {
  const so = fs.readFileSync(path.join(__dirname, '..', 'routes', 'so.js'), 'utf8');
  const board = fs.readFileSync(path.join(__dirname, '..', 'routes', 'papertrail.js'), 'utf8');
  assert.match(so, /GROUP BY Status\s+--[^\n]*\n\s+OPTION \(RECOMPILE\)`, inputs\);/);
  assert.equal((so.match(/OPTION \(RECOMPILE\)/g) || []).length, 3);
  assert.equal((board.match(/OPTION \(RECOMPILE\)/g) || []).length, 1);
  assert.match(so, /force: bust, staleMs: DASHBOARD_STALE_MS/);
});
