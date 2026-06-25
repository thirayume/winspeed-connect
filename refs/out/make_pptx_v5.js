// ============================================================
// WorldFert Presentation v5.0 — Light Theme (2569)
// Design Standard: Primary #0C447C | Surface #F1EFE8/#FFFFFF
// ============================================================
const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "World Fert";
pres.title  = "WS-Sale-App v5.0 — World Fert";

const FONT = "Prompt";

// ── Design Tokens (Light Theme) ──────────────────────────────
const C = {
  primary : "0C447C",  // header, primary buttons
  pLight  : "E6F1FB",  // hover, selected bg
  surface : "FFFFFF",  // card bg
  page    : "F1EFE8",  // page background
  border  : "D3D1C7",  // card borders
  text1   : "2C2C2A",  // text primary
  text2   : "888780",  // text secondary
  success : "3B6D11",  // confirmed, shipped
  succLt  : "EAF3DE",  // success bg
  rebate  : "BA7517",  // rebate accent
  rebateLt: "FAEEDA",  // rebate bg
  danger  : "A32D2D",  // danger, late
  dangerLt: "F09595",  // danger bg
  warn    : "854F0B",  // warning text
  warnLt  : "EF9F27",  // warning fill
  gray    : "D3D1C7",
  darkBg  : "1E3A5F",  // title slide only
};

const T = (s,txt,o={}) => s.addText(txt,Object.assign({fontFace:FONT},o));
const R = (runs) => runs.map(r=>({text:r.text,options:Object.assign({fontFace:FONT},r.options||{})}));

// ── Reusable helpers ─────────────────────────────────────────
function topBar(s, title, subtitle="") {
  s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:10,h:0.55,fill:{color:C.primary},line:{color:C.primary,width:0}});
  T(s,title,{x:0.3,y:0,w:7,h:0.55,fontSize:13,bold:true,color:C.pLight,align:"left",valign:"middle"});
  if(subtitle) T(s,subtitle,{x:7.2,y:0,w:2.7,h:0.55,fontSize:10,color:"B5D4F4",align:"right",valign:"middle"});
}
function card(s,x,y,w,h,{fill=C.surface}={}) {
  s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:fill},line:{color:C.border,width:0.5}});
}
function sectionHead(s,x,y,w,label) {
  s.addShape(pres.shapes.RECTANGLE,{x,y,w,h:0.26,fill:{color:C.page},line:{color:C.border,width:0.5}});
  T(s,label,{x:x+0.08,y,w:w-0.1,h:0.26,fontSize:9,bold:true,color:C.text2,align:"left",valign:"middle"});
}
function pill(s,x,y,w,h,txt,bg,fg) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w,h,fill:{color:bg},line:{color:bg,width:0},rectRadius:0.06});
  T(s,txt,{x,y,w,h,fontSize:8.5,bold:true,color:fg,align:"center",valign:"middle"});
}
function kpi(s,x,y,w,val,label,color=C.primary) {
  card(s,x,y,w,0.72);
  T(s,val,{x:x+0.1,y:y+0.04,w:w-0.2,h:0.38,fontSize:22,bold:true,color,align:"center",valign:"middle"});
  T(s,label,{x:x+0.05,y:y+0.44,w:w-0.1,h:0.22,fontSize:9,color:C.text2,align:"center",valign:"middle"});
}
function tableRow(s,x,y,w,cols,vals,isHead=false) {
  const bg = isHead?C.page:C.surface;
  s.addShape(pres.shapes.RECTANGLE,{x,y,w,h:0.25,fill:{color:bg},line:{color:C.border,width:0.3}});
  let cx=x;
  cols.forEach((cw,i)=>{
    const color = isHead?C.text2:C.text1;
    const bold = isHead;
    T(s,vals[i]||"",{x:cx+0.05,y,w:cw-0.08,h:0.25,fontSize:isHead?8:9,bold,color,align:"left",valign:"middle"});
    cx+=cw;
  });
}
function uiTopbar(s,x,y,w,title,tabs=[]) {
  s.addShape(pres.shapes.RECTANGLE,{x,y,w,h:0.32,fill:{color:C.primary},line:{color:C.primary,width:0}});
  T(s,"🌾 "+title,{x:x+0.1,y,w:2,h:0.32,fontSize:9,bold:true,color:C.pLight,align:"left",valign:"middle"});
  let tx=x+2.1;
  tabs.forEach(tab=>{
    const active=tab.startsWith("*");
    const label=active?tab.slice(1):tab;
    const bg=active?C.pLight:C.primary;
    const fg=active?C.primary:C.pLight;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:tx,y:y+0.06,w:0.7,h:0.2,fill:{color:bg},line:{color:bg,width:0},rectRadius:0.04});
    T(s,label,{x:tx,y:y+0.06,w:0.7,h:0.2,fontSize:7.5,bold:active,color:fg,align:"center",valign:"middle"});
    tx+=0.76;
  });
}
function uiField(s,x,y,w,label,value,color=C.text1) {
  T(s,label,{x,y,w,h:0.16,fontSize:7.5,bold:true,color:C.text2,align:"left",valign:"middle"});
  s.addShape(pres.shapes.RECTANGLE,{x,y:y+0.16,w,h:0.24,fill:{color:C.surface},line:{color:C.border,width:0.5}});
  T(s,value,{x:x+0.05,y:y+0.16,w:w-0.1,h:0.24,fontSize:9,color,align:"left",valign:"middle"});
}
function uiBtn(s,x,y,w,txt,bg=C.primary,fg=C.pLight) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w,h:0.3,fill:{color:bg},line:{color:bg,width:0},rectRadius:0.04});
  T(s,txt,{x,y,w,h:0.3,fontSize:9,bold:true,color:fg,align:"center",valign:"middle"});
}

// ── Slide background helper ───────────────────────────────────
function pageSetup(s) {
  s.background = {color:C.page};
}

// ══════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = {color:C.darkBg};
  s.addShape(pres.shapes.RECTANGLE,{x:0,y:4.5,w:10,h:1.25,fill:{color:C.primary},line:{color:C.primary,width:0}});
  s.addShape(pres.shapes.RECTANGLE,{x:0,y:4.5,w:0.3,h:1.25,fill:{color:"378ADD"},line:{color:"378ADD",width:0}});
  T(s,"WS-Sale-App",{x:0.5,y:0.8,w:9,h:1,fontSize:40,bold:true,color:C.pLight,align:"left"});
  T(s,"ระบบจัดการสั่งขายปุ๋ยและส่วนลดรีเบท",{x:0.5,y:1.85,w:9,h:0.5,fontSize:18,color:"B5D4F4",align:"left"});
  T(s,"บริษัท เวิลด์ เฟอท จำกัด  |  World Fert Co., Ltd.",{x:0.5,y:2.45,w:9,h:0.35,fontSize:13,color:"7FB3E0",align:"left"});
  T(s,"Prosoft WINSpeed v9.0  ·  SQL Server 2022  ·  dbwins_worldfert9",{x:0.5,y:2.9,w:9,h:0.28,fontSize:10,color:"5A8FB8",align:"left"});
  T(s,"v5.0 (Production)  ·  23 มิถุนายน 2569  ·  React 19 + Express + SQL Server (msnodesqlv8)",{x:0.5,y:4.6,w:8.8,h:0.4,fontSize:11,color:"9DC8E8",align:"left",valign:"middle"});
  T(s,"ข้อมูลยืนยันจาก query DB จริง  ·  282,087 ใบกำกับ  ·  790 ลูกค้า  ·  417 สินค้า  ·  ปี 2555–2568",{x:0.5,y:5.1,w:9,h:0.3,fontSize:9,color:"5A8FB8",align:"left"});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 2 — DB Overview
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"ภาพรวมฐานข้อมูล WINSpeed v9.0","dbwins_worldfert9 · SQL Server 2022");
  const stats=[["669","ตาราง"],["8,987","คอลัมน์"],["282,087","ใบกำกับ"],["107,018","ใบจอง/SO"],["790","ลูกค้า"],["417","สินค้า/ปุ๋ย"]];
  stats.forEach((st,i)=>kpi(s,0.2+i*1.6,0.7,1.5,st[0],st[1]));
  card(s,0.2,1.55,9.6,1.15,{fill:C.surface});
  T(s,"⚠  FK จริงมีแค่ 4 รายการ — ความสัมพันธ์ทั้งหมดใช้ Naming Convention (*ID → PK master)  |  ICStock, SOPickingHD/DT, ICPriceHD/DT, EMCreditTerm = ว่าง (ไม่ใช้)  |  EMCust.CreditAmnt = 0 ทุกราย",
    {x:0.35,y:1.6,w:9.3,h:0.3,fontSize:9.5,bold:true,color:C.warn,align:"left",valign:"middle"});
  const rows=[["ตาราง","แถว","หมายเหตุ"],["SOHD","107,018","DocuType 103=54,095 / 104=52,923"],["SOInvHD","282,087","107=146,276 / 202=113,043"],["SOInvDT","471,641","GoodID=NULL 224,571 rows (misc/service)"],["GLHD/GLDT","384,400 / 813,085","DocuType=501 ทุกแถว"],["EMGood","417","StockFlag='Y' 193 ตัว (ปุ๋ย FG)"],["EMSetPriceHD/DT","129 / 4,054","ราคา NET 2022–2025"]];
  const cols=[1.8,1.8,5.8];
  rows.forEach((r,i)=>tableRow(s,0.2,1.8+i*0.24,9.6,cols,r,i===0));
}

