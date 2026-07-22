const pptxgen = require("pptxgenjs");
const path = require("path");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.333, height: 7.5 });
p.layout = "W";
const NAVY="0C447C", NAVYDK="082A4E", GREEN="059669", GREENDK="04704F", ICE="CADCFC", LIGHT="F4F7FB", GRAY="5B6B7B", WHITE="FFFFFF", INK="1E2A38";
const HF="Prompt", HS="Kanit";
const W=13.333, H=7.5;

function title(s, t, sub){
  s.addText(t, {x:0.6,y:0.45,w:12.1,h:0.8,fontFace:HS,fontSize:30,bold:true,color:NAVY});
  if(sub) s.addText(sub,{x:0.62,y:1.2,w:12.1,h:0.4,fontFace:HF,fontSize:14,color:GRAY});
}
function card(s,x,y,w,h,fill){ s.addShape(p.ShapeType.roundRect,{x,y,w,h,rectRadius:0.09,fill:{color:fill||LIGHT},line:{type:"none"},shadow:{type:"outer",color:"9AA7B4",opacity:0.25,blur:6,offset:2,angle:90}}); }
function circle(s,x,y,d,fill,txt,tc){ s.addShape(p.ShapeType.ellipse,{x,y,w:d,h:d,fill:{color:fill},line:{type:"none"}}); if(txt) s.addText(txt,{x,y,w:d,h:d,align:"center",valign:"middle",fontFace:HF,fontSize:15,bold:true,color:tc||WHITE}); }
function stat(s,x,y,w,num,lab,c){ s.addText(num,{x,y,w,h:0.85,align:"center",fontFace:HS,fontSize:40,bold:true,color:c||NAVY}); s.addText(lab,{x,y:y+0.85,w,h:0.5,align:"center",fontFace:HF,fontSize:12,color:GRAY}); }

// 1 TITLE
let s=p.addSlide(); s.background={color:NAVYDK};
s.addShape(p.ShapeType.ellipse,{x:10.2,y:-1.4,w:4.6,h:4.6,fill:{color:NAVY},line:{type:"none"}});
s.addShape(p.ShapeType.ellipse,{x:11.6,y:4.7,w:3.2,h:3.2,fill:{color:GREEN},line:{type:"none"}});
s.addText("World Fert · WS-Sale-App",{x:0.7,y:2.5,w:10,h:0.5,fontFace:HF,fontSize:18,color:ICE});
s.addText("Enterprise Documentation",{x:0.7,y:3.0,w:11,h:1.1,fontFace:HS,fontSize:48,bold:true,color:WHITE});
s.addShape(p.ShapeType.roundRect,{x:0.72,y:4.35,w:2.5,h:0.5,rectRadius:0.25,fill:{color:GREEN},line:{type:"none"}});
s.addText("VERSION v1.0",{x:0.72,y:4.35,w:2.5,h:0.5,align:"center",valign:"middle",fontFace:HF,fontSize:13,bold:true,color:WHITE});
s.addText("Sales Order · Warehouse Execution · Rebate/Coupon Management",{x:0.75,y:5.05,w:11,h:0.4,fontFace:HF,fontSize:14,color:ICE});
s.addText("App 1.0.0   ·   21 กรกฎาคม 2569 (21 July 2026)   ·   Confidential",{x:0.75,y:6.6,w:11,h:0.4,fontFace:HF,fontSize:12,color:"8FA6C4"});

// 2 OVERVIEW
s=p.addSlide(); s.background={color:WHITE}; title(s,"ภาพรวมระบบ (System Overview)","แพลตฟอร์มจัดการใบสั่งขาย คลังสินค้า และรีเบท/คูปอง บนฐาน WINSpeed ERP");
const ov=[["ครอบคลุม","Sales Order · Quotation · Warehouse/Picking · Weighbridge · Paper Trail · Rebate/Coupon"],["Stack","React 19 + Vite · Express · SQL Server (WINSpeed dbo + wf) · MySQL bridge (TruckScale)"],["ผู้ใช้","7 บทบาท (RBAC) ตั้งแต่ SALES ถึง ADMIN บน tablet-first UI"]];
let yy=1.8; ov.forEach(([h,b])=>{ circle(s,0.7,yy+0.05,0.5,NAVY,"›"); s.addText(h,{x:1.4,y:yy,w:2.5,h:0.5,fontFace:HF,fontSize:16,bold:true,color:NAVY}); s.addText(b,{x:3.9,y:yy,w:8.8,h:0.7,fontFace:HF,fontSize:14,color:INK}); yy+=1.05; });
card(s,0.7,5.35,12,1.5,LIGHT);
stat(s,0.9,5.55,2.7,"125,189","ใบสั่งขายในระบบ");
stat(s,3.7,5.55,2.7,"111,192","คูปอง (Coupon)",GREEN);
stat(s,6.5,5.55,2.7,"21","หน้าจอ (Screens)");
stat(s,9.3,5.55,2.7,"7","บทบาท (Roles)",GREEN);

