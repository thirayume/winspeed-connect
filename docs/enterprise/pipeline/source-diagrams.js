'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIPELINE_ROOT = __dirname;
const REPORT_ROOT = path.join(PIPELINE_ROOT, 'reports');
const DIAGRAM_ROOT = path.join(PIPELINE_ROOT, 'diagrams');
const ALIGNMENT_REPORT = path.join(REPORT_ROOT, 'source-alignment-report.json');
const SOURCE_INVENTORY = path.join(REPORT_ROOT, 'source-inventory.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mermaidHeader(report, title) {
  return [
    `%% ${title}`,
    `%% generatedFromSourceInventory: ${report.sourceInventorySha256}`,
    `%% generatedAt: ${report.generatedAt}`,
  ];
}

function renderSystemContext(report) {
  const facts = report.facts;
  return `${[
    ...mermaidHeader(report, 'Current source system context'),
    'flowchart LR',
    '  U["World Fert users<br/>8 roles"] --> FE["React 19 + Vite<br/>22 portal keys"]',
    `  FE -->|"HTTP / Socket.IO"| API["Express 5 API<br/>${facts.routeMounts.length} route modules · ${facts.endpointCount} endpoints"]`,
    '  API --> WF["SQL Server · wf schema<br/>application-owned workflow"]',
    `  API -->|"controlled WINSpeed writes<br/>${facts.dboWrites.length} statements detected"| DBO["SQL Server · dbo schema<br/>WINSpeed-owned records"]`,
    `  API -->|"read + pre-weigh write<br/>${facts.truckscaleWrites.length} statements detected"| TS["TruckScale MySQL<br/>tblscale / tbl_keyone"]`,
    '  DBO --> ACC["WINSpeed accounting<br/>Invoice · AR · VAT · GL"]',
    `  E2E["E2E evidence<br/>${report.e2e.evidenceStatus || report.e2e.status}<br/>${report.e2e.counts ? `${report.e2e.counts.passed}/${report.e2e.counts.total} passed` : 'not reviewed'}"] -->|"source-bound evidence"| API`,
  ].join('\n')}\n`;
}

