// ============================================================
// WorldFert WS-Sale-App — Diagrams generator (drawio, editable)
// Pages: Swimlane AS-IS, Swimlane TO-BE, Workflow, Work Process,
//        DFD (Context+L1), ER Diagram, UML Use Case, UML Class
// CI: Navy #1F3864
// ============================================================
const fs = require("fs");

// ---- palette ----
const NAVY="#1F3864", NAVY2="#2E5496", STEEL="#4472C4", ICE="#E8EEF5",
      ROW="#EBF0F7", GREEN="#E8F0E5", GREENB="#5E7E45", PEACH="#FBEFE0",
      GOLD="#C8862E", GRAY="#667085", WHITE="#FFFFFF", RED="#B02418";

let uid = 0;
const nid = (p="n") => `${p}${++uid}`;
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\n/g,"&#10;");

function box(id,val,x,y,w,h,style){ return `<mxCell id="${id}" value="${esc(val)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`; }
function edge(id,s,t,style="",lbl=""){ return `<mxCell id="${id}" value="${esc(lbl)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;${style}" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`; }

// styles
const ST = {
  proc:`rounded=1;whiteSpace=wrap;html=1;fillColor=${ICE};strokeColor=${NAVY};fontColor=#13233F;fontSize=12;arcSize=12;`,
  procN:`rounded=1;whiteSpace=wrap;html=1;fillColor=${NAVY};strokeColor=${NAVY};fontColor=#FFFFFF;fontSize=12;fontStyle=1;arcSize=12;`,
  procG:`rounded=1;whiteSpace=wrap;html=1;fillColor=${GREEN};strokeColor=${GREENB};fontColor=#2E3D22;fontSize=12;arcSize=12;`,
  procP:`rounded=1;whiteSpace=wrap;html=1;fillColor=${PEACH};strokeColor=${GOLD};fontColor=#5A3D12;fontSize=12;arcSize=12;`,
  start:`ellipse;whiteSpace=wrap;html=1;fillColor=${GREEN};strokeColor=${GREENB};fontSize=11;`,
  end:`ellipse;whiteSpace=wrap;html=1;fillColor=${PEACH};strokeColor=${GOLD};fontSize=11;`,
  dec:`rhombus;whiteSpace=wrap;html=1;fillColor=#FFF6E0;strokeColor=${GOLD};fontColor=#5A3D12;fontSize=11;`,
  store:`shape=partialRectangle;top=1;bottom=1;left=0;right=0;whiteSpace=wrap;html=1;fillColor=#F4F6F9;strokeColor=${NAVY2};fontColor=#13233F;fontSize=11;`,
  ext:`rounded=0;whiteSpace=wrap;html=1;fillColor=#EDEDED;strokeColor=#666;fontSize=11;fontStyle=1;`,
  dfdproc:`ellipse;whiteSpace=wrap;html=1;fillColor=${ICE};strokeColor=${NAVY};fontColor=#13233F;fontSize=11;`,
  uc:`ellipse;whiteSpace=wrap;html=1;fillColor=${ICE};strokeColor=${NAVY};fontSize=11;`,
  actor:`shape=umlActor;verticalLabelPosition=bottom;labelPosition=center;verticalAlign=top;html=1;fontSize=11;strokeColor=${NAVY};`,
  note:`text;html=1;align=left;verticalAlign=top;fontSize=11;fontColor=#444;`,
  title:`text;html=1;align=left;fontSize=18;fontStyle=1;fontColor=${NAVY};`,
  lane:`swimlane;html=1;startSize=28;fillColor=none;strokeColor=${NAVY2};fontColor=${NAVY};fontStyle=1;fontSize=12;horizontal=0;`,
  edgeN:`strokeColor=${NAVY};fontColor=#13233F;`,
  edgeG:`strokeColor=${GOLD};fontColor=${GOLD};fontStyle=1;`,
  edgeR:`strokeColor=${RED};fontColor=${RED};dashed=1;`,
};

function page(name, cells){
  uid_reset_marker:; // no-op
  return `  <diagram name="${esc(name)}" id="${nid('d')}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join("\n        ")}
      </root>
    </mxGraphModel>
  </diagram>`;
}

const pages = [];