// ══════════════════════════════════════════════════════════════
// SLIDE 3 — DocuType & Document Chain
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"Document Flow — DocuType & Join Keys (ยืนยันจากข้อมูลจริง)");
  const chain=[["103","ใบจอง","SOHD/SODT","SOID","AppvFlag=W→Y"],["104","ใบสั่งขาย","SOHD/SODT","SOID","RefNo=AI68-XXXXX"],["107","ใบกำกับขายเชื่อ★","SOInvHD/DT","SOInvID","PostGL='Y'"],["202","Flow ลัด","SOInvHD/DT","SOInvID","DocuNo=SONo"],["109","Credit Note","SOInvHD/DT","SOInvID","RefSOID→orig"],["110","Debit Note","SOInvHD/DT","SOInvID","RefNo→orig.DocuNo"],["501","GL Journal","GLHD/GLDT","GLID","FromFlag=107"]];
  const cw=[0.7,2.2,2.0,1.3,3.2];
  tableRow(s,0.2,0.65,9.6,cw,["Type","ชื่อ","ตาราง","PK","หมายเหตุ"],true);
  chain.forEach((r,i)=>{
    const bg=r[0]==="107"?C.succLt:C.surface;
    s.addShape(pres.shapes.RECTANGLE,{x:0.2,y:0.9+i*0.26,w:9.6,h:0.26,fill:{color:bg},line:{color:C.border,width:0.3}});
    let cx=0.2;
    cw.forEach((w,ci)=>{
      const bold=ci<=1; const color=ci===1&&r[0]==="107"?C.success:C.text1;
      T(s,r[ci]||"",{x:cx+0.05,y:0.9+i*0.26,w:w-0.08,h:0.26,fontSize:9,bold,color,align:"left",valign:"middle"});
      cx+=w;
    });
  });
  card(s,0.2,2.72,9.6,0.8,{fill:C.pLight});
  T(s,"Join Keys ที่ยืนยันแล้ว:",{x:0.35,y:2.76,w:2,h:0.2,fontSize:9,bold:true,color:C.primary});
  T(s,"SOHD104.RefNo = SOHD103.AppvDocuNo  ·  SOInvHD.SONo = SOHD104.DocuNo  ·  GLHD.DocuNo = SOInvHD.DocuNo AND FromFlag=107",{x:0.35,y:2.96,w:9.2,h:0.18,fontSize:8.5,color:"0C447C"});
  T(s,"CN 109: SOInvHD.RefSOID = orig.SOInvID  ·  DN 110: SOInvHD.RefNo = orig.DocuNo (RefSOID=NULL!)  ·  รับชำระ: ARReceDT.SOInvID = SOInvHD.SOInvID",{x:0.35,y:3.16,w:9.2,h:0.18,fontSize:8.5,color:"0C447C"});
  card(s,0.2,3.6,9.6,0.8,{fill:C.surface});
  T(s,"GL Flow (ยืนยันแล้ว):",{x:0.35,y:3.64,w:2,h:0.2,fontSize:9,bold:true,color:C.text1});
  T(s,"SOHD(103→104) → SOInvHD(107, PostGL='Y') → GLHD(501, FromFlag=107) → GLDT → EMAcc",{x:0.35,y:3.84,w:9.2,h:0.18,fontSize:8.5,color:C.primary,bold:true});
  T(s,"✓ Join ถูก: GLHD.DocuNo = SOInvHD.DocuNo AND FromFlag=107  |  ✓ GLHD.FromID = SOInvHD.PostID  |  ✗ ผิด: GLHD.FromID = SOInvHD.SOInvID  |  GL: Dr 1037 / Cr 1120 · ปุ๋ยยกเว้น VAT",{x:0.35,y:4.04,w:9.2,h:0.28,fontSize:8.5,color:C.text2});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 4 — ตั๋วคุม / Weigh Flow
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"ตั๋วคุม / เข้าชั่ง-ชั่งออก — กระบวนการและข้อมูลจริง");
  const steps=[
    {label:"1  ลูกค้าจอง",detail:"SOHD DocuType=103\nAppvFlag='W' (รอชั่ง)\nTransRegistration=ทะเบียนรถ",color:C.page},
    {label:"2  เข้าชั่ง",detail:"AppvFlag → 'Y'\nAppvDocuNo → 'AI68-XXXXX'\nAppvDate → วันที่ชั่ง",color:C.pLight},
    {label:"3  ชั่งออก / ปิด",detail:"SOHD DocuType=104\nRefNo = AppvDocuNo (AI...)\nSODT.Refno = 'AI68-XXXXX'",color:C.page},
    {label:"4  ออกใบกำกับ",detail:"SOInvHD DocuType=107\nSONo = SOHD104.DocuNo\nPostGL='Y'",color:C.pLight},
  ];
  steps.forEach((st,i)=>{
    card(s,0.2+i*2.42,0.65,2.3,2.0,{fill:st.color});
    T(s,st.label,{x:0.28+i*2.42,y:0.7,w:2.1,h:0.3,fontSize:11,bold:true,color:C.primary});
    T(s,st.detail,{x:0.28+i*2.42,y:1.04,w:2.14,h:1.4,fontSize:9,color:C.text1,align:"left",valign:"top"});
    if(i<3) T(s,"→",{x:2.38+i*2.42,y:1.1,w:0.2,h:0.3,fontSize:16,color:C.text2,align:"center"});
  });
  card(s,0.2,2.75,9.6,0.6,{fill:"FFF3CD"});
  T(s,"⚠  ไม่มีใน WINSpeed — ต้องสร้างใน schema wf:",{x:0.35,y:2.78,w:3,h:0.2,fontSize:9,bold:true,color:C.warn});
  T(s,"wf.WeighTicket: Gross/Tare/Net weight (kg) + weighInAt + weighOutAt timestamps  |  ไม่มี Gross/Tare/Net weight ใน WS  |  ไม่มี Weigh timestamp  |  BTCar/TMTruck ว่าง (0 rows)",{x:0.35,y:2.98,w:9.2,h:0.3,fontSize:8.5,color:C.warn});
  card(s,0.2,3.45,9.6,0.85,{fill:C.surface});
  T(s,"ข้อมูลจริง:",{x:0.35,y:3.48,w:1.5,h:0.2,fontSize:9,bold:true,color:C.text1});
  const nums=[["รอชั่ง Active (W,Y)","28,290"],["ผ่านชั่ง Active (Y,Y)","24,632"],["AppvDocuNo prefix 'AI'","25,639 (99.8%)"],["SO 104 อ้างตั๋วคุม","52,923"]];
  nums.forEach((n,i)=>{
    T(s,n[0]+":",{x:0.35+i*2.4,y:3.7,w:1.6,h:0.2,fontSize:8.5,color:C.text2});
    T(s,n[1],{x:0.35+i*2.4,y:3.9,w:1.6,h:0.28,fontSize:14,bold:true,color:C.primary});
  });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 5 — Design System (Light Theme Standard)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"UI/UX Design System — Light Theme Standard v5.0","React 19 + Vite + TypeScript + Tailwind v4 + lucide-react");
  const swatches=[
    ["Primary","0C447C","E6F1FB","Header, primary actions","Light hover, selected"],
    ["Surface","FFFFFF","F1EFE8","Card background","Page background"],
    ["Border","D3D1C7","888780","0.5px all cards","Text secondary"],
    ["Success","3B6D11","EAF3DE","Confirmed, shipped","Success bg"],
    ["Rebate","BA7517","FAEEDA","Rebate accrual","Rebate bg"],
    ["Danger","A32D2D","F09595","Error, late >45d","Danger bg"],
  ];
  swatches.forEach((sw,i)=>{
    const x=0.2+i*1.6; const y=0.65;
    s.addShape(pres.shapes.RECTANGLE,{x,y,w:0.7,h:0.4,fill:{color:sw[1]},line:{color:C.border,width:0.5}});
    s.addShape(pres.shapes.RECTANGLE,{x:x+0.74,y,w:0.7,h:0.4,fill:{color:sw[2]},line:{color:C.border,width:0.5}});
    T(s,sw[0],{x,y:y+0.42,w:1.45,h:0.18,fontSize:8.5,bold:true,color:C.text1,align:"left"});
    T(s,"#"+sw[1]+" / #"+sw[2],{x,y:y+0.6,w:1.45,h:0.18,fontSize:7.5,color:C.text2});
    T(s,sw[3]+" / "+sw[4],{x,y:y+0.78,w:1.45,h:0.26,fontSize:7.5,color:C.text2,align:"left",valign:"top"});
  });
  card(s,0.2,1.7,5.5,1.1,{fill:C.surface});
  sectionHead(s,0.2,1.7,5.5,"Status Pills");
  const pills=[["DRAFT","D3D1C7","444441"],["CONFIRMED","97C459","27500A"],["PICKING","EF9F27","412402"],["SHIPPED","85B7EB","042C53"],["CANCELLED","F09595","501313"]];
  pills.forEach((p,i)=>pill(s,0.3+i*1.06,1.98,0.98,0.22,p[0],p[1],p[2]));
  T(s,">30 วัน = เหลือง  |  >45 วัน = แดง",{x:0.3,y:2.24,w:5.2,h:0.2,fontSize:8.5,color:C.text2});
  T(s,"Font: Prompt (Thai) / System-UI  |  Touch target ≥ 44px  |  Tablet-first 768–1024px  |  Radius: 8px card / 6px input / 4px pill",{x:0.3,y:2.48,w:5.1,h:0.26,fontSize:8.5,color:C.text2});
  card(s,5.8,1.7,4.0,1.1,{fill:C.surface});
  sectionHead(s,5.8,1.7,4.0,"Typography Scale");
  T(s,"Title",{x:5.9,y:1.96,w:3.8,h:0.22,fontSize:14,bold:true,color:C.text1});
  T(s,"Section Header",{x:5.9,y:2.18,w:3.8,h:0.18,fontSize:11,bold:true,color:C.text1});
  T(s,"Body text / 46-0-0 ยูเรีย",{x:5.9,y:2.36,w:3.8,h:0.18,fontSize:9.5,color:C.text1});
  T(s,"LABEL  ·  Caption ฿18,500/ตัน",{x:5.9,y:2.54,w:3.8,h:0.18,fontSize:8,color:C.text2});
  card(s,0.2,2.88,9.6,0.55,{fill:C.surface});
  sectionHead(s,0.2,2.88,9.6,"Component Tokens");
  T(s,"Border: 0.5px solid #D3D1C7  |  Card radius: 8px  |  Page bg: #F1EFE8  |  Card bg: #FFFFFF  |  Header bg: #0C447C  |  Btn Primary: #0C447C/#E6F1FB  |  Btn Confirm: #3B6D11/#EAF3DE  |  Input height: 44px  |  Icon: Tabler Outline",{x:0.35,y:3.14,w:9.2,h:0.22,fontSize:8.5,color:C.text2});
  T(s,"7 บทบาทผู้ใช้: SALES · COUNTER_SALES · WAREHOUSE · WEIGHBRIDGE · APPROVER · ACCOUNTING · ADMIN",{x:0.35,y:3.36,w:9.2,h:0.18,fontSize:8.5,color:C.text2});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 6 — UI: Dashboard
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"UI — 13.2 Dashboard (real-time)","Counter Sales / Warehouse / Approver");
  uiTopbar(s,0.15,0.58,9.7,"WS-Sale-App",["*Dashboard","SO สั่งขาย","Rebate","ของแถม","รายงาน"]);
  const kpis=[["142","ตั๋วคงค้าง","A32D2D"],["18","รอชั่งวันนี้","BA7517"],["7","รถในโรงงาน","0C447C"],["฿2.4M","Rebate pool","3B6D11"],["34","SO วันนี้","0C447C"]];
  kpis.forEach((k,i)=>{
    card(s,0.15+i*1.92,0.95,1.85,0.6,{fill:C.surface});
    T(s,k[0],{x:0.15+i*1.92,y:0.98,w:1.85,h:0.32,fontSize:18,bold:true,color:k[2],align:"center"});
    T(s,k[1],{x:0.15+i*1.92,y:1.3,w:1.85,h:0.18,fontSize:8,color:C.text2,align:"center"});
  });
  card(s,0.15,1.62,4.8,2.4,{fill:C.surface});
  sectionHead(s,0.15,1.62,4.8,"ตั๋วคงค้าง aging  (>30d=🟡 >45d=🔴)");
  const atCols=[1.6,1.4,0.8,1.1];
  tableRow(s,0.15,1.88,4.8,atCols,["ลูกค้า","สูตร/ตัน","วัน","สถานะ"],true);
  const aging=[["บ.ปุ๋ยสุโขทัย","46-0-0/40ต","52","รอชั่ง"],["หจก.เกษตรอีสาน","15-15-15/20ต","38","Confirm"],["ร้านชัยเกษตร","0-0-60/10ต","31","Confirm"],["บ.เจริญผล","16-20-0/60ต","22","Picking"],["บ.รุ่งเรือง","21-0-0/35ต","15","Shipped"]];
  aging.forEach((r,i)=>{
    const bg=r[2]>45?C.dangerLt:r[2]>30?"FFF3CD":C.surface;
    s.addShape(pres.shapes.RECTANGLE,{x:0.15,y:2.13+i*0.25,w:4.8,h:0.25,fill:{color:bg},line:{color:C.border,width:0.3}});
    T(s,r[0],{x:0.2,y:2.13+i*0.25,w:1.55,h:0.25,fontSize:8.5,color:C.text1,align:"left",valign:"middle"});
    T(s,r[1],{x:1.77,y:2.13+i*0.25,w:1.35,h:0.25,fontSize:8.5,color:C.text1,align:"left",valign:"middle"});
    T(s,r[2]+" วัน",{x:3.14,y:2.13+i*0.25,w:0.75,h:0.25,fontSize:8.5,bold:true,color:parseInt(r[2])>45?C.danger:parseInt(r[2])>30?C.warn:C.success,align:"center",valign:"middle"});
    T(s,r[3],{x:3.91,y:2.13+i*0.25,w:1.05,h:0.25,fontSize:8.5,color:C.text2,align:"center",valign:"middle"});
  });
  card(s,5.05,1.62,4.8,2.4,{fill:C.surface});
  sectionHead(s,5.05,1.62,4.8,"สถานะรถ / Rebate Pool");
  const trucks=[["สท 70-4239/40","46-0-0(40t)","กำลังรับ","EF9F27"],["นบ 80-1234/35","21-0-0(35t)","กำลังรับ","EF9F27"],["ชม 90-5678","0-0-60(10t)","รอคิว","D3D1C7"],["กก 60-9012","16-20-0(60t)","ออกแล้ว","3B6D11"]];
  trucks.forEach((t,i)=>{
    s.addShape(pres.shapes.RECTANGLE,{x:5.1,y:1.9+i*0.3,w:4.7,h:0.28,fill:{color:C.page},line:{color:C.border,width:0.3}});
    T(s,t[0],{x:5.15,y:1.9+i*0.3,w:1.3,h:0.28,fontSize:8.5,bold:true,color:C.text1,align:"left",valign:"middle"});
    T(s,t[1],{x:6.48,y:1.9+i*0.3,w:1.5,h:0.28,fontSize:8.5,color:C.text2,align:"left",valign:"middle"});
    pill(s,8.0,1.94+i*0.3,0.95,0.2,t[2],t[3],"FFFFFF");
  });
  sectionHead(s,5.05,3.1,4.8,"Rebate pool (Sales)");
  const rbs=[["ภาคเหนือ — สมชาย","฿684,000","55"],["ภาคกลาง — วิชัย","฿432,000","35"],["ภาคตะวันออก","฿1,230,000","82"],["ภาคใต้ — ปิยะ","฿54,800","18"]];
  rbs.forEach((r,i)=>{
    s.addShape(pres.shapes.RECTANGLE,{x:5.1,y:3.36+i*0.34,w:4.7,h:0.28,fill:{color:C.page},line:{color:C.border,width:0.3}});
    T(s,r[0],{x:5.18,y:3.36+i*0.34,w:2.2,h:0.28,fontSize:8.5,color:C.text1,align:"left",valign:"middle"});
    s.addShape(pres.shapes.RECTANGLE,{x:7.4,y:3.4+i*0.34,w:1.4,h:0.1,fill:{color:"FAC775"},line:{color:"FAC775",width:0}});
    s.addShape(pres.shapes.RECTANGLE,{x:7.4,y:3.4+i*0.34,w:1.4*parseInt(r[2])/100,h:0.1,fill:{color:C.rebate},line:{color:C.rebate,width:0}});
    T(s,r[1],{x:8.85,y:3.36+i*0.34,w:0.9,h:0.28,fontSize:8.5,bold:true,color:C.warn,align:"right",valign:"middle"});
  });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 7 — UI: SO POS (Sales Order)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"UI — 13.3 ใบสั่งขาย (SO) — POS Mode","Sales / Counter Sales · Tablet-first");
  uiTopbar(s,0.15,0.58,9.7,"WS-Sale-App",["Dashboard","*SO สั่งขาย","Rebate","ของแถม","รายงาน"]);
  const prefixTabs=[["I — เชื่อม",true],["K — คลัง",false],["AI — ตั๋วคุม",false]];
  prefixTabs.forEach((pt,i)=>{
    const bg=pt[1]?C.pLight:C.page;
    const fg=pt[1]?C.primary:C.text2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:0.15+i*1.0,y:0.93,w:0.92,h:0.22,fill:{color:bg},line:{color:C.border,width:0.5},rectRadius:0.06});
    T(s,pt[0],{x:0.15+i*1.0,y:0.93,w:0.92,h:0.22,fontSize:7.5,bold:pt[1],color:fg,align:"center",valign:"middle"});
  });
  T(s,"I69-03842",{x:3.25,y:0.96,w:1.2,h:0.18,fontSize:9,bold:true,color:C.primary,align:"center"});
  pill(s,4.5,0.96,0.8,0.18,"DRAFT","D3D1C7","444441");
  T(s,"22 มิ.ย. 2569",{x:5.35,y:0.96,w:1.2,h:0.18,fontSize:8.5,color:C.text2});
  uiField(s,0.15,1.22,2.2,"ลูกค้า","บ.ปุ๋ยสุโขทัย จก.");
  uiField(s,2.45,1.22,1.8,"ทะเบียนรถ","สท 70-4239/40");
  uiField(s,4.35,1.22,1.4,"วันส่ง","22/06/2569");
  s.addShape(pres.shapes.RECTANGLE,{x:5.85,y:1.22,w:1.8,h:0.16,fill:{color:C.surface},line:{width:0}});
  T(s,"Rebate pool:",{x:5.85,y:1.22,w:1.2,h:0.16,fontSize:7.5,color:C.text2});
  s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:5.85,y:1.38,w:1.8,h:0.24,fill:{color:C.rebateLt},line:{color:C.rebate,width:0.5},rectRadius:0.04});
  T(s,"฿ 42,800 คงเหลือ",{x:5.85,y:1.38,w:1.8,h:0.24,fontSize:8.5,bold:true,color:C.warn,align:"center",valign:"middle"});
  card(s,0.15,1.72,5.75,3.5,{fill:C.surface});
  sectionHead(s,0.15,1.72,5.75,"สินค้า / ปุ๋ย (แตะเพื่อเพิ่ม)");
  s.addShape(pres.shapes.RECTANGLE,{x:0.15,y:1.98,w:5.75,h:0.28,fill:{color:C.page},line:{color:C.border,width:0.3}});
  T(s,"🔍  ค้นหาสูตรปุ๋ย เช่น 46-0-0, 15-5...",{x:0.25,y:1.98,w:3,h:0.28,fontSize:8.5,color:C.text2,valign:"middle"});
  ["ทั้งหมด","N สูง","NPK","K สูง"].forEach((f,i)=>{
    const bg=i===0?C.primary:C.page;
    const fg=i===0?C.pLight:C.text2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:3.25+i*0.6,y:2.02,w:0.55,h:0.2,fill:{color:bg},line:{color:C.border,width:0.3},rectRadius:0.04});
    T(s,f,{x:3.25+i*0.6,y:2.02,w:0.55,h:0.2,fontSize:7,bold:i===0,color:fg,align:"center",valign:"middle"});
  });
  const prods=[["46-0-0","ยูเรีย","฿18,500","NET ฿17,200","Reb ฿1,300",true],["21-0-0","แอมโมเนียม","฿15,900","NET ฿14,800","Reb ฿1,100",false],["15-15-15","สูตรกลาง","฿17,200","NET ฿16,100","Reb ฿1,100",false],["0-0-60","โพแทส","฿19,800","NET ฿18,500","Reb ฿1,300",false],["15-5-35","K สูง","฿18,100","NET ฿17,000","Reb ฿1,100",false],["16-20-0","แอมโมเนียมP","฿16,800","NET ฿15,600","Reb ฿1,200",false]];
  prods.forEach((p,i)=>{
    const col=i%3; const row=Math.floor(i/3);
    const x=0.22+col*1.88; const y=2.32+row*1.4;
    const bg=p[5]?C.succLt:C.surface;
    const bd=p[5]?C.success:C.border;
    s.addShape(pres.shapes.RECTANGLE,{x,y,w:1.8,h:1.25,fill:{color:bg},line:{color:bd,width:p[5]?1:0.5}});
    T(s,p[0],{x:x+0.06,y:y+0.06,w:1.68,h:0.22,fontSize:11,bold:true,color:p[5]?C.success:C.text1});
    T(s,p[1],{x:x+0.06,y:y+0.28,w:1.68,h:0.18,fontSize:8,color:C.text2});
    T(s,p[2]+"/ตัน",{x:x+0.06,y:y+0.46,w:1.68,h:0.22,fontSize:10,bold:true,color:C.primary});
    T(s,p[3],{x:x+0.06,y:y+0.68,w:1.68,h:0.16,fontSize:7.5,color:C.text2});
    pill(s,x+0.06,y+0.86,1.0,0.18,p[4],C.rebateLt,C.warn);
    const btnBg=p[5]?C.success:C.primary;
    s.addShape(pres.shapes.RECTANGLE,{x:x+0.06,y:y+1.06,w:1.68,h:0.15,fill:{color:btnBg},line:{color:btnBg,width:0}});
    T(s,p[5]?"✓ เพิ่มแล้ว":"+ เพิ่ม",{x:x+0.06,y:y+1.06,w:1.68,h:0.15,fontSize:8,bold:true,color:"FFFFFF",align:"center"});
  });
  s.addShape(pres.shapes.RECTANGLE,{x:0.15,y:5.05,w:5.75,h:0.35,fill:{color:"FFF8E6"},line:{color:"FAC775",width:0.5}});
  T(s,"🎁  ของแถม — งบ ฿18,500 คงเหลือ",{x:0.25,y:5.05,w:2,h:0.2,fontSize:8.5,bold:true,color:C.warn});
  ["เสื้อ WF","กระเป๋า WF","กระสอบเปล่า"].forEach((g,i)=>{
    pill(s,2.4+i*1.1,5.1,1.0,0.22,g,C.rebateLt,C.warn);
  });
  card(s,6.0,1.72,3.85,4.0,{fill:C.surface});
  sectionHead(s,6.0,1.72,3.85,"รายการสั่ง (Order Summary)");
  s.addShape(pres.shapes.RECTANGLE,{x:6.0,y:1.98,w:3.85,h:1.1,fill:{color:C.succLt},line:{color:C.success,width:0.5}});
  T(s,"46-0-0  ยูเรีย",{x:6.1,y:2.02,w:2,h:0.22,fontSize:9,bold:true,color:C.success});
  T(s,"30 ตัน = 600 กระสอบ",{x:6.1,y:2.24,w:2,h:0.18,fontSize:8.5,color:C.text2});
  T(s,"฿555,000",{x:7.5,y:2.02,w:1.25,h:0.22,fontSize:10,bold:true,color:C.primary,align:"right"});
  s.addShape(pres.shapes.RECTANGLE,{x:6.1,y:2.44,w:1.1,h:0.28,fill:{color:C.page},line:{color:C.border,width:0.5}});
  T(s,"−  30  +",{x:6.1,y:2.44,w:1.1,h:0.28,fontSize:11,bold:true,color:C.primary,align:"center",valign:"middle"});
  s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:7.25,y:2.48,w:1.5,h:0.2,fill:{color:C.rebateLt},line:{color:C.rebate,width:0.3},rectRadius:0.04});
  T(s,"Rebate ฿39,000",{x:7.25,y:2.48,w:1.5,h:0.2,fontSize:7.5,bold:true,color:C.warn,align:"center",valign:"middle"});
  s.addShape(pres.shapes.RECTANGLE,{x:6.0,y:3.14,w:3.85,h:0.5,fill:{color:C.page},line:{color:C.border,width:0.3}});
  T(s,"ยอดสินค้า",{x:6.1,y:3.17,w:2,h:0.18,fontSize:8.5,color:C.text2});
  T(s,"฿555,000",{x:8.3,y:3.17,w:1.45,h:0.18,fontSize:8.5,color:C.text1,align:"right"});
  T(s,"Rebate accrual",{x:6.1,y:3.35,w:2,h:0.18,fontSize:8.5,color:C.warn});
  T(s,"฿39,000",{x:8.3,y:3.35,w:1.45,h:0.18,fontSize:8.5,color:C.warn,align:"right"});
  s.addShape(pres.shapes.RECTANGLE,{x:6.0,y:3.64,w:3.85,h:0.32,fill:{color:C.primary},line:{color:C.primary,width:0}});
  T(s,"ยอดสุทธิ  ฿555,000",{x:6.1,y:3.64,w:3.65,h:0.32,fontSize:11,bold:true,color:C.pLight,align:"center",valign:"middle"});
  uiBtn(s,6.05,4.06,3.75,"✓  ยืนยัน SO — ตั้ง Rebate accrual",C.success,C.succLt);
}

