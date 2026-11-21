'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {discoverEvidencePage,stageEvidencePage}=require('../services/rebate-evidence-discovery');
const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  lastResetAtUtc:new Date('2026-11-14T05:00:00Z')};
const windowStart='2026-01-01';
test('scans keyset independently of event time; lines created before the reset are skipped even without a weigh-out',async()=>{
  const q=async(sql,args)=>{
    assert.match(sql,/ORDER BY h.RedemtionID,d.Listno/);assert.equal(args.limit,4);
    return {recordset:[
      {RedemtionID:1,Listno:1,FromSaleApp:1,LatestAudit:'2026-11-14 11:00:00.000',LatestWeighOut:'2026-11-14 11:30:00.000'},
      {RedemtionID:1,Listno:2,FromSaleApp:1,LatestAudit:'2026-11-14 11:00:00.000',LatestWeighOut:null},
      {RedemtionID:2,Listno:1,FromSaleApp:1,LatestAudit:'2026-11-14 13:00:00.000',LatestWeighOut:'2026-11-14 11:00:00.000'},
    ]};
  };
  const page=await discoverEvidencePage(q,{epoch,limit:4,windowStart});
  assert.equal(page.scanned,3);assert.deepEqual(page.next,{redemptionId:2,listNo:1});assert.equal(page.cycleComplete,true);
  // 1/2 was created at 11:00 local, before the 12:00 local reset: it existed already, so no weigh-out does not hold it.
  assert.deepEqual(page.candidates.map(x=>[x.redemptionId,x.listNo,x.reason]),[[2,1,'POST_RESET_CANDIDATE']]);
});
test('only lines on or after the data-window start, or created after the reset, reach the page',async()=>{
  let seen;
  const q=async(sql,args)=>{seen={sql,args};return {recordset:[
    {RedemtionID:7,Listno:1,FromSaleApp:1,LatestAudit:null,LatestWeighOut:'2026-11-14 10:00:00.000'},
    {RedemtionID:8,Listno:1,FromSaleApp:1,LatestAudit:null,LatestWeighOut:null}]};};
  const page=await discoverEvidencePage(q,{epoch,limit:5,windowStart});
  assert.ok(seen.sql.includes('AND (h.DocuDate>=@windowStart OR EXISTS (SELECT 1 FROM dbo.SMAudit r'));
  assert.ok(seen.sql.includes('r.audit_datetime>@resetLocal'));
  // A cached plan for another reset time or cursor timed out the first page on the UAT copy.
  assert.match(seen.sql,/ORDER BY x\.RedemtionID,x\.Listno\s+OPTION \(RECOMPILE\)\s*$/);
  assert.equal(seen.args.windowStart,'20260101');
  // the reset at 05:00 UTC is 12:00 Bangkok time, the clock WinSpeed writes audit in
  assert.equal(seen.args.resetLocal,'2026-11-14T12:00:00.000');
  // no create audit: the time cannot be proved, so the line is held
  assert.deepEqual(page.candidates.map(x=>x.reason),['TIME_EVIDENCE_INCOMPLETE','TIME_EVIDENCE_INCOMPLETE']);
});
test('a page without the data-window start is refused before any query',async()=>{
  let called=false;const q=async()=>{called=true;return {recordset:[]};};
  for(const bad of [undefined,'','01/01/2026','2026-13-01'])
    await assert.rejects(discoverEvidencePage(q,{epoch,windowStart:bad}),e=>e.code==='REBATE_DISCOVERY_INPUT_INVALID');
  assert.equal(called,false);
});
test('a source arriving behind the cursor is found on the next scan cycle',async()=>{
  const q=async(_sql,args)=>({recordset:args.afterId?[]:[{RedemtionID:1,Listno:1,FromSaleApp:1,LatestAudit:null,LatestWeighOut:null}]});
  const end=await discoverEvidencePage(q,{epoch,after:{redemptionId:9,listNo:1},windowStart});
  assert.equal(end.cycleComplete,true);
  const restart=await discoverEvidencePage(q,{epoch,windowStart});
  assert.equal(restart.candidates[0].redemptionId,1);
});
test('cursor advances only after all candidate stages succeed with expected epoch',async()=>{
  const page={candidates:[{redemptionId:1,listNo:1},{redemptionId:2,listNo:1}],next:{redemptionId:2,listNo:1},cycleComplete:false};
  const seen=[];
  const ok=await stageEvidencePage(page,epoch,{stage:async(item,opts)=>{seen.push(item);assert.equal(opts.expectedEpoch,epoch);return {replayed:false};}});
  assert.equal(ok.staged,2);assert.equal(seen.length,2);
  await assert.rejects(stageEvidencePage(page,epoch,{stage:async item=>{if(item.redemptionId===2)throw Error('failed');}}),/failed/);
});
// Hybrid rule (owner, 21 Nov 2026): a booking made in WinSpeed keeps WinSpeed's Rebate process.
test('a line whose booking was made in WinSpeed is scanned but never held',async()=>{
  let seen;
  const q=async(sql,args)=>{seen=sql;return {recordset:[
    {RedemtionID:3,Listno:1,FromSaleApp:0,LatestAudit:'2026-11-14 13:00:00.000',LatestWeighOut:'2026-11-14 13:30:00.000'},
    {RedemtionID:3,Listno:2,FromSaleApp:null,LatestAudit:null,LatestWeighOut:null},
    {RedemtionID:4,Listno:1,FromSaleApp:1,LatestAudit:'2026-11-14 13:00:00.000',LatestWeighOut:null}]};};
  const page=await discoverEvidencePage(q,{epoch,limit:3,windowStart});
  assert.equal(page.scanned,3);assert.equal(page.notFromSaleApp,2);
  assert.deepEqual(page.next,{redemptionId:4,listNo:1});assert.equal(page.cycleComplete,false);
  assert.deepEqual(page.candidates.map(x=>[x.redemptionId,x.listNo]),[[4,1]]);
  // the origin is the booking line that carries Sale-App's price snapshot, joined through the coupon and 104 line
  assert.ok(seen.includes('JOIN wf.RebateBookingPriceSnapshot os ON os.BookingSOID=ob.SOID AND os.[LineNo]=osd.RefListNo'));
  assert.ok(seen.includes('WHERE od.RedemtionID=x.RedemtionID AND od.Listno=x.Listno'));
  assert.ok(!/\bref\./.test(seen));
});
test('a candidate refused by the intake as a WinSpeed booking is skipped, any other failure stops the page',async()=>{
  const page={candidates:[{redemptionId:1,listNo:1},{redemptionId:2,listNo:1}],next:{redemptionId:2,listNo:1},cycleComplete:false};
  const notApp=Object.assign(Error('x'),{code:'REBATE_BOOKING_NOT_FROM_SALE_APP'});
  const r=await stageEvidencePage(page,epoch,{stage:async item=>{if(item.redemptionId===1)throw notApp;return {replayed:false};}});
  assert.deepEqual([r.staged,r.skipped,r.next],[1,1,{redemptionId:2,listNo:1}]);
  await assert.rejects(stageEvidencePage(page,epoch,{stage:async()=>{throw Object.assign(Error('y'),{code:'REBATE_EVIDENCE_SOURCE_CHANGED'});}}),{code:'REBATE_EVIDENCE_SOURCE_CHANGED'});
});