// 3 ARCHITECTURE
s=p.addSlide(); s.background={color:WHITE}; title(s,"สถาปัตยกรรม 3 ชั้น (Layered, Non-Invasive)","แยกส่วน App ออกจาก ERP โดยไม่แตะข้อมูลเดิม");
const arch=[["WINSpeed  ·  dbo","ERP เดิม — READ-ONLY","ออเดอร์ · คูปอง · AR · GL · ราคา",NAVY],["App  ·  wf schema","ส่วนที่พัฒนาใหม่ (เขียนได้)","SO draft · Rebate engine · Audit · Users",GREEN],["TruckScale bridge","MySQL — READ-ONLY","น้ำหนักชั่ง → Weigh Inbox","1C7293"]];
arch.forEach((a,i)=>{ const x=0.7+i*4.15; card(s,x,2.0,3.85,4.3,LIGHT); s.addShape(p.ShapeType.roundRect,{x:x,y:2.0,w:3.85,h:1.0,rectRadius:0.09,fill:{color:a[3]},line:{type:"none"}}); s.addText(a[0],{x:x+0.2,y:2.15,w:3.5,h:0.7,fontFace:HF,fontSize:17,bold:true,color:WHITE,valign:"middle"}); s.addText(a[1],{x:x+0.25,y:3.2,w:3.4,h:0.5,fontFace:HF,fontSize:13,bold:true,color:a[3]}); s.addText(a[2],{x:x+0.25,y:3.8,w:3.4,h:2.2,fontFace:HF,fontSize:13,color:INK}); });
s.addText("กติกา: dbo อ่านเป็นหลัก/เขียนเฉพาะ flow ที่อนุมัติตาม ADR-003 · GL ออกโดย WINSpeed",{x:0.7,y:6.55,w:12,h:0.4,fontFace:HF,fontSize:12,italic:true,color:GRAY});

// 4 SO LIFECYCLE
s=p.addSlide(); s.background={color:WHITE}; title(s,"วงจรใบสั่งขาย (SO Lifecycle)","DocuType mapping ระหว่าง App ↔ WINSpeed");
const steps=[["Draft","ร่าง (103)"],["Confirm","ยืนยัน"],["Picking","หยิบสินค้า"],["Loaded","โหลดขึ้นรถ"],["Shipped","ชั่งออก"],["Invoice","ปิดบิล (107)"]];
const sw=1.85, sx0=0.55, sy=3.0;
steps.forEach((st,i)=>{ const x=sx0+i*2.07; circle(s,x+0.55,sy,0.75,i%2?GREEN:NAVY,String(i+1)); s.addText(st[0],{x:x,y:sy+0.85,w:1.85,h:0.4,align:"center",fontFace:HF,fontSize:14,bold:true,color:INK}); s.addText(st[1],{x:x,y:sy+1.25,w:1.85,h:0.4,align:"center",fontFace:HF,fontSize:11,color:GRAY}); if(i<5) s.addShape(p.ShapeType.rightArrow,{x:x+1.32,y:sy+0.27,w:0.72,h:0.2,fill:{color:ICE},line:{type:"none"}}); });
card(s,0.7,5.4,12,1.2,LIGHT);
s.addText([{text:"ชั่งออก (SHIPPED) ",options:{bold:true,color:NAVY}},{text:"→ trigger การสะสมรีเบท (bookRebateAccrual) และเชื่อม WeighTicket จาก TruckScale",options:{color:INK}}],{x:0.95,y:5.65,w:11.4,h:0.7,fontFace:HF,fontSize:14,valign:"middle"});

