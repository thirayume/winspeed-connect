'use strict';
// Owner-designated full backup, 14 September 2026. Old baseline remains unchanged.
process.env.DB_MODE = 'local';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.COUPON_NATIVE_POSTING_ENABLED = 'false';
const path = require('node:path');
const rehearsal = require('./rehearsal-isolated-restore.cjs');
Object.assign(rehearsal.EXPECTED_BASELINE, {
 filename: 'dbwins_worldfert9_14092026.bak',
 sha256: 'BDD8EAAB8B3011EF0B4668D43E3E4D05E285944F10B99775FB37873BB5D6593E',
 byteSize: 3548452352,
 serverBackupSize: 3548443648,
 backupSetGuid: 'CE202D0A-AA10-419C-BD1C-09887793C463'
});
const args = process.argv.slice(2);
if (!['--plan','--execute'].includes(args[0]) || (args[0] === '--execute' && !args[1])) {
 console.error('Usage: node backend/scripts/rehearsal-backup-20260914.cjs --plan | --execute <manifest>'); process.exit(2);
}
rehearsal.runRehearsal({mode: args[0], targetHost: 'Amyou-Yoga7\\SQLEXPRESS', clientBackupPath: path.resolve(__dirname,'../../db-init/dbwins_worldfert9_14092026.bak'), manifest: args[1]})
.then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
