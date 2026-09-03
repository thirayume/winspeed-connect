// WorldFert doc-gen: PPTX matrix (training overview / per-role / support-maintenance)
// embeds mermaid diagram PNGs. pptxgenjs.
const pptxgen = require("pptxgenjs");
const path = require("path");
const fs = require("fs");
const ENT = path.resolve(__dirname, "..", "..");
const DIAG = path.join(ENT, "pipeline", "diagrams");
const OUT = path.join(ENT, "02-PPTX", "generated");
const NAVY="0C447C", NAVYDK="082A4E", GREEN="059669", ICE="CADCFC", LIGHT="F4F7FB", GRAY="5B6B7B", WHITE="FFFFFF", INK="1E2A38";
// ---------- manifest-driven (ห้าม hardcode โครงสไลด์/ชื่อ diagram ในไฟล์นี้) ----------
const MANIFEST_PATH = process.env.WF_PPTX_MANIFEST || path.join(__dirname, "pptx-manifest.json");
const APP_VERSION = (() => {
  // ห้าม hardcode เลขเวอร์ชัน อ่านจาก package.json ของ repo เพื่อให้ตรงกับ runtime เสมอ
  try { return require(require("path").resolve(__dirname, "..", "..", "..", "..", "package.json")).version; }
  catch { return MF.docVersion || "0.0.0"; }
})();
const DOC_VERSION = "v" + APP_VERSION;

const MF = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const HS = (MF.fonts && MF.fonts.heading) || "Kanit";
const HF = (MF.fonts && MF.fonts.body) || "Prompt";
const DT = MF.diagramTitles || {};
const DECKS = MF.decks || [];

// ดึง bullet จาก markdown จริง — ใช้กับสไลด์ที่ระบุ { md: { file, heading, max } }
// เก็บ list item ใต้ heading ที่ระบุ จนถึง heading ถัดไปที่ระดับเท่ากันหรือสูงกว่า
function bulletsFromMarkdown(spec) {
  const file = path.join(ENT, spec.file);
  if (!fs.existsSync(file)) {
    console.warn("  [warn] ไม่พบ " + spec.file + " - ใช้ bullet สำรองแทน");
    return [];
  }
  const text = fs.readFileSync(file, "utf8");
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const want = String(spec.heading || "").trim().toLowerCase();
  let level = 0;
  let collecting = !want;
  const out = [];
  for (const raw of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const lv = h[1].length;
      const title = h[2].trim().toLowerCase();
      if (collecting && want && lv <= level) break;
      if (!collecting && want && title.indexOf(want) !== -1) { collecting = true; level = lv; }
      continue;
    }
    if (!collecting) continue;
    const b = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(raw);
    if (b) {
      const clean = b[1]
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .replace(/\[(.+?)\]\([^)]*\)/g, "$1")
        .trim();
      if (clean) out.push(clean);
    }
    if (spec.max && out.length >= spec.max) break;
  }
  return out;
}

// bullet ของสไลด์: ถ้ามี md ให้ดึงจากเอกสารก่อน ไม่ได้ค่อย fallback ไป b
function slideBullets(sl) {
  if (sl.md) {
    const got = bulletsFromMarkdown(sl.md);
    if (got.length) return got;
  }
  return sl.b || [];
}


// สไลด์ฝึกปฏิบัติต่อท้ายหัวข้อที่ manifest ระบุ lab ไว้
// แยกเป็นสไลด์ของตัวเองเพื่อให้ผู้สอนหยุดให้ผู้เรียนลงมือทำได้จริง
const SHOTS = path.join(ENT, "05-UI-SCREENSHOTS", "generated");

