'use strict';

// A generation alone is not a unique reset identity: a restored database or
// interrupted multi-target reset can have the same generation with different
// reset IDs. Never join evidence from such epochs.
function fail() { throw Object.assign(new Error('REBATE_RESET_EPOCH_INVALID'), { code: 'REBATE_RESET_EPOCH_INVALID', status: 503 }); }
function epoch({ generation, resetId, lastResetAtUtc } = {}) {
  if (!Number.isSafeInteger(generation) || generation < 0) fail();
  if (generation === 0) {
    if (resetId != null || lastResetAtUtc != null) fail();
    return { generation, resetId: null, lastResetAtUtc: null };
  }
  const id = typeof resetId === 'string' ? resetId.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || lastResetAtUtc == null) fail();
  if (!(lastResetAtUtc instanceof Date) && (typeof lastResetAtUtc !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(lastResetAtUtc))) fail();
  const at = lastResetAtUtc instanceof Date ? lastResetAtUtc.getTime() : Date.parse(lastResetAtUtc);
  if (!Number.isFinite(at)) fail();
  return { generation, resetId: id, lastResetAtUtc: new Date(at) };
}

module.exports = { epoch };
