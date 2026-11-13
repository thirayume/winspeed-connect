'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {discoverEvidencePage,stageEvidencePage}=require('../services/rebate-evidence-discovery');
const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  lastResetAtUtc:new Date('2026-11-14T05:00:00Z')};
test('scans keyset independently of event time; incomplete proof is held and old complete records skipped',async()=>{
  const q=async(sql,args)=>{
    assert.match(sql,/ORDER BY h.RedemtionID,d.Listno/);assert.equal(args.limit,4);
    return {recordset:[
      {RedemtionID:1,Listno:1,LatestAudit:'2026-11-14 11:00:00.000',LatestWeighOut:'2026-11-14 11:30:00.000'},
      {RedemtionID:1,Listno:2,LatestAudit:'2026-11-14 11:00:00.000',LatestWeighOut:null},
      {RedemtionID:2,Listno:1,LatestAudit:'2026-11-14 13:00:00.000',LatestWeighOut:'2026-11-14 11:00:00.000'},
    ]};
  };
  const page=await discoverEvidencePage(q,{epoch,limit:4});
  assert.equal(page.scanned,3);assert.deepEqual(page.next,{redemptionId:2,listNo:1});assert.equal(page.cycleComplete,true);
  assert.deepEqual(page.candidates.map(x=>x.reason),['TIME_EVIDENCE_INCOMPLETE','POST_RESET_CANDIDATE']);
});
test('a source arriving behind the cursor is found on the next scan cycle',async()=>{
  const q=async(_sql,args)=>({recordset:args.afterId?[]:[{RedemtionID:1,Listno:1,LatestAudit:null,LatestWeighOut:null}]});
  const end=await discoverEvidencePage(q,{epoch,after:{redemptionId:9,listNo:1}});
  assert.equal(end.cycleComplete,true);
  const restart=await discoverEvidencePage(q,{epoch});
  assert.equal(restart.candidates[0].redemptionId,1);
});
test('cursor advances only after all candidate stages succeed with expected epoch',async()=>{
  const page={candidates:[{redemptionId:1,listNo:1},{redemptionId:2,listNo:1}],next:{redemptionId:2,listNo:1},cycleComplete:false};
  const seen=[];
  const ok=await stageEvidencePage(page,epoch,{stage:async(item,opts)=>{seen.push(item);assert.equal(opts.expectedEpoch,epoch);return {replayed:false};}});
  assert.equal(ok.staged,2);assert.equal(seen.length,2);
  await assert.rejects(stageEvidencePage(page,epoch,{stage:async item=>{if(item.redemptionId===2)throw Error('failed');}}),/failed/);
});
