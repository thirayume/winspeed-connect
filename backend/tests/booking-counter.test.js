'use strict';
/**
 * Booking counter (R12 K-F1). WINSpeed keeps the active book in dbo.EMRunBrch and both
 * books in dbo.EMRunChar (ListNo 1 = I/C/J, ListNo 2 = K/D/N); staff switch the active book.
 */
const test = require('node:test'), assert = require('node:assert/strict');
const { advanceDocuNoCounter, readBookCounter, RUN_CODE_BY_PREFIX, _resetCounterProcCache } = require('../services/winspeed-counter');

// Counter rows as the two tables hold them today (I active) and after a switch (K active)
const TODAY = [
  { Source: 'EMRunBrch', Fmt: 'Iyy-00000', LastNo: 'I69-04241', ListNo: 0 },
  { Source: 'EMRunChar', Fmt: 'Iyy-00000', LastNo: 'I69-01527', ListNo: 1 },   // stale while I is active
  { Source: 'EMRunChar', Fmt: 'Kyy-00000', LastNo: 'K69-02762', ListNo: 2 },
];
const SWAPPED = [
  { Source: 'EMRunBrch', Fmt: 'Kyy-00000', LastNo: 'K69-02800', ListNo: 0 },
  { Source: 'EMRunChar', Fmt: 'Iyy-00000', LastNo: 'I69-04300', ListNo: 1 },
  { Source: 'EMRunChar', Fmt: 'Kyy-00000', LastNo: 'K69-02762', ListNo: 2 },   // stale while K is active
];
const rowsQuery = rows => async () => ({ recordset: rows });

test('both books use RunCode 103; the old "K unknown" rule is gone', () => {
  assert.deepEqual(RUN_CODE_BY_PREFIX, { I: '103', K: '103' });
});

test('readBookCounter: active prefix reads EMRunBrch, the other book reads its EMRunChar row', async () => {
  assert.deepEqual(await readBookCounter(rowsQuery(TODAY), '103', 'I'), { lastNo: 'I69-04241', location: 'EMRunBrch' });
  assert.deepEqual(await readBookCounter(rowsQuery(TODAY), '103', 'K'), { lastNo: 'K69-02762', location: 'EMRunChar' });
});

test('readBookCounter: after a book switch the stale EMRunChar row of the active book is ignored', async () => {
  assert.deepEqual(await readBookCounter(rowsQuery(SWAPPED), '103', 'K'), { lastNo: 'K69-02800', location: 'EMRunBrch' });
  assert.deepEqual(await readBookCounter(rowsQuery(SWAPPED), '103', 'I'), { lastNo: 'I69-04300', location: 'EMRunChar' });
});

test('with migration 145: K and I bookings both advance through wf.sp_AdvanceDocuCounter', async () => {
  _resetCounterProcCache();
  const calls = [];
  const query = async (text, p) => {
    calls.push({ text, p });
    if (/OBJECT_ID\('wf\.sp_AdvanceDocuCounter'/.test(text)) return { recordset: [{ HasProc: 1 }] };
    return { recordset: [{ Updated: 1, Location: p.no.value.startsWith('K') ? 'EMRunChar' : 'EMRunBrch' }] };
  };
  const k = await advanceDocuNoCounter('K69-02763', { strict: true, query });
  assert.equal(k.updated, true); assert.equal(k.location, 'EMRunChar');
  const i = await advanceDocuNoCounter('I69-04242', { strict: true, query });
  assert.equal(i.updated, true); assert.equal(i.location, 'EMRunBrch');
  const execs = calls.filter(c => /EXEC wf\.sp_AdvanceDocuCounter/.test(c.text));
  assert.equal(execs.length, 2);
  assert.equal(execs[0].p.rc.value, '103'); assert.equal(execs[0].p.no.value, 'K69-02763');
  assert.equal(calls.filter(c => /\bUPDATE\s/.test(c.text)).length, 0, 'no direct UPDATE from the app');
});

test('without migration 145: K is not advanced (no UPDATE), I keeps the guarded EMRunBrch update', async () => {
  _resetCounterProcCache();
  let updates = 0;
  const query = async (text, p) => {
    if (/OBJECT_ID\('wf\.sp_AdvanceDocuCounter'/.test(text)) return { recordset: [{ HasProc: 0 }] };
    updates++;
    assert.equal(p.rc.value, '103'); assert.equal(p.format.value, 'I%');
    assert.match(text, /r\.RunFormat LIKE @format AND b\.RunFormat LIKE @format/);
    assert.match(text, /RTRIM\(b\.LastNo\) < @no/);
    return { rowsAffected: [1] };
  };
  const k = await advanceDocuNoCounter('K69-02763', { strict: true, query });
  assert.equal(k.reason, 'K_COUNTER_NEEDS_MIGRATION_145');
  assert.equal(updates, 0);
  const i = await advanceDocuNoCounter('I69-04221', { strict: true, query });
  assert.equal(i.updated, true); assert.equal(updates, 1);
});

test('malformed numbers never reach SQL', async () => {
  _resetCounterProcCache();
  assert.equal((await advanceDocuNoCounter('I69-x', { query: () => { throw Error('must not query'); } })).reason, 'INVALID_DOCUMENT_NUMBER');
  assert.equal((await advanceDocuNoCounter('D6904967', { query: () => { throw Error('must not query'); } })).reason, 'INVALID_DOCUMENT_NUMBER');
});
