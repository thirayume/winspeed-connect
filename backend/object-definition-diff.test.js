'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDefinition,
  extractObjectDefinitions,
} = require('./object-definition-diff');

test('normalization removes comments, case, line-ending, and spacing differences', () => {
  const left = 'CREATE OR ALTER VIEW wf.Example AS\r\n-- comment\r\nSELECT 1 AS Value;';
  const right = 'create or alter view wf.Example as select 1 as Value;';
  assert.equal(normalizeDefinition(left), normalizeDefinition(right));
});

test('extracts editable view and procedure definitions from GO-separated batches', () => {
  const sql = [
    "PRINT N'before';",
    'GO',
    'CREATE OR ALTER VIEW wf.ExampleView AS SELECT 1 AS Value;',
    'GO',
    'CREATE OR ALTER PROCEDURE [wf].[ExampleProcedure] AS SELECT 2;',
    'GO',
  ].join('\n');
  assert.deepEqual(extractObjectDefinitions(sql).map(item => ({
    type: item.type,
    schema: item.schema,
    object: item.object,
  })), [
    { type: 'VIEW', schema: 'wf', object: 'ExampleView' },
    { type: 'PROCEDURE', schema: 'wf', object: 'ExampleProcedure' },
  ]);
});
