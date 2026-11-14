'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sync=require('../services/scale-ship-sync');
test('global worker disable prevents scale, incident and stock timers',()=>{
 const oldGlobal=process.env.DISABLE_BACKGROUND_WORKERS,oldScale=process.env.SCALE_SHIP_SYNC_DISABLED;
 const oldInterval=global.setInterval,oldTimeout=global.setTimeout;
 try{
  process.env.DISABLE_BACKGROUND_WORKERS='TRUE';delete process.env.SCALE_SHIP_SYNC_DISABLED;
  global.setInterval=()=>{throw Error('unexpected interval');};global.setTimeout=()=>{throw Error('unexpected startup timer');};
  assert.doesNotThrow(()=>sync.start());
  delete process.env.DISABLE_BACKGROUND_WORKERS;process.env.SCALE_SHIP_SYNC_DISABLED='true';
  assert.doesNotThrow(()=>sync.start());
 } finally {
  if(oldGlobal===undefined)delete process.env.DISABLE_BACKGROUND_WORKERS;else process.env.DISABLE_BACKGROUND_WORKERS=oldGlobal;
  if(oldScale===undefined)delete process.env.SCALE_SHIP_SYNC_DISABLED;else process.env.SCALE_SHIP_SYNC_DISABLED=oldScale;
  global.setInterval=oldInterval;global.setTimeout=oldTimeout;
 }
});
