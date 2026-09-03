'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { xmlEscape, renderSystemContext, renderApiSurface, renderEvidenceFlow, renderDrawio } = require('./source-diagrams');

const report = {
  generatedAt: '2026-07-22T00:00:00.000Z',
  sourceInventorySha256: 'ABC123',
  summary: { gapCount: 3 },
  e2e: { status: 'REQUIRED', evidenceStatus: 'PASSED_COMPLETE', evidenceReviewed: true, counts: { passed: 10, total: 10 } },
  facts: {
    sourceFileCount: 218,
    routeMounts: [{ basePath: '/api/so', module: 'so' }, { basePath: '/api/auth', module: 'auth' }],
    endpointCount: 12,
    dboWrites: [{}, {}],
    truckscaleWrites: [{}],
  },
};

test('escapes XML control characters', () => {
  assert.equal(xmlEscape('A&B<"x">'), 'A&amp;B&lt;&quot;x&quot;&gt;');
});

test('renders source-hash-provenance in all Mermaid diagrams', () => {
  for (const output of [renderSystemContext(report), renderApiSurface(report), renderEvidenceFlow(report)]) {
    assert.match(output, /generatedFromSourceInventory: ABC123/);
    assert.match(output, /flowchart/);
  }
  for (const output of [renderSystemContext(report), renderEvidenceFlow(report)]) {
    assert.match(output, /PASSED_COMPLETE/);
    assert.doesNotMatch(output, /DEFERRED/);
  }
});

test('renders editable multi-page drawio XML', () => {
  const xml = renderDrawio(report);
  assert.match(xml, /^<\?xml/);
  assert.equal((xml.match(/<diagram /g) || []).length, 3);
  assert.match(xml, /sourceInventorySha256="ABC123"/);
  assert.match(xml, /<mxCell/);
});
