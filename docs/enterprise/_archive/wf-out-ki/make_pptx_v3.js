// ============================================================
// WorldFert Workflow Deck — v3.0-aligned
// CI: Minimal Navy (ตรงกับ SRS v3.0)  |  Font: Prompt
// ============================================================
const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "World Fert";
pres.title  = "WINSpeed Sales Workflow (v3.0)";

const FONT = "Prompt";
const MONO = "Consolas";

// ─── Palette: Minimal Navy (match Word CI) ──────────────────
const C = {
  navy   : "1F3864",  // primary dark / headers
  navy2  : "2E5496",  // secondary card
  steel  : "4472C4",  // accent line/arrow
  ice    : "C5D5EE",  // light text on navy
  ice2   : "9DB8E0",
  row    : "EBF0F7",  // light-blue row
  off    : "F4F6F9",  // page bg
  gold   : "C8862E",  // peach accent
  peach  : "FBEFE0",
  grnbg  : "E8F0E5",
  grnbd  : "5E7E45",
  red    : "B02418",
  white  : "FFFFFF",
  gray   : "667085",
  dark   : "1F2937",
  slate  : "4B5563",
};

const sh = () => ({ type:"outer", blur:8, offset:2, angle:135, color:"000000", opacity:0.12 });

// font-injecting text helper
function T(slide, text, opts={}) { slide.addText(text, Object.assign({ fontFace:FONT }, opts)); }
// rich runs helper (inject fontFace into each run)
function R(runs){ return runs.map(r=>({ text:r.text, options:Object.assign({ fontFace:FONT }, r.options||{}) })); }

