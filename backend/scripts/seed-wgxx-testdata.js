/**
 * seed-wgxx-testdata.js — ใส่ข้อมูลชั่งทดสอบลง dbo.WGHD / dbo.WGDT
 *
 * สิทธิ์
 *   04/09/2569 เจ้าของระบบเปิดสิทธิ์อ่าน–เขียน dbo.WGHD/WGDT/WGDTReport เต็มรูปแบบ
 *   และยืนยันว่า 181 แถวที่เคยมีเป็นข้อมูลทดสอบล้วน จำลองใหม่ได้
 *   (ยังคงห้ามแก้ **โครงสร้าง** ของ schema dbo เหมือนเดิม — เขียนได้เฉพาะข้อมูล)
 *
 * ⚠ PROD-A (Azure) เป็นระบบที่มีผู้ใช้จริง ต้องใส่ --allow-prod-a ถึงจะยอมรัน
 *   ไม่ใช่เพราะห้าม แต่เพราะไม่ควรเกิดจากการพิมพ์คำสั่งผิด
 *
 * แถวที่สร้างจากสคริปต์นี้มี UpdateBy = 'SEED-TEST' และทะเบียนขึ้นต้น TEST-
 * จึงแยกออกจากข้อมูลจริงได้เสมอ และล้างคืนได้ด้วย --clean
 *
 * ครอบคลุมอะไร
 *   TEST-01  3 SO คันเดียว · สถานะ 1 รอเข้าชั่ง      ← เคส "รถคันเดียวหลาย SO"
 *   TEST-02  2 SO คันเดียว · สถานะ 2 ชั่งเข้าแล้ว
 *   TEST-03  1 SO         · สถานะ 3 ชั่งออกครบ + มีเลขตั๋วคุม
 *
 * ทะเบียนขึ้นต้น TEST- และ UpdateBy = 'SEED-TEST' เพื่อให้แยกออกจากของจริงได้ทันที
 *
 * ใช้:  DB_MODE=local node scripts/seed-wgxx-testdata.js [--apply]
 *      (ไม่ใส่ --apply = dry-run)
 *
 * หมายเหตุ: WGHD.Id และ WGDT.Id เป็น IDENTITY จริง ต่างจาก SOID/CouponID
 *          ที่ WINSpeed แจกเป็นบล็อกผ่าน dbo.SMID — จึงปล่อยให้ฐานออกเลขเอง
 */
require('dotenv').config({path:require('path').join(__dirname,'..','.env')});
const { query, dboWrite, sql } = require('../db');
const APPLY = process.argv.includes('--apply');
const CLEAN = process.argv.includes('--clean');
const ALLOW_PROD_A = process.argv.includes('--allow-prod-a');

// เที่ยวทดสอบ 3 เที่ยว ครอบคลุมสถานะ 1/2/3 และเคส "รถคันเดียวหลาย SO"
// ทะเบียนขึ้นต้น TEST- เพื่อให้แยกออกจากข้อมูลจริงได้ทันทีถ้าหลุดไปที่ไหน
const TRIPS = [
  { car:'TEST-01/0001', driver:1, date:'2026-09-03', status:1,   // รอเข้าชั่ง · 3 SO คันเดียว
    sos:[{soid:269606,doc:'I69-01283',cv:1108,code:'0334005',name:'บริษัท อุบลกิมบ้วนเซ้ง จำกัด',ton:12,sto:'สB',good:1118,gname:'16-8-8 เชิงผสม ตรารถเกษตร'},
         {soid:269605,doc:'I69-01282',cv:1108,code:'0334005',name:'บริษัท อุบลกิมบ้วนเซ้ง จำกัด',ton:8, sto:'คH',good:1118,gname:'16-8-8 เชิงผสม ตรารถเกษตร'},
         {soid:269603,doc:'K69-01209',cv:18006,code:'0462002-1',name:'กลุ่มชาวไร่น้ำจืด',ton:10,sto:'04',good:1118,gname:'16-8-8 เชิงผสม ตรารถเกษตร'}] },
  { car:'TEST-02/0002', driver:2, date:'2026-09-03', status:2,   // ชั่งเข้าแล้ว · 2 SO
    win:15200,
    sos:[{soid:269604,doc:'I69-01281',cv:104028,code:'0335003-2',name:'เกษตรกิจ จำกัด',ton:20,sto:'สB',good:1118,gname:'16-8-8 เชิงผสม ตรารถเกษตร'},
         {soid:268438,doc:'I69-01280',cv:23072,code:'0586026',name:'บริษัท หลังสวนแสงเพชร จำกัด',ton:14,sto:'03',good:1118,gname:'16-8-8 เชิงผสม ตรารถเกษตร'}] },
  { car:'TEST-03/0003', driver:1, date:'2026-09-02', status:3,   // ชั่งออกครบ · 1 SO
    win:14800, wout:39800,
    sos:[{soid:268435,doc:'K69-01202',cv:18006,code:'0462002-1',name:'กลุ่มชาวไร่น้ำจืด',ton:25,sto:'คH',good:1118,gname:'16-8-8 เชิงผสม ตรารถเกษตร',coupon:'C6902239'}] },
];

