// ============================================================
// WS-Sale-App — UI/UX Mockups (HTML, shadcn-like, Tailwind CDN)
// Tech: React + Vite + TS + Tailwind + shadcn/ui (mockup = static HTML)
// Output: ui_mockups/*.html  (editable + render to PNG via Chrome)
// ============================================================
const fs = require("fs");
const DIR = "M:\\My Drive\\World Fert\\ui_mockups\\";

// shared shell: sidebar + topbar, navy CI, Prompt font
const NAV = [
  ["dashboard","Dashboard","grid"],
  ["sale-order","ใบสั่งขาย (SO)","file"],
  ["quotation","ใบเสนอราคา","tag"],
  ["rebate-pool","Rebate Pool","percent"],
  ["rebate-claim","Rebate Claim","wallet"],
  ["giveaway","ของแถม","gift"],
  ["control-ticket","ชุดตั๋วคุม","ticket"],
  ["paper-trail","Paper Trail","layers"],
  ["approvals","อนุมัติ/Unlock","check"],
  ["reports","รายงาน","chart"],
  ["admin","ผู้ใช้/สิทธิ์","users"],
];

function shell(active, title, body){
  const navHtml = NAV.map(([id,label])=>`
    <a href="${id}.html" class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${id===active?'bg-[#1F3864] text-white font-medium':'text-slate-300 hover:bg-white/10'}">
      <span class="w-2 h-2 rounded-full ${id===active?'bg-amber-400':'bg-slate-500'}"></span>${label}
    </a>`).join("");
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{font-family:'Prompt','Inter',sans-serif} body{margin:0} .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 1px 2px rgba(16,24,40,.04)}</style>
</head><body class="bg-slate-100">
<div class="flex min-h-screen">
  <aside class="w-60 shrink-0 bg-[#16233A] flex flex-col">
    <div class="px-5 py-4 border-b border-white/10">
      <div class="text-white font-bold text-lg leading-tight">WS-Sale-App</div>
      <div class="text-[#9DB8E0] text-xs">World Fert · WINSpeed Layer</div>
    </div>
    <nav class="p-3 space-y-1 flex-1">${navHtml}</nav>
    <div class="p-3 border-t border-white/10 text-xs text-slate-400">v4.0 · dbo READ-ONLY</div>
  </aside>
  <main class="flex-1 min-w-0">
    <header class="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      <div class="font-semibold text-slate-800">${title}</div>
      <div class="flex items-center gap-3 text-sm">
        <span class="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs border border-emerald-200">● WINSpeed online</span>
        <span class="text-slate-500">สมชาย (Sales)</span>
        <div class="w-8 h-8 rounded-full bg-[#1F3864] text-white grid place-items-center text-xs">ส</div>
      </div>
    </header>
    <div class="p-6">${body}</div>
  </main>
</div></body></html>`;
}

// UI helpers
const card=(t,b,cls="")=>`<div class="card p-5 ${cls}"><div class="text-sm font-semibold text-slate-700 mb-3">${t}</div>${b}</div>`;
const kpi=(label,val,sub,color="#1F3864")=>`<div class="card p-4"><div class="text-xs text-slate-500">${label}</div><div class="text-2xl font-bold mt-1" style="color:${color}">${val}</div><div class="text-xs text-slate-400 mt-1">${sub}</div></div>`;
const btn=(t,kind="primary")=>{const m={primary:"bg-[#1F3864] text-white",ghost:"bg-white border border-slate-300 text-slate-700",gold:"bg-amber-500 text-white",danger:"bg-red-600 text-white",green:"bg-emerald-600 text-white"};return `<button class="px-3.5 py-2 rounded-lg text-sm font-medium ${m[kind]}">${t}</button>`;};
const badge=(t,c)=>`<span class="px-2 py-0.5 rounded-full text-xs font-medium ${c}">${t}</span>`;
const th=a=>`<th class="text-left font-medium text-slate-500 px-3 py-2 ${a||''}">`;
const td=a=>`<td class="px-3 py-2 ${a||''}">`;
function table(head,rows){return `<div class="overflow-hidden rounded-xl border border-slate-200"><table class="w-full text-sm"><thead class="bg-slate-50">${head}</thead><tbody class="divide-y divide-slate-100">${rows}</tbody></table></div>`;}
const field=(l,v,ph="")=>`<label class="block"><span class="text-xs text-slate-500">${l}</span><div class="mt-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm ${v?'text-slate-800':'text-slate-400'}">${v||ph}</div></label>`;

const pages = {};

// ---- 1. LOGIN (standalone) ----
pages["login"] = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>*{font-family:'Prompt',sans-serif}</style></head>
<body class="bg-gradient-to-br from-[#16233A] to-[#2E5496] min-h-screen grid place-items-center">
<div class="bg-white rounded-2xl shadow-2xl w-[380px] p-8">
  <div class="text-center mb-6"><div class="text-2xl font-bold text-[#1F3864]">WS-Sale-App</div><div class="text-sm text-slate-500">World Fert · ระบบสั่งขายปุ๋ย</div></div>
  ${field("ชื่อผู้ใช้","somchai.s")}
  <div class="h-3"></div>${field("รหัสผ่าน","••••••••")}
  <div class="flex items-center justify-between mt-3 text-sm"><label class="flex items-center gap-2 text-slate-600"><input type="checkbox" checked> จดจำ</label><a class="text-[#2E5496]">ลืมรหัส?</a></div>
  <button class="w-full mt-5 py-2.5 rounded-lg bg-[#1F3864] text-white font-medium">เข้าสู่ระบบ</button>
  <div class="text-center text-xs text-slate-400 mt-4">JWT 15 นาที + refresh 7 วัน · RBAC 7 บทบาท</div>
</div></body></html>`;