// ══════════════════════════════════════════════════════════════
// SLIDE 8 — UI: Rebate Pool + FIFO Ledger
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"UI — 13.5 Rebate Pool — FIFO Ledger + Claim","Sales / Accounting");
  uiTopbar(s,0.15,0.58,9.7,"WS-Sale-App",["Dashboard","SO สั่งขาย","*Rebate","ของแถม","รายงาน"]);
  const rKpis=[["฿1,240,000","Allocated","0C447C"],["฿684,000","Accrual ตั้งไว้","3B6D11"],["฿280,000","Claimed แล้ว","BA7517"],["฿404,000","คงเหลือ","A32D2D"]];
  rKpis.forEach((k,i)=>{
    card(s,0.15+i*2.4,0.88,2.3,0.56,{fill:C.surface});
    T(s,k[0],{x:0.15+i*2.4,y:0.9,w:2.3,h:0.28,fontSize:16,bold:true,color:k[2],align:"center"});
    T(s,k[1],{x:0.15+i*2.4,y:1.18,w:2.3,h:0.18,fontSize:8.5,color:C.text2,align:"center"});
  });
  card(s,0.15,1.52,9.7,2.7,{fill:C.surface});
  sectionHead(s,0.15,1.52,9.7,"FIFO Ledger — สมชาย / ภาคเหนือ / มิ.ย. 2569");
  const lCols=[0.5,1.1,1.4,0.7,1.0,1.0,1.1,1.2,1.7];
  tableRow(s,0.15,1.78,9.7,lCols,["#","SO/Invoice","สูตร","ตัน","ราคาขาย","NET/ตัน","Reb/ตัน","รวม","สถานะ"],true);
  const ledger=[["1","I69-03511","46-0-0","40","฿18,500","฿17,200","฿1,300","฿52,000","ตัดแล้ว","EAF3DE","27500A"],["2","I69-03598","15-15-15","20","฿17,200","฿16,100","฿1,100","฿22,000","ตัดแล้ว","EAF3DE","27500A"],["3","I69-03720","0-0-60","16","฿19,800","฿18,500","฿1,300","฿20,800","pending","FAEEDA","633806"],["4","I69-03842","46-0-0","30","฿18,500","฿17,200","฿1,300","฿39,000","accrual","E6F1FB","0C447C"]];
  ledger.forEach((r,i)=>{
    s.addShape(pres.shapes.RECTANGLE,{x:0.15,y:2.03+i*0.27,w:9.7,h:0.27,fill:{color:C.surface},line:{color:C.border,width:0.3}});
    let cx=0.15;
    const vals=[r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8]];
    vals.forEach((v,ci)=>{
      const color=ci===1?C.primary:ci===8?r[10]:C.text1;
      T(s,v,{x:cx+0.04,y:2.03+i*0.27,w:lCols[ci]-0.06,h:0.27,fontSize:8.5,color,align:"left",valign:"middle"});
      cx+=lCols[ci];
    });
    if(i<3){
      s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:8.7,y:2.06+i*0.27,w:1.1,h:0.18,fill:{color:r[9]},line:{color:r[9],width:0},rectRadius:0.04});
      T(s,r[8],{x:8.7,y:2.06+i*0.27,w:1.1,h:0.18,fontSize:7.5,bold:true,color:r[10],align:"center",valign:"middle"});
    }
  });
  s.addShape(pres.shapes.RECTANGLE,{x:0.15,y:4.18,w:9.7,h:0.32,fill:{color:C.page},line:{color:C.border,width:0.5}});
  uiBtn(s,0.25,4.22,2.5,"สร้าง Claim → CN (109)",C.success,C.succLt);
  T(s,"ยอด pending: ฿20,800  ·  ต้องการอนุมัติ Accounting  ·  Claim ประเภท: คืนรีเบท / คืนส่วนต่าง",{x:2.85,y:4.24,w:6.9,h:0.2,fontSize:8.5,color:C.text2,valign:"middle"});
  card(s,0.15,4.58,9.7,0.9,{fill:"FFF8E6"});
  T(s,"ตัวอย่างจริง — RBD68-019 (฿55,800)",{x:0.3,y:4.62,w:3,h:0.2,fontSize:9,bold:true,color:C.warn});
  const ex=[["15-5-35","19ต","฿18,200","฿17,000","฿1,200","฿22,800"],["0-0-60","16ต","฿13,200","฿12,500","฿700","฿11,200"],["21-0-0","8ต","฿8,200","฿7,700","฿500","฿4,000"]];
  const exCols=[1.1,0.6,1.0,1.0,1.0,1.0];
  tableRow(s,0.15,4.82,6.8,exCols,["สูตร","ตัน","ราคาขาย","NET","Reb/ตัน","รวม"],true);
  ex.forEach((r,i)=>tableRow(s,0.15,5.07+i*0.22,6.8,exCols,r));
}