// 5 REBATE/COUPON FLOW (flagship)
s=p.addSlide(); s.background={color:NAVYDK};
s.addText("ระบบ Rebate / Coupon (WINSpeed native)",{x:0.6,y:0.45,w:12,h:0.7,fontFace:HS,fontSize:28,bold:true,color:WHITE});
s.addText("get → use → คงเหลือจนเป็น 0 · วัดเป็นตัน (มีมิติบาทผ่าน GoodPrice)",{x:0.62,y:1.2,w:12,h:0.4,fontFace:HF,fontSize:14,color:ICE});
const rf=[["SOHD 104","ออเดอร์ต้นทาง"],["WFCoupon","คูปอง (GET) RemaQty"],["WFRedemtion","ตัดใช้ (USE)"],["SOInv 107","ใบกำกับที่ใช้"]];
rf.forEach((r,i)=>{ const x=0.75+i*3.1; s.addShape(p.ShapeType.roundRect,{x,y:2.25,w:2.7,h:1.4,rectRadius:0.09,fill:{color:i==1?GREEN:NAVY},line:{type:"none"}}); s.addText(r[0],{x:x,y:2.45,w:2.7,h:0.5,align:"center",fontFace:HF,fontSize:16,bold:true,color:WHITE}); s.addText(r[1],{x:x,y:2.95,w:2.7,h:0.6,align:"center",fontFace:HF,fontSize:12,color:ICE}); if(i<3) s.addShape(p.ShapeType.rightArrow,{x:x+2.72,y:2.83,w:0.36,h:0.24,fill:{color:GREEN},line:{type:"none"}}); });
stat(s,0.9,4.5,3.6,"111,192","คูปองในระบบ"); s.addText("",{});
stat(s,4.7,4.5,3.6,"~111,182","ใช้หมด (RemaQty=0)",GREEN);
stat(s,8.5,4.5,3.9,"RemaQty → 0","ทยอยตัดจนหมด");
[0,4.7,8.5].forEach((x,i)=>{}); // stat labels already
s.addText("WFCoupon.DocuID = SOHD.SOID · WFRedemtionDT.CouponID = WFCoupon.CouponID · WFRedemtionDT.SOInvID = SOInvHD.SOInvID",{x:0.75,y:6.7,w:12,h:0.4,fontFace:HF,fontSize:11,italic:true,color:"8FA6C4"});
// recolor stat numbers on dark
s.addText("111,192",{x:0.9,y:4.5,w:3.6,h:0.85,align:"center",fontFace:HS,fontSize:40,bold:true,color:WHITE});
s.addText("RemaQty → 0",{x:8.5,y:4.5,w:3.9,h:0.85,align:"center",fontFace:HS,fontSize:30,bold:true,color:WHITE});

// 6 REBATE VARIANTS
s=p.addSlide(); s.background={color:WHITE}; title(s,"4 กลไก Rebate ที่ต้องแยกให้ชัด","หลัก = คูปอง (ตัน) · ส่วน RBT/CN = credit note (บาท) · wf = engine ของ App");
const v=[["WFCoupon → Redemtion","dbo · ตัน","ผูกออเดอร์ครบ · ~111k · หลัก",GREEN],["RBT (SOInvHD 106)","dbo · บาท","credit note พิมพ์มือ · ไม่ผูก · 953",NAVY],["CN (SOInvHD 109)","dbo · บาท","ผูก RefSOID · 87 (2013–14)","1C7293"],["wf engine","wf · บาท","earn/use/claim · ยังไม่ต่อ dbo","7A5AA6"]];
v.forEach((c,i)=>{ const x=0.7+(i%2)*6.15, y=1.9+Math.floor(i/2)*2.35; card(s,x,y,5.85,2.05,LIGHT); circle(s,x+0.25,y+0.25,0.45,c[3]); s.addText(c[0],{x:x+0.85,y:y+0.22,w:4.8,h:0.5,fontFace:HF,fontSize:16,bold:true,color:c[3]}); s.addText(c[1],{x:x+0.85,y:y+0.72,w:4.8,h:0.4,fontFace:HF,fontSize:12,bold:true,color:GRAY}); s.addText(c[2],{x:x+0.3,y:y+1.15,w:5.3,h:0.7,fontFace:HF,fontSize:13,color:INK}); });