// ---- 2. DASHBOARD ----
pages["dashboard"] = shell("dashboard","Dashboard — ภาพรวมการขาย (real-time)",`
<div class="grid grid-cols-4 gap-4 mb-5">
  ${kpi("ตั๋วคงค้าง (รอชั่ง)","28,290","ใบจอง DocuType 103","#B02418")}
  ${kpi("Rebate Pool คงเหลือ","฿24.8M","ของฉัน (สมชาย)","#5E7E45")}
  ${kpi("SO วันนี้","37","12 รออนุมัติ","#1F3864")}
  ${kpi("ของแถมคงเหลือ","640","เสื้อ/กระเป๋า รวมภาค","#C8862E")}
</div>
<div class="grid grid-cols-3 gap-4">
  <div class="col-span-2">${card("ตั๋วคงค้าง + Aging (>30 วัน เหลือง, >45 วัน แดง)",table(
    `<tr>${th()}เลขใบจอง</th>${th()}ลูกค้า</th>${th()}ทะเบียนรถ</th>${th()}วันเปิด</th>${th()}อายุ</th>${th()}สถานะ</th></tr>`,
    [["K68-01316","ทวีชัยเคมีเกษตร","นว71-1457/58","10/05/69","31 วัน","y"],
     ["I68-02107","สหกรณ์บางน้ำเปรี้ยว","สร70-3385/86","02/05/69","48 วัน","r"],
     ["K68-01355","รวมการเกษตรเคมีภัณฑ์","กพ70-1028/29","28/05/69","13 วัน","g"]].map(r=>
      `<tr>${td()}${r[0]}</td>${td()}${r[1]}</td>${td('font-mono text-xs')}${r[2]}</td>${td()}${r[3]}</td>${td()}${r[4]}</td>${td()}${
        r[5]==='r'?badge('เกิน 45 วัน','bg-red-100 text-red-700'):r[5]==='y'?badge('เกิน 30 วัน','bg-amber-100 text-amber-700'):badge('ปกติ','bg-emerald-100 text-emerald-700')}</td></tr>`).join("")
  ))}</div>
  <div class="space-y-4">
    ${card("สถานะรถ (เครื่องชั่ง)",`<div class="space-y-2 text-sm">
      <div class="flex justify-between items-center"><span>นว71-1457/58</span>${badge('กำลังรับสินค้า','bg-amber-100 text-amber-700')}</div>
      <div class="flex justify-between items-center"><span>สร70-3385/86</span>${badge('มาถึง-รอคิว','bg-slate-100 text-slate-600')}</div>
      <div class="flex justify-between items-center"><span>กพ70-1028/29</span>${badge('ออกจากโรงงาน','bg-emerald-100 text-emerald-700')}</div></div>`)}
    ${card("สต๊อก FG ใกล้หมด",`<div class="space-y-2 text-sm">
      <div class="flex justify-between"><span>0-0-60 ปุ๋ยเทพ</span><span class="text-red-600 font-medium">12 ตัน</span></div>
      <div class="flex justify-between"><span>16-8-8 เชิงผสม</span><span class="text-amber-600 font-medium">48 ตัน</span></div>
      <div class="text-xs text-slate-400">* WF = Trade, รอ DB โรงงาน</div></div>`)}
  </div>
</div>`);

