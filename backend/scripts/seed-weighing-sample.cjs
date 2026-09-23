'use strict';
const fs=require('node:fs');const path=require('node:path');const d=require('../db');
(async()=>{await d.runWithTarget('remote_b',async()=>{
 const identity=await d.query('SELECT DB_NAME() dbName, @@SERVERNAME serverName');
 if(identity[0]?.dbName!=='dbwins_worldfert9_test_v2')throw Error('Wrong database');
 console.log(JSON.stringify({target:identity[0]}));
 const before=await d.query('SELECT (SELECT COUNT(*) FROM dbo.WGHD) hd,(SELECT COUNT(*) FROM dbo.WGDT) dt,(SELECT COUNT(*) FROM dbo.WGDTReport) rpt');
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({mode:'read-only',counts:before[0],next:'Review db-init/seed-weighing-sample-20260917.sql; --apply adds four synthetic scenarios atomically'}));return;}
 await d.pools('remote_b').ready; const p=d.pools('remote_b').ownerPool;
 const result=await p.request().batch(fs.readFileSync(path.join(__dirname,'../../db-init/seed-weighing-sample-20260917.sql'),'utf8'));
 const after=await d.query('SELECT (SELECT COUNT(*) FROM dbo.WGHD) hd,(SELECT COUNT(*) FROM dbo.WGDT) dt,(SELECT COUNT(*) FROM dbo.WGDTReport) rpt');
 const receipt={at:new Date().toISOString(),target:identity[0],before:before[0],after:after[0],synthetic:true,hardwareVerified:false,rows:result.recordset};
 console.log(JSON.stringify(receipt,null,2));
 const first=path.join(__dirname,'../../docs/evidence/WEIGHING-SAMPLE-20260917.json'); fs.writeFileSync(fs.existsSync(first)?first.replace('.json','-verification.json'):first,JSON.stringify(receipt,null,2));
});})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{for(const p of Object.values(d.pools('remote_b')))if(p&&p.close)await p.close()});