// 7 RBAC
s=p.addSlide(); s.background={color:WHITE}; title(s,"บทบาทผู้ใช้ (RBAC · 7 Roles)","สิทธิ์การเห็นเมนู/ข้อมูลตามบทบาท (เช่น ยอดรีเบทเห็นเฉพาะ ACCOUNTING/ADMIN/MANAGER)");
const roles=["SALES","COUNTER_SALES","WAREHOUSE","WEIGHBRIDGE","APPROVER","ACCOUNTING","ADMIN"];
roles.forEach((r,i)=>{ const x=0.7+(i%4)*3.1, y=2.2+Math.floor(i/4)*1.7; s.addShape(p.ShapeType.roundRect,{x,y,w:2.8,h:1.3,rectRadius:0.09,fill:{color:i%2?NAVY:GREEN},line:{type:"none"}}); s.addText(r,{x,y,w:2.8,h:1.3,align:"center",valign:"middle",fontFace:HF,fontSize:16,bold:true,color:WHITE}); });

// 8 MODULES
s=p.addSlide(); s.background={color:WHITE}; title(s,"โมดูล/หน้าจอ (21 Screens · 5 กลุ่มเมนู)","source-aligned กับ src/components/* — มี Test Catalog กำกับ");
const groups=[["หลัก","Dashboard · ขาย/POS · เสนอราคา · คลัง · Paper Trail · ตั๋วคงค้าง"],["การเงิน","รีเบท(App) · Rebate Plan · CN Rebate · ของแถม"],["บัญชี","บัญชี · กระทบยอด · รายงาน · ชุดตั๋วคุม"],["คลัง/ชั่ง","TruckScale · Weigh Inbox"],["ตั้งค่าระบบ","ข้อมูลหลัก · นโยบายอนุมัติ · กำกับข้อมูล(PDPA) · สถานะระบบ · ผู้ใช้งาน"]];
let gy=1.85; groups.forEach(([g,items],i)=>{ card(s,0.7,gy,12,0.86,i%2?LIGHT:"EAF1FA"); s.addText(g,{x:0.9,y:gy,w:2.4,h:0.86,valign:"middle",fontFace:HF,fontSize:16,bold:true,color:NAVY}); s.addText(items,{x:3.4,y:gy,w:9.1,h:0.86,valign:"middle",fontFace:HF,fontSize:13,color:INK}); gy+=1.0; });

// 9 QA
s=p.addSlide(); s.background={color:WHITE}; title(s,"คุณภาพ & การทดสอบ (QA)","Test Catalog ตรงกับ UI ปัจจุบัน + smoke tests อัตโนมัติ");
stat(s,0.7,2.2,3.0,"21","จอใน Test Catalog");
stat(s,3.9,2.2,3.0,"40+","Test Cases",GREEN);
stat(s,7.1,2.2,3.0,"3","Smoke suites");
stat(s,10.1,2.2,3.0,"0","encoding errors",GREEN);
card(s,0.7,4.0,12,2.4,LIGHT);
const qa=["Test Catalog ดึงหน้าจอจริงจาก source → กันปัญหา test ไม่ตรง UI","Test Log template ผูก TC-ID + app version ทุกครั้ง","pipeline เตือนอัตโนมัติเมื่อมีหน้าจอใหม่ที่ยังไม่มี test","smoke:queries / smoke:api / smoke:api:local รันซ้ำได้"];
s.addText(qa.map((t,i)=>({text:t,options:{bullet:{code:"2022"},color:INK,breakLine:i<qa.length-1,paraSpaceAfter:8}})),{x:1.0,y:4.25,w:11.4,h:2.0,fontFace:HF,fontSize:15});