function header(slide, label) {
  slide.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.58, fill:{color:C.navy}, line:{color:C.navy,width:0} });
  T(slide, label, { x:0.38, y:0, w:9.2, h:0.58, fontSize:15, bold:true, color:C.ice, align:"left", valign:"middle", margin:0 });
}
function pill(slide, x, y, w, h, text, bg, fg) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill:{color:bg}, line:{color:bg,width:0}, rectRadius:0.07 });
  T(slide, text, { x, y, w, h, fontSize:9, bold:true, color:fg||C.white, align:"center", valign:"middle", margin:0 });
}
function card(slide, x, y, w, h) {
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill:{color:C.white}, line:{color:"D5DEEC",width:1.5}, shadow:sh() });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:3.6, w:10, h:2.025, fill:{color:C.navy2}, line:{color:C.navy2,width:0} });
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:3.6, w:0.35, h:2.025, fill:{color:C.steel}, line:{color:C.steel,width:0} });

  T(s, "World Fert", { x:0.5, y:0.55, w:9, h:0.7, fontSize:22, color:C.ice, align:"left", charSpacing:6 });
  T(s, "WINSpeed\nSales Workflow", { x:0.5, y:1.2, w:9, h:2.0, fontSize:48, bold:true, color:C.white, align:"left" });
  T(s, "ระบบสั่งขายปุ๋ย — กระบวนการและการไหลของข้อมูล (สอดคล้อง SRS v3.0)", { x:0.55, y:3.72, w:9, h:0.5, fontSize:16, color:C.ice, align:"left", valign:"middle", margin:0 });
  T(s, "Prosoft WINSpeed v9.0  |  SQL Server 2022  |  DB: dbwins_worldfert9", { x:0.55, y:4.25, w:8.5, h:0.35, fontSize:10, color:C.ice2, align:"left", valign:"middle", margin:0 });
  T(s, "ข้อมูลยืนยันจาก query จริง  ·  282,087 ใบกำกับ  ·  790 ลูกค้า  ·  417 สินค้า  ·  ปี 2555–2568", { x:0.55, y:4.62, w:9, h:0.3, fontSize:9, color:C.ice2, align:"left", valign:"middle", margin:0 });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 2 — Database Overview
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "ภาพรวมฐานข้อมูล WINSpeed");

  const stats = [["669","ตาราง"],["8,987","คอลัมน์"],["282,087","ใบกำกับ"],["107,018","ใบจอง/SO"],["790","ลูกค้า"],["417","สินค้า"]];
  stats.forEach(([num,label],i)=>{
    const col=i%3, row=Math.floor(i/3);
    const x=0.4+col*3.12, y=0.85+row*2.05;
    card(s,x,y,2.82,1.72);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:2.82, h:0.16, fill:{color:C.steel}, line:{color:C.steel,width:0} });
    T(s, num, { x, y:y+0.24, w:2.82, h:0.9, fontSize:40, bold:true, color:C.navy, align:"center", margin:0 });
    T(s, label, { x, y:y+1.2, w:2.82, h:0.4, fontSize:13, color:C.gray, align:"center", margin:0 });
  });

  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:5.0, w:9.2, h:0.46, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "⚠  FK จริงมีแค่ 4 รายการ — ความสัมพันธ์ใช้ Naming Convention (*ID)  |  ICStock, SOPickingHD/DT, ICPriceHD/DT, EMCreditTerm = ว่าง (ไม่ใช้)", { x:0.5, y:5.0, w:9.0, h:0.46, fontSize:9.5, color:"7A4F12", align:"left", valign:"middle", margin:0 });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 3 — Document Chain
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "Document Chain — ภาพรวมการไหลของเอกสาร");

  const steps = [
    { x:0.25, label:"ใบจอง\n103", sub:"SOHD/SODT\nAppvFlag=W" },
    { x:2.15, label:"ตั๋วคุม\nAI68-XXXXX", sub:"เข้าชั่ง\nAppvFlag=Y" },
    { x:4.05, label:"ใบสั่งขาย\n104", sub:"SOHD/SODT\nRefNo=AI" },
    { x:5.95, label:"ใบกำกับ\n107/202", sub:"SOInvHD/DT\nSONo=SO104" },
    { x:7.85, label:"ใบวางบิล\n203", sub:"ARBillHD/DT\nSOInvID" },
  ];
  steps.forEach((st,i)=>{
    const bx=st.x, by=0.78;
    s.addShape(pres.shapes.RECTANGLE, { x:bx, y:by, w:1.75, h:1.62, fill:{color:C.navy}, line:{color:C.steel,width:1.5}, shadow:sh() });
    T(s, st.label, { x:bx, y:by+0.1, w:1.75, h:0.82, fontSize:13, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
    T(s, st.sub, { x:bx, y:by+0.92, w:1.75, h:0.62, fontSize:9, color:C.ice, align:"center", valign:"top", margin:0 });
    if(i<steps.length-1) s.addShape(pres.shapes.LINE, { x:bx+1.77, y:by+0.81, w:0.36, h:0, line:{color:C.gold,width:2.5} });
  });

  // GL + AR row
  s.addShape(pres.shapes.RECTANGLE, { x:5.95, y:2.68, w:1.75, h:1.46, fill:{color:C.navy2}, line:{color:C.steel,width:1.5}, shadow:sh() });
  T(s, "Post GL\n501", { x:5.95, y:2.74, w:1.75, h:0.78, fontSize:13, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
  T(s, "GLHD/GLDT\nFromFlag=107", { x:5.95, y:3.52, w:1.75, h:0.55, fontSize:9, color:C.ice, align:"center", valign:"top", margin:0 });
  s.addShape(pres.shapes.LINE, { x:6.825, y:2.40, w:0, h:0.28, line:{color:C.gold,width:2.5} });

  s.addShape(pres.shapes.RECTANGLE, { x:7.85, y:2.68, w:1.75, h:1.46, fill:{color:C.slate}, line:{color:"9CA3AF",width:1.5}, shadow:sh() });
  T(s, "รับชำระ / AR\nCN · DN", { x:7.85, y:2.74, w:1.75, h:0.78, fontSize:13, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
  T(s, "ARReceDT\n109 · 110", { x:7.85, y:3.52, w:1.75, h:0.55, fontSize:9, color:"D1D5DB", align:"center", valign:"top", margin:0 });
  s.addShape(pres.shapes.LINE, { x:8.725, y:2.40, w:0, h:0.28, line:{color:C.gold,width:2.5} });

  // join keys box
  card(s, 0.25, 4.34, 9.5, 1.12);
  T(s, "Join Keys ที่ยืนยันแล้ว", { x:0.38, y:4.39, w:4, h:0.25, fontSize:10, bold:true, color:C.navy, margin:0 });
  const joins = [
    "SOHD104.RefNo = SOHD103.AppvDocuNo",
    "SOInvHD.SONo = SOHD104.DocuNo",
    "GLHD.DocuNo = SOInvHD.DocuNo  AND  FromFlag=107",
    "ARBillDT.SOInvID = SOInvHD.SOInvID     ·     ARReceDT.SOInvID = SOInvHD.SOInvID (รับชำระ)",
    "CN 109: SOInvHD.RefSOID = orig.SOInvID   ·   DN 110: SOInvHD.RefNo = orig.DocuNo",
  ];
  T(s, joins.join("\n"), { x:0.38, y:4.66, w:9.1, h:0.75, fontSize:8.5, color:C.gray, margin:0, fontFace:MONO });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 4 — ใบจอง + ตั๋วคุม
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "ขั้นที่ 1–2  :  ใบจอง (DocuType 103) และตั๋วคุม");

  card(s, 0.25, 0.75, 4.55, 4.65);
  pill(s, 0.35, 0.82, 1.4, 0.32, "ใบจอง 103", C.navy, C.white);
  T(s, "SOHD + SODT", { x:1.85, y:0.83, w:2.8, h:0.28, fontSize:9, color:C.gray, margin:0, valign:"middle" });

  const items=[
    ["AppvFlag","'W' = รอชั่ง  |  'Y' = ผ่านแล้ว"],
    ["AppvDocuNo","'AI68-XXXXX'  ← เลขตั๋วคุม"],
    ["AppvDate","วันที่ชั่งเข้า"],
    ["TransRegistration","ทะเบียนรถ (เช่น สท70-4239/40)"],
    ["Desc1 / Desc2","รายละเอียดสินค้า/สูตรปุ๋ย"],
    ["NetAmnt","ยอดสุทธิ (DECIMAL 18,4)"],
    ["DocuStatus","'Y'=Active  |  'N'=ยกเลิก"],
    ["SODT.GoodQty2","ปริมาณ (ตัน)  ← หน่วยหลัก"],
    ["SODT.GoodPrice2=0","ของแถม (เสื้อ/ปุ๋ยโบนัส)"],
  ];
  items.forEach(([col,desc],i)=>{
    const ry=1.24+i*0.37;
    s.addShape(pres.shapes.RECTANGLE, { x:0.35, y:ry, w:4.35, h:0.32, fill:{color:i%2===0?C.row:C.white}, line:{color:"E5E7EB",width:0.5} });
    T(s, col, { x:0.42, y:ry, w:1.85, h:0.32, fontSize:9, bold:true, color:C.navy, fontFace:MONO, margin:0, valign:"middle" });
    T(s, desc, { x:2.3, y:ry, w:2.3, h:0.32, fontSize:9, color:C.dark, margin:0, valign:"middle" });
  });

  card(s, 5.05, 0.75, 4.7, 4.65);
  pill(s, 5.15, 0.82, 1.6, 0.32, "ตั๋วคุม Flow", C.steel, C.white);
  const flow=[
    {icon:"①", title:"ลูกค้ามาจอง", sub:"สร้าง SOHD DocuType=103\nAppvFlag='W' (รอชั่ง)"},
    {icon:"②", title:"รถเข้าชั่ง", sub:"AppvFlag → 'Y'\nAppvDocuNo → 'AI68-XXXXX'\nAppvDate → วันที่ชั่ง"},
    {icon:"③", title:"ชั่งออก / ปิดตั๋วคุม", sub:"สร้าง SOHD DocuType=104\nRefNo = AppvDocuNo (AI...)"},
    {icon:"④", title:"ออกใบกำกับ", sub:"สร้าง SOInvHD DocuType=107\nSONo = SOHD104.DocuNo"},
  ];
  flow.forEach((f,i)=>{
    const fy=1.24+i*1.02;
    s.addShape(pres.shapes.OVAL, { x:5.2, y:fy+0.05, w:0.42, h:0.42, fill:{color:C.steel}, line:{color:C.steel,width:0} });
    T(s, f.icon, { x:5.2, y:fy+0.05, w:0.42, h:0.42, fontSize:13, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
    T(s, f.title, { x:5.72, y:fy+0.04, w:3.85, h:0.28, fontSize:11, bold:true, color:C.dark, margin:0, valign:"middle" });
    T(s, f.sub, { x:5.72, y:fy+0.33, w:3.85, h:0.6, fontSize:9, color:C.gray, margin:0, valign:"top" });
    if(i<flow.length-1) s.addShape(pres.shapes.LINE, { x:5.41, y:fy+0.5, w:0, h:0.74, line:{color:C.ice2,width:1.5} });
  });
  s.addShape(pres.shapes.RECTANGLE, { x:5.05, y:5.08, w:4.7, h:0.32, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "⚠  ไม่มี Gross/Tare/Net weight ใน WINSpeed → ต้องสร้าง wf.WeighTicket เพิ่มเอง", { x:5.12, y:5.08, w:4.58, h:0.32, fontSize:8.5, color:"7A4F12", margin:0, valign:"middle" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 5 — ใบกำกับ + GL  (UPDATED: VAT-exempt, 1129, counts)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "ขั้นที่ 4–6  :  ใบกำกับขาย → ใบวางบิล → Post GL");

  card(s, 0.25, 0.75, 4.55, 3.3);
  pill(s, 0.35, 0.82, 2.0, 0.32, "SOInvHD  DocuType=107", C.navy, C.white);
  const inv=[
    ["DocuNo","N68-XXXXX / J68-XXXXX"],
    ["SONo","= SOHD 104 DocuNo  ← join key"],
    ["CustID","→ EMCust  |  ARID = CustID"],
    ["PostGL","'Y'=บันทึก GL แล้ว  |  'N'=รอ"],
    ["PostID","= GLHD.FromID  (ไม่ใช่ GLHD.GLID)"],
    ["VATType=3","ปุ๋ยยกเว้น VAT → VATAmnt=0 ทุกใบ"],
    ["Docutype 202","SONo=DocuNo (เลขเดิม) = flow ลัด"],
  ];
  inv.forEach(([col,desc],i)=>{
    const ry=1.24+i*0.37;
    s.addShape(pres.shapes.RECTANGLE, { x:0.35, y:ry, w:4.35, h:0.32, fill:{color:i%2===0?C.row:C.white}, line:{color:"E5E7EB",width:0.5} });
    T(s, col, { x:0.42, y:ry, w:1.7, h:0.32, fontSize:9, bold:true, color:C.navy, fontFace:MONO, margin:0, valign:"middle" });
    T(s, desc, { x:2.15, y:ry, w:2.5, h:0.32, fontSize:9, color:C.dark, margin:0, valign:"middle" });
  });

  // SOInvDT note
  s.addShape(pres.shapes.RECTANGLE, { x:0.25, y:4.12, w:4.55, h:1.05, fill:{color:C.navy2}, line:{color:C.steel,width:1}, shadow:sh() });
  T(s, "SOInvDT — รายการสินค้า", { x:0.38, y:4.16, w:4.2, h:0.25, fontSize:10, bold:true, color:C.ice, margin:0 });
  T(s, "GoodQty2 = ปริมาณ (ตัน)    GoodPrice2 = ราคา (บาท/ตัน)\nGoodID IS NULL → Misc/Service (224,571 rows)\nGoodPrice2 = 0  → ของแถม (เสื้อ / ปุ๋ยโบนัส)", { x:0.38, y:4.43, w:4.2, h:0.68, fontSize:9, color:C.white, margin:0, valign:"top" });

  // GL box
  card(s, 5.05, 0.75, 4.7, 2.62);
  pill(s, 5.15, 0.82, 1.4, 0.32, "GLHD / GLDT", C.navy2, C.white);
  T(s, "DocuType=501 ทุกแถว  |  FromFlag=107", { x:6.65, y:0.83, w:2.95, h:0.28, fontSize:8.5, color:C.gray, margin:0, valign:"middle" });
  const gl=[
    ["Join ถูก ✓","GLHD.DocuNo = SOInvHD.DocuNo"],
    ["Join ถูก ✓","GLHD.FromID = SOInvHD.PostID"],
    ["Join ผิด ✗","GLHD.FromID = SOInvHD.SOInvID"],
    ["GL Pattern","Dr 1037 ลูกหนี้-ค้างส่ง / Cr 1120 ขายเชื่อ"],
    ["VAT","ไม่มี VAT line (ปุ๋ยยกเว้น)"],
  ];
  gl.forEach(([col,desc],i)=>{
    const ry=1.24+i*0.37;
    const bad=col.includes("✗");
    s.addShape(pres.shapes.RECTANGLE, { x:5.15, y:ry, w:4.45, h:0.32, fill:{color:bad?"FBECEA":(i%2===0?C.row:C.white)}, line:{color:"E5E7EB",width:0.5} });
    T(s, col, { x:5.22, y:ry, w:1.5, h:0.32, fontSize:9, bold:true, color:bad?C.red:C.navy, margin:0, valign:"middle" });
    T(s, desc, { x:6.75, y:ry, w:2.8, h:0.32, fontSize:8.5, fontFace:MONO, color:C.dark, margin:0, valign:"middle" });
  });

  // ARBill box
  card(s, 5.05, 3.5, 4.7, 1.67);
  pill(s, 5.15, 3.57, 1.6, 0.32, "ARBillHD / ARReceHD", C.slate, C.white);
  T(s, "885 ใบวางบิล  ·  69,591 รับชำระ", { x:6.85, y:3.58, w:2.75, h:0.28, fontSize:8.5, color:C.gray, margin:0, valign:"middle" });
  ["ARBillDT.SOInvID → SOInvHD (วางบิล)","ARReceDT.SOInvID → SOInvHD (รับชำระ)","BillAmnt / RemaAmnt (ค้างชำระ)"].forEach((t,i)=>{
    T(s, "•  "+t, { x:5.22, y:3.98+i*0.37, w:4.4, h:0.34, fontSize:9.5, color:C.dark, margin:0, valign:"middle" });
  });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 6 — 8 Scenarios
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "Scenarios — กรณีที่พบในระบบ (8 กรณี)");

  const sc=[
    {lbl:"A",title:"Happy Path",sub:"103→104→107→ARBill→GL\n(สถานะปกติ)",col:C.navy},
    {lbl:"B",title:"Flow ลัด 202",sub:"SOInvHD.DocuNo = SONo\n113,043 ใบ",col:C.navy2},
    {lbl:"C",title:"ยกเลิกใบจอง",sub:"DocuStatus='N'\nAppvFlag W หรือ Y",col:C.slate},
    {lbl:"D",title:"Credit Note 109",sub:"RefSOID → ใบกำกับต้นทาง\nลดยอดหลังออกบิล",col:C.gold},
    {lbl:"E",title:"Debit Note 110",sub:"RefNo → ต้นทาง (RefSOID=NULL)\nเพิ่มยอดหลังออกบิล",col:"9A6614"},
    {lbl:"F",title:"ของแถม",sub:"GoodPrice2 = 0\nพบทุกปี 2555–2568",col:C.steel},
    {lbl:"G",title:"Rebate",sub:"คำนวณจาก SOInvDT\n→ CN (109) / wf.RebateLedger",col:"5B3FA8"},
    {lbl:"H",title:"Outstanding",sub:"PostGL='Y' แต่ยังไม่อยู่\nใน ARBillDT",col:"0E6E8C"},
  ];
  sc.forEach((c,i)=>{
    const col=i%4, row=Math.floor(i/4);
    const x=0.25+col*2.38, y=0.78+row*2.42, h=2.25;
    card(s,x,y,2.22,h);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:2.22, h:0.58, fill:{color:c.col}, line:{color:c.col,width:0} });
    T(s, c.lbl, { x:x+0.08, y:y+0.06, w:0.44, h:0.44, fontSize:18, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
    T(s, c.title, { x:x+0.58, y:y+0.06, w:1.56, h:0.44, fontSize:12, bold:true, color:C.white, align:"left", valign:"middle", margin:0 });
    T(s, c.sub, { x:x+0.15, y:y+0.66, w:1.98, h:h-0.74, fontSize:10.5, color:C.dark, align:"left", valign:"top", margin:0 });
  });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 7 — Scenario A Query
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "Scenario A — กระบวนการปกติ  :  Query ตรวจสอบ Lifecycle");

  s.addShape(pres.shapes.RECTANGLE, { x:0.25, y:0.75, w:9.5, h:0.7, fill:{color:C.navy}, line:{color:C.steel,width:1}, shadow:sh() });
  T(s, "ใส่เลขตั๋วคุม AI เพื่อดู lifecycle ทั้งหมดของ Order", { x:0.38, y:0.75, w:9.2, h:0.7, fontSize:11, bold:true, color:C.ice, margin:0, valign:"middle" });

  const code = `DECLARE @AI VARCHAR(30) = 'AI68-03542'

SELECT stage, DocuNo, DocuDate_str, Amnt, Status FROM (
  SELECT '1_ใบจอง'    AS stage, h.DocuNo,
    CONVERT(VARCHAR,CONVERT(DATE,h.DocuDate)) AS DocuDate_str,
    h.NetAmnt AS Amnt, h.AppvFlag AS Status
  FROM dbo.SOHD h WHERE h.AppvDocuNo=@AI AND h.DocuType=103
  UNION ALL
  SELECT '2_ใบSO', h.DocuNo, CONVERT(VARCHAR,CONVERT(DATE,h.DocuDate)),
    h.NetAmnt, h.DocuStatus
  FROM dbo.SOHD h WHERE h.RefNo=@AI AND h.DocuType=104
  UNION ALL
  SELECT '3_ใบกำกับ', inv.DocuNo, CONVERT(VARCHAR,CONVERT(DATE,inv.DocuDate)),
    inv.NetAmnt, inv.PostGL
  FROM dbo.SOHD h104
  JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
  WHERE h104.RefNo=@AI AND h104.DocuType=104
  UNION ALL
  SELECT '5_ใบวางบิล', b.DocuNo, CONVERT(VARCHAR,CONVERT(DATE,b.DocuDate)),
    b.TotaBillAmnt, b.DocuStatus
  FROM dbo.SOHD h104
  JOIN dbo.SOInvHD inv ON inv.SONo=h104.DocuNo AND inv.Docutype IN (107,202)
  JOIN dbo.ARBillDT dt ON dt.SOInvID=inv.SOInvID
  JOIN dbo.ARBillHD b  ON b.ARBillID=dt.ARBillID
  WHERE h104.RefNo=@AI AND h104.DocuType=104
) t ORDER BY stage;`;
  s.addShape(pres.shapes.RECTANGLE, { x:0.25, y:1.52, w:9.5, h:3.9, fill:{color:"16233A"}, line:{color:C.steel,width:1}, shadow:sh() });
  T(s, code, { x:0.4, y:1.6, w:9.2, h:3.75, fontSize:8.0, color:C.ice, fontFace:MONO, align:"left", valign:"top", margin:0 });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 8 — CN / DN
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "Scenario D & E — Credit Note / Debit Note  :  แก้ไขยอดหลังออกบิล");

  card(s, 0.25, 0.75, 4.55, 4.65);
  pill(s, 0.35, 0.82, 2.1, 0.32, "Credit Note  109  (ลดยอด)", C.gold, C.white);
  s.addShape(pres.shapes.RECTANGLE, { x:0.35, y:1.22, w:4.35, h:1.4, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "SOInvHD 109\n  RefSOID  →  SOInvHD 107 (ต้นทาง)\n  DocuNo  =  CNK68-XXXXX\n  NetAmnt = ยอดที่ลด", { x:0.42, y:1.28, w:4.2, h:1.3, fontSize:9.5, fontFace:MONO, color:C.dark, margin:0, valign:"top" });
  T(s, "Query: CN พร้อมต้นทาง", { x:0.38, y:2.72, w:4.2, h:0.28, fontSize:10, bold:true, color:C.navy, margin:0 });
  s.addShape(pres.shapes.RECTANGLE, { x:0.35, y:3.02, w:4.35, h:2.28, fill:{color:"16233A"}, line:{color:C.steel,width:1} });
  T(s, `SELECT
  cn.DocuNo AS CN,
  orig.DocuNo AS ต้นทาง,
  c.CustName,
  cn.NetAmnt AS ยอดลด
FROM dbo.SOInvHD cn
JOIN dbo.SOInvHD orig
  ON orig.SOInvID = cn.RefSOID
JOIN dbo.EMCust c
  ON c.CustID = cn.CustID
WHERE cn.Docutype = 109
ORDER BY cn.DocuDate DESC;`, { x:0.42, y:3.08, w:4.2, h:2.18, fontSize:8.5, fontFace:MONO, color:C.ice, margin:0, valign:"top" });

  card(s, 5.05, 0.75, 4.68, 4.65);
  pill(s, 5.15, 0.82, 2.1, 0.32, "Debit Note  110  (เพิ่มยอด)", "9A6614", C.white);
  s.addShape(pres.shapes.RECTANGLE, { x:5.15, y:1.22, w:4.38, h:1.32, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "SOInvHD 110\n  RefNo  →  orig.DocuNo (ต้นทาง)\n  RefSOID = NULL ทุกแถว!\n  NetAmnt = ยอดที่เพิ่ม", { x:5.22, y:1.28, w:4.25, h:1.22, fontSize:9.5, fontFace:MONO, color:C.dark, margin:0, valign:"top" });
  T(s, "Query: ยอดสุทธิหลัง CN/DN", { x:5.18, y:2.62, w:4.38, h:0.28, fontSize:10, bold:true, color:C.navy, margin:0 });
  s.addShape(pres.shapes.RECTANGLE, { x:5.15, y:2.94, w:4.38, h:2.38, fill:{color:"16233A"}, line:{color:C.steel,width:1} });
  T(s, `SELECT c.CustName,
  SUM(CASE WHEN inv.Docutype=107
    THEN inv.NetAmnt ELSE 0 END) AS ยอดขาย,
  SUM(CASE WHEN inv.Docutype=109
    THEN inv.NetAmnt ELSE 0 END) AS ยอดลด_CN,
  SUM(CASE WHEN inv.Docutype=110
    THEN inv.NetAmnt ELSE 0 END) AS ยอดเพิ่ม_DN,
  SUM(CASE
    WHEN inv.Docutype=107 THEN  inv.NetAmnt
    WHEN inv.Docutype=109 THEN -inv.NetAmnt
    WHEN inv.Docutype=110 THEN  inv.NetAmnt
    ELSE 0 END) AS ยอดสุทธิ
FROM dbo.SOInvHD inv
JOIN dbo.EMCust c ON c.CustID=inv.CustID
WHERE inv.Docutype IN (107,109,110)
GROUP BY c.CustName;`, { x:5.22, y:3.01, w:4.25, h:2.28, fontSize:7.8, fontFace:MONO, color:C.ice, margin:0, valign:"top" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 9 — ราคา & หน่วย
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "ราคา NET & หน่วยสินค้า — ข้อเท็จจริงสำคัญ");

  card(s, 0.25, 0.75, 4.55, 4.65);
  pill(s, 0.35, 0.82, 1.5, 0.32, "ราคา NET", C.navy, C.white);
  const pr=[
    ["EMSetPriceDT","GoodPriceNet","✓ ใช้งาน",C.navy],
    ["EMSetPriceHD","BeginDate/EndDate","129 price lists",C.navy2],
    ["SOInvDT","GoodPrice2","ราคาจริงในบิล",C.gray],
    ["ICPriceHD/DT","—","✗ ว่าง 0 rows",C.red],
    ["EMGood","StandardSalePrce","✗ NULL ทุกแถว",C.red],
  ];
  pr.forEach(([tbl,col,note,clr],i)=>{
    const ry=1.25+i*0.65;
    s.addShape(pres.shapes.RECTANGLE, { x:0.35, y:ry, w:4.35, h:0.58, fill:{color:i%2===0?C.row:C.white}, line:{color:"E5E7EB",width:0.5} });
    T(s, tbl, { x:0.42, y:ry+0.02, w:1.9, h:0.26, fontSize:9, bold:true, color:clr, fontFace:MONO, margin:0, valign:"middle" });
    T(s, col, { x:0.42, y:ry+0.3, w:1.9, h:0.22, fontSize:8.5, color:C.gray, fontFace:MONO, margin:0, valign:"middle" });
    T(s, note, { x:2.35, y:ry+0.1, w:2.2, h:0.38, fontSize:9.5, color:clr, bold:note.startsWith("✓")||note.startsWith("✗"), margin:0, valign:"middle" });
  });
  s.addShape(pres.shapes.RECTANGLE, { x:0.25, y:4.55, w:4.55, h:0.85, fill:{color:C.navy2}, line:{color:C.steel,width:1}, shadow:sh() });
  T(s, "EMSetPriceDT.GoodPriceNet → CustGroup + GoodGroup + เดือน + qty tier\nราคาก่อนปี 2565 ดึงจาก SOInvDT.GoodPrice2 (transaction history)", { x:0.38, y:4.6, w:4.3, h:0.76, fontSize:9, color:C.white, margin:0, valign:"middle" });

  card(s, 5.05, 0.75, 4.7, 4.65);
  pill(s, 5.15, 0.82, 1.5, 0.32, "หน่วยสินค้า", C.navy, C.white);
  const un=[["1002","ตัน  (hex: 0xB5D1B9)","หน่วยหลักปุ๋ยทุกตัว"],["1001","ใบ   (hex: 0xE3BA)","ใช้น้อย (62 rows)"],["1003","ตัว  (hex: 0xB5D1C7)","BaseFlag=Y"]];
  un.forEach(([id,name,note],i)=>{
    const ry=1.25+i*0.65;
    s.addShape(pres.shapes.RECTANGLE, { x:5.15, y:ry, w:4.45, h:0.58, fill:{color:i%2===0?C.row:C.white}, line:{color:"E5E7EB",width:0.5} });
    T(s, id, { x:5.22, y:ry+0.02, w:0.6, h:0.54, fontSize:18, bold:true, color:C.steel, align:"center", valign:"middle", margin:0 });
    T(s, name, { x:5.88, y:ry+0.04, w:3.6, h:0.26, fontSize:10, bold:true, color:C.dark, fontFace:MONO, margin:0, valign:"middle" });
    T(s, note, { x:5.88, y:ry+0.32, w:3.6, h:0.22, fontSize:9, color:C.gray, margin:0, valign:"middle" });
  });
  s.addShape(pres.shapes.RECTANGLE, { x:5.15, y:3.22, w:4.45, h:0.85, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "⚠  ไม่มี conversion ตัน↔กระสอบ ใน EMGoodUnit (RateQty=1.0)\nSaleGoodUnitID = NULL ทุก item\n→ เพิ่ม wf.GoodExtra.BagPerTon  (1 ตัน = 20 กระสอบ)", { x:5.22, y:3.27, w:4.3, h:0.75, fontSize:9, color:"7A4F12", margin:0, valign:"middle" });
  s.addShape(pres.shapes.RECTANGLE, { x:5.15, y:4.2, w:4.45, h:1.2, fill:{color:C.navy}, line:{color:C.steel,width:1}, shadow:sh() });
  T(s, "SOInvDT  (MultiUnitFlag=3 → single unit)", { x:5.22, y:4.24, w:4.3, h:0.26, fontSize:9, bold:true, color:C.ice, margin:0 });
  T(s, "GoodUnitID1 = NULL    GoodUnitID2 = 1002 (ตัน)\nGoodQty2 = ปริมาณ (ตัน)    GoodPrice2 = บาท/ตัน\nGoodAmnt = GoodQty2 × GoodPrice2", { x:5.22, y:4.52, w:4.3, h:0.85, fontSize:9, fontFace:MONO, color:C.white, margin:0, valign:"top" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 10 — wf Schema  (ALIGNED with SRS v3.0 data model)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "wf Schema — Logical Data Model (ตรงกับ SRS v3.0 ข้อ 8)");

  const tables=[
    {t:"SalesOrder / SalesOrderLine", d:"soNo, status, qtyTon, motherBaby,\nloadSeq, rebateAccrual"},
    {t:"RebatePlan / RebatePool", d:"plan ต่อสูตร×ภาค, Pool ต่อ Sales\nallocated / used / remaining"},
    {t:"RebateLedger / RebateClaim", d:"accrual ต่อบรรทัด, fifoSeq, reversedFlag\nClaim 2 ประเภท (รีเบท/ส่วนต่าง)"},
    {t:"GiveawayBudget / ControlTicket", d:"งบของแถมรายภาค→Sales,\nชุดตั๋วคุม + ยอดคงเหลือ"},
    {t:"WeighTicket  ·  GoodExtra", d:"Gross/Tare/Net + เวลา (WS ไม่มี),\nBagPerTon (1 ตัน=20 กระสอบ)"},
    {t:"PriceBook  ·  PaperCopy / Scan", d:"NET รายเดือน (อ้าง EMSetPriceDT),\nเอกสาร 4 สี + QR Kanban"},
  ];
  tables.forEach((tb,i)=>{
    const col=i%2, row=Math.floor(i/2);
    const x=0.25+col*4.88, y=0.78+row*1.48;
    card(s,x,y,4.6,1.38);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:4.6, h:0.32, fill:{color:C.navy2}, line:{color:C.navy2,width:0} });
    T(s, tb.t, { x:x+0.12, y, w:4.36, h:0.32, fontSize:11, bold:true, color:C.ice, fontFace:MONO, margin:0, valign:"middle" });
    T(s, tb.d, { x:x+0.12, y:y+0.37, w:4.36, h:0.94, fontSize:10, color:C.dark, margin:0, valign:"top" });
  });
  s.addShape(pres.shapes.RECTANGLE, { x:0.25, y:5.08, w:9.5, h:0.38, fill:{color:"5B3FA8"}, line:{color:"5B3FA8",width:0} });
  T(s, "Rebate: accrual = (ราคาขาย − ราคา NET) × ตัน → RebateLedger เข้า Pool → ตัด FIFO → Claim → ส่ง import ให้ WINSpeed ออก CN (109)  |  schema wf เขียนเอง, dbo = READ-ONLY", { x:0.38, y:5.08, w:9.2, h:0.38, fontSize:9, color:C.white, margin:0, valign:"middle" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 11 — Quick Reference  (+ corrections)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "Quick Reference — Status Flags & ข้อแก้ไขสำคัญ (v3.0)");

  card(s, 0.25, 0.75, 5.5, 4.65);
  pill(s, 0.35, 0.82, 1.5, 0.3, "Status Flags", C.navy, C.white);
  const flags=[
    ["SOHD.AppvFlag","W","รอชั่ง (pending)"],
    ["SOHD.AppvFlag","Y","ผ่านชั่งแล้ว"],
    ["SOHD.DocuStatus","Y/N","Active / ยกเลิก"],
    ["SOInvHD.PostGL","Y/N","Post GL แล้ว / รอ"],
    ["SOInvHD.Docutype","107","ใบกำกับขายเชื่อ N/J"],
    ["SOInvHD.Docutype","202","Flow ลัด DocuNo=SONo"],
    ["SOInvHD.Docutype","109/110","Credit / Debit Note"],
    ["SOInvHD.VATType","3","ปุ๋ยยกเว้น VAT (VATAmnt=0)"],
    ["GLHD.DocuType","501","GL Journal (ทุกแถว)"],
    ["GLHD.FromFlag","107/202","มาจากใบกำกับขาย"],
  ];
  flags.forEach(([col,val,desc],i)=>{
    const ry=1.2+i*0.34;
    s.addShape(pres.shapes.RECTANGLE, { x:0.35, y:ry, w:5.3, h:0.31, fill:{color:i%2===0?C.row:C.white}, line:{color:"E5E7EB",width:0.5} });
    T(s, col, { x:0.42, y:ry, w:2.3, h:0.31, fontSize:8.5, bold:true, color:C.navy, fontFace:MONO, margin:0, valign:"middle" });
    T(s, val, { x:2.75, y:ry, w:0.8, h:0.31, fontSize:8.5, bold:true, color:C.gold, align:"center", margin:0, valign:"middle" });
    T(s, desc, { x:3.6, y:ry, w:1.95, h:0.31, fontSize:8.5, color:C.dark, margin:0, valign:"middle" });
  });

  // corrections box (key v3 changes)
  s.addShape(pres.shapes.RECTANGLE, { x:6.0, y:0.75, w:3.75, h:4.65, fill:{color:C.navy}, line:{color:C.steel,width:1.5}, shadow:sh() });
  T(s, "ข้อแก้ไข v3.0 (ตรงกับ SRS)", { x:6.12, y:0.82, w:3.5, h:0.3, fontSize:11, bold:true, color:C.ice, margin:0 });
  const corr=[
    ["Pricing","EMSetPriceDT (ICPriceHD/DT ว่าง)"],
    ["Stock","ICStock ว่าง → จัดใน wf เอง"],
    ["Credit Note","SOInvHD 109 (ไม่ใช่ ARCNHD)"],
    ["Credit Limit","EMCust.CreditAmnt=0 ทุกราย → wf"],
    ["VAT","ปุ๋ยยกเว้น → GL ไม่มี VAT line"],
    ["GL Acc","Dr 1037 / Cr 1120 (+1129)"],
    ["รับชำระ","ARReceDT.SOInvID (69,591 แถว)"],
  ];
  corr.forEach(([k,v],i)=>{
    const ry=1.25+i*0.56;
    T(s, k, { x:6.14, y:ry, w:3.5, h:0.24, fontSize:9.5, bold:true, color:C.gold, margin:0 });
    T(s, v, { x:6.14, y:ry+0.24, w:3.5, h:0.28, fontSize:9, color:C.ice, margin:0, valign:"top" });
  });
}

// ══════════════════════════════════════════════════════════════
// SECTION DIVIDER — To-Be Design (ปรับจากภาพ concept ให้ตรง v3.0)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:2.35, w:10, h:0.05, fill:{color:C.steel}, line:{color:C.steel,width:0} });
  s.addShape(pres.shapes.RECTANGLE, { x:3.6, y:1.55, w:2.8, h:0.05, fill:{color:C.gold}, line:{color:C.gold,width:0} });
  T(s, "PART 2", { x:0, y:1.05, w:10, h:0.4, fontSize:14, color:C.ice2, align:"center", charSpacing:8, margin:0 });
  T(s, "ระบบใหม่ — การออกแบบ (To-Be Design)", { x:0, y:1.7, w:10, h:0.7, fontSize:30, bold:true, color:C.white, align:"center", margin:0 });
  T(s, "WSSALE-APP บน schema wf  ·  Non-Invasive Layer เหนือ WINSpeed (dbo READ-ONLY)", { x:0, y:2.55, w:10, h:0.4, fontSize:14, color:C.ice, align:"center", margin:0 });
  T(s, "ปรับจากภาพ concept 9 ไดอะแกรม — แก้ข้อมูลให้ตรงข้อเท็จจริงที่ยืนยันแล้ว (v3.0)", { x:0, y:3.05, w:10, h:0.35, fontSize:11, italic:true, color:C.ice2, align:"center", margin:0 });
}

// ══════════════════════════════════════════════════════════════
// SLIDE — System Overview (3 columns)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "1 · ภาพรวมระบบ (System Overview)");

  // col 1 — Users
  card(s, 0.25, 0.75, 2.75, 4.65);
  pill(s, 0.35, 0.82, 1.5, 0.32, "ผู้ใช้ (7 บทบาท)", C.navy, C.white);
  const users = [
    ["SALES","สร้าง order, เบิก Rebate/ของแถม"],
    ["COUNTER_SALES","คีย์ SO, ตรวจซ้ำ, พิมพ์ 4 สี"],
    ["WAREHOUSE","unlock, จัดของ, ชุดตั๋วคุม"],
    ["WEIGHBRIDGE","ยืนยันน้ำหนัก, Shipped"],
    ["APPROVER","อนุมัติ Plan/Unlock/Claim"],
    ["ACCOUNTING","ตรวจบัญชี, GL, Rebate"],
    ["ADMIN","user, sync, Price Book"],
  ];
  users.forEach(([r,d],i)=>{
    const y=1.26+i*0.58;
    T(s, r, { x:0.4, y, w:2.5, h:0.24, fontSize:9.5, bold:true, color:C.navy2, fontFace:MONO, margin:0 });
    T(s, d, { x:0.4, y:y+0.23, w:2.5, h:0.3, fontSize:8.5, color:C.gray, margin:0, valign:"top" });
  });

  // col 2 — Core Modules
  card(s, 3.1, 0.75, 3.6, 4.65);
  pill(s, 3.2, 0.82, 1.9, 0.32, "Core Modules (F1–F8)", C.navy2, C.white);
  const mods = [
    ["F1","Sales Order + State Machine"],
    ["F2","Rebate (Accrual + FIFO + Claim)"],
    ["F3","Giveaway + ชุดตั๋วคุม"],
    ["F4","Paper Trail 4 สี + QR"],
    ["F5","Unlock Request Flow"],
    ["F6","WINSpeed Integration"],
    ["F7","Reporting & Dashboard"],
    ["F8","RBAC + Audit + Security"],
  ];
  mods.forEach(([f,d],i)=>{
    const y=1.28+i*0.5;
    s.addShape(pres.shapes.RECTANGLE, { x:3.2, y, w:3.4, h:0.42, fill:{color:i%2===0?C.row:C.white}, line:{color:"E5E7EB",width:0.5} });
    s.addShape(pres.shapes.OVAL, { x:3.27, y:y+0.07, w:0.28, h:0.28, fill:{color:C.steel}, line:{color:C.steel,width:0} });
    T(s, f, { x:3.27, y:y+0.07, w:0.28, h:0.28, fontSize:8, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
    T(s, d, { x:3.62, y, w:2.95, h:0.42, fontSize:9.5, color:C.dark, valign:"middle", margin:0 });
  });

  // col 3 — Integration
  card(s, 6.8, 0.75, 2.95, 4.65);
  pill(s, 6.9, 0.82, 1.8, 0.32, "Integration (WS)", "0E6E8C", C.white);
  T(s, "อ่าน (read-only View)", { x:6.92, y:1.28, w:2.7, h:0.26, fontSize:10, bold:true, color:C.navy, margin:0 });
  T(s, "EMGood · EMCust\nEMSetPriceDT (ราคา NET)\nEMAcc · JOIN ตรง (DB เดียว)", { x:6.92, y:1.54, w:2.7, h:0.85, fontSize:9, color:C.dark, margin:0, valign:"top" });
  s.addShape(pres.shapes.RECTANGLE, { x:6.9, y:2.5, w:2.75, h:0.5, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "ICStock / ICPriceHD/DT = ว่าง\n→ จัดใน wf เอง", { x:6.98, y:2.52, w:2.6, h:0.46, fontSize:8.5, color:"7A4F12", margin:0, valign:"middle" });
  T(s, "ส่งเข้า (WINSpeed Import)", { x:6.92, y:3.12, w:2.7, h:0.26, fontSize:10, bold:true, color:C.navy, margin:0 });
  T(s, "ไฟล์ import → WINSpeed\nออกใบกำกับ+GL เอง\n(ไม่เขียน dbo ตรง)", { x:6.92, y:3.38, w:2.7, h:0.85, fontSize:9, color:C.dark, margin:0, valign:"top" });
  s.addShape(pres.shapes.RECTANGLE, { x:6.9, y:4.35, w:2.75, h:0.5, fill:{color:C.navy}, line:{color:C.steel,width:1} });
  T(s, "LINE = webhook/notify (Phase 1)\nLIFF เต็มรูป = Phase 2", { x:6.98, y:4.37, w:2.6, h:0.46, fontSize:8.5, color:C.ice, margin:0, valign:"middle" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE — End-to-End Business Flow (9 stages)
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "2 · กระบวนการทำงานทั้งหมด (End-to-End — ระบบใหม่)");

  const steps = [
    ["1","ใบเสนอราคา","Quotation\n(optional)"],
    ["2","SO — Draft","wf.SalesOrder\nคีย์/ตรวจซ้ำ"],
    ["3","Confirmed","ตั้ง Rebate accrual\n+ จองสต็อก (wf)"],
    ["4","Picking","จัดของ + ลำดับ\nแม่-ลูก"],
    ["5","Shipped","ส่ง import → WINSpeed\nออกใบกำกับ (107)"],
    ["6","Paper Trail","4 สี + QR\nKanban tracking"],
    ["7","Rebate Claim","FIFO → CN (109)\nอนุมัติ 4 ชั้น"],
    ["8","ใบวางบิล/รับชำระ","ARBill / ARReceDT\n.SOInvID"],
    ["9","Report","KPI · Dashboard\nexport"],
  ];
  // 2 rows: 5 + 4 (fixed card width to avoid overflow)
  const W=1.8, GAP=0.12, H=1.6;
  steps.forEach((st,i)=>{
    const row = i<5 ? 0 : 1;
    const idx = i<5 ? i : i-5;
    const startX = row===0 ? 0.26 : 1.22;   // row1 (4 cards) centered
    const x = startX + idx*(W+GAP);
    const y = 0.95 + row*2.15;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:W, h:H, fill:{color:C.white}, line:{color:"D5DEEC",width:1.5}, shadow:sh() });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:W, h:0.5, fill:{color: i===4||i===6 ? C.navy2 : C.navy}, line:{width:0} });
    s.addShape(pres.shapes.OVAL, { x:x+0.1, y:y+0.11, w:0.28, h:0.28, fill:{color:C.gold}, line:{width:0} });
    T(s, st[0], { x:x+0.1, y:y+0.11, w:0.28, h:0.28, fontSize:9, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
    T(s, st[1], { x:x+0.44, y:y+0.04, w:W-0.5, h:0.42, fontSize:9.5, bold:true, color:C.white, valign:"middle", margin:0 });
    T(s, st[2], { x:x+0.1, y:y+0.58, w:W-0.2, h:0.95, fontSize:8.5, color:C.dark, valign:"top", margin:0 });
    const lastInRow = (row===0 && idx===4) || (row===1 && idx===3);
    if(!lastInRow) s.addShape(pres.shapes.LINE, { x:x+W+0.005, y:y+0.8, w:GAP-0.01, h:0, line:{color:C.gold,width:2} });
  });
  // wrap indicator: row0 right (card 5) ลง → row1 (card 6)
  const c5x = 0.26 + 4*(W+GAP);                       // x ของ card 5
  s.addShape(pres.shapes.LINE, { x:c5x+W/2, y:2.6, w:0, h:0.32, line:{color:C.gold,width:2.5} });
  T(s, "ต่อแถวล่าง", { x:c5x-0.2, y:2.92, w:W+0.4, h:0.24, fontSize:8, bold:true, color:C.gold, align:"center", margin:0 });

  s.addShape(pres.shapes.RECTANGLE, { x:0.25, y:5.28, w:9.5, h:0.32, fill:{color:C.grnbg}, line:{color:C.grnbd,width:1} });
  T(s, "✓ แก้จาก concept: WINSpeed post บัญชีเอง (ไม่เขียน dbo) · ส่งผ่าน WINSpeed Import · ราคา NET = EMSetPriceDT · ปุ๋ยยกเว้น VAT · Stock จัดใน wf", { x:0.33, y:5.28, w:9.35, h:0.32, fontSize:8.5, color:"3D5530", margin:0, valign:"middle" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE — SO State Machine
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "3 · SO State Machine (wf.SalesOrder)");

  const states = [
    ["DRAFT","แก้ได้ทุก field","6B7280"],
    ["CONFIRMED","ตั้ง Rebate accrual\n+ จองสต็อก (wf)","B8860B"],
    ["PICKING","จัดของ — ห้ามแก้","C2683C"],
    ["SHIPPED","ล็อกถาวร + ส่ง import\n→ WINSpeed ออกใบกำกับ","2D6A4F"],
  ];
  states.forEach((st,i)=>{
    const x = 0.4 + i*2.4;
    const y = 1.0;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w:2.0, h:1.5, fill:{color:st[2]}, line:{color:st[2],width:0}, rectRadius:0.08, shadow:sh() });
    T(s, st[0], { x, y:y+0.14, w:2.0, h:0.4, fontSize:14, bold:true, color:C.white, align:"center", margin:0 });
    T(s, st[1], { x:x+0.1, y:y+0.6, w:1.8, h:0.85, fontSize:8.5, color:C.white, align:"center", valign:"top", margin:0 });
    if(i<3) s.addShape(pres.shapes.LINE, { x:x+2.02, y:y+0.75, w:0.36, h:0, line:{color:C.navy,width:2.5} });
  });

  // unlock back-arrow
  s.addShape(pres.shapes.LINE, { x:2.4, y:2.72, w:4.6, h:0, line:{color:C.red,width:1.75,dashType:"dash"} });
  s.addShape(pres.shapes.LINE, { x:2.4, y:2.5, w:0, h:0.22, line:{color:C.red,width:1.75,dashType:"dash"} });
  s.addShape(pres.shapes.LINE, { x:7.0, y:2.5, w:0, h:0.22, line:{color:C.red,width:1.75,dashType:"dash"} });
  T(s, "Unlock → กลับ DRAFT + Reverse accrual (reversedFlag, ไม่ลบ)", { x:2.4, y:2.74, w:4.6, h:0.3, fontSize:9, bold:true, color:C.red, align:"center", margin:0 });

  // transition rules + audit
  card(s, 0.25, 3.25, 4.7, 2.15);
  pill(s, 0.35, 3.32, 1.7, 0.3, "Transition Rules", C.navy, C.white);
  T(s, "• DRAFT → CONFIRMED : ตั้ง accrual + จองสต็อก\n• CONFIRMED → PICKING : เริ่มจัดของ\n• PICKING → SHIPPED : ยืนยันน้ำหนัก → เขียน WS\n• CONFIRMED/PICKING → DRAFT : ผ่าน Unlock approve\n• * → CANCELLED : DocuStatus='N'", { x:0.4, y:3.72, w:4.45, h:1.6, fontSize:9.5, color:C.dark, margin:0, valign:"top" });

  card(s, 5.05, 3.25, 4.7, 2.15);
  pill(s, 5.15, 3.32, 1.9, 0.3, "Audit Trail (immutable)", C.navy2, C.white);
  T(s, "ทุก transition บันทึก wf.SalesOrderAudit:\n• actor (ผู้ทำ) + IP\n• timestamp\n• action (CONFIRM/UNLOCK/SHIP...)\n• before/after JSON\n→ แก้ไม่ได้ (append-only, retention 7 ปี)", { x:5.2, y:3.72, w:4.45, h:1.6, fontSize:9.5, color:C.dark, margin:0, valign:"top" });
}

// ══════════════════════════════════════════════════════════════
// SLIDE — Rebate FIFO Process
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "4 · กระบวนการบริหารส่วนลด (Rebate Accrual + FIFO)");

  const flow = [
    ["Price Book","NET รายเดือน\n(EMSetPriceDT)"],
    ["Rebate Plan","สูตร×ภาค\nDRAFT/ACTIVE/CLOSED"],
    ["Rebate Pool","ต่อ Sales×เดือน\nalloc/used/remain"],
    ["Accrual","(ขาย−NET)×ตัน\nต่อบรรทัด"],
    ["FIFO + Claim","ตัดก้อนเก่าก่อน\n→ CN (109)"],
  ];
  flow.forEach((f,i)=>{
    const x = 0.3 + i*1.92;
    const y = 0.95;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:1.62, h:1.25, fill:{color:C.navy}, line:{color:C.steel,width:1}, shadow:sh() });
    T(s, f[0], { x, y:y+0.14, w:1.62, h:0.35, fontSize:10, bold:true, color:C.white, align:"center", margin:0 });
    T(s, f[1], { x:x+0.06, y:y+0.5, w:1.5, h:0.7, fontSize:8, color:C.ice, align:"center", valign:"top", margin:0 });
    if(i<4) s.addShape(pres.shapes.LINE, { x:x+1.64, y:y+0.62, w:0.28, h:0, line:{color:C.gold,width:2.5} });
  });

  // formula + example
  card(s, 0.25, 2.5, 5.0, 2.9);
  pill(s, 0.35, 2.57, 2.6, 0.3, "ตัวอย่างจริง — RBD68-019", C.navy2, C.white);
  T(s, "accrual = (ราคาขาย − ราคา NET) × จำนวนตัน", { x:0.4, y:2.95, w:4.8, h:0.3, fontSize:10, bold:true, color:C.navy, fontFace:MONO, margin:0 });
  const ex = [
    ["สูตร","ตัน","ขาย","NET","รีเบท/ตัน","รวม"],
    ["15-5-35","19","18,200","17,000","1,200","22,800"],
    ["0-0-60","16","13,200","12,500","700","11,200"],
    ["21-0-0","8","8,200","7,700","500","4,000"],
  ];
  ex.forEach((r,ri)=>{
    const y=3.3+ri*0.42;
    const cols=[0.4,1.45,2.1,2.95,3.8,4.55];
    const ws=[1.05,0.65,0.85,0.85,0.75,0.7];
    r.forEach((c,ci)=>{
      s.addShape(pres.shapes.RECTANGLE, { x:cols[ci], y, w:ws[ci], h:0.4, fill:{color: ri===0?C.navy : (ri%2===1?C.row:C.white)}, line:{color:"E5E7EB",width:0.5} });
      T(s, c, { x:cols[ci]+0.02, y, w:ws[ci]-0.04, h:0.4, fontSize:8, bold:ri===0, color:ri===0?C.white:C.dark, align:ci===0?"left":"center", valign:"middle", margin:0 });
    });
  });

  // corrections box
  card(s, 5.35, 2.5, 4.4, 2.9);
  pill(s, 5.45, 2.57, 2.3, 0.3, "แก้จาก concept (v3.0)", C.gold, C.white);
  const corr = [
    ["Claim → Credit Note","ส่ง import → WINSpeed ออก CN (109)\n(WINSpeed ลงบัญชีเอง ไม่เขียน dbo)"],
    ["FIFO ตัดข้าม Plan","เมื่อ Pool ก่อนหน้าหมด, fifoSeq ต่อเนื่อง"],
    ["Unlock → Reverse","RebateLedger.reversedFlag=1 (ไม่ลบ)"],
    ["Trace 100%","ทุก ledger link กลับ SOLine + Plan"],
  ];
  corr.forEach(([k,v],i)=>{
    const y=3.0+i*0.6;
    T(s, "• "+k, { x:5.45, y, w:4.2, h:0.26, fontSize:9.5, bold:true, color:C.navy, margin:0 });
    T(s, v, { x:5.6, y:y+0.24, w:4.05, h:0.34, fontSize:8.5, color:C.gray, margin:0, valign:"top" });
  });
}

// ══════════════════════════════════════════════════════════════
// SLIDE — Architecture & Tech Stack
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.off };
  header(s, "5 · สถาปัตยกรรมระบบ — เน้นความเรียบง่าย (SQL Server เดียว)");

  // 3 boxes: Frontend → Backend → SQL Server (single DB)
  const tiers = [
    ["Frontend","React + Vite + TypeScript\nTailwind + shadcn/ui\n(tablet-first iPad)", C.navy, 2.5],
    ["Backend","NestJS (Node 20) + REST\nJWT (Passport)\nWebSocket node เดียว", C.navy2, 2.5],
    ["SQL Server 2022","ฐานข้อมูลเดียว: dbwins_worldfert9\nschema wf (read-write)\n+ dbo (read-only)\nPrisma (SQL Server) / mssql", "0E6E8C", 3.3],
  ];
  let tx = 0.4;
  tiers.forEach((t,i)=>{
    const y = 1.0, w = t[3];
    s.addShape(pres.shapes.RECTANGLE, { x:tx, y, w, h:2.5, fill:{color:C.white}, line:{color:"D5DEEC",width:1.5}, shadow:sh() });
    s.addShape(pres.shapes.RECTANGLE, { x:tx, y, w, h:0.5, fill:{color:t[2]}, line:{width:0} });
    T(s, t[0], { x:tx, y:y+0.08, w, h:0.34, fontSize:13, bold:true, color:C.white, align:"center", margin:0 });
    T(s, t[1], { x:tx+0.14, y:y+0.64, w:w-0.28, h:1.8, fontSize:9.5, color:C.dark, valign:"top", margin:0 });
    if(i<2) s.addShape(pres.shapes.LINE, { x:tx+w+0.04, y:y+1.25, w:0.32, h:0, line:{color:C.gold,width:2.5} });
    tx += w + 0.4;
  });

  // no-tech callout (peach)
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:3.62, w:9.2, h:0.45, fill:{color:C.peach}, line:{color:"E8C98A",width:1} });
  T(s, "✗ ไม่ใช้ PostgreSQL · ไม่ใช้ Redis · ไม่ใช้ Message Queue (BullMQ) · ไม่มี Background worker  —  ทุกอย่างอยู่บน SQL Server เดียว", { x:0.5, y:3.62, w:9.0, h:0.45, fontSize:9.5, bold:true, color:"7A4F12", align:"center", valign:"middle", margin:0 });

  // design principles
  card(s, 0.4, 4.2, 9.2, 1.2);
  pill(s, 0.5, 4.27, 1.7, 0.3, "Non-Invasive", C.grnbd, C.white);
  const principles = [
    "wf กับ dbo อยู่ DB เดียวกัน → JOIN ข้าม schema ได้ตรง ไม่ต้อง sync/cache",
    "ห้ามแก้ schema + ห้ามเขียนตารางบัญชี dbo — อ่าน dbo ผ่าน View, ส่งข้อมูลเข้าผ่าน WINSpeed Import (WINSpeed post บัญชีเอง 100%)",
    "ระบบใหม่ล่ม → กลับไปคีย์ WINSpeed ได้ปกติ · ยืนยันแล้ว: DB ไม่มี trigger/SP post GL อัตโนมัติ (RI-check ล้วน)",
  ];
  principles.forEach((p,i)=>{
    T(s, "•  "+p, { x:0.5, y:4.62+i*0.26, w:9.0, h:0.24, fontSize:8.8, color:C.dark, valign:"middle", margin:0 });
  });
}

