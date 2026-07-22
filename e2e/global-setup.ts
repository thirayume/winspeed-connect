import fs from 'node:fs';
import path from 'node:path';

async function readEndpoint(url: string) {
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { 'X-DB-Target': 'local' } });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { url, status: response.status, ok: response.ok, durationMs: Date.now() - startedAt, body };
}

export default async function globalSetup() {
  const startedAt = new Date().toISOString();
  const [frontend, api] = await Promise.all([
    readEndpoint(process.env.E2E_BASE_URL || 'http://localhost:5173'),
    readEndpoint(`${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/health`),
  ]);
  const environment = { schemaVersion: 1, capturedAt: startedAt, frontend, api };
  const output = path.resolve('test-results/environment.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(environment, null, 2)}\n`, 'utf8');
  if (!frontend.ok || !api.ok || (api.body as any)?.db?.sqlserver !== 'up') {
    throw new Error(`E2E environment is not ready; inspect ${output}`);
  }
}
