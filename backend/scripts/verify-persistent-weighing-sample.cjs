const d=require('../db');
(async()=>{await d.runWithTarget('remote_b',async()=>{
const identity=await d.query('SELECT DB_NAME() dbName');if(identity[0].dbName!=='dbwins_worldfert9_test_v2')throw Error('Wrong database');
const r=await d.query(`SELECT m.Scenario,m.WGHDId,m.WGDTId,m.WGDTReportId,h.Id ActualHeader,d.Id ActualDetail,r.Id ActualReport,h.Status,h.WeightNet,d.GoodTon,r.GoodTonNet FROM wf.WeighingSampleManifest m LEFT JOIN dbo.WGHD h ON h.Id=m.WGHDId LEFT JOIN dbo.WGDT d ON d.Id=m.WGDTId LEFT JOIN dbo.WGDTReport r ON r.Id=m.WGDTReportId WHERE m.BatchKey='SAMPLE-WEIGH-20260917-V1' ORDER BY m.WGHDId,m.WGDTId`);console.log(JSON.stringify(r));
if(r.length!==5||r.some(x=>!x.ActualHeader||!x.ActualDetail||(x.WGDTReportId&&!x.ActualReport)))throw Error('Sample missing');
});})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{for(const p of Object.values(d.pools('remote_b')))if(p&&p.close)await p.close()});