// ══════════════════════════════════════════════════════════════
// SLIDE 9 — UI: Paper Trail + SO State Machine
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"UI — 13.9 Paper Trail Kanban + 13.4 SO State Machine","Warehouse / Counter Sales");
  uiTopbar(s,0.15,0.58,9.7,"WS-Sale-App",["Dashboard","SO สั่งขาย","Rebate","ของแถม","*Paper Trail"]);
  const cols=[["รอพิมพ์","3","D3D1C7","444441"],["พิมพ์แล้ว","6","D3D1C7","444441"],["จ่ายออก","3","D3D1C7","444441"],["รับคืน","2","97C459","27500A"],["ยืนยันครบ","8","97C459","27500A"]];
  cols.forEach((col,ci)=>{
    const x=0.15+ci*1.92;
    s.addShape(pres.shapes.RECTANGLE,{x,y:0.9,w:1.85,h:3.5,fill:{color:C.page},line:{color:C.border,width:0.5}});
    s.addShape(pres.shapes.RECTANGLE,{x,y:0.9,w:1.85,h:0.25,fill:{color:C.page},line:{color:C.border,width:0.5}});
    T(s,col[0],{x:x+0.06,y:0.9,w:1.2,h:0.25,fontSize:8.5,bold:true,color:C.text1,valign:"middle"});
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:x+1.3,y:0.94,w:0.45,h:0.17,fill:{color:col[2]},line:{color:col[2],width:0},rectRadius:0.04});
    T(s,col[1],{x:x+1.3,y:0.94,w:0.45,h:0.17,fontSize:7.5,bold:true,color:col[3],align:"center",valign:"middle"});
    const cards = ci===0?[["I69-03842","บ.ปุ๋ยสุโขทัย","46-0-0/30ต","warn"],["K69-01512","หจก.เกษตร","15-15-15/20ต",""],["I69-03801","ร้านชัย","0-0-60/10ต",""]]:
                   ci===1?[["I69-03798","บ.เจริญผล","16-20-0/60ต",""],["I69-03750","บ.ปุ๋ยสุโขทัย","21-0-0/25ต","late"],["K69-01508","ร้านชัย","15-5-35/8ต",""]]:
                   ci===2?[["I69-03789","บ.รุ่งเรือง","46-0-0/50ต",""],["I69-03777","หจก.สมบูรณ์","16-16-16/30ต",""]]:
                   ci===3?[["I69-03701","บ.เจริญผล","13-13-21/15ต",""],["K69-01490","ร้านรุ่งสว่าง","46-0-0/20ต",""]]:
                          [["I69-03680","บ.ปุ๋ยสุโขทัย","46-0-0/80ต",""],["K69-01450","หจก.เกษตร","0-0-60/12ต",""]];
    cards.forEach((c,ci2)=>{
      const cy=1.2+ci2*0.72;
      const bd=c[3]==="late"?"A32D2D":c[3]==="warn"?"EF9F27":C.border;
      s.addShape(pres.shapes.RECTANGLE,{x:x+0.06,y:cy,w:1.73,h:0.64,fill:{color:C.surface},line:{color:bd,width:c[3]?1:0.5}});
      T(s,c[0],{x:x+0.1,y:cy+0.04,w:1.65,h:0.18,fontSize:8.5,bold:true,color:C.primary});
      T(s,c[1],{x:x+0.1,y:cy+0.22,w:1.65,h:0.16,fontSize:7.5,color:C.text2});
      T(s,c[2],{x:x+0.1,y:cy+0.38,w:1.3,h:0.16,fontSize:7.5,color:C.text1});
      s.addShape(pres.shapes.RECTANGLE,{x:x+1.45,y:cy+0.42,w:0.22,h:0.16,fill:{color:C.text1},line:{color:C.text1,width:0}});
    });
  });
  card(s,0.15,4.52,9.7,1.0,{fill:C.surface});
  sectionHead(s,0.15,4.52,9.7,"SO State Machine — wf.SalesOrder");
  const states=[["DRAFT","แก้ได้ทุก field","888780"],["CONFIRMED","ตั้ง Rebate accrual","BA7517"],["PICKING","จัดของ (ห้ามแก้)","3B6D11"],["SHIPPED","ส่ง import → WS","0C447C"]];
  states.forEach((st,i)=>{
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:0.25+i*2.38,y:4.78,w:2.2,h:0.38,fill:{color:C.page},line:{color:st[2],width:1},rectRadius:0.05});
    T(s,st[0],{x:0.25+i*2.38,y:4.78,w:2.2,h:0.22,fontSize:10,bold:true,color:st[2],align:"center",valign:"middle"});
    T(s,st[1],{x:0.25+i*2.38,y:5.0,w:2.2,h:0.16,fontSize:7.5,color:C.text2,align:"center"});
    if(i<3) T(s,"→",{x:2.35+i*2.38,y:4.86,w:0.15,h:0.22,fontSize:12,color:C.text2,align:"center"});
  });
  T(s,"Unlock → กลับ DRAFT + Reverse accrual (reversedFlag=1, ไม่ลบ)  ·  ทุก transition → wf.SalesOrderAudit (actor, IP, timestamp, before/after JSON) · immutable 7 ปี",{x:0.25,y:5.2,w:9.3,h:0.2,fontSize:8.5,color:C.text2});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 10 — UI: Giveaway + Approval
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"UI — 13.7 ของแถม & 13.10 อนุมัติ/Unlock","Sales / Approver");
  card(s,0.15,0.62,4.75,4.85,{fill:C.surface});
  sectionHead(s,0.15,0.62,4.75,"13.7 ของแถม (Giveaway)");
  const gives=[["เสื้อ World Fert","P00001","48","เหนือ ฿45,000 / ฿62,000"],["กระเป๋า WF","P00002","12","กลาง ฿18,500 / ฿30,000"],["กระสอบเปล่า","P00010","200","ตะวันออก ฿22,000 / ฿40,000"]];
  gives.forEach((g,i)=>{
    card(s,0.22,0.9+i*0.9,4.6,0.82,{fill:C.page});
    T(s,g[0],{x:0.32,y:0.94+i*0.9,w:2.5,h:0.22,fontSize:10,bold:true,color:C.text1});
    T(s,g[1],{x:0.32,y:1.16+i*0.9,w:1.5,h:0.18,fontSize:8.5,color:C.text2});
    T(s,"คงเหลือ: "+g[2]+" ชิ้น",{x:0.32,y:1.34+i*0.9,w:2,h:0.18,fontSize:8.5,color:C.success});
    T(s,g[3],{x:0.32,y:1.52+i*0.9,w:3,h:0.16,fontSize:7.5,color:C.warn});
    uiBtn(s,3.4,0.96+i*0.9,1.2,"เบิก",C.primary,C.pLight);
  });
  s.addShape(pres.shapes.RECTANGLE,{x:0.15,y:3.62,w:4.75,h:1.0,fill:{color:"FFF8E6"},line:{color:"FAC775",width:0.5}});
  T(s,"⚠  งบเบิกเกิน → แจ้งเตือน (ติดลบได้ตามพฤติกรรมจริง)  ·  สต็อกของแถมจัดใน schema wf  ·  แยกงบต่อภาค→Sales",{x:0.25,y:3.68,w:4.5,h:0.5,fontSize:8.5,color:C.warn,align:"left",valign:"top"});
  card(s,5.0,0.62,4.85,4.85,{fill:C.surface});
  sectionHead(s,5.0,0.62,4.85,"13.10 Approval Levels — กฎเฉพาะ (ยืนยันจากทีมขาย)");
  const approvals=[["แก้ไขตอน Picking","สุรชัย คนเดียว","ApproveFlagPicking","E24B4A"],["ขายเกินราคาตั้ง","รุ่งนิรันดร์ (1 คน)","ApproveFlag SO","BA7517"],["ขายต่ำกว่า ≤500","ผจก. 3 ท่าน","ApproveFlag SO","3B6D11"]];
  approvals.forEach((ap,i)=>{
    card(s,5.08,0.9+i*0.95,4.7,0.86,{fill:C.page});
    s.addShape(pres.shapes.RECTANGLE,{x:5.08,y:0.9+i*0.95,w:0.12,h:0.86,fill:{color:ap[3]},line:{color:ap[3],width:0}});
    T(s,ap[0],{x:5.25,y:0.94+i*0.95,w:4.4,h:0.22,fontSize:9,bold:true,color:C.text1});
    T(s,"ผู้อนุมัติ: "+ap[1],{x:5.25,y:1.16+i*0.95,w:4.4,h:0.18,fontSize:9,color:C.primary,bold:true});
    T(s,"Flag: "+ap[2],{x:5.25,y:1.34+i*0.95,w:4.4,h:0.18,fontSize:8.5,color:C.text2});
  });
  card(s,5.0,3.82,4.85,1.65,{fill:C.page});
  sectionHead(s,5.0,3.82,4.85,"Unlock Request Flow");
  T(s,"Sales ขอ Unlock → Approver รับแจ้ง real-time (WebSocket)\n→ อนุมัติ: SO กลับ DRAFT + Reverse RebateLedger\n→ ปฏิเสธ: SO คงสถานะ + บันทึก Audit\nทุก action → wf.SalesOrderAudit (immutable)",{x:5.12,y:4.08,w:4.6,h:1.3,fontSize:8.5,color:C.text1,align:"left",valign:"top"});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 11 — System Architecture
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"สถาปัตยกรรมระบบ — 2-Tier, SQL Server เดียว","ไม่ใช้ PostgreSQL / Redis / Message Queue");
  const boxes=[
    {x:0.3,y:0.75,w:2.8,h:1.5,label:"Frontend",sub:"React 19 + Vite + TypeScript\nTailwind v4 + lucide-react\nTablet-first (768–1024px)\nJWT auth · polling (5s)",color:C.pLight,border:C.primary},
    {x:3.6,y:0.75,w:2.8,h:1.5,label:"Backend API",sub:"Express (Node 22) + REST\nJWT (jsonwebtoken+bcrypt)\nRBAC 7 roles · polling\nmssql/msnodesqlv8 (named-pipe)",color:C.page,border:C.primary},
    {x:6.9,y:0.75,w:2.8,h:1.5,label:"SQL Server 2022",sub:"dbwins_worldfert9\n• wf_owner: CONTROL wf เท่านั้น\n• wf_reader: db_datareader\n• dbo เขียนไม่ได้ (permission)",color:C.succLt,border:C.success},
  ];
  boxes.forEach(b=>{
    s.addShape(pres.shapes.RECTANGLE,{x:b.x,y:b.y,w:b.w,h:b.h,fill:{color:b.color},line:{color:b.border,width:1}});
    T(s,b.label,{x:b.x+0.1,y:b.y+0.08,w:b.w-0.2,h:0.28,fontSize:13,bold:true,color:C.text1,align:"center"});
    T(s,b.sub,{x:b.x+0.1,y:b.y+0.38,w:b.w-0.2,h:1.0,fontSize:8.5,color:C.text1,align:"left",valign:"top"});
  });
  T(s,"→",{x:3.2,y:1.25,w:0.35,h:0.4,fontSize:18,color:C.primary,align:"center"});
  T(s,"→",{x:6.5,y:1.25,w:0.35,h:0.4,fontSize:18,color:C.primary,align:"center"});
  card(s,0.3,2.4,9.4,0.9,{fill:C.surface});
  T(s,"ข้อจำกัดและการรักษาความถูกต้อง (Non-Invasive)",{x:0.45,y:2.44,w:5,h:0.22,fontSize:10,bold:true,color:C.text1});
  T(s,"✓ wf และ dbo อยู่ DB เดียวกัน → JOIN ข้ามได้ตรง ไม่ต้อง sync/cache\n✓ dbo = READ-ONLY ผ่าน View เท่านั้น · ห้ามเขียน dbo เด็ดขาด\n✓ ส่งข้อมูลเข้า WINSpeed ผ่าน SO Export/Import (SOHD/SODT.TXT) · WINSpeed post GL เอง\n✓ ระบบใหม่ล่ม → กลับไปคีย์ WINSpeed ได้ปกติ · ไม่มี trigger/SP post GL อัตโนมัติใน DB",{x:0.45,y:2.68,w:9.0,h:0.55,fontSize:8.5,color:C.text2});
  card(s,0.3,3.4,9.4,1.0,{fill:C.page});
  sectionHead(s,0.3,3.4,9.4,"schema wf — Entities หลัก");
  const entities=["AppUser","SalesOrder","SalesOrderLine","SalesOrderAudit","RebatePool","RebateLedger","RebateClaim","GiveawayBudget","GiveawayIssue","GoodExtra"];
  entities.forEach((e,i)=>{
    const x=0.38+i*0.72; const y=3.68;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w:0.68,h:0.22,fill:{color:C.pLight},line:{color:C.primary,width:0.5},rectRadius:0.04});
    T(s,e,{x,y,w:0.68,h:0.22,fontSize:6.5,color:C.primary,align:"center",valign:"middle"});
  });
  T(s,"10 ตาราง + 4 Views READ-ONLY บน dbo: v_Customer · v_FertGood · v_CurrentPrice · v_ControlTicket   |   dbo: EMGood (417) · EMCust (790) · EMEmp (59) · SOInvHD (282,087)",{x:0.38,y:3.96,w:9.3,h:0.18,fontSize:7.5,color:C.text2});
  card(s,0.3,4.5,9.4,0.9,{fill:C.surface});
  sectionHead(s,0.3,4.5,9.4,"WINSpeed Integration — SO Import Flow");
  T(s,"wf (CONFIRMED→PICKING→SHIPPED) → SOHD.TXT + SODT.TXT (Tab-delimited, DocuType=104, VATType=3, EmpID จาก AppUser↔EMEmp) → WINSpeed Import (w_importexport_so)\n→ WINSpeed ออกใบกำกับ (107) + post GL เอง (WINSpeed = เจ้าของบัญชี 100%) → poll DocuNo กลับมา sync สถานะ (read-only)",{x:0.45,y:4.74,w:9.0,h:0.55,fontSize:8.5,color:C.text1});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 12 — Gantt Chart v5
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"แผนการพัฒนา v5 — Timeline 20 พ.ค. – 31 ก.ค. 2569","คืบหน้า 65% · เกินแผน 20%");
  const START=new Date("2026-05-20"); const END=new Date("2026-07-31"); const TODAY=new Date("2026-06-22");
  const TOTAL=(END-START)/86400000;
  const p=(d)=>((new Date(d)-START)/86400000/TOTAL);
  const W=(s,e)=>((new Date(e)-new Date(s))/86400000/TOTAL);
  const BX=2.8; const BW=6.8;
  const kpis2=[["65%","คืบหน้าจริง","3B6D11"],["+20%","เกินแผน","A32D2D"],["30 มิ.ย.","Frontend เสร็จ","0C447C"],["31 ก.ค.","Go-Live","BA7517"]];
  kpis2.forEach((k,i)=>{kpi(s,0.15+i*2.4,0.62,2.3,k[0],k[1],k[2]);});
  const tasks=[
    {label:"เก็บ Requirement & SRS",s:"2026-05-20",e:"2026-06-01",done:100,type:"done"},
    {label:"DB Schema + Auth",s:"2026-05-28",e:"2026-06-08",done:100,type:"done"},
    {label:"SO State Machine (Frontend+API)",s:"2026-06-03",e:"2026-06-16",done:100,type:"done"},
    {label:"Rebate FIFO Engine",s:"2026-06-10",e:"2026-06-25",done:60,type:"active"},
    {label:"Paper Trail + Unlock",s:"2026-06-18",e:"2026-06-27",done:40,type:"active"},
    {label:"Frontend UI (ไม่เชื่อม WS)",s:"2026-06-20",e:"2026-06-30",done:35,type:"active"},
    {label:"WINSpeed Integration",s:"2026-07-01",e:"2026-07-18",done:0,type:"plan"},
    {label:"UAT + Go-Live",s:"2026-07-21",e:"2026-07-31",done:0,type:"plan"},
  ];
  const colors={done:[C.success,"FFFFFF"],active:[C.rebate,"FFFFFF"],plan:["85B7EB","042C53"]};
  T(s,"พ.ค. 2569",{x:BX+BW*p("2026-05-20"),y:1.45,w:0.9,h:0.18,fontSize:7.5,color:C.text2});
  T(s,"มิ.ย. 2569",{x:BX+BW*p("2026-06-01"),y:1.45,w:0.9,h:0.18,fontSize:7.5,color:C.text2});
  T(s,"ก.ค. 2569",{x:BX+BW*p("2026-07-01"),y:1.45,w:0.9,h:0.18,fontSize:7.5,color:C.text2});
  tasks.forEach((t,i)=>{
    const y=1.7+i*0.5;
    T(s,t.label,{x:0.15,y,w:BX-0.25,h:0.42,fontSize:8.5,color:C.text1,valign:"middle"});
    const bx=BX+BW*p(t.s); const bw=BW*W(t.s,t.e);
    const [bg,fg]=colors[t.type];
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:bx,y:y+0.06,w:bw,h:0.3,fill:{color:bg},line:{color:bg,width:0},rectRadius:0.04});
    if(t.done>0){
      s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:bx,y:y+0.06,w:bw*t.done/100,h:0.3,fill:{color:"FFFFFF"},line:{color:"FFFFFF",width:0},rectRadius:0.04});
      s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:bx,y:y+0.06,w:bw*t.done/100,h:0.3,fill:{color:bg},line:{color:bg,width:0},rectRadius:0.04});
    }
    const lbl=t.type==="done"?"✓":t.type==="active"?t.done+"%":"แผน";
    T(s,lbl,{x:bx+0.05,y:y+0.06,w:bw-0.1,h:0.3,fontSize:7.5,bold:true,color:fg,align:"left",valign:"middle"});
  });
  const todayX=BX+BW*p(TODAY.toISOString().slice(0,10));
  s.addShape(pres.shapes.LINE,{x:todayX,y:1.6,w:0,h:4.2,line:{color:"E24B4A",width:1.5}});
  T(s,"วันนี้",{x:todayX-0.2,y:1.42,w:0.5,h:0.16,fontSize:7.5,bold:true,color:"A32D2D",align:"center"});
  const m1X=BX+BW*p("2026-06-30");
  s.addShape(pres.shapes.LINE,{x:m1X,y:1.6,w:0,h:4.2,line:{color:C.success,width:1,dashType:"dash"}});
  T(s,"Frontend\nComplete",{x:m1X-0.3,y:1.42,w:0.75,h:0.26,fontSize:6.5,bold:true,color:C.success,align:"center"});
  const m2X=BX+BW*p("2026-07-31");
  s.addShape(pres.shapes.LINE,{x:m2X-0.02,y:1.6,w:0,h:4.2,line:{color:C.primary,width:1,dashType:"dash"}});
  T(s,"Go-Live",{x:m2X-0.4,y:1.42,w:0.8,h:0.18,fontSize:6.5,bold:true,color:C.primary,align:"center"});
}