// หาไฟล์ภาพหน้าจอตามชื่อ portal โดยเลือกบทบาทที่เหมาะกับผู้ฟังก่อน
function findShot(key, rolePref){
  if(!key) return null;
  const order=[...(rolePref||[]),"admin","manager","sales","warehouse","counter-sales"];
  for(const role of order){
    const file=path.join(SHOTS, `${role}--${key}.png`);
    if(fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * สไลด์ฝึกปฏิบัติ: ภาพหน้าจอจริงด้านซ้าย ขั้นตอนทีละข้อด้านขวา
 *
 * ผู้เรียนต้องเห็นหน้าจอที่กำลังพูดถึง ไม่ใช่ตัวหนังสือล้วน
 * ถ้าไม่มีภาพของหน้านั้นจะถอยไปใช้เลย์เอาต์ข้อความเต็มหน้าแทน
 */
function addLab(p,sl,rolePref){
  const L=p.addSlide(); L.background={color:WHITE};
  L.addText("ฝึกปฏิบัติ · "+sl.t,{x:0.6,y:0.35,w:12.1,h:0.75,fontFace:HS,fontSize:25,bold:true,color:NAVY});

  const shot=findShot(sl.lab.ui||sl.ui,rolePref);
  const stepX = shot ? 7.6 : 1.0;
  const stepW = shot ? 5.1 : 11.0;

  if(shot){
    L.addShape(p.ShapeType.roundRect,{x:0.55,y:1.25,w:6.85,h:5.75,rectRadius:0.06,fill:{color:LIGHT},line:{color:"D8DEE8",width:1}});
    L.addImage({path:shot,x:0.7,y:1.4,w:6.55,h:5.45,sizing:{type:"contain",w:6.55,h:5.45}});
    L.addText("หน้าจอจริงของระบบ",{x:0.55,y:6.95,w:6.85,h:0.3,fontFace:HF,fontSize:10,italic:true,color:GRAY});
  }

  const steps=(sl.lab.steps||[]).map((t,i)=>({text:(i+1)+".  "+t,options:{bullet:false,color:INK,breakLine:true,paraSpaceAfter:9}}));
  L.addText("ทำตามขั้นตอน",{x:stepX,y:1.25,w:stepW,h:0.35,fontFace:HS,fontSize:15,bold:true,color:NAVY});
  L.addText(steps,{x:stepX,y:1.7,w:stepW,h:3.4,fontFace:HF,fontSize:13.5,valign:"top"});

  const ok=(sl.lab.pass||[]).map(t=>({text:t,options:{bullet:{code:"2713"},color:INK,breakLine:true,paraSpaceAfter:7}}));
  L.addText("เกณฑ์ผ่าน",{x:stepX,y:5.15,w:stepW,h:0.35,fontFace:HS,fontSize:15,bold:true,color:NAVY});
  L.addText(ok,{x:stepX,y:5.55,w:stepW,h:1.6,fontFace:HF,fontSize:12.5,valign:"top"});

  if(sl.lab.note) L.addNotes(String(sl.lab.note));
}

function makeDeck(spec){
  const p=new pptxgen(); p.defineLayout({name:"W",width:13.333,height:7.5}); p.layout="W";
  // title
  let s=p.addSlide(); s.background={color:NAVYDK};
  s.addShape(p.ShapeType.ellipse,{x:10.4,y:-1.3,w:4.4,h:4.4,fill:{color:NAVY},line:{type:"none"}});
  s.addShape(p.ShapeType.ellipse,{x:11.8,y:4.9,w:3,h:3,fill:{color:GREEN},line:{type:"none"}});
  s.addText("World Fert · WS-Sale-App",{x:0.7,y:2.4,w:11,h:0.5,fontFace:HF,fontSize:17,color:ICE});
  s.addText(spec.title,{x:0.7,y:2.95,w:11.5,h:1.3,fontFace:HS,fontSize:40,bold:true,color:WHITE});
  s.addShape(p.ShapeType.roundRect,{x:0.72,y:4.4,w:2.2,h:0.5,rectRadius:0.25,fill:{color:GREEN},line:{type:"none"}});
  s.addText(DOC_VERSION,{x:0.72,y:4.4,w:2.2,h:0.5,align:"center",valign:"middle",fontFace:HF,fontSize:13,bold:true,color:WHITE});
  s.addText("Audience: "+spec.aud+"   ·   App 1.0.0   ·   21 ก.ค. 2569",{x:0.75,y:6.5,w:11.5,h:0.4,fontFace:HF,fontSize:12,color:"8FA6C4"});
  // agenda
  s=p.addSlide(); s.background={color:WHITE};
  s.addText("Agenda",{x:0.6,y:0.5,w:11,h:0.8,fontFace:HS,fontSize:30,bold:true,color:NAVY});
  s.addText(spec.slides.map((sl,i)=>({text:(i+1)+".  "+sl.t,options:{bullet:false,color:INK,breakLine:true,paraSpaceAfter:12}})),{x:0.9,y:1.8,w:11,h:5,fontFace:HF,fontSize:20});
  // content slides: diagram + bullets
  spec.slides.forEach(sl=>{
    const c=p.addSlide(); c.background={color:WHITE};
    c.addText(sl.t,{x:0.6,y:0.4,w:12.1,h:0.8,fontFace:HS,fontSize:26,bold:true,color:NAVY});
    // หน้าจอจริงมาก่อนไดอะแกรม เพราะผู้เรียนต้องเห็นสิ่งที่จะไปกดจริง
    const uiShot=findShot(sl.ui,spec.rolePref);
    const png=path.join(DIAG,sl.d+".png");
    if(uiShot){
      c.addShape(p.ShapeType.roundRect,{x:0.55,y:1.4,w:8.0,h:5.5,rectRadius:0.06,fill:{color:LIGHT},line:{color:"D8DEE8",width:1}});
      c.addImage({path:uiShot,x:0.7,y:1.55,w:7.7,h:5.2,sizing:{type:"contain",w:7.7,h:5.2}});
    } else if(fs.existsSync(png)) c.addImage({path:png,x:0.55,y:1.4,w:8.0,h:5.5,sizing:{type:"contain",w:8.0,h:5.5}});
    // bullets panel right
    c.addShape(p.ShapeType.roundRect,{x:8.75,y:1.4,w:4.0,h:5.5,rectRadius:0.08,fill:{color:LIGHT},line:{type:"none"}});
    const bl=slideBullets(sl);
    c.addText(bl.map((t,i)=>({text:t,options:{bullet:{code:"2022"},color:INK,breakLine:i<bl.length-1,paraSpaceAfter:10}})),{x:9.0,y:1.65,w:3.55,h:5,fontFace:HF,fontSize:13,valign:"top"});
    c.addText(uiShot?("หน้าจอ: "+sl.ui):(DT[sl.d]||""),{x:0.55,y:6.95,w:8,h:0.35,fontFace:HF,fontSize:10,italic:true,color:GRAY});
    // สคริปต์ผู้สอน — ผู้บรรยายเห็นใน Presenter View ผู้เรียนไม่เห็น
    if(sl.n) c.addNotes(Array.isArray(sl.n) ? sl.n.join("\n") : String(sl.n));
    // สไลด์ฝึกปฏิบัติต่อท้ายหัวข้อ (ถ้ามี)
    if(sl.lab) addLab(p,sl,spec.rolePref);
  });
  // closing
  s=p.addSlide(); s.background={color:NAVYDK};
  s.addText("ขอบคุณครับ / Thank you",{x:0.8,y:3.0,w:11.5,h:1,fontFace:HS,fontSize:34,bold:true,color:WHITE});
  s.addText("World Fert · WS-Sale-App "+DOC_VERSION+" · "+spec.aud,{x:0.82,y:4.1,w:11.5,h:0.5,fontFace:HF,fontSize:15,color:ICE});
  return p.writeFile({fileName:path.join(OUT,String(spec.id).replace("{VERSION}",DOC_VERSION)+".pptx")});
}

fs.mkdirSync(OUT,{recursive:true});
(async()=>{ for(const d of DECKS){ const f=await makeDeck(d); console.log("built",path.basename(f)); } console.log("done",DECKS.length,"decks ->",OUT); })();