// 10 PIPELINE + VERSION
s=p.addSlide(); s.background={color:WHITE}; title(s,"Doc-Sync Pipeline & Version 1.0.0","Markdown = source of truth → สร้าง docx/manifest อัตโนมัติ");
const ps=["Cleanup","Version stamp","Align check","Test drift","Render docx","Manifest"];
ps.forEach((t,i)=>{ const x=0.7+i*2.07; circle(s,x+0.55,2.3,0.7,i%2?GREEN:NAVY,String(i+1)); s.addText(t,{x:x,y:3.1,w:1.85,h:0.6,align:"center",fontFace:HF,fontSize:12,bold:true,color:INK}); if(i<5) s.addShape(p.ShapeType.rightArrow,{x:x+1.3,y:2.55,w:0.72,h:0.2,fill:{color:ICE},line:{type:"none"}}); });
card(s,0.7,4.2,12,2.2,LIGHT);
s.addText([{text:"Reconciled → 1.0.0   ",options:{bold:true,color:GREEN,fontSize:18}},{text:"source (package.json ×3) + เอกสารทั้งชุด v1.0",options:{color:INK,fontSize:15}}],{x:1.0,y:4.5,w:11.4,h:0.6,fontFace:HF});
s.addText([{text:"รันเมื่อ: ",options:{bold:true,color:NAVY}},{text:"แก้ markdown ทั่วไป · ขึ้น major version (-Version) · deploy production (-Deploy บังคับ docs=app)",options:{color:INK}}],{x:1.0,y:5.2,w:11.4,h:0.7,fontFace:HF,fontSize:14});
s.addText("Version provenance: historical build numbers retained · current package runtime = 1.0.0",{x:1.0,y:5.95,w:11.4,h:0.4,fontFace:HF,fontSize:12,italic:true,color:"B85042"});

// 11 ROADMAP
s=p.addSlide(); s.background={color:WHITE}; title(s,"Roadmap & Backlog (Section 09)","งานที่วางแผนแล้วยังไม่พัฒนา + ประเด็นเปิด — เก็บไว้ให้เห็นชัด ไม่ฝัง archive");
const rm=[["Thai Localization Roadmap","แผนบัญชี/localization ไทย — วางแผนแล้ว ยังไม่พัฒนา"],["Pending Issues","ประเด็นค้าง/known issues — เปิด"],["Open Decisions Register","การตัดสินใจที่ยังไม่ปิด"],["Delta & Risk Register","ส่วนต่างรุ่น + ความเสี่ยง"],["Legacy open items","งานค้างจากการวิเคราะห์ยุคแรก — ทบทวน"]];
let ry=1.95; rm.forEach(([h,b],i)=>{ circle(s,0.7,ry+0.02,0.5,i%2?GREEN:NAVY,String(i+1)); s.addText(h,{x:1.4,y:ry,w:4.6,h:0.5,fontFace:HF,fontSize:15,bold:true,color:NAVY}); s.addText(b,{x:6.1,y:ry,w:6.6,h:0.6,fontFace:HF,fontSize:13,color:INK}); ry+=0.95; });

// 12 DOC SET / CLOSING
s=p.addSlide(); s.background={color:NAVYDK};
s.addShape(p.ShapeType.ellipse,{x:-1.5,y:4.6,w:4,h:4,fill:{color:NAVY},line:{type:"none"}});
s.addShape(p.ShapeType.ellipse,{x:11.2,y:-1.2,w:3.4,h:3.4,fill:{color:GREEN},line:{type:"none"}});
s.addText("Enterprise Documentation v1.0",{x:0.8,y:2.3,w:11.5,h:1.0,fontFace:HS,fontSize:38,bold:true,color:WHITE});
s.addText("Review candidate · Markdown + source evidence under document control",{x:0.82,y:3.5,w:11.5,h:0.5,fontFace:HF,fontSize:18,color:ICE});
s.addText("00-GOVERNANCE → 09-ROADMAP  ·  docx · pptx · drawio · diagrams · UI · ISO records",{x:0.82,y:4.4,w:11.5,h:0.4,fontFace:HF,fontSize:13,color:"8FA6C4"});
s.addText("World Fert Co., Ltd.   ·   21 กรกฎาคม 2569   ·   App 1.0.0",{x:0.82,y:6.6,w:11.5,h:0.4,fontFace:HF,fontSize:12,color:"8FA6C4"});

const OUT=path.resolve(__dirname, "..", "..", "02-PPTX", "WorldFert-Overview-v1.0.pptx");
p.writeFile({ fileName: OUT }).then(f=>console.log("saved",f)).catch(e=>console.error("ERR",e.message));
