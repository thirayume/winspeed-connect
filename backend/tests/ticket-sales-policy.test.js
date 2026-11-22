const test=require('node:test'),assert=require('node:assert/strict');
const {hasPermission,capabilitiesFor}=require('../services/role-capabilities');
test('SALES cannot issue new tickets even with a stale/custom grant, but can request a cut',()=>{
 for(const action of ['so.create-native-delivery','so.control-ticket']) {
  assert.equal(hasPermission({role:'SALES',permissions:[action]},action),false);
  assert.equal(hasPermission({role:'COUNTER_SALES',permissions:[action]},action),true);
  assert.equal(hasPermission({roles:['SALES','COUNTER_SALES'],permissions:[action]},action),true);
  assert.equal(hasPermission({roles:['ADMIN','SEPARATION'],permissions:[action]},action),false);
 }
 assert.equal(hasPermission({role:'SALES'},'coupon.request116'),true);
 assert.equal(hasPermission({role:'SALES'},'coupon.manual116'),false);
 assert.equal(hasPermission({role:'SALES',permissions:['coupon.manual116']},'coupon.manual116'),false);
 assert.equal(hasPermission({role:'SALES'},'rebate.conversion.request'),true);
 assert.equal(hasPermission({role:'SALES'},'so.confirm'),true);
});

test('cut requests are not advertised while native 116 is disabled',()=>{
 const saved=process.env.NATIVE_MANUAL_116_ENABLED;
 try{
  process.env.NATIVE_MANUAL_116_ENABLED='false';
  assert.equal(capabilitiesFor('SALES').actions.includes('coupon.request116'),false);
  process.env.NATIVE_MANUAL_116_ENABLED='true';
  assert.equal(capabilitiesFor('SALES').actions.includes('coupon.request116'),true);
 }finally{if(saved===undefined)delete process.env.NATIVE_MANUAL_116_ENABLED;else process.env.NATIVE_MANUAL_116_ENABLED=saved;}
});