// ---- 3. SALE ORDER ----
pages["sale-order"] = shell("sale-order","ใบสั่งขาย (Sale Order) — สร้างใหม่",`
<div class="card p-5 mb-4">
  <div class="grid grid-cols-4 gap-4">
    ${field("รหัสลูกค้า","0462002 · ทวีชัยเคมีเกษตร")}
    ${field("เลขที่เอกสาร","(auto) K69-xxxxx")}
    ${field("ทะเบียนรถ","นว71-1457/1458 ▾")}
    ${field("พนักงานขาย","สมชาย")}
  </div>
  <div class="text-xs text-slate-400 mt-2">💡 พิมพ์ทะเบียน 'นว' → เลือกจากประวัติ · อ้างถึงอนุมัติใบเสนอราคา I69-01539</div>
</div>
${card("รายการสินค้า (หน่วย: ตัน · ปุ๋ยยกเว้น VAT)",table(
  `<tr>${th()}สูตร/สินค้า</th>${th('text-right')}ตัน</th>${th('text-right')}กระสอบ</th>${th('text-right')}ราคา/ตัน</th>${th('text-center')}แม่/ลูก</th>${th('text-center')}ลำดับ</th>${th('text-right')}จำนวนเงิน</th></tr>`,
  [["0-0-60 เม็ด ตราปุ๋ยเทพ","2.50","50","16,200","แม่","1","40,500"],
   ["16-8-8 เชิงผสม","5.00","100","13,500","ลูก","2","67,500"],
   ["เสื้อยืด รถเกษตร (ของแถม)","—","—","0","—","—","0"]].map(r=>
    `<tr>${td()}${r[0]==='เสื้อยืด รถเกษตร (ของแถม)'?`${r[0]} ${badge('ของแถม','bg-amber-100 text-amber-700')}`:r[0]}</td>${td('text-right')}${r[1]}</td>${td('text-right text-slate-500')}${r[2]}</td>${td('text-right')}${r[3]}</td>${td('text-center')}${r[4]}</td>${td('text-center')}${r[5]}</td>${td('text-right font-medium')}${r[6]}</td></tr>`).join("")
))}
<div class="flex items-center justify-between mt-4">
  <div class="flex gap-2">${btn("+ เพิ่มสินค้า","ghost")}${btn("+ ของแถม","ghost")}${btn("ชุดตั๋วคุม","ghost")}</div>
  <div class="flex items-center gap-4">
    <div class="text-right"><div class="text-xs text-slate-500">Rebate ที่จะได้รับ</div><div class="font-bold text-emerald-600">฿4,200</div></div>
    <div class="text-right"><div class="text-xs text-slate-500">รวมทั้งสิ้น</div><div class="text-xl font-bold text-[#1F3864]">฿108,000</div></div>
    ${btn("ตรวจซ้ำ + Confirm","primary")}
  </div>
</div>`);

// ---- 4. QUOTATION ----
pages["quotation"] = shell("quotation","ใบเสนอราคา — พร้อมราคากลาง + Rebate",`
<div class="grid grid-cols-3 gap-4 mb-4">
  ${card("ลูกค้า",field("","กลุ่มชาวไร่น้ำจืด"))}
  ${card("ราคากลางอนุมัติ (set price)",`<div class="text-2xl font-bold text-[#1F3864]">฿13,500<span class="text-sm text-slate-400">/ตัน</span></div><div class="text-xs text-slate-400">16-8-8 เชิงผสม</div>`)}
  ${card("Rebate รายลูกค้า",`<div class="text-2xl font-bold text-emerald-600">฿200<span class="text-sm text-slate-400">/ตัน</span></div>`)}
</div>
${card("เสนอราคา",`<div class="grid grid-cols-3 gap-4">
  ${field("ราคาเสนอ/ตัน","13,200")}
  <div class="flex items-end">${badge('ต่ำกว่าราคากลาง 300 บาท → ต้องอนุมัติ','bg-amber-100 text-amber-700')}</div>
  <div class="flex items-end justify-end">${btn("ส่งขออนุมัติ (ผจก. 3 ท่าน)","gold")}</div></div>
  <div class="text-xs text-slate-400 mt-3">กฎ: ต่ำกว่า set price ≤500 บาท → ผจก. 3 ท่านอนุมัติ · เกินกว่านั้น → ผู้มีอำนาจคนเดียว</div>`)}`);

