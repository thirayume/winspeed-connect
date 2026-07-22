// WorldFert doc-gen: PPTX matrix (training overview / per-role / support-maintenance)
// embeds mermaid diagram PNGs. pptxgenjs.
const pptxgen = require("pptxgenjs");
const path = require("path");
const fs = require("fs");
const ENT = path.resolve(__dirname, "..", "..");
const DIAG = path.join(ENT, "pipeline", "diagrams");
const OUT = path.join(ENT, "02-PPTX", "generated");
const NAVY="0C447C", NAVYDK="082A4E", GREEN="059669", ICE="CADCFC", LIGHT="F4F7FB", GRAY="5B6B7B", WHITE="FFFFFF", INK="1E2A38";
const HS="Kanit", HF="Prompt";
const DT={ "01-architecture":"สถาปัตยกรรมระบบ 3 ชั้น","02-so-lifecycle":"วงจรใบสั่งขาย (SO Lifecycle)","03-rebate-coupon-flow":"Rebate / Coupon Flow","04-rebate-sequence":"Rebate Sequence (weigh → accrual)","05-erd":"ERD (wf + dbo)","06-rbac":"RBAC · 7 Roles","07-swimlane-order-to-cash":"Swimlane · Order-to-Cash","08-uml-rebate-domain":"UML · Rebate Domain" };

const DECKS = [
 { id:"Training-Overview-v1.0", title:"Training — ภาพรวมระบบ", aud:"ผู้ใช้ทุก Role (All-hands)",
   slides:[
    {t:"WS-Sale-App คืออะไร", b:["จัดการใบสั่งขาย · คลัง · ชั่งน้ำหนัก · รีเบท/คูปอง","ต่อยอดบน WINSpeed ERP โดยไม่แตะข้อมูลเดิม (dbo READ-ONLY)","Tablet-first · 21 หน้าจอ · 7 บทบาท (RBAC)"], d:"01-architecture"},
    {t:"วงจรใบสั่งขาย", b:["Draft → Confirm → Picking → Loaded → Shipped → Invoice","ชั่งออก (SHIPPED) = จุดตั้งรีเบทอัตโนมัติ"], d:"02-so-lifecycle"},
    {t:"ระบบรีเบท/คูปอง", b:["คูปอง (WFCoupon) วัดเป็นตัน · ได้จากออเดอร์ → ใช้บนใบกำกับ → คงเหลือจน 0","รีเบทเงิน: RBT (106) · CN (109) · engine wf (บาท)"], d:"03-rebate-coupon-flow"},
    {t:"บทบาทผู้ใช้ (RBAC)", b:["SALES · COUNTER_SALES · WAREHOUSE · WEIGHBRIDGE","APPROVER · ACCOUNTING · ADMIN","สิทธิ์เห็นเมนู/ยอดรีเบทตามบทบาท"], d:"06-rbac"},
   ]},
 { id:"Training-Sales-v1.0", title:"Training — ฝ่ายขาย (Sales)", aud:"SALES · COUNTER_SALES",
   slides:[
    {t:"งานหลักของฝ่ายขาย", b:["สร้างใบสั่งขาย (I/K) · Multi-bill ในรถคันเดียว","ใบเสนอราคา → แปลงเป็น SO","ราคาต่ำกว่า NET เกิน 500 → ต้องอนุมัติ","เบิกตั๋วคุม (AI) → ตัดจาก WFCoupon"], d:"02-so-lifecycle"},
    {t:"รีเบทสำหรับการขาย", b:["ขายเกิน NET → สะสมรีเบท (ตอนชั่งออก)","ใช้รีเบทเป็นส่วนลดออเดอร์ถัดไป (FIFO)","ยอดรีเบทเห็นตามสิทธิ์"], d:"03-rebate-coupon-flow"},
   ]},
 { id:"Training-Warehouse-Weigh-v1.0", title:"Training — คลัง & ชั่งน้ำหนัก", aud:"WAREHOUSE · WEIGHBRIDGE",
   slides:[
    {t:"งานคลัง & ชั่ง", b:["Picking / Receiving queue · Visual Truck Loader (ลำดับโหลด)","Weigh Inbox: จับคู่ตั๋วชั่ง ↔ SO → SHIPPED","บันทึก WeighTicket (gross/tare/net)"], d:"07-swimlane-order-to-cash"},
    {t:"ชั่งออก → รีเบท", b:["weigh-out ทริกเกอร์ bookRebateAccrual อัตโนมัติ","TruckScale: completed-weigh read-only; tbl_keyone pre-weigh queue only"], d:"04-rebate-sequence"},
   ]},
 { id:"Training-Accounting-v1.0", title:"Training — บัญชี/การเงิน", aud:"ACCOUNTING",
   slides:[
    {t:"งานบัญชี/การเงิน", b:["รีเบท: Pool/Ledger · เคลม FIFO → CN","CN Rebate (SOInvHD 109) · ผูก RefSOID","กระทบยอด (Recon) SO ↔ WINSpeed · รายงาน"], d:"03-rebate-coupon-flow"},
    {t:"โครงข้อมูลรีเบท", b:["WFCoupon → WFRedemtion (ตัน)","wf.RebatePool/Ledger/Usage/Claim (บาท)"], d:"05-erd"},
   ]},
 { id:"Training-Admin-v1.0", title:"Training — ผู้ดูแลระบบ (Admin)", aud:"ADMIN",
   slides:[
    {t:"งานผู้ดูแลระบบ", b:["ข้อมูลหลัก: ลูกค้า/สินค้า/ราคา/รถ · Price Book (5-level color)","ผู้ใช้/บทบาท · นโยบายอนุมัติ · PDPA/Governance (audit)","สถานะระบบ (Ops)"], d:"06-rbac"},
    {t:"สถาปัตยกรรมที่ต้องรู้", b:["dbo READ-ONLY · wf writable · TruckScale bridge","GL ออกโดย WINSpeed"], d:"01-architecture"},
   ]},
 { id:"Support-Maintenance-v1.0", title:"Support & Maintenance — Technical", aud:"Support · Maintenance · DevOps",
   slides:[
    {t:"สถาปัตยกรรมระบบ", b:["3 ชั้น: App (React+Express) · wf schema · WINSpeed dbo","TruckScale (MySQL) bridge · sync ทางเดียว dbo→wf"], d:"01-architecture"},
    {t:"Work-process (Swimlane)", b:["Order-to-Cash ข้ามบทบาท: Sales → Warehouse → Weighbridge → Accounting"], d:"07-swimlane-order-to-cash"},
    {t:"SO State Machine", b:["Draft→Confirmed→Picking→Loaded→Shipped→Closed","แก้ SO ผ่าน cancel + create ใหม่"], d:"02-so-lifecycle"},
    {t:"Rebate Sequence", b:["confirm → sp_ConfirmSalesOrder → weigh-out → bookRebateAccrual","consume/claim FIFO"], d:"04-rebate-sequence"},
    {t:"ERD", b:["WFCoupon/WFRedemtion (dbo) · RebatePool/Ledger/Usage/Claim (wf)","key: DocuID · CouponID · SOInvID · SoId · LedgerId"], d:"05-erd"},
    {t:"UML — Rebate Domain", b:["RebatePool 1—* RebateLedger 1—* RebateUsage","RebatePool 1—* RebateClaim (CnDocuNo)"], d:"08-uml-rebate-domain"},
   ]},
];

