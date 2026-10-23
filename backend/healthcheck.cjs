'use strict';

const http = require('node:http');

const HEALTH_URL = 'http://127.0.0.1:3000/api/health';
const MAX_RESPONSE_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 8000;

function isHealthyResponse(statusCode, body) {
  if (statusCode !== 200 || typeof body !== 'string') return false;
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed?.db?.sqlserver === 'up';
  } catch {
    return false;
  }
}

function runHealthCheck({ get = http.get, setTimer = setTimeout, clearTimer = clearTimeout, setExitCode = code => { process.exitCode = code; } } = {}) {
  let settled = false;
  let response = '';
  let request;
  let timer;

  const finish = healthy => {
    if (settled) return;
    settled = true;
    if (timer) clearTimer(timer);
    setExitCode(healthy ? 0 : 1);
    if (!healthy && request && !request.destroyed) request.destroy();
  };

  try {
    request = get(HEALTH_URL, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        response += chunk;
        if (Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_BYTES) finish(false);
      });
      res.on('end', () => finish(isHealthyResponse(res.statusCode, response)));
      res.on('error', () => finish(false));
    });
    request.on('error', () => finish(false));
    timer = setTimer(() => finish(false), REQUEST_TIMEOUT_MS);
  } catch {
    finish(false);
  }
  return { finish };
}

if (require.main === module) runHealthCheck();

module.exports = { HEALTH_URL, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, isHealthyResponse, runHealthCheck };