// ---- 5. REBATE POOL ----
pages["rebate-pool"] = shell("rebate-pool","Rebate Pool — ของฉัน (Sales × สูตร × ภาค × เดือน)",`
<div class="grid grid-cols-4 gap-4 mb-5">
  ${kpi("Allocated","฿30.0M","งบที่ได้รับ")}
  ${kpi("Used (FIFO)","฿5.2M","ตัดแล้ว","#C8862E")}
  ${kpi("Remaining","฿24.8M","คงเหลือ","#5E7E45")}
  ${kpi("Frozen","฿0","ระหว่าง Claim")}
</div>
${card("Ledger — accrual ต่อบรรทัด (trace กลับ SO/Plan ได้)",table(
  `<tr>${th()}fifoSeq</th>${th()}SO Line</th>${th()}สูตร</th>${th('text-right')}ตัน</th>${th('text-right')}accrual</th>${th()}สถานะ</th></tr>`,
  [["1001","N68-01455 #1","15-5-35","19","฿22,800","ACCRUAL"],
   ["1002","N68-01443 #1","0-0-60","16","฿11,200","ACCRUAL"],
   ["1003","CNK68-008","21-0-0","8","-฿4,000","CLAIM"]].map(r=>
    `<tr>${td('font-mono text-xs')}${r[0]}</td>${td('text-xs')}${r[1]}</td>${td()}${r[2]}</td>${td('text-right')}${r[3]}</td>${td('text-right font-medium')}${r[4]}</td>${td()}${r[5]==='CLAIM'?badge('CLAIM','bg-blue-100 text-blue-700'):badge('ACCRUAL','bg-emerald-100 text-emerald-700')}</td></tr>`).join("")
))}`);

// ---- 6. REBATE CLAIM ----
pages["rebate-claim"] = shell("rebate-claim","Rebate Claim — เบิก 2 ประเภท (FIFO → Credit Note 109)",`
<div class="grid grid-cols-2 gap-4 mb-4">
  ${card("บล็อก 1 — คืนรีเบท (sell − NET)",`<table class="w-full text-sm"><tr class="text-slate-500"><td>15-5-35 · 19 ตัน</td><td class="text-right">฿22,800</td></tr><tr class="text-slate-500"><td>0-0-60 · 16 ตัน</td><td class="text-right">฿11,200</td></tr><tr class="font-bold border-t"><td>รวม</td><td class="text-right text-[#1F3864]">฿34,000</td></tr></table>`)}
  ${card("บล็อก 2 — คืนส่วนต่าง (price-list)",`<table class="w-full text-sm"><tr class="text-slate-500"><td>21-0-0 · 8 ตัน</td><td class="text-right">฿4,000</td></tr><tr class="font-bold border-t"><td>รวม</td><td class="text-right text-[#1F3864]">฿4,000</td></tr></table>`)}
</div>
${card("สายอนุมัติ + ออกเอกสาร",`<div class="flex items-center gap-2 text-sm mb-3">
  ${["ผู้แทนขาย","ผจก.ภาค","ผจก.ฝ่ายขาย","กรรมการ"].map((s,i)=>`<div class="flex items-center gap-2">${badge(s, i<2?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500')}${i<3?'<span class="text-slate-300">→</span>':''}</div>`).join("")}
</div>
<div class="flex items-center justify-between"><div class="text-xs text-slate-500">หลังอนุมัติ 4 ชั้น → ส่ง Import ให้ WINSpeed ออก <b>Credit Note (DocuType 109)</b> — WINSpeed ลงบัญชีเอง</div>${btn("Submit Claim","green")}</div>`)}`);

