'use strict';

// Explicit database targets; never silently fall back to another database.
// onprem = the office SQL Server that WINSpeed uses, reached from the Ubuntu VM (see onprem-target.js)
const VALID_TARGETS = Object.freeze(['local', 'remote', 'remote_b', 'local_uat', 'local_rehearsal', 'onprem']);

function validateTarget(value) {
  const target = String(value).trim().toLowerCase();
  if (!VALID_TARGETS.includes(target)) {
    throw new Error(`Unsupported DB target: ${target}. Use ${VALID_TARGETS.join(', ')}`);
  }
  return target;
}

function requestTarget(header, defaultTarget, production) {
  if (process.env.LOCAL_ONLY_MODE === 'true') {
    if (defaultTarget !== 'local_uat' || (header && validateTarget(header) !== 'local_uat')) throw new Error('LOCAL_ONLY_MODE prohibits database switching');
    return 'local_uat';
  }
  if (!header) return defaultTarget;
  const target = validateTarget(header);
  if (production && target !== defaultTarget) {
    throw new Error('Database switching is disabled in production');
  }
  return target;
}

module.exports = { VALID_TARGETS, validateTarget, requestTarget };
