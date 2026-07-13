const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const scripts = [
  'backend/scripts/check_dashboard_queries.js',
  'backend/scripts/check_master_goods_query.js',
  'backend/scripts/check_master_transports_query.js',
  'backend/scripts/check_quotation_migration.js',
  'backend/scripts/check_papertrail_report_queries.js',
  'backend/scripts/check_aging_search_query.js',
  'backend/scripts/inspect_so_performance.js',
  'backend/scripts/inspect_sohd_distribution.js',
];

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, DB_MODE: process.env.DB_MODE || 'local' },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

async function main() {
  for (const script of scripts) {
    console.log(`\n=== ${script} ===`);
    await run(script);
  }
  console.log('\nQuery smoke suite passed.');
}

main().catch((error) => {
  console.error('\nQuery smoke suite failed:', error.message);
  process.exit(1);
});
