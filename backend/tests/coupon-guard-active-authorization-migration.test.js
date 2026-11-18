'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const up=fs.readFileSync(path.join(__dirname,'../migrations/222_coupon_guard_active_authorization.sql'),'utf8');
const down=fs.readFileSync(path.join(__dirname,'../migrations/down/222_coupon_guard_active_authorization.down.sql'),'utf8');
test('disabled balance guard counts expired reservations while a native authorization is active',()=>{
 assert.match(up,/r\.ExpiresAt IS NULL OR r\.ExpiresAt>GETUTCDATE\(\) OR EXISTS/);
 assert.match(up,/l\.ReservationId=r\.Id AND h\.State=''ACTIVE''/);
 assert.match(up,/DISABLE TRIGGER dbo\.WF_CouponReservationGuard/);
 assert.match(up,/is_disabled=1/);
});
test('rollback refuses an active guard or active authorizations before restoring 219',()=>{
 assert.match(down,/is_disabled=1/);
 assert.match(down,/COUPON_AUTH_GUARD_ACTIVE_AUTHORIZATIONS/);
 assert.ok(down.indexOf('COUPON_AUTH_GUARD_ACTIVE_AUTHORIZATIONS')<down.indexOf('ALTER TRIGGER'));
 assert.match(down,/DISABLE TRIGGER dbo\.WF_CouponReservationGuard/);
});