function nodeId(value) {
  return `R_${value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function renderApiSurface(report) {
  const lines = [
    ...mermaidHeader(report, 'Current Express API surface'),
    'flowchart TB',
    `  API["Express API<br/>${report.facts.endpointCount} extracted endpoints"]`,
  ];
  for (const mount of report.facts.routeMounts) {
    const id = nodeId(mount.basePath);
    lines.push(`  ${id}["${mount.basePath}<br/>${mount.module}.js"]`);
    lines.push(`  API --> ${id}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderEvidenceFlow(report) {
  return `${[
    ...mermaidHeader(report, 'Documentation evidence and release flow'),
    'flowchart LR',
    '  SRC["Backend · Frontend · Migrations · Deployment"] --> INV["Deterministic source inventory<br/>SHA-256"]',
    '  INV --> GAP["Source ↔ document gap report"]',
    '  GAP --> REV["40 merged documents<br/>Review"]',
    '  REV --> APPROVE{"Technical / business approval"}',
    `  E2E["Automated E2E<br/>${report.e2e.evidenceStatus || report.e2e.status}<br/>${report.e2e.counts ? `${report.e2e.counts.passed}/${report.e2e.counts.total} passed` : 'not reviewed'}"] --> REVIEW["Source/hash evidence review"]`,
    '  REVIEW --> UAT["Business UAT sign-off (separate)"]',
    '  APPROVE --> GATE{"Strict documentation gate"}',
    '  UAT --> GATE',
    '  GATE -->|"pass"| BASE["Accepted source + document baseline"]',
    '  GATE -->|"gap / drift"| BLOCK["Release blocked"]',
  ].join('\n')}\n`;
}

function drawioPage(name, nodes, edges) {
  const cells = [
    '<mxCell id="0"/>',
    '<mxCell id="1" parent="0"/>',
  ];
  for (const node of nodes) {
    const style = node.style || 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=13;';
    cells.push(`<mxCell id="${xmlEscape(node.id)}" value="${xmlEscape(node.label)}" style="${xmlEscape(style)}" vertex="1" parent="1"><mxGeometry x="${node.x}" y="${node.y}" width="${node.w || 190}" height="${node.h || 70}" as="geometry"/></mxCell>`);
  }
  edges.forEach((edge, index) => {
    const label = edge.label ? ` value="${xmlEscape(edge.label)}"` : '';
    cells.push(`<mxCell id="e${index + 1}"${label} style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="${xmlEscape(edge.from)}" target="${xmlEscape(edge.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  });
  return `<diagram id="${sha256(name).slice(0, 12)}" name="${xmlEscape(name)}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel></diagram>`;
}

function renderDrawio(report) {
  const contextNodes = [
    { id: 'users', label: 'World Fert users\n8 roles', x: 40, y: 160, style: 'ellipse;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=13;' },
    { id: 'frontend', label: 'React 19 + Vite\n22 portal keys', x: 270, y: 160 },
    { id: 'api', label: `Express 5 API\n${report.facts.routeMounts.length} modules / ${report.facts.endpointCount} endpoints`, x: 510, y: 160, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=13;' },
    { id: 'wf', label: 'SQL Server · wf\napp-owned workflow', x: 780, y: 40 },
    { id: 'dbo', label: `SQL Server · dbo\n${report.facts.dboWrites.length} writes detected`, x: 780, y: 160, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=13;' },
    { id: 'truck', label: `TruckScale MySQL\n${report.facts.truckscaleWrites.length} writes detected`, x: 780, y: 280, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=13;' },
    { id: 'e2e', label: `E2E evidence\n${report.e2e.evidenceStatus || report.e2e.status}\n${report.e2e.counts ? `${report.e2e.counts.passed}/${report.e2e.counts.total} passed` : 'not reviewed'}`, x: 510, y: 320, style: report.e2e.evidenceReviewed ? 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=13;' : 'rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=13;' },
  ];
  const contextEdges = [
    { from: 'users', to: 'frontend' }, { from: 'frontend', to: 'api', label: 'HTTP / Socket.IO' },
    { from: 'api', to: 'wf' }, { from: 'api', to: 'dbo', label: 'controlled writes' },
    { from: 'api', to: 'truck', label: 'read + pre-weigh write' }, { from: 'e2e', to: 'api', label: 'source-bound evidence' },
  ];

  const apiNodes = [{ id: 'api-root', label: `Express API\n${report.facts.endpointCount} endpoints`, x: 40, y: 320, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=13;' }];
  const apiEdges = [];
  report.facts.routeMounts.forEach((mount, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const id = `api-${index}`;
    apiNodes.push({ id, label: `${mount.basePath}\n${mount.module}.js`, x: 300 + column * 205, y: 40 + row * 115, w: 170, h: 60 });
    apiEdges.push({ from: 'api-root', to: id });
  });

  const flowNodes = [
    { id: 'source', label: `Source code\n${report.facts.sourceFileCount}-file inventory`, x: 40, y: 160 },
    { id: 'inventory', label: 'SHA-256 source snapshot', x: 270, y: 160 },
    { id: 'gaps', label: `${report.summary.gapCount} alignment gaps`, x: 500, y: 160, style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=13;' },
    { id: 'review', label: '40 documents\nReview', x: 730, y: 80 },
    { id: 'tests', label: `Automated E2E evidence\n${report.e2e.evidenceStatus || report.e2e.status}\n${report.e2e.counts ? `${report.e2e.counts.passed}/${report.e2e.counts.total} passed` : 'not reviewed'}`, x: 730, y: 240, style: report.e2e.evidenceReviewed ? 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=13;' : 'rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=13;' },
    { id: 'gate', label: 'Strict release gate', x: 960, y: 160, style: 'rhombus;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=13;' },
  ];
  const flowEdges = [
    { from: 'source', to: 'inventory' }, { from: 'inventory', to: 'gaps' },
    { from: 'gaps', to: 'review' }, { from: 'review', to: 'gate' },
    { from: 'tests', to: 'gate', label: 'verified' },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net" modified="${xmlEscape(report.generatedAt)}" agent="WorldFert source-diagrams.js" version="24.7.17" type="device" sourceInventorySha256="${xmlEscape(report.sourceInventorySha256)}">${drawioPage('Current System Context', contextNodes, contextEdges)}${drawioPage('Current API Surface', apiNodes, apiEdges)}${drawioPage('Document Evidence Flow', flowNodes, flowEdges)}</mxfile>\n`;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(file, content) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, file);
}

function main() {
  if (!fs.existsSync(ALIGNMENT_REPORT) || !fs.existsSync(SOURCE_INVENTORY)) throw new Error('Run source.ps1 preflight before generating diagrams.');
  const report = JSON.parse(fs.readFileSync(ALIGNMENT_REPORT, 'utf8'));
  const inventory = JSON.parse(fs.readFileSync(SOURCE_INVENTORY, 'utf8'));
  if (report.sourceInventorySha256 !== inventory.sourceInventorySha256) throw new Error('Alignment report and source inventory hashes differ; rerun source preflight.');
  const outputs = [
    ['09-current-system-context.mmd', renderSystemContext(report)],
    ['10-current-api-surface.mmd', renderApiSurface(report)],
    ['11-document-evidence-flow.mmd', renderEvidenceFlow(report)],
    ['12-source-alignment.drawio', renderDrawio(report)],
  ];
  for (const [name, content] of outputs) atomicWrite(path.join(DIAGRAM_ROOT, name), content);
  const manifest = {
    schemaVersion: 1,
    kind: 'worldfert-source-diagram-manifest',
    generatedAt: new Date().toISOString(),
    sourceInventorySha256: report.sourceInventorySha256,
    reviewOnly: true,
    e2eEvidence: report.e2e.evidenceStatus || report.e2e.status,
    e2eEvidenceReviewed: report.e2e.evidenceReviewed,
    outputs: outputs.map(([name, content]) => ({ path: `pipeline/diagrams/${name}`, sha256: sha256(content) })),
  };
  atomicWrite(path.join(REPORT_ROOT, 'source-diagram-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${outputs.length} source-aligned diagram files for ${report.sourceInventorySha256}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}

module.exports = { xmlEscape, renderSystemContext, renderApiSurface, renderEvidenceFlow, renderDrawio };