// ══════════════════════════════════════════════════════════════
// SLIDE 13 — Traceability + Next Steps
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide(); pageSetup(s);
  topBar(s,"Traceability + สถานะการพัฒนา — v5.0","23 มิ.ย. 2569");
  card(s,0.15,0.65,4.7,3.8,{fill:C.surface});
  sectionHead(s,0.15,0.65,4.7,"Requirement ↔ FR Traceability (ครบทุกข้อ)");
  const traces=[["ปัญหา #1 แม่-ลูกตัน","FR-019 Mother/Baby Load"],["ปัญหา #2 รายงานชุดตั๋ว","FR-021 Control Ticket"],["ปัญหา #3 ของแถม+สต็อก","FR-020 Giveaway Budget"],["ปัญหา #4 รับเฉพาะชุด","FR-021 Ticket Set"],["ปัญหา #5 ตรวจซ้ำ","FR-022 Verification Gate"],["Rebate FIFO แยก Sales","FR-008/9/10/11"],["บันทึก WINSpeed ถูกต้อง","D-03(B) SO Import"],["ตั๋ว aging 30/45 วัน","FR-017 Dashboard"],["Approval เฉพาะคน","FR-006/007 §5.5"]];
  traces.forEach((t,i)=>{
    s.addShape(pres.shapes.RECTANGLE,{x:0.2,y:0.92+i*0.3,w:4.6,h:0.28,fill:{color:i%2===0?C.surface:C.page},line:{color:C.border,width:0.3}});
    T(s,"✓",{x:0.25,y:0.92+i*0.3,w:0.25,h:0.28,fontSize:9,bold:true,color:C.success,align:"center",valign:"middle"});
    T(s,t[0],{x:0.52,y:0.92+i*0.3,w:2.0,h:0.28,fontSize:8.5,color:C.text1,align:"left",valign:"middle"});
    T(s,t[1],{x:2.55,y:0.92+i*0.3,w:2.2,h:0.28,fontSize:8.5,bold:true,color:C.primary,align:"left",valign:"middle"});
  });
  card(s,4.95,0.65,4.9,3.8,{fill:C.surface});
  sectionHead(s,4.95,0.65,4.9,"สถานะการพัฒนา — Implemented ✓");
  const steps=[["✓","wf schema (deployed)","10 ตาราง + 4 views · wf_reader/wf_owner · dbo เขียนไม่ได้"],["✓","Backend API (Express)","JWT + RBAC · SO state machine · msnodesqlv8"],["✓","Rebate Engine","accrual ต่อบรรทัด → FIFO cut → Claim → CN (109)"],["✓","WINSpeed Import","SOHD/SODT.TXT (EmpID map) → poll DocuNo กลับ"],["✓","Frontend + Admin","POS · Picking · Map พนักงาน · ทดสอบ E2E ผ่าน"]];
  steps.forEach((st,i)=>{
    s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:5.08,y:0.9+i*0.55,w:0.3,h:0.3,fill:{color:C.primary},line:{color:C.primary,width:0},rectRadius:0.04});
    T(s,st[0],{x:5.08,y:0.9+i*0.55,w:0.3,h:0.3,fontSize:8,bold:true,color:C.pLight,align:"center",valign:"middle"});
    T(s,st[1],{x:5.44,y:0.9+i*0.55,w:4.3,h:0.18,fontSize:9,bold:true,color:C.text1});
    T(s,st[2],{x:5.44,y:1.08+i*0.55,w:4.3,h:0.18,fontSize:8,color:C.text2});
  });
  card(s,4.95,3.5,4.9,0.95,{fill:C.succLt});
  T(s,"✓ Frontend (ไม่เชื่อม WS) → 30 มิ.ย. 2569\n✓ Go-Live เต็มระบบ → 31 ก.ค. 2569\nWarranty 30 วันหลัง Go-Live · MA option 12 เดือน",{x:5.08,y:3.55,w:4.7,h:0.84,fontSize:8.5,color:C.success,align:"left",valign:"top"});
  s.addShape(pres.shapes.RECTANGLE,{x:0,y:5.2,w:10,h:0.55,fill:{color:C.primary},line:{color:C.primary,width:0}});
  T(s,"World Fert Co., Ltd.  ·  WS-Sale-App v5.0 (Production)  ·  22 มิ.ย. 2569  ·  ข้อมูลยืนยันจาก query DB จริง  |  dbo = READ-ONLY  |  schema wf = สร้างใหม่",{x:0.3,y:5.2,w:9.4,h:0.55,fontSize:8.5,color:"9DC8E8",align:"left",valign:"middle"});
}

// ── Generate ─────────────────────────────────────────────────
const outPath = "L:\\My Drive\\World Fert\\WorldFert_Presentation_v5.pptx";
pres.writeFile({fileName: outPath})
  .then(()=>console.log("✓ Saved: "+outPath+" ("+pres.slides.length+" slides)"))
  .catch(e=>console.error("✗ Error:",e));
