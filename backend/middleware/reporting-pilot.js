'use strict';

/**
 * reporting-pilot.js — Enforce Read-Only Boundary for Reporting Pilot
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides server-side enforcement for Scope A (Reporting Pilot).
 * When active (via dedicated role REPORT_PILOT, X-Reporting-Pilot header, or
 * REPORTING_PILOT_ENFORCED env flag), only read-only report/reconciliation queries,
 * exports, master metadata, and authentication/session operations are permitted.
 *
 * All business mutation endpoints (including POST /api/recon/:soId/resolve,
 * SO/trip/coupon/rebate/admin mutations) are rejected with fail-closed HTTP 403.
 *
 * Normal TEST workflows outside pilot scope remain 100% operational.
 */

const jwt = require('jsonwebtoken');
const { SECRET } = require('./auth');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Narrowly scoped authentication/session write endpoints permitted in pilot scope
// Includes password change so users with mustChangePassword are not locked out
const ALLOWED_AUTH_MUTATIONS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/profile/password',
  '/api/auth/profile',
]);

function extractUser(req) {
  if (req.user) return req.user;
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

/**
 * Server-owned pilot scope resolution:
 * Never trusts client headers (e.g. X-Reporting-Pilot).
 * Determined strictly by:
 * 1. Instance-wide environment flag: REPORTING_PILOT_ENFORCED=true
 * 2. Server-assigned role in JWT: REPORT_PILOT
 * 3. Server-assigned claim in JWT: isPilot === true
 * 4. Server-configured pilot usernames: REPORTING_PILOT_USERNAMES
 */
function isPilotScope(req) {
  if (String(process.env.REPORTING_PILOT_ENFORCED || '').toLowerCase() === 'true') {
    return true;
  }
  const user = extractUser(req);
  if (!user) return false;
  const role = String(user.role || user.Role || '').toUpperCase();
  if (role === 'REPORT_PILOT' || user.isPilot === true) {
    return true;
  }
  const pilotUsers = (process.env.REPORTING_PILOT_USERNAMES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const username = String(user.username || user.Username || '').toLowerCase();
  if (pilotUsers.length > 0 && username && pilotUsers.includes(username)) {
    return true;
  }
  return false;
}

function reportingPilotBoundary(req, res, next) {
  if (!isPilotScope(req)) {
    return next();
  }

  const method = req.method.toUpperCase();
  const urlPath = (req.originalUrl || req.url || req.path).split('?')[0];

  // 1. Allow safe read-only requests (GET, HEAD, OPTIONS)
  if (!WRITE_METHODS.has(method)) {
    return next();
  }

  // 2. Allow narrowly scoped session / authentication endpoints
  if (ALLOWED_AUTH_MUTATIONS.has(urlPath)) {
    return next();
  }

  // 3. Deny all business mutations with explicit structured 403
  return res.status(403).json({
    code: 'REPORTING_PILOT_READ_ONLY',
    message: 'Reporting Pilot is strictly read-only: business mutation endpoints are disabled in pilot scope',
    method,
    path: urlPath,
  });
}

module.exports = {
  reportingPilotBoundary,
  isPilotScope,
  ALLOWED_AUTH_MUTATIONS,
};
