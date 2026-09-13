'use strict';

// `remote` is the SQL-auth connection inside Docker, never a provider default.
const VALID_TARGETS = Object.freeze(['local', 'remote', 'remote_b']);

function validateTarget(value) {
  const target = String(value).trim().toLowerCase();
  if (!VALID_TARGETS.includes(target)) {
    throw new Error(`Unsupported DB target: ${target}. Use ${VALID_TARGETS.join(', ')}`);
  }
  return target;
}

function requestTarget(header, defaultTarget, production) {
  if (!header) return defaultTarget;
  const target = validateTarget(header);
  if (production && target !== defaultTarget) {
    throw new Error('Database switching is disabled in production');
  }
  return target;
}

module.exports = { VALID_TARGETS, validateTarget, requestTarget };