(async()=>{
  const db=(await query('SELECT @@SERVERNAME s, DB_NAME() d'))[0];
  const isProdA = String(process.env.DB_MODE||'').toLowerCase()==='remote';
  if (isProdA && !ALLOW_PROD_A) {
    console.error(`หยุด: เป้าหมายคือ PROD-A (${db.s}) ซึ่งมีผู้ใช้จริง`);
    console.error('      ถ้าตั้งใจจริง ใส่ --allow-prod-a');
    process.exit(1);
  }

  const rows = TRIPS.reduce((n,t)=>n+t.sos.length,0);
  console.log(`เป้าหมาย: ${db.s}/${db.d}  โหมด: ${CLEAN?'CLEAN':APPLY?'APPLY':'DRY-RUN'}`);

  const cur=(await query('SELECT COUNT(*) n FROM dbo.WGHD'))[0].n;
  const seeded=(await query(`SELECT COUNT(*) n FROM dbo.WGHD WHERE UpdateBy='SEED-TEST'`))[0].n;
  console.log(`  WGHD ปัจจุบัน: ${cur} แถว (เป็นข้อมูลทดสอบ ${seeded})`);

  // ── ล้างเฉพาะแถวที่สคริปต์นี้สร้าง ──────────────────────────
  // ลบลูกก่อนแม่ เพราะ WGDT/WGDTReport อ้าง WGHDId
  if (CLEAN) {
    const d1 = await dboWrite(`DELETE FROM dbo.WGDTReport WHERE WGHDId IN (SELECT Id FROM dbo.WGHD WHERE UpdateBy='SEED-TEST')`);
    const d2 = await dboWrite(`DELETE FROM dbo.WGDT       WHERE WGHDId IN (SELECT Id FROM dbo.WGHD WHERE UpdateBy='SEED-TEST')`);
    const d3 = await dboWrite(`DELETE FROM dbo.WGHD WHERE UpdateBy='SEED-TEST'`);
    console.log(`  ลบแล้ว — WGDTReport ${d1.rowsAffected?.[0]??0} · WGDT ${d2.rowsAffected?.[0]??0} · WGHD ${d3.rowsAffected?.[0]??0}`);
    process.exit(0);
  }

  console.log(`  จะสร้าง ${rows} แถว WGHD`);
  if(!APPLY){ console.log('  (ยังไม่ใส่ — ใส่ --apply)'); process.exit(0); }

  // กันข้อมูลจริงเท่านั้น ข้อมูลทดสอบเดิมให้ล้างด้วย --clean ก่อน
  if(cur-seeded>0){ console.log(`  ⚠ มีข้อมูลจริงอยู่ ${cur-seeded} แถว หยุดเพื่อไม่ให้ปน`); process.exit(1); }
  if(seeded>0){ console.log('  ⚠ มีข้อมูลทดสอบเดิมอยู่ — รัน --clean ก่อน'); process.exit(1); }

  let mb=6909001;
  for(const t of TRIPS){
    for(const so of t.sos){
      const kasob = so.ton*20;
      const net = t.status===3 ? Math.round(so.ton*1000) : null;
      const ins = await dboWrite(`INSERT INTO dbo.WGHD
        (DateReg,CarNo,TotalTon,TotalKasob,SPID,CVID,CVCode,CVName,DocuNo,WGType,isMulti,EMDriverId,MoveBill,
         DateIn,WeightIn,DateOut,WeightOut,WeightNet,Status,QStatus,LocationName,UpdateDate,UpdateBy,isNOQ)
        OUTPUT INSERTED.Id
        VALUES (@dreg,@car,@ton,@kasob,@spid,@cv,@code,@name,@doc,'SO',@multi,@drv,@mb,
                @din,@win,@dout,@wout,@net,@st,0,NULL,GETDATE(),'SEED-TEST',0)`, {
        dreg:{type:sql.DateTime,value:new Date(t.date+'T08:00:00')},
        car:{type:sql.VarChar(50),value:t.car}, ton:{type:sql.Decimal(18,6),value:so.ton},
        kasob:{type:sql.Decimal(18,6),value:kasob}, spid:{type:sql.Int,value:so.soid},
        cv:{type:sql.Int,value:so.cv}, code:{type:sql.VarChar(50),value:so.code},
        name:{type:sql.NVarChar(200),value:so.name}, doc:{type:sql.VarChar(50),value:so.doc},
        multi:{type:sql.Bit,value:t.sos.length>1?1:0}, drv:{type:sql.Int,value:t.driver},
        mb:{type:sql.VarChar(50),value:String(mb++)},
        din:{type:sql.DateTime,value:t.status>=2?new Date(t.date+'T09:15:00'):null},
        win:{type:sql.Decimal(18,6),value:t.status>=2?t.win:null},
        dout:{type:sql.DateTime,value:t.status>=3?new Date(t.date+'T13:40:00'):null},
        wout:{type:sql.Decimal(18,6),value:t.status>=3?t.wout:null},
        net:{type:sql.Decimal(18,6),value:net}, st:{type:sql.Int,value:t.status} });

      const newId = ins.recordset[0].Id;
      await dboWrite(`INSERT INTO dbo.WGDT
        (WGHDId,SPID,ListNo,GoodID,GoodName,GoodUnitID2,GoodUnitName,GoodQty2,Qty1,Qty2,
         GoodTon,GoodKasob,STOCode,STOCode2,CouponNo)
        VALUES (@h,@spid,1,@g,@gn,1002,N'ตัน',@ton,@ton,@kasob,@ton,@kasob,@sto,'',@cp)`, {
        h:{type:sql.Int,value:newId}, spid:{type:sql.Int,value:so.soid},
        g:{type:sql.Int,value:so.good}, gn:{type:sql.NVarChar(200),value:so.gname},
        ton:{type:sql.Decimal(18,6),value:so.ton}, kasob:{type:sql.Decimal(18,6),value:kasob},
        sto:{type:sql.VarChar(20),value:so.sto}, cp:{type:sql.VarChar(25),value:so.coupon||''} });
    }
  }
  const a=await query(`SELECT (SELECT COUNT(*) FROM dbo.WGHD) h,(SELECT COUNT(*) FROM dbo.WGDT) d`);
  console.log(`  หลังใส่: WGHD=${a[0].h} · WGDT=${a[0].d}`);
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
