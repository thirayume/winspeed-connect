'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const key = path.resolve(__dirname, '../deploy/cloud-vps/.local-secrets/worldfert-hostinger-deploy');
const destination = 'root@76.13.190.104';
const port = '22';

function runSsh(cmd) {
  return execFileSync('ssh.exe', [
    '-o', 'BatchMode=yes',
    '-p', port,
    '-i', key,
    destination,
    cmd
  ], { encoding: 'utf8' });
}

console.log('--- 1. Remote Container SHA256 Hashes ---');
const hashes = runSsh('docker exec wf-backend-test sha256sum /app/routes/recon.js /app/routes/reports.js /app/services/native-gl-linkage.js');
console.log(hashes);

console.log('--- 2. Remote Container Environment ---');
const env = runSsh('docker exec wf-backend-test env | grep -E "(COUPON_NATIVE_POSTING|DB_NAME)"');
console.log(env);

console.log('--- 3. Native Posting Enabled Gate Expression ---');
const gate = runSsh('docker exec wf-backend-test node -e "console.log(\'COUPON_NATIVE_POSTING_ENABLED:\', process.env.COUPON_NATIVE_POSTING_ENABLED); console.log(\'process.env.COUPON_NATIVE_POSTING_ENABLED === true:\', process.env.COUPON_NATIVE_POSTING_ENABLED === \'true\');"');
console.log(gate);