// ---- 7. GIVEAWAY ----
pages["giveaway"] = shell("giveaway","ของแถม (Giveaway) — เลือก + เห็นงบ/สต๊อกคงเหลือ",`
<div class="grid grid-cols-3 gap-4">
${[["เสื้อยืด รถเกษตร","ตัว","640","100","g"],["กระเป๋า ปุ๋ยเทพ","ใบ","210","50","y"],["กระสอบเปล่า","ใบ","-15","20","r"]].map(it=>
  `<div class="card p-4"><div class="font-medium text-slate-800">${it[0]}</div><div class="text-xs text-slate-400 mb-3">หน่วย: ${it[1]}</div>
   <div class="flex items-end justify-between"><div><div class="text-xs text-slate-500">คงเหลือ (ภาค)</div><div class="text-xl font-bold ${it[4]==='r'?'text-red-600':it[4]==='y'?'text-amber-600':'text-emerald-600'}">${it[2]}</div></div>
   <div class="text-right"><div class="text-xs text-slate-500">เบิกครั้งนี้</div><div class="text-lg font-semibold">${it[3]}</div></div></div>
   ${it[4]==='r'?`<div class="mt-2 text-xs text-red-600">⚠ เบิกเกินงบ (ติดลบ) — บันทึก + เตือน</div>`:''}</div>`).join("")}
</div>
<div class="card p-4 mt-4 text-sm text-slate-500">งบของแถมแยกตาม ภาค → Sales → รายการ · เบิกเกินงบ "ติดลบได้" แต่ต้องเตือน + บันทึก · รายงานรายภาค/Sales/แยก brand (รถเกษตร/ปุ๋ยเทพ)</div>`);

// ---- 8. CONTROL TICKET ----
pages["control-ticket"] = shell("control-ticket","ชุดตั๋วคุม (Control Ticket) — ยอดคงเหลือ + รับเฉพาะชุด/พร้อมใบสั่งจอง",`
${card("ชุดตั๋วคุมของลูกค้า",table(
  `<tr>${th()}ชุดตั๋ว</th>${th()}ลูกค้า</th>${th('text-right')}ทั้งหมด</th>${th('text-right')}ใช้แล้ว</th>${th('text-right')}คงเหลือ</th>${th()}โหมดรับ</th></tr>`,
  [["CT-68-001","ทวีชัยเคมีเกษตร","20","12","8","WITH_ORDER"],
   ["CT-68-014","สหกรณ์บางน้ำเปรี้ยว","10","10","0","SET_ONLY"]].map(r=>
    `<tr>${td('font-mono text-xs')}${r[0]}</td>${td()}${r[1]}</td>${td('text-right')}${r[2]}</td>${td('text-right')}${r[3]}</td>${td('text-right font-bold '+(r[4]==='0'?'text-red-600':'text-emerald-600'))}${r[4]}</td>${td()}${r[5]==='SET_ONLY'?badge('รับเฉพาะชุด','bg-blue-100 text-blue-700'):badge('รับพร้อมใบสั่งจอง','bg-slate-100 text-slate-600')}</td></tr>`).join("")
))}
<div class="card p-4 mt-4 text-sm text-slate-500">เรียกรายงานแบบเจาะจงต่อชุดตั๋วได้ (WINSpeed เดิมดูได้แค่ภาพรวม) · โชว์ยอดคงเหลือทันที</div>`);

// ---- 9. PAPER TRAIL KANBAN ----
pages["paper-trail"] = shell("paper-trail","Paper Trail — เอกสาร 4 สี + QR (Kanban)",`
<div class="grid grid-cols-5 gap-3">
${[["Printed","พิมพ์แล้ว","slate",3],["In Transit","กำลังส่ง","blue",5],["Signed","เซ็นรับ","amber",2],["Filed","จัดเก็บ","emerald",8],["Lost","สูญหาย","red",1]].map(col=>
  `<div class="bg-slate-50 rounded-xl p-3 border border-slate-200"><div class="flex items-center justify-between mb-2"><span class="text-xs font-semibold text-slate-600">${col[1]}</span>${badge(col[3],'bg-'+col[2]+'-100 text-'+col[2]+'-700')}</div>
   <div class="space-y-2">${Array.from({length:Math.min(col[3],3)}).map((_,i)=>`<div class="bg-white rounded-lg border border-slate-200 p-2 text-xs"><div class="font-medium">N68-01${455-i}</div><div class="text-slate-400">ขาว · QR ✓</div></div>`).join("")}</div></div>`).join("")}
</div>
<div class="card p-4 mt-4 text-sm text-slate-500">4 สี: ขาว/ฟ้า=เก็บ, ชมพู=ลูกค้า, เหลือง=รปภ. · scan QR ≤2s แสดง history · alert ใบหาย >3 วัน</div>`);

