'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { isHealthyResponse, runHealthCheck, MAX_RESPONSE_BYTES } = require('../healthcheck.cjs');

test('health endpoint must report SQL up, not merely return HTTP 200', () => {
  assert.equal(isHealthyResponse(200, JSON.stringify({ db: { sqlserver: 'up' } })), true);
  assert.equal(isHealthyResponse(200, JSON.stringify({ db: { sqlserver: 'down' } })), false);
  assert.equal(isHealthyResponse(503, JSON.stringify({ db: { sqlserver: 'up' } })), false);
});

test('health response rejects malformed, missing, or oversized payloads', () => {
  assert.equal(isHealthyResponse(200, '{'), false);
  assert.equal(isHealthyResponse(200, JSON.stringify({ status: 'ok' })), false);
  assert.equal(isHealthyResponse(200, 'x'.repeat(MAX_RESPONSE_BYTES + 1)), false);
});

test('health probe succeeds only for a bounded HTTP response with SQL up', () => {
  let exitCode;
  let responseHandler;
  let timerHandler;
  let cleared = false;
  const request = new EventEmitter();
  request.destroyed = false;
  request.destroy = () => { request.destroyed = true; };
  const response = new EventEmitter();
  response.statusCode = 200;
  response.setEncoding = () => {};

  runHealthCheck({
    get: (_url, handler) => { responseHandler = handler; return request; },
    setTimer: handler => { timerHandler = handler; return 1; },
    clearTimer: () => { cleared = true; },
    setExitCode: code => { exitCode = code; },
  });
  responseHandler(response);
  response.emit('data', JSON.stringify({ db: { sqlserver: 'up' } }));
  response.emit('end');
  timerHandler();

  assert.equal(exitCode, 0);
  assert.equal(cleared, true);
  assert.equal(request.destroyed, false);
});

test('health probe fails closed and destroys only its timed-out request', () => {
  let exitCode;
  let timerHandler;
  const request = new EventEmitter();
  request.destroyed = false;
  request.destroy = () => { request.destroyed = true; };

  runHealthCheck({
    get: () => request,
    setTimer: handler => { timerHandler = handler; return 1; },
    clearTimer: () => {},
    setExitCode: code => { exitCode = code; },
  });
  timerHandler();

  assert.equal(exitCode, 1);
  assert.equal(request.destroyed, true);
});
