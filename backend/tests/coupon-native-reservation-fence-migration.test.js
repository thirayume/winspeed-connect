'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const up=fs.readFileSync(path.join(__dirname,'../migrations/221_coupon_native_authorization_reservation_fence.sql'),'utf8');
const down=fs.readFileSync(path.join(__dirname,'../migrations/down/221_coupon_native_authorization_reservation_fence.down.sql'),'utf8');
test('authorization reservation fence ships disabled, protects update/delete, and retains expired active authorizations',()=>{
 assert.match(up,/AFTER UPDATE, DELETE/i);
 assert.match(up,/JOIN wf\.CouponNativeCutAuthorizationLine[\s\S]*JOIN wf\.CouponNativeCutAuthorization/);
 assert.match(up,/h\.State=''ACTIVE''/);
 assert.doesNotMatch(up,/h\.ExpiresAt\s*[<>]/i);
 assert.match(up,/COUPON_NATIVE_AUTH_RESERVATION_HELD/);
 assert.match(up,/ROLLBACK TRANSACTION/);
 assert.match(up,/DISABLE TRIGGER wf\.WF_CouponAuthorizationReservationFence/i);
});
test('down script rejects active and unrecognized trigger rather than removing protection silently',()=>{
 assert.match(down,/WF_AUTH_FENCE_221_V2/);
 assert.match(down,/WF_AUTH_FENCE_225_V%/);
 assert.match(down,/is_disabled=0/);
 assert.match(down,/COUPON_AUTH_FENCE_ACTIVE/);
 assert.ok(down.indexOf('COUPON_AUTH_FENCE_ACTIVE')<down.indexOf('DROP TRIGGER'));
});