// ---- 10. APPROVALS ----
pages["approvals"] = shell("approvals","อนุมัติ / Unlock Request — ตามกฎเฉพาะ",`
${card("รายการรออนุมัติ",table(
  `<tr>${th()}ประเภท</th>${th()}เอกสาร</th>${th()}เหตุผล</th>${th()}ผู้มีอำนาจ</th>${th('text-center')}จัดการ</th></tr>`,
  [["แก้ไขตอน Picking","K68-01316","แก้จำนวน 2.5→3 ตัน","คุณสุรชัย (คนเดียว)","s"],
   ["ขายเกินราคาตั้ง","K68-01355","+200 บาท/ตัน","คุณรุ่งนิรันดร์","r"],
   ["ขายต่ำกว่า ≤500","I68-02107","-300 บาท/ตัน","ผจก. 3 ท่าน","m"]].map(r=>
    `<tr>${td()}${r[0]}</td>${td('font-mono text-xs')}${r[1]}</td>${td('text-slate-500')}${r[2]}</td>${td()}${badge(r[3],'bg-slate-100 text-slate-600')}</td>${td('text-center')}<button class="px-2 py-1 rounded-md bg-emerald-600 text-white text-xs">อนุมัติ</button> <button class="px-2 py-1 rounded-md bg-white border border-slate-300 text-xs">ปฏิเสธ</button></td></tr>`).join("")
))}
<div class="card p-4 mt-4 text-sm text-slate-500">Unlock: CONFIRMED/PICKING → DRAFT + reverse accrual (reversedFlag, ไม่ลบ) · แจ้งคลัง real-time ≤1s · audit ทุกครั้ง</div>`);

// ---- 11. REPORTS ----
pages["reports"] = shell("reports","รายงาน & Dashboard",`
<div class="grid grid-cols-3 gap-4">
${["SO summary รายวัน/Sales","Rebate balance + Claim","ของแถม รายภาค/Sales","ชุดตั๋วคุม (เฉพาะชุด)","Paper status (Kanban)","Outstanding ใบกำกับ"].map(r=>
  `<div class="card p-5"><div class="font-medium text-slate-800 mb-1">${r}</div><div class="text-xs text-slate-400 mb-3">export Excel / PDF</div><div class="flex gap-2">${btn("ดู","ghost")}${btn("Export","ghost")}</div></div>`).join("")}
</div>`);

// ---- 12. ADMIN ----
pages["admin"] = shell("admin","ผู้ใช้ & สิทธิ์ (RBAC) — 7 บทบาท",`
${card("ผู้ใช้งาน",table(
  `<tr>${th()}ผู้ใช้</th>${th()}บทบาท</th>${th()}สาขา</th>${th()}สิทธิ์พิเศษ</th>${th('text-center')}สถานะ</th></tr>`,
  [["somchai.s","SALES","สนญ.","-","on"],["surachai","WAREHOUSE","อยุธยา","แก้ตอน Picking","on"],
   ["rungnirun","APPROVER","สนญ.","อนุมัติเกินราคา","on"],["board","BOARD","สนญ.","ดูต้นทุน/ราคา","on"]].map(r=>
    `<tr>${td()}${r[0]}</td>${td()}${badge(r[1],'bg-[#1F3864] text-white')}</td>${td()}${r[2]}</td>${td('text-xs text-slate-500')}${r[3]}</td>${td('text-center')}${badge('active','bg-emerald-100 text-emerald-700')}</td></tr>`).join("")
))}
<div class="card p-4 mt-4 text-sm text-slate-500">RBAC field-level: ต้นทุน=ผู้รับผิดชอบ, ราคาขาย=ผู้มีอำนาจ, บางรายการกรรมการเท่านั้น · JWT + audit ทุก auth event</div>`);

// write all
Object.entries(pages).forEach(([k,html])=>{ fs.writeFileSync(DIR+k+".html", html, "utf8"); });
console.log("✅ Saved "+Object.keys(pages).length+" UI mockups to ui_mockups/");
console.log(Object.keys(pages).join(", "));