function makeDeck(spec){
  const p=new pptxgen(); p.defineLayout({name:"W",width:13.333,height:7.5}); p.layout="W";
  // title
  let s=p.addSlide(); s.background={color:NAVYDK};
  s.addShape(p.ShapeType.ellipse,{x:10.4,y:-1.3,w:4.4,h:4.4,fill:{color:NAVY},line:{type:"none"}});
  s.addShape(p.ShapeType.ellipse,{x:11.8,y:4.9,w:3,h:3,fill:{color:GREEN},line:{type:"none"}});
  s.addText("World Fert · WS-Sale-App",{x:0.7,y:2.4,w:11,h:0.5,fontFace:HF,fontSize:17,color:ICE});
  s.addText(spec.title,{x:0.7,y:2.95,w:11.5,h:1.3,fontFace:HS,fontSize:40,bold:true,color:WHITE});
  s.addShape(p.ShapeType.roundRect,{x:0.72,y:4.4,w:2.2,h:0.5,rectRadius:0.25,fill:{color:GREEN},line:{type:"none"}});
  s.addText("v1.0",{x:0.72,y:4.4,w:2.2,h:0.5,align:"center",valign:"middle",fontFace:HF,fontSize:13,bold:true,color:WHITE});
  s.addText("Audience: "+spec.aud+"   ·   App 1.0.0   ·   21 ก.ค. 2569",{x:0.75,y:6.5,w:11.5,h:0.4,fontFace:HF,fontSize:12,color:"8FA6C4"});
  // agenda
  s=p.addSlide(); s.background={color:WHITE};
  s.addText("Agenda",{x:0.6,y:0.5,w:11,h:0.8,fontFace:HS,fontSize:30,bold:true,color:NAVY});
  s.addText(spec.slides.map((sl,i)=>({text:(i+1)+".  "+sl.t,options:{bullet:false,color:INK,breakLine:true,paraSpaceAfter:12}})),{x:0.9,y:1.8,w:11,h:5,fontFace:HF,fontSize:20});
  // content slides: diagram + bullets
  spec.slides.forEach(sl=>{
    const c=p.addSlide(); c.background={color:WHITE};
    c.addText(sl.t,{x:0.6,y:0.4,w:12.1,h:0.8,fontFace:HS,fontSize:26,bold:true,color:NAVY});
    const png=path.join(DIAG,sl.d+".png");
    if(fs.existsSync(png)) c.addImage({path:png,x:0.55,y:1.4,w:8.0,h:5.5,sizing:{type:"contain",w:8.0,h:5.5}});
    // bullets panel right
    c.addShape(p.ShapeType.roundRect,{x:8.75,y:1.4,w:4.0,h:5.5,rectRadius:0.08,fill:{color:LIGHT},line:{type:"none"}});
    c.addText(sl.b.map((t,i)=>({text:t,options:{bullet:{code:"2022"},color:INK,breakLine:i<sl.b.length-1,paraSpaceAfter:10}})),{x:9.0,y:1.65,w:3.55,h:5,fontFace:HF,fontSize:13,valign:"top"});
    c.addText(DT[sl.d]||"",{x:0.55,y:6.95,w:8,h:0.35,fontFace:HF,fontSize:10,italic:true,color:GRAY});
  });
  // closing
  s=p.addSlide(); s.background={color:NAVYDK};
  s.addText("ขอบคุณครับ / Thank you",{x:0.8,y:3.0,w:11.5,h:1,fontFace:HS,fontSize:34,bold:true,color:WHITE});
  s.addText("World Fert · WS-Sale-App v1.0 · "+spec.aud,{x:0.82,y:4.1,w:11.5,h:0.5,fontFace:HF,fontSize:15,color:ICE});
  return p.writeFile({fileName:path.join(OUT,spec.id+".pptx")});
}

fs.mkdirSync(OUT,{recursive:true});
(async()=>{ for(const d of DECKS){ const f=await makeDeck(d); console.log("built",path.basename(f)); } console.log("done",DECKS.length,"decks ->",OUT); })();