// ════════════════════════════════════════════════════════════
// PAGE 1 — Swimlane AS-IS (กระบวนการปัจจุบัน)
// ════════════════════════════════════════════════════════════
{
  const c = [];
  c.push(box(nid(),"Swimlane AS-IS — กระบวนการขายปัจจุบัน (Manual + WINSpeed)",40,16,900,30,ST.title));
  // pool
  const lanes = [
    ["Sales (ตัวแทนขาย)", "#F4F6F9"],
    ["Counter Sales", "#EEF3FB"],
    ["ยาม / รปภ.", "#F4F6F9"],
    ["ส่วนจ่ายสินค้า + TruckScale", "#EEF3FB"],
    ["คนขับรถ", "#F4F6F9"],
    ["ฝ่ายชั่งน้ำหนัก", "#EEF3FB"],
    ["Accounting", "#F4F6F9"],
  ];
  const laneX=40, laneY=60, laneW=1500, laneH=120;
  const laneIds=[];
  lanes.forEach((l,i)=>{ const id=nid('lane'); laneIds.push(id);
    c.push(`<mxCell id="${id}" value="${esc(l[0])}" style="${ST.lane}fillColor=${l[1]};" vertex="1" parent="1"><mxGeometry x="${laneX}" y="${laneY+i*laneH}" width="${laneW}" height="${laneH}" as="geometry"/></mxCell>`);
  });
  // helper to place node in a lane (relative to lane)
  const inLane=(laneIdx,val,x,w,style,h=46,y=36)=>{ const id=nid();
    c.push(`<mxCell id="${id}" value="${esc(val)}" style="${style}" vertex="1" parent="${laneIds[laneIdx]}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`); return id; };
  const s = inLane(0,"รับ enquiry +\nส่ง order ทาง LINE",30,150,ST.start,46,36);
  const cs = inLane(1,"พิมพ์ใบสั่งจอง (WINSpeed)\n+ แจ้งทะเบียนรถ",230,170,ST.proc);
  const ya = inLane(2,"รับบัตร ปชช.\n+ ออกใบอนุญาตเข้า-ออก",450,170,ST.proc);
  const dp = inLane(3,"คีย์ใบสั่งจองลง TruckScale\nพิมพ์ตั๋วจ่ายของ (สายพาน/คลัง/bulk)",670,210,ST.proc);
  const dr1= inLane(4,"นำรถเบาชั่งเข้า\n→ รับของตามจุด",910,160,ST.proc);
  const dr2= inLane(4,"วนรับของ 3 รอบ\n(หลายชนิด)",1090,150,ST.dec,46);
  const wb = inLane(5,"ชั่งรถรวมของ +\nพิมพ์ใบจ่าย 4 สี",1270,160,ST.proc);
  const drs= inLane(4,"เซ็นรับของทั้งชุด",1270,150,ST.proc);
  const acc= inLane(6,"ตรวจ Rebate ทีละบิล\n(manual) → อนุมัติเบิก",1300,180,ST.procP);
  // edges (cross-lane via absolute ids)
  c.push(edge(nid('e'),s,cs,ST.edgeN));
  c.push(edge(nid('e'),cs,ya,ST.edgeN));
  c.push(edge(nid('e'),ya,dp,ST.edgeN));
  c.push(edge(nid('e'),dp,dr1,ST.edgeN));
  c.push(edge(nid('e'),dr1,dr2,ST.edgeN));
  c.push(edge(nid('e'),dr2,wb,ST.edgeN,"ครบ"));
  c.push(edge(nid('e'),dr2,dr1,ST.edgeR,"ยังไม่ครบ"));
  c.push(edge(nid('e'),wb,drs,ST.edgeN));
  c.push(edge(nid('e'),drs,acc,ST.edgeN));
  // pain points note
  c.push(box(nid(),"⚠ Pain Points: คีย์ซ้ำ (LINE→WINSpeed) · ใบ 4 สีหาย ~10%/เดือน · Rebate ตรวจ manual 2-3 ชม./วัน · ของแถม/ตั๋วคุมเขียนกระดาษ (ไม่อยู่ในระบบ) · ไม่เห็นสต็อก/สถานะรถ real-time",40,laneY+lanes.length*laneH+20,1500,40,ST.note+`fontColor=${RED};`));
  pages.push(page("1. Swimlane AS-IS", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 2 — Swimlane TO-BE (WS-Sale-App + WINSpeed)
// ════════════════════════════════════════════════════════════
{
  const c=[];
  c.push(box(nid(),"Swimlane TO-BE — WS-Sale-App + WINSpeed (Non-Invasive)",40,16,900,30,ST.title));
  const lanes=[
    ["Sales (WS-Sale-App)","#EEF3FB"],
    ["Counter Sales","#F4F6F9"],
    ["Approver","#EEF3FB"],
    ["WS-Sale-App (ระบบ wf)","#E8F0E5"],
    ["Warehouse / Weighbridge","#F4F6F9"],
    ["WINSpeed (บัญชี — ไม่แก้)","#FBEFE0"],
  ];
  const laneX=40, laneY=60, laneW=1500, laneH=120; const laneIds=[];
  lanes.forEach((l,i)=>{ const id=nid('lane'); laneIds.push(id);
    c.push(`<mxCell id="${id}" value="${esc(l[0])}" style="${ST.lane}fillColor=${l[1]};" vertex="1" parent="1"><mxGeometry x="${laneX}" y="${laneY+i*laneH}" width="${laneW}" height="${laneH}" as="geometry"/></mxCell>`);
  });
  const inLane=(li,val,x,w,style,h=46,y=36)=>{ const id=nid();
    c.push(`<mxCell id="${id}" value="${esc(val)}" style="${style}" vertex="1" parent="${laneIds[li]}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`); return id; };
  const s  = inLane(0,"สร้าง SO + ดู Rebate/\nสต็อก/ของแถม real-time",30,170,ST.start,50);
  const ver= inLane(1,"ตรวจซ้ำคำสั่งซื้อ\n(Verification Gate)",240,160,ST.proc);
  const apv= inLane(2,"อนุมัติ (ตามกฎ:\nสุรชัย/รุ่งนิรันดร์/3 ผจก.)",440,170,ST.proc);
  const gen= inLane(3,"สร้าง SOHD.TXT+SODT.TXT\n(DocuType 104)",660,180,ST.procG);
  const imp= inLane(5,"SO Export/Import →\nใบสั่งขาย (รออนุมัติ)",660,180,ST.procP);
  const wh = inLane(4,"จัด/ชั่งออก +\nยืนยันน้ำหนัก (WeighTicket)",880,180,ST.proc);
  const post=inLane(5,"Post Invoice (WF) →\nใบกำกับ 107 + GL",890,170,ST.procP);
  const sync=inLane(3,"อ่าน DocuNo กลับ\nsync สถานะ",1110,150,ST.procG);
  const reb= inLane(3,"Rebate accrual + FIFO\n+ Claim → CN(109)",1290,170,ST.procG);
  c.push(edge(nid('e'),s,ver,ST.edgeN));
  c.push(edge(nid('e'),ver,apv,ST.edgeN));
  c.push(edge(nid('e'),apv,gen,ST.edgeN));
  c.push(edge(nid('e'),gen,imp,ST.edgeG,"import file"));
  c.push(edge(nid('e'),imp,wh,ST.edgeN));
  c.push(edge(nid('e'),wh,post,ST.edgeN,"Shipped"));
  c.push(edge(nid('e'),post,sync,ST.edgeG,"DocuNo"));
  c.push(edge(nid('e'),sync,reb,ST.edgeN));
  c.push(box(nid(),"✓ WINSpeed = เจ้าของบัญชี 100% (ไม่แก้ระบบ) · wf คุม workflow+สถานะ+rebate · ส่งผ่าน Import → WINSpeed post GL เอง",40,laneY+lanes.length*laneH+20,1500,34,ST.note+`fontColor=${GREENB};`));
  pages.push(page("2. Swimlane TO-BE", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 3 — Workflow (Document flow + DocuType)
// ════════════════════════════════════════════════════════════
{
  const c=[]; c.push(box(nid(),"Workflow — สายเอกสาร (Document Flow + DocuType)",40,16,900,30,ST.title));
  const row=(y,items)=>{ const ids=[]; let x=60; items.forEach(it=>{ const id=nid(); const w=it.w||170;
    c.push(box(id,it.v,x,y,w,60,it.s||ST.proc)); ids.push({id,x,w,y}); x+=w+50; }); return ids; };
  const r1=row(90,[
    {v:"ใบเสนอราคา\n(Quotation)"},
    {v:"ใบสั่งจอง 103\n(Confirm Order)",s:ST.procN},
    {v:"เข้าชั่ง → ตั๋วคุม\nAppvDocuNo 'AI'",s:ST.procP},
    {v:"ใบสั่งขาย 104\n(Sale Order)",s:ST.procN},
    {v:"Post Invoice (WF)",s:ST.procP},
  ]);
  const r2=row(230,[
    {v:"ใบกำกับ 107/202\n(SOInvHD) + GL 501",s:ST.procN},
    {v:"ใบวางบิล 203\n(ARBillHD)"},
    {v:"รับชำระ\n(ARReceDT)"},
    {v:"CN 109 / DN 110\n(แก้ยอด)",s:ST.procP},
  ]);
  for(let i=0;i<r1.length-1;i++) c.push(edge(nid('e'),r1[i].id,r1[i+1].id,ST.edgeN));
  c.push(edge(nid('e'),r1[4].id,r2[0].id,ST.edgeG,"WINSpeed ออกใบกำกับ+GL"));
  for(let i=0;i<r2.length-1;i++) c.push(edge(nid('e'),r2[i].id,r2[i+1].id,ST.edgeN));
  // join key notes
  c.push(box(nid(),"Join keys (ยืนยันจริง): SOHD104.RefNo = SOHD103.AppvDocuNo · SOInvHD.SONo = SOHD104.DocuNo · GLHD.DocuNo = SOInvHD.DocuNo AND FromFlag=107 · CN: RefSOID · DN: RefNo",60,340,1300,30,ST.note));
  c.push(box(nid(),"GL pattern: Dr 1037 ลูกหนี้-ค้างส่ง / Cr 1120 ขายสินค้า-เงินเชื่อ · ปุ๋ยยกเว้น VAT (VATType=3) → GL 2 บรรทัด ไม่มี VAT line",60,375,1300,30,ST.note));
  pages.push(page("3. Workflow", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 4 — Work Process (BPMN-ish vertical with decisions)
// ════════════════════════════════════════════════════════════
{
  const c=[]; c.push(box(nid(),"Work Process — SO State Machine (wf.SalesOrder)",40,16,900,30,ST.title));
  const cx=400;
  const start=nid(); c.push(box(start,"เริ่ม: รับ order",cx,80,160,44,ST.start));
  const draft=nid(); c.push(box(draft,"DRAFT — คีย์/ตรวจซ้ำ",cx,160,160,50,ST.proc));
  const dgate=nid(); c.push(box(dgate,"Counter Sales\nตรวจแล้ว?",cx,240,160,70,ST.dec));
  const conf =nid(); c.push(box(conf,"CONFIRMED — ตั้ง Rebate accrual\n+ จองสต็อก (wf)",cx,350,200,54,ST.procN));
  const pick =nid(); c.push(box(pick,"PICKING — จัดของ (ห้ามแก้)",cx,440,200,46,ST.proc));
  const ship =nid(); c.push(box(ship,"SHIPPED — ยืนยันน้ำหนัก →\nส่ง import → WINSpeed",cx,520,200,54,ST.procG));
  const end  =nid(); c.push(box(end,"จบ: WINSpeed post GL",cx,610,200,44,ST.end));
  // unlock branch
  const unlock=nid(); c.push(box(unlock,"UNLOCK\n(Approver)\n→ reverse accrual",720,430,170,70,ST.procP));
  c.push(edge(nid('e'),start,draft,ST.edgeN));
  c.push(edge(nid('e'),draft,dgate,ST.edgeN));
  c.push(edge(nid('e'),dgate,conf,ST.edgeN,"ใช่"));
  c.push(edge(nid('e'),dgate,draft,ST.edgeR,"ไม่"));
  c.push(edge(nid('e'),conf,pick,ST.edgeN));
  c.push(edge(nid('e'),pick,ship,ST.edgeN));
  c.push(edge(nid('e'),ship,end,ST.edgeN));
  c.push(edge(nid('e'),conf,unlock,ST.edgeR,""));
  c.push(edge(nid('e'),pick,unlock,ST.edgeR,""));
  c.push(edge(nid('e'),unlock,draft,ST.edgeR,"กลับ DRAFT"));
  // audit
  c.push(box(nid(),"ทุก transition → wf.SalesOrderAudit (actor, IP, time, before/after JSON) · immutable",60,700,900,30,ST.note));
  pages.push(page("4. Work Process", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 5 — DFD (Context + Level 1)
// ════════════════════════════════════════════════════════════
{
  const c=[]; c.push(box(nid(),"DFD — Context (Lv0) & Level 1",40,16,900,30,ST.title));
  // Context
  c.push(box(nid(),"— Context Diagram (Level 0) —",60,60,300,24,ST.note+"fontStyle=1;"));
  const sys=nid(); c.push(box(sys,"0\nWS-Sale-App",360,150,180,70,ST.dfdproc));
  const e1=nid(); c.push(box(e1,"Sales",80,90,120,44,ST.ext));
  const e2=nid(); c.push(box(e2,"Approver",80,180,120,44,ST.ext));
  const e3=nid(); c.push(box(e3,"Warehouse/\nWeighbridge",80,260,120,50,ST.ext));
  const e4=nid(); c.push(box(e4,"WINSpeed\n(dbo)",700,150,130,60,ST.ext));
  c.push(edge(nid('e'),e1,sys,ST.edgeN,"order/giveaway"));
  c.push(edge(nid('e'),sys,e1,ST.edgeN,"rebate/stock/ticket"));
  c.push(edge(nid('e'),e2,sys,ST.edgeN,"approve"));
  c.push(edge(nid('e'),e3,sys,ST.edgeN,"weigh/picking"));
  c.push(edge(nid('e'),sys,e4,ST.edgeG,"SOHD/SODT.TXT (Import)"));
  c.push(edge(nid('e'),e4,sys,ST.edgeN,"master/DocuNo (View read)"));
  // Level 1
  c.push(box(nid(),"— Level 1 (กระบวนการย่อย + Data Stores) —",60,360,400,24,ST.note+"fontStyle=1;"));
  const p1=nid(); c.push(box(p1,"1\nSO Management",120,420,150,56,ST.dfdproc));
  const p2=nid(); c.push(box(p2,"2\nRebate (FIFO)",120,520,150,56,ST.dfdproc));
  const p3=nid(); c.push(box(p3,"3\nGiveaway/Ticket",120,620,150,56,ST.dfdproc));
  const p4=nid(); c.push(box(p4,"4\nWINSpeed Integration",380,520,170,56,ST.dfdproc));
  const ds1=nid(); c.push(box(ds1,"D1 | wf.SalesOrder/Line",640,420,230,30,ST.store));
  const ds2=nid(); c.push(box(ds2,"D2 | wf.RebatePlan/Pool/Ledger",640,470,230,30,ST.store));
  const ds3=nid(); c.push(box(ds3,"D3 | wf.Giveaway/ControlTicket",640,520,230,30,ST.store));
  const ds4=nid(); c.push(box(ds4,"D4 | wf.WeighTicket/PaperCopy",640,570,230,30,ST.store));
  const ds5=nid(); c.push(box(ds5,"dbo (READ-ONLY View)",640,630,230,30,ST.store+`strokeColor=${GOLD};`));
  c.push(edge(nid('e'),p1,ds1,ST.edgeN));
  c.push(edge(nid('e'),p2,ds2,ST.edgeN));
  c.push(edge(nid('e'),p3,ds3,ST.edgeN));
  c.push(edge(nid('e'),p1,ds4,ST.edgeN));
  c.push(edge(nid('e'),p4,ds5,ST.edgeN,"read"));
  c.push(edge(nid('e'),p1,p4,ST.edgeN));
  c.push(edge(nid('e'),p4,e4_dummy(c),"",""));
  function e4_dummy(){ return p4; } // self ref guard (no-op)
  pages.push(page("5. DFD", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 6 — ER Diagram (wf schema)
// ════════════════════════════════════════════════════════════
{
  const c=[]; c.push(box(nid(),"ER Diagram — schema wf (+ dbo read-only refs)",40,16,900,30,ST.title));
  function entity(name,x,y,attrs,head=NAVY){
    const id=nid('E'); const w=230, rh=20, h=28+attrs.length*rh;
    let s=`<mxCell id="${id}" value="${esc(name)}" style="swimlane;html=1;fontStyle=1;fontColor=#FFFFFF;fillColor=${head};strokeColor=${NAVY};startSize=26;fontSize=12;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
    c.push(s);
    attrs.forEach((a,i)=>{ const aid=nid('a');
      c.push(`<mxCell id="${aid}" value="${esc(a)}" style="text;html=1;align=left;spacingLeft=6;fontSize=10;fillColor=${i%2?ROW:WHITE};strokeColor=#D5DEEC;" vertex="1" parent="${id}"><mxGeometry x="0" y="${26+i*rh}" width="${w}" height="${rh}" as="geometry"/></mxCell>`); });
    return id;
  }
  const SO  = entity("wf.SalesOrder",60,80,["PK soNo","FK customerId → dbo.EMCust","salesId, branchId","status (state machine)","truckReg, weighControlNo","wsDocuNo / wsSOInvID"]);
  const SOL = entity("wf.SalesOrderLine",60,330,["PK (soNo, lineNo)","goodId → dbo.EMGood","qtyTon, unitPrice","motherBaby, loadSeq","rebateAccrual","isGiveaway"]);
  const AUD = entity("wf.SalesOrderAudit",60,560,["PK auditId","FK soNo","actor, action, ip, ts","before/after JSON"]);
  const WT  = entity("wf.WeighTicket",350,560,["PK weighTicketId","FK soNo","gross/tare/netKg","weighIn/OutAt"]);
  const PLAN= entity("wf.RebatePlan",660,80,["PK planId","formula, region","netPrice, returnType","validFrom/To, priority","status"],NAVY2);
  const POOL= entity("wf.RebatePool",660,300,["PK poolId","FK planId, salesId","yearMonth","allocated/used/remaining"],NAVY2);
  const LED = entity("wf.RebateLedger",660,520,["PK ledgerId","FK poolId","FK (soNo,lineNo)","accrualAmount, fifoSeq","type, reversedFlag"],NAVY2);
  const CLM = entity("wf.RebateClaim",960,300,["PK claimId","customerId, salesId","rebateTotal/priceDiffTotal","status, approvalLevel","wsCreditNoteNo"],NAVY2);
  const GB  = entity("wf.GiveawayBudget",960,80,["PK budgetId","region, salesId","itemCode, brand","budget/used/remaining"],STEEL);
  const CT  = entity("wf.ControlTicket",1230,80,["PK controlTicketId","ticketSetNo","customerId","total/remainingQty"],STEEL);
  const PB  = entity("wf.PriceBook",1230,300,["PK priceBookId","goodId, formula","yearMonth","netPricePerTon, version"],STEEL);
  const USR = entity("wf.AppUser",1230,500,["PK userId","username, role","branchId, empId","permissions JSON"],GRAY);
  const rel=(a,b,lbl)=>c.push(edge(nid('r'),a,b,`startArrow=ERone;endArrow=ERmany;${ST.edgeN}`,lbl));
  rel(SO,SOL,"1:N"); rel(SO,AUD,"1:N"); rel(SO,WT,"1:N");
  rel(PLAN,POOL,"1:N"); rel(POOL,LED,"1:N"); rel(SOL,LED,"1:N");
  rel(CLM,LED,"1:N"); rel(GB,SO,"N:M"); rel(CT,SO,"N:M"); rel(PB,PLAN,"ref");
  pages.push(page("6. ER Diagram", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 7 — UML Use Case
// ════════════════════════════════════════════════════════════
{
  const c=[]; c.push(box(nid(),"UML — Use Case Diagram",40,16,700,30,ST.title));
  // boundary
  c.push(box(nid(),"WS-Sale-App",420,70,560,680,`rounded=0;html=1;fillColor=none;strokeColor=${NAVY};verticalAlign=top;fontStyle=1;fontColor=${NAVY};fontSize=12;`));
  const actor=(name,x,y)=>{ const id=nid('ac'); c.push(box(id,name,x,y,40,70,ST.actor)); return id; };
  const uc=(name,x,y)=>{ const id=nid('uc'); c.push(box(id,name,x,y,180,40,ST.uc)); return id; };
  const aSales=actor("Sales",60,120), aCounter=actor("Counter\nSales",60,240),
        aWh=actor("Warehouse",60,360), aWeigh=actor("Weighbridge",60,470),
        aApr=actor("Approver",1050,150), aAcc=actor("Accounting",1050,330), aAdm=actor("Admin",1050,500);
  const u=[
    uc("สร้าง/แก้ Sale Order",460,110), uc("ดู Rebate/สต็อก/ตั๋ว real-time",460,170),
    uc("เลือกของแถม + ชุดตั๋วคุม",460,230), uc("ตรวจซ้ำ (Verification Gate)",460,300),
    uc("ขอ Unlock",460,360), uc("จัดของ / Picking",460,420),
    uc("ยืนยันน้ำหนัก (Shipped)",460,480), uc("อนุมัติ Plan/Unlock/Claim",460,540),
    uc("ตรวจ Rebate / Claim",460,600), uc("จัดการ User/RBAC",460,660),
    uc("ส่ง Import → WINSpeed",740,480),
  ];
  const link=(a,b)=>c.push(edge(nid('l'),a,b,"endArrow=none;strokeColor=#555;"));
  link(aSales,u[0]); link(aSales,u[1]); link(aSales,u[2]); link(aSales,u[4]);
  link(aCounter,u[3]); link(aCounter,u[0]);
  link(aWh,u[5]); link(aWeigh,u[6]);
  link(aApr,u[7]); link(aAcc,u[8]); link(aAdm,u[9]);
  pages.push(page("7. UML Use Case", c));
}

// ════════════════════════════════════════════════════════════
// PAGE 8 — UML Class Diagram (domain)
// ════════════════════════════════════════════════════════════
{
  const c=[]; c.push(box(nid(),"UML — Class Diagram (Domain model)",40,16,700,30,ST.title));
  function cls(name,x,y,fields,methods){
    const id=nid('C'); const w=220, lh=18; const lines=[...fields,"--",...methods];
    const h=30+lines.length*lh;
    c.push(`<mxCell id="${id}" value="${esc(name)}" style="swimlane;html=1;fontStyle=1;fillColor=${ICE};strokeColor=${NAVY};startSize=24;fontSize=12;fontColor=${NAVY};" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
    lines.forEach((l,i)=>{ const sep=l==="--";
      c.push(`<mxCell id="${nid('m')}" value="${esc(sep?'':l)}" style="text;html=1;align=left;spacingLeft=6;fontSize=10;${sep?`strokeColor=${NAVY};fillColor=none;`:'strokeColor=none;fillColor=none;'}" vertex="1" parent="${id}"><mxGeometry x="0" y="${24+i*lh}" width="${w}" height="${lh}" as="geometry"/></mxCell>`); });
    return id;
  }
  const SO=cls("SalesOrder",60,70,["+soNo: string","+status: SOStatus","+customerId, salesId","+truckReg, weighControlNo"],["+confirm()","+unlock()","+ship()","+toImportFile(): SOHD/SODT"]);
  const LINE=cls("SalesOrderLine",60,330,["+goodId, qtyTon","+unitPrice","+motherBaby, loadSeq","+rebateAccrual"],["+calcAccrual(priceNet)"]);
  const REB=cls("RebateService",340,70,["+plans, pools, ledgers"],["+applyAccrual(line)","+fifoCut(amount)","+buildClaim(): RebateClaim","+reverse(ledger)"]);
  const CLAIM=cls("RebateClaim",340,330,["+claimId","+rebateTotal, priceDiffTotal","+approvalLevel, status"],["+submit()","+approve(level)","+toCreditNote()"]);
  const INT=cls("WinspeedGateway",620,70,["+importPath"],["+readMaster() <<view>>","+exportSO(order)","+pollDocuNo(soNo)","// NO dbo write"]);
  const WT=cls("WeighTicket",620,330,["+gross/tare/netKg","+weighIn/OutAt"],["+computeNet()"]);
  const AUTH=cls("ApprovalPolicy",880,70,["+rules[]"],["+canEditPicking(user)","+approveOverPrice(user)","+approveUnderPrice(mgrs)"]);
  const rel=(a,b,style,lbl="")=>c.push(edge(nid('r'),a,b,style+ST.edgeN,lbl));
  rel(SO,LINE,"startArrow=diamondThin;startFill=1;endArrow=none;","1..*");
  rel(SO,WT,"startArrow=diamondThin;startFill=1;endArrow=none;","0..*");
  rel(REB,CLAIM,"endArrow=open;","creates");
  rel(LINE,REB,"endArrow=open;dashed=1;","uses");
  rel(SO,INT,"endArrow=open;dashed=1;","export");
  rel(SO,AUTH,"endArrow=open;dashed=1;","checks");
  pages.push(page("8. UML Class", c));
}

// ---- assemble ----
const out = `<mxfile host="app.diagrams.net" type="device" pages="${pages.length}">
${pages.join("\n")}
</mxfile>`;
fs.writeFileSync("M:\\My Drive\\World Fert\\WorldFert_Diagrams_v4.drawio", out, "utf8");
console.log("✅ Saved WorldFert_Diagrams_v4.drawio ("+pages.length+" pages, "+out.length+" bytes)");