// ══════════════════════════════════════════════════════════════
// SLIDE 12 — Next Steps
// ══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.4, h:5.625, fill:{color:C.steel}, line:{color:C.steel,width:0} });
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:4.2, w:10, h:1.425, fill:{color:C.navy2}, line:{color:C.navy2,width:0} });

  T(s, "ขั้นตอนถัดไป", { x:0.65, y:0.45, w:9, h:0.5, fontSize:14, color:C.ice, charSpacing:4, margin:0 });
  T(s, "Next Steps", { x:0.65, y:0.95, w:9, h:1.0, fontSize:44, bold:true, color:C.white, margin:0 });

  const nx=[
    ["01","สร้าง wf schema","SalesOrder, RebatePlan/Pool/Ledger/Claim, Giveaway, ControlTicket, WeighTicket"],
    ["02","Login wf_owner","CREATE LOGIN → full access เฉพาะ schema wf (dbo อ่านอย่างเดียว)"],
    ["03","API Layer","NestJS + Prisma → query dbo (read-only) + write wf"],
    ["04","Rebate Engine","accrual ต่อบรรทัด → FIFO → Claim → CN (109) ใน WS"],
    ["05","Credit Master (D-02)","WS ไม่มีวงเงิน (CreditAmnt=0) → ออกแบบใน wf หรือยืนยันยกเลิก"],
  ];
  nx.forEach((n,i)=>{
    const bx=i<3 ? 0.65+i*3.05 : 0.65+(i-3)*3.05+1.55;
    const by=i<3 ? 2.08 : 3.35;
    s.addShape(pres.shapes.OVAL, { x:bx, y:by, w:0.38, h:0.38, fill:{color:C.steel}, line:{color:C.steel,width:0} });
    T(s, n[0], { x:bx, y:by, w:0.38, h:0.38, fontSize:11, bold:true, color:C.white, align:"center", valign:"middle", margin:0 });
    T(s, n[1], { x:bx+0.48, y:by+0.02, w:2.45, h:0.24, fontSize:11, bold:true, color:C.white, margin:0, valign:"middle" });
    T(s, n[2], { x:bx+0.48, y:by+0.28, w:2.45, h:0.7, fontSize:8.5, color:C.ice, margin:0, valign:"top" });
  });

  T(s, "World Fert  ·  WINSpeed DB Study  ·  สอดคล้อง SRS v3.0  ·  2569", { x:0.5, y:4.35, w:9, h:0.35, fontSize:9, color:C.ice, align:"center", margin:0, valign:"middle" });
  T(s, "ข้อมูลทั้งหมดยืนยันจากการ query DB จริง  |  dbo = READ-ONLY  |  wf schema = สร้างใหม่", { x:0.5, y:4.75, w:9, h:0.3, fontSize:8.5, color:C.ice2, align:"center", margin:0, valign:"middle" });
}

// ─── Save ──────────────────────────────────────────────────────
const outPath = "M:\\My Drive\\World Fert\\WorldFert_Workflow.pptx";
pres.writeFile({ fileName: outPath })
  .then(()=>console.log("✅ Saved:", outPath))
  .catch(e=>{ console.error("❌", e); process.exit(1); });
