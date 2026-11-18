'use strict';

// Validation primitive only. The request guard remains in place until the
// repository, audited editing, business-ID translation and audit are wired.
function invalid() {
  throw Object.assign(new Error('IDENTITY_BINDING_INVALID'), { code: 'IDENTITY_BINDING_INVALID', status: 409 });
}
function id(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function active(value) { return value === true || value === 1; }
function text(value) { return value == null ? '' : String(value).trim(); }
function sameLocation(a, b) { return Boolean(text(a)) && text(a).toLowerCase() === text(b).toLowerCase(); }

function validateReviewedBinding({ binding, primary, target, primaryServer, primaryDatabase, targetServer, targetDatabase }) {
  if (!binding || !primary || !target || !active(binding.IsActive) || !id(binding.ReviewedBy) || !id(binding.Revision) || !Number.isFinite(Date.parse(binding.ReviewedAt))) invalid();
  if (!sameLocation(binding.PrimaryServerName, primaryServer) || !sameLocation(binding.PrimaryDatabaseName, primaryDatabase)) invalid();
  if (!sameLocation(binding.TargetServerName, targetServer) || !sameLocation(binding.TargetDatabaseName, targetDatabase)) invalid();
  if (!id(binding.PrimaryUserId) || id(binding.PrimaryUserId) !== id(primary.Id) || !active(primary.IsActive)) invalid();
  if (!id(binding.TargetUserId) || id(binding.TargetUserId) !== id(target.Id) || !active(target.IsActive)) invalid();
  if (!text(binding.PrimaryUsername) || text(binding.PrimaryUsername) !== text(primary.Username)) invalid();
  if (!text(binding.TargetUsername) || text(binding.TargetUsername) !== text(target.Username)) invalid();
  if (text(binding.PrimaryEmployeeId) !== text(primary.EmpId) || text(binding.TargetEmployeeId) !== text(target.EmpId)) invalid();
  return { primaryUserId: id(primary.Id), targetUserId: id(target.Id), revision: id(binding.Revision) };
}

module.exports = { validateReviewedBinding };
