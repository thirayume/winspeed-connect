'use strict';
// Explicitly approved 2026-09-14 full-backup refresh. No defaults for target/host.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const win = process.platform === 'win32';
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const sql = win ? require('mssql/msnodesqlv8') : require('mssql');
const runner = require('../run_migrations');
const SHA = 'BDD8EAAB8B3011EF0B4668D43E3E4D05E285944F10B99775FB37873BB5D6593E';
const GUID = 'CE202D0A-AA10-419C-BD1C-09887793C463';
const targets = new Set(['dbwins_worldfert9','dbwins_worldfert9_test','dbwins_worldfert9_test_v2']);
const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i]]=process.argv[i+1];
const target=a['--target'],host=a['--host'],source=a['--source'],file=a['--file'],backupDir=a['--backup-dir'],receipt=a['--receipt'],mode=a['--mode'];
if(!targets.has(target)||!host||!source||!file||!backupDir||!receipt||!['plan','execute'].includes(mode))throw Error('Explicit mode/target/host/source/file/backup-dir/receipt required');
const qi=v=>'['+v.replace(/]/g,']]')+']';const qs=v=>"N'"+v.replace(/'/g,"''")+"'";
function config(database){return win?{server:host,database,driver:'msnodesqlv8',options:{trustedConnection:true,trustServerCertificate:true,enableArithAbort:true},requestTimeout:1200000,pool:{max:2,min:0}}:{server:process.env.REMOTE_DB_SERVER,port:Number(process.env.REMOTE_DB_PORT||1433),user:process.env.REMOTE_DB_USER||'sa',password:process.env.REMOTE_DB_PASSWORD,database,options:{encrypt:true,trustServerCertificate:true,enableArithAbort:true},requestTimeout:1200000,pool:{max:2,min:0}};}
async function query(pool,text){const req=pool.request();req.timeout=1200000;req.overrides={requestTimeout:1200000};return req.query(text);}
async function identity(pool,db){const r=(await query(pool,'SELECT @@SERVERNAME host,DB_NAME() db')).recordset[0];if(r.host.toLowerCase()!==host.toLowerCase()||r.db!==db)throw Error('Connection identity mismatch');}
async function hash(){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex').toUpperCase();}
const run=Date.now().toString();const state={run,target,host,source,sha256:SHA,status:'STARTED',startedAt:new Date().toISOString()};
function save(){fs.mkdirSync(path.dirname(receipt),{recursive:true});fs.writeFileSync(receipt,JSON.stringify(state,null,2));}
(async()=>{
 let master,db,restoreStarted=false,snapshot=false;
 const snap='RefreshAccounts_'+run;
 try{
 if(await hash()!==SHA)throw Error('Backup hash mismatch');
 master=await new sql.ConnectionPool(config('master')).connect();await identity(master,'master');
 const header=(await query(master,'RESTORE HEADERONLY FROM DISK='+qs(source))).recordset;
 if(header.length!==1||header[0].BackupType!==1||String(header[0].BackupSetGUID).toUpperCase()!==GUID||Number(header[0].BackupSize)!==3548443648||header[0].IsDamaged)throw Error('Backup identity/type mismatch');
 await query(master,'RESTORE VERIFYONLY FROM DISK='+qs(source));
 const logical=(await query(master,'RESTORE FILELISTONLY FROM DISK='+qs(source))).recordset;
 const current=(await query(master,`SELECT name,type,physical_name,size*8192.0 sizeBytes FROM sys.master_files WHERE database_id=DB_ID(${qs(target)})`)).recordset;
 if(current.length!==2||logical.length!==2||logical.filter(x=>x.Type==='D').length!==1||logical.filter(x=>x.Type==='L').length!==1)throw Error('Expected one data and one log file; manual mapping required');
 const moves=logical.map(f=>{const c=current.find(c=>c.type===(f.Type==='D'?0:1));if(!c)throw Error('Missing file mapping');return {logicalName:f.LogicalName,path:c.physical_name,size:Number(f.Size)};});
 state.files=moves;
 state.safetyBackup=backupDir.replace(/[\\/]$/,'')+(win?'\\':'/')+'pre_refresh_'+target+'_'+run+'.bak';
 state.status='PLAN_VERIFIED';save();
 console.log(JSON.stringify({target,host,files:moves,safetyBackup:state.safetyBackup,mode}));
 if(mode==='plan')return;
 // Caller stops the application before execute. Refuse non-self sessions in target DB.
 const sessions=(await query(master,`SELECT session_id FROM sys.dm_exec_sessions WHERE database_id=DB_ID(${qs(target)}) AND is_user_process=1 AND session_id<>@@SPID`)).recordset;
 if(sessions.length)throw Error('Active target sessions remain; stop application before restore');
 await query(master,`BACKUP DATABASE ${qi(target)} TO DISK=${qs(state.safetyBackup)} WITH COPY_ONLY,CHECKSUM;`);
 await query(master,`RESTORE VERIFYONLY FROM DISK=${qs(state.safetyBackup)} WITH CHECKSUM;`);
 state.status='SAFETY_BACKUP_VERIFIED';save();
 const volumes=(await query(master,`SELECT f.physical_name,v.volume_mount_point,CAST(v.available_bytes AS float) available FROM sys.master_files f CROSS APPLY sys.dm_os_volume_stats(f.database_id,f.file_id) v WHERE f.database_id=DB_ID(${qs(target)})`)).recordset;
 const growth=new Map();for(const m of moves){const v=volumes.find(v=>v.physical_name===m.path);const c=current.find(c=>c.physical_name===m.path);if(!v||!c)throw Error('Unknown destination volume');const old=growth.get(v.volume_mount_point)||{needed:0,available:Number(v.available)};old.needed+=Math.max(0,m.size-Number(c.sizeBytes));growth.set(v.volume_mount_point,old);}
 for(const [volume,v] of growth)if(v.available<v.needed+2*1024**3)throw Error('Insufficient post-backup free space on '+volume);
 const hasUsers=(await query(master,`SELECT COUNT(*) n FROM ${qi(target)}.sys.tables t JOIN ${qi(target)}.sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf' AND t.name='AppUser'`)).recordset[0].n;
 if(hasUsers){await query(master,`SELECT * INTO tempdb.dbo.${qi(snap)} FROM ${qi(target)}.wf.AppUser;`);snapshot=true;}
 const restore=`RESTORE DATABASE ${qi(target)} FROM DISK=${qs(source)} WITH REPLACE,${moves.map(m=>'MOVE '+qs(m.logicalName)+' TO '+qs(m.path)).join(',')},RECOVERY;`;
 restoreStarted=true;state.status='RESTORING';save();
 await query(master,`ALTER DATABASE ${qi(target)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ${restore} ALTER DATABASE ${qi(target)} SET MULTI_USER;`);
 db=await new sql.ConnectionPool(config(target)).connect();await identity(db,target);
 try{await query(db,'DBCC CHECKDB WITH NO_INFOMSGS;');state.checkdb='PASS';}catch(e){if(!/UPDATEUSAGE|RSVD page count/i.test(e.message))throw e;await query(db,'DBCC UPDATEUSAGE(0) WITH NO_INFOMSGS; DBCC CHECKDB WITH NO_INFOMSGS;');state.checkdb='PASS_AFTER_UPDATEUSAGE';}
 await query(db,`IF DATABASE_PRINCIPAL_ID('wf_reader') IS NULL BEGIN IF SUSER_ID('wf_reader') IS NOT NULL CREATE USER wf_reader FOR LOGIN wf_reader; ELSE CREATE USER wf_reader WITHOUT LOGIN; END; IF DATABASE_PRINCIPAL_ID('wf_owner') IS NULL BEGIN IF SUSER_ID('wf_owner') IS NOT NULL CREATE USER wf_owner FOR LOGIN wf_owner; ELSE CREATE USER wf_owner WITHOUT LOGIN; END;`);
 const applied=await runner.run({plan:false},db,target);const rerun=await runner.run({plan:true},db,target);
 if(rerun.plan.entries.some(e=>e.status!=='UNCHANGED'))throw Error('Migration re-plan not clean');
 state.migrations={applied:applied.appliedList.length,unchanged:rerun.counts.UNCHANGED,drift:0,pending:0};
 if(snapshot){
 const columns=(await query(db,`SELECT c.name FROM sys.columns c WHERE c.object_id=OBJECT_ID('wf.AppUser') AND c.is_identity=0 AND c.is_computed=0 AND c.system_type_id<>189 AND EXISTS(SELECT 1 FROM tempdb.sys.columns s WHERE s.object_id=OBJECT_ID('tempdb.dbo.${snap}') AND s.name COLLATE DATABASE_DEFAULT=c.name COLLATE DATABASE_DEFAULT)`)).recordset.map(r=>r.name);
 if(!columns.includes('PasswordHash')||!columns.includes('Username'))throw Error('Account snapshot incomplete');
 const list=columns.map(qi).join(',');const updates=columns.filter(c=>c!=='Username').map(c=>'d.'+qi(c)+'=s.'+qi(c)).join(',');
 await query(db,`SET XACT_ABORT ON; BEGIN TRAN; UPDATE d SET ${updates} FROM wf.AppUser d JOIN tempdb.dbo.${qi(snap)} s ON d.Username COLLATE DATABASE_DEFAULT=s.Username COLLATE DATABASE_DEFAULT; INSERT wf.AppUser (${list}) SELECT ${columns.map(c=>'s.'+qi(c)).join(',')} FROM tempdb.dbo.${qi(snap)} s WHERE NOT EXISTS(SELECT 1 FROM wf.AppUser d WHERE d.Username COLLATE DATABASE_DEFAULT=s.Username COLLATE DATABASE_DEFAULT); COMMIT;`);
 const mismatches=(await query(db,`SELECT COUNT(*) n FROM tempdb.dbo.${qi(snap)} s LEFT JOIN wf.AppUser d ON s.Username COLLATE DATABASE_DEFAULT=d.Username COLLATE DATABASE_DEFAULT WHERE d.Id IS NULL OR d.PasswordHash COLLATE DATABASE_DEFAULT<>s.PasswordHash COLLATE DATABASE_DEFAULT OR d.Role COLLATE DATABASE_DEFAULT<>s.Role COLLATE DATABASE_DEFAULT OR d.IsActive<>s.IsActive`)).recordset[0].n;
 if(mismatches)throw Error('Account preservation mismatch');state.accountsPreserved=true;
 }
 const counts=(await query(db,"SELECT (SELECT COUNT(*) FROM dbo.SOHD) SOHD,(SELECT COUNT(*) FROM dbo.SODT) SODT,(SELECT COUNT(*) FROM dbo.SOInvHD) SOInvHD,(SELECT COUNT(*) FROM dbo.GLHD) GLHD,(SELECT COUNT(*) FROM wf.SchemaMigration) Migrations")).recordset[0];
 if(counts.SOHD!==129777||counts.SODT!==234219||counts.SOInvHD!==309079||counts.GLHD!==418848)throw Error('Native baseline count mismatch');
 state.counts=counts;await query(db,'DBCC CHECKDB WITH NO_INFOMSGS;');
 if(snapshot){await query(master,`DROP TABLE tempdb.dbo.${qi(snap)};`);snapshot=false;}
 state.status='RESTORED_MIGRATED_VERIFIED';state.completedAt=new Date().toISOString();save();console.log('RESULT '+JSON.stringify(state));
 }catch(e){state.error=e.message;state.errorDetails=(e.precedingErrors||[]).map(x=>x.message);state.status='FAILED';save();console.error(e.message);
 if(restoreStarted){if(db){await db.close();db=null;}try{await query(master,`ALTER DATABASE ${qi(target)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE ${qi(target)} FROM DISK=${qs(state.safetyBackup)} WITH REPLACE,RECOVERY; ALTER DATABASE ${qi(target)} SET MULTI_USER;`);state.status='FAILED_ROLLED_BACK';save();console.error('Rollback restored verified safety backup');}catch(rb){state.rollbackError=rb.message;save();console.error('ROLLBACK FAILED: '+rb.message);}}
 if(snapshot&&state.status==='FAILED_ROLLED_BACK')await query(master,`DROP TABLE tempdb.dbo.${qi(snap)};`);
 process.exitCode=1;
 }finally{if(db)await db.close().catch(()=>{});if(master)await master.close().catch(()=>{});}
})().catch(e=>{console.error(e.message);process.exitCode=1});
