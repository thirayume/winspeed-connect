const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.resolve(ROOT, 'backend');
const port = Number(process.env.API_SMOKE_PORT || 3100);
const baseUrl = process.env.API_SMOKE_BASE_URL || `http://localhost:${port}/api`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
      lastError = new Error(`health returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(750);
  }
  throw new Error(`API did not become healthy at ${baseUrl}: ${lastError?.message || 'timeout'}`);
}

function runApiSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['backend/scripts/api_smoke.js'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        DB_MODE: process.env.DB_MODE || 'local',
        API_SMOKE_BASE_URL: baseUrl,
      },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`api_smoke.js exited with code ${code}`));
    });
  });
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DB_MODE: process.env.DB_MODE || 'local',
      PORT: String(port),
    },
  });

  server.stdout.on('data', (chunk) => process.stdout.write(`[API] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[API] ${chunk}`));

  let serverExited = false;
  server.on('exit', (code) => {
    serverExited = true;
    if (code && code !== 0) {
      console.error(`[API] server exited with code ${code}`);
    }
  });

  try {
    await waitForHealth();
    await runApiSmoke();
  } finally {
    if (!serverExited) {
      server.kill();
      await delay(500);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
