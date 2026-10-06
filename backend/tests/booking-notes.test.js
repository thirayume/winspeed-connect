const test=require('node:test'),assert=require('node:assert/strict');
const {validateBookingNote,validateBookingNotes}=require('../services/booking-notes');
test('booking note: trims, preserves Thai/newlines and accepts 255 characters',()=>{
 assert.equal(validateBookingNote('  รถแม่\nรถลูก  '),'รถแม่\nรถลูก');
 assert.equal(validateBookingNote('ก'.repeat(255)).length,255);
});
test('booking note: rejects 256 chars and non-874 characters with 400',()=>{
 for(const note of ['ก'.repeat(256),'😀','漢字'])assert.throws(()=>validateBookingNote(note),e=>e.status===400);
});
test('all user note fields share validation; missing and null preserved',()=>{
 assert.deepEqual(validateBookingNotes({remark:null}),{remark:null});
 for(const key of ['remark','truckRemark','billRemark'])assert.throws(()=>validateBookingNotes({[key]:'😀'}),e=>e.status===400);
 const body=validateBookingNotes({remark:' บิล ',truckRemark:' รถ ',billRemark:' เดิม '});assert.deepEqual(body,{remark:'บิล',truckRemark:'รถ',billRemark:'เดิม'});
});
