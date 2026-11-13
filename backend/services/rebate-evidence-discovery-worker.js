'use strict';
// Disabled by default. It stages candidates as HELD only; it cannot approve
// or accrue. The target manifest and both reset fences are required per page.
const {resolvePhysicalResetTargets}=require('./rebate-reset-targets');
const {runEvidenceDiscoveryPage}=require('./rebate-evidence-discovery-runner');
function createWorker({env=process.env,db=require('../db'),targets=resolvePhysicalResetTargets,
  runPage=runEvidenceDiscoveryPage,interval=setInterval,logger=console}={}){
  let timer=null,running=false;
  function settings() {
    const pageSize=Number(env.REBATE_DISCOVERY_PAGE_SIZE||50);
    const intervalMs=Number(env.REBATE_DISCOVERY_INTERVAL_MS||10000);
    if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||
       !Number.isSafeInteger(intervalMs)||intervalMs<5000||intervalMs>300000)
      throw Object.assign(Error('Invalid discovery worker settings'),{code:'REBATE_DISCOVERY_SETTINGS_INVALID'});
    return {pageSize,intervalMs};
  }
  async function runOnce(){
    if(running)return {skipped:true};
    running=true;
    try {
      const configured=targets(env),{pageSize}=settings(),results=[];
      for(const target of configured) {
        // Do not log target tuples or include credentials in output.
        results.push(await db.runWithTarget('onprem',()=>runPage({limit:pageSize}),target.name));
      }
      return {skipped:false,targets:results.length};
    } finally {running=false;}
  }
  function start(){
    if(timer||String(env.DISABLE_BACKGROUND_WORKERS||'').toLowerCase()==='true'||
       env.REBATE_POOL_103_ENABLED!=='true'||env.REBATE_EVIDENCE_DISCOVERY_ENABLED!=='true')return false;
    // Fail closed at startup for an unpinned manifest before scheduling.
    targets(env);
    const {intervalMs}=settings();
    timer=interval(()=>{runOnce().catch(e=>logger.error('[rebate-discovery]',String(e?.code||'DISCOVERY_FAILED')));},intervalMs);
    timer.unref?.();
    return true;
  }
  return {start,runOnce};
}
module.exports={createWorker};
