'use strict';
/**
 * mermaid-to-mxgraph.js — แปลง mermaid เป็นรูปทรงจริงของ draw.io ที่แก้ไขได้
 *
 * รองรับ flowchart (TB/TD/LR/RL), stateDiagram-v2, erDiagram, classDiagram และ sequenceDiagram
 * ชนิดที่ยังแปลงไม่ได้จะคืน null เพื่อให้ผู้เรียกถอยไปใช้ภาพ PNG แทน
 *
 * วางตำแหน่งด้วย layered layout: ไล่ระดับตามทิศทางของเส้นเชื่อม แล้วเรียงในแต่ละระดับ
 * ด้วย barycenter เพื่อลดเส้นตัดกัน ผู้ใช้จัดตำแหน่งใหม่ใน draw.io ได้ตามต้องการ
 * เพราะทุกอย่างเป็น mxCell จริง
 */

const NODE_W = 200, NODE_H = 60, GAP_X = 90, GAP_Y = 70, PAD = 60;

// เนื้อหาเริ่มใต้หัวเรื่องของหน้า (build-drawio.js วางหัวเรื่องไว้ y=16 สูง 34)
const TITLE_CLEAR = 80;

/**
 * ประมาณความกว้างข้อความเป็นพิกเซล ใช้กำหนดขนาดกล่องให้พอดีเนื้อหา
 * สระบน/ล่างและวรรณยุกต์ไทยซ้อนอยู่บนพยัญชนะ จึงไม่นับความกว้าง
 */
function textWidth(text, size) {
  let units = 0;
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    if (code === 0x0E31 || (code >= 0x0E34 && code <= 0x0E3A) || (code >= 0x0E47 && code <= 0x0E4E)) continue;
    units += (code >= 0x0E00 && code <= 0x0E5B) ? 0.95 : 0.58;
  }
  return Math.ceil(units * size);
}

/**
 * จัดโหนดเป็นชั้น ๆ ตามทิศทางของเส้นเชื่อม แล้วเรียงลำดับในแต่ละชั้นด้วย barycenter
 * (ค่าเฉลี่ยตำแหน่งของเพื่อนบ้านต่างชั้น) ซึ่งเป็นวิธีมาตรฐานในการลดเส้นตัดกัน
 * กราฟที่ไม่เชื่อมกันจะถูกแยกเป็นคนละ component เพื่อวางแยกแถบกัน
 */
function layeredLayout(names, links) {
  const neighbours = new Map(names.map(name => [name, []]));
  const clean = links.filter(l => l.from !== l.to && neighbours.has(l.from) && neighbours.has(l.to));
  for (const link of clean) {
    neighbours.get(link.from).push(link.to);
    neighbours.get(link.to).push(link.from);
  }

  const component = new Map();
  let componentCount = 0;
  for (const name of names) {
    if (component.has(name)) continue;
    const queue = [name];
    component.set(name, componentCount);
    while (queue.length) {
      for (const next of neighbours.get(queue.shift())) {
        if (!component.has(next)) { component.set(next, componentCount); queue.push(next); }
      }
    }
    componentCount++;
  }

  // longest-path layering แบบผ่อนคลายซ้ำ มีเพดานกันวงจรทำให้ลูปไม่จบ
  const layer = new Map(names.map(name => [name, 0]));
  const ceiling = names.length;
  for (let pass = 0; pass <= names.length; pass++) {
    let changed = false;
    for (const link of clean) {
      const want = layer.get(link.from) + 1;
      if (want <= ceiling && layer.get(link.to) < want) { layer.set(link.to, want); changed = true; }
    }
    if (!changed) break;
  }

  const groups = new Map();
  for (const name of names) {
    const key = component.get(name) + '#' + layer.get(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }

  const order = new Map();
  for (const list of groups.values()) list.forEach((name, index) => order.set(name, index));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const list of groups.values()) {
      const bary = new Map();
      for (const name of list) {
        const across = neighbours.get(name).filter(other => layer.get(other) !== layer.get(name));
        bary.set(name, across.length
          ? across.reduce((sum, other) => sum + order.get(other), 0) / across.length
          : order.get(name));
      }
      list.sort((a, b) => (bary.get(a) - bary.get(b)) || a.localeCompare(b));
      list.forEach((name, index) => order.set(name, index));
    }
  }

  const layers = [...new Set(names.map(name => layer.get(name)))].sort((a, b) => a - b);
  const components = [...new Set(names.map(name => component.get(name)))].sort((a, b) => a - b);
  return { layer, component, groups, layers, components, componentCount };
}

/**
 * แปลงผลการจัดชั้นเป็นพิกัดจริง
 * dir='LR' ชั้น = คอลัมน์ (ใช้กับ ERD) · dir='TB' ชั้น = แถว (ใช้กับ class diagram)
 * แต่ละ component วางต่อกันเป็นแถบ ไม่ปนกัน
 */
function placeLayers(plan, size, dir, gapAlong, gapAcross, gapComponent) {
  const { groups, layers, components } = plan;
  const alongStart = new Map();
  let cursor = 60;
  for (const level of layers) {
    alongStart.set(level, cursor);
    let widest = 0;
    for (const component of components) {
      for (const name of groups.get(component + '#' + level) || []) {
        widest = Math.max(widest, dir === 'LR' ? size.get(name).w : size.get(name).h);
      }
    }
    cursor += widest + gapAlong;
  }

  const position = new Map();
  let bandStart = TITLE_CLEAR + 20;
  for (const component of components) {
    const extent = new Map();
    for (const level of layers) {
      const list = groups.get(component + '#' + level) || [];
      const total = list.reduce((sum, name) => sum + (dir === 'LR' ? size.get(name).h : size.get(name).w) + gapAcross, 0);
      extent.set(level, Math.max(0, total - gapAcross));
    }
    const band = Math.max(0, ...extent.values());
    for (const level of layers) {
      const list = groups.get(component + '#' + level) || [];
      let across = bandStart + Math.round((band - extent.get(level)) / 2);
      for (const name of list) {
        position.set(name, dir === 'LR'
          ? { x: alongStart.get(level), y: across }
          : { x: across, y: alongStart.get(level) });
        across += (dir === 'LR' ? size.get(name).h : size.get(name).w) + gapAcross;
      }
    }
    bandStart += band + gapComponent;
  }
  return position;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// mermaid ใช้ <br/> ขึ้นบรรทัดใหม่ draw.io ใช้ &#10; ในค่า value
function cleanLabel(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/^["'`]|["'`]$/g, '')
    .trim();
}

const SHAPES = {
  round:    'rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#DAE8FC;strokeColor=#6C8EBF;',
  stadium:  'rounded=1;whiteSpace=wrap;html=1;arcSize=50;fillColor=#D5E8D4;strokeColor=#82B366;',
  cylinder: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;',
  diamond:  'rhombus;whiteSpace=wrap;html=1;fillColor=#FFF2CC;strokeColor=#D6B656;',
  circle:   'ellipse;whiteSpace=wrap;html=1;fillColor=#F8CECC;strokeColor=#B85450;',
  box:      'whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#666666;',
  state:    'rounded=1;whiteSpace=wrap;html=1;arcSize=20;fillColor=#FFE6CC;strokeColor=#D79B00;',
  // จุดเริ่ม/จุดจบของ stateDiagram — ห้ามถมสีทึบแล้ววางข้อความทับ เพราะอ่านไม่ออก
  // จึงวางป้ายไว้ "ใต้" วงกลมเสมอ เริ่ม = วงทึบ · จบ = วงแหวน ตามแบบ UML
  start:    'ellipse;html=1;fillColor=#2E4A6B;strokeColor=#1A2E45;fontColor=#333333;fontStyle=1;'
            + 'verticalLabelPosition=bottom;verticalAlign=top;labelBackgroundColor=none;',
  stop:     'ellipse;html=1;fillColor=#FFFFFF;strokeColor=#2E4A6B;strokeWidth=5;fontColor=#333333;fontStyle=1;'
            + 'verticalLabelPosition=bottom;verticalAlign=top;labelBackgroundColor=none;',
};

// จุดเริ่ม/จุดจบเป็นวงกลมเล็กขนาดคงที่ ไม่ยืดตามความยาวป้าย
const MARKER_SIZE = { start: 54, stop: 54 };

// ตัวอย่างที่รองรับ: A[ข้อความ] · A([ข้อความ]) · A[(ข้อความ)] · A{ข้อความ} · A((ข้อความ))
const NODE_PATTERNS = [
  [/([A-Za-z0-9_]+)\(\[([^\]]*)\]\)/g, 'stadium'],
  [/([A-Za-z0-9_]+)\[\(([^)]*)\)\]/g, 'cylinder'],
  [/([A-Za-z0-9_]+)\(\(([^)]*)\)\)/g, 'circle'],
  [/([A-Za-z0-9_]+)\{([^}]*)\}/g, 'diamond'],
  [/([A-Za-z0-9_]+)\[([^\]]*)\]/g, 'round'],
];

function parseFlowchart(source) {
  const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
  const header = lines.find(line => /^(flowchart|graph|stateDiagram)/i.test(line)) || '';
  const isState = /^stateDiagram/i.test(header);
  const horizontal = /\b(LR|RL)\b/.test(header);

  const nodes = new Map();   // id -> { id, label, shape, group }
  const edges = [];          // { from, to, label, dashed }
  const groups = new Map();  // id -> { id, label, members: [] }
  const groupStack = [];

  const ensure = (id, label, shape) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: label || id, shape: shape || (isState ? 'state' : 'box'), group: groupStack[groupStack.length - 1] || null });
      if (groupStack.length) groups.get(groupStack[groupStack.length - 1]).members.push(id);
    } else if (label) {
      const node = nodes.get(id);
      if (node.label === node.id) node.label = label;
      if (shape) node.shape = shape;
    }
    return nodes.get(id);
  };

  for (const line of lines) {
    if (/^(flowchart|graph|stateDiagram|%%|linkStyle|classDef|class\s|style\s|direction\b)/i.test(line)) continue;

    const sub = /^subgraph\s+(\w+)?\s*\[?"?([^"\]]*)"?\]?/i.exec(line);
    if (sub) {
      const id = sub[1] || ('g' + groups.size);
      groups.set(id, { id, label: cleanLabel(sub[2] || sub[1] || id), members: [] });
      groupStack.push(id);
      continue;
    }
    if (/^end$/i.test(line)) { groupStack.pop(); continue; }

    // เก็บรูปทรงและป้ายของโหนดที่ประกาศไว้ในบรรทัดนี้
    let scan = line;
    for (const [pattern, shape] of NODE_PATTERNS) {
      scan = scan.replace(pattern, (whole, id, label) => {
        ensure(id, cleanLabel(label), shape);
        return id;   // เหลือแต่ id ไว้ให้ตัวจับเส้นเชื่อมทำงานง่าย
      });
    }

    // mermaid วางป้ายไว้กลางเส้นได้ด้วย เช่น A -- ป้าย --> B และ A -. ป้าย .-> B
    // แปลงให้เป็นรูปแบบ |ป้าย| ก่อน ตัวจับเส้นเชื่อมจะได้ใช้กติกาเดียว
    scan = scan
      .replace(/-{2,3}\s+"?([^"|>]+?)"?\s+-{2,3}>/g, '-->|$1|')
      .replace(/-\.\s+"?([^"|>]+?)"?\s+\.-{1,2}>/g, '-.->|$1|')
      .replace(/={2,3}\s+"?([^"|>]+?)"?\s+={2,3}>/g, '==>|$1|');

    // เส้นเชื่อม: A --> B, A -->|ป้าย| B, A -.-> B, A --- B, A --> B : ป้าย (stateDiagram)
    // mermaid ต่อเส้นในบรรทัดเดียวได้ เช่น A --> B --> C จึงต้องวนอ่านทั้งบรรทัด
    // ใช้ lookahead จับปลายทาง ตำแหน่งอ่านจะได้ค้างไว้ที่โหนดนั้นเพื่อเป็นต้นทางของรอบถัดไป
    const trailing = /:\s*([^:]+)$/.exec(scan);
    const chain = /([A-Za-z0-9_*[\]]+)\s*(-{2,3}>|-\.-+>|-\.-|={2,3}>|-{2,3}|={2,3})\s*(?:\|([^|]*)\||"([^"]*)")?\s*(?=([A-Za-z0-9_*[\]]+))/g;
    let link, linked = false;
    while ((link = chain.exec(scan))) {
      linked = true;
      const from = link[1].replace(/\[\*\]/, 'START');
      const to = link[5].replace(/\[\*\]/, 'END');
      ensure(from, from === 'START' ? 'เริ่ม' : null, from === 'START' ? 'start' : null);
      ensure(to, to === 'END' ? 'จบ' : null, to === 'END' ? 'stop' : null);
      edges.push({ from, to, label: cleanLabel(link[3] || link[4] || (trailing ? trailing[1] : '')), dashed: link[2].includes('.') });
    }
    if (linked) continue;

    // โหนดเดี่ยวที่ไม่มีเส้นเชื่อม
    const lone = /^([A-Za-z0-9_]+)$/.exec(scan);
    if (lone) ensure(lone[1]);
  }

  if (!nodes.size) return null;
  return { nodes, edges, groups, horizontal };
}

/**
 * จัดระดับตามทิศทางของเส้นเชื่อม
 *
 * ต้องตัดวงจรก่อนเสมอ ผังงานจริงมีเส้นย้อนกลับปกติ (เช่น "ส่งกลับแก้ไข" C2 --> S2
 * หรือ state ที่วนกลับสถานะเดิม) ถ้าไม่ตัด การไล่ระดับจะวนดันเลขขึ้นไปเรื่อย ๆ
 * จนโหนดไปกองผิดคอลัมน์ทั้งผัง — ใช้ DFS หา back-edge แล้วจัดชั้นบนกราฟที่เหลือ
 */
function assignLevels(nodes, edges) {
  const outgoing = new Map([...nodes.keys()].map(id => [id, []]));
  edges.forEach((edge, index) => {
    if (outgoing.has(edge.from) && outgoing.has(edge.to) && edge.from !== edge.to) {
      outgoing.get(edge.from).push({ to: edge.to, index });
    }
  });

  const state = new Map();   // 1 = กำลังอยู่ในเส้นทาง DFS · 2 = สำรวจครบแล้ว
  const back = new Set();
  for (const start of nodes.keys()) {
    if (state.has(start)) continue;
    state.set(start, 1);
    const stack = [{ id: start, at: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const list = outgoing.get(frame.id);
      if (frame.at >= list.length) { state.set(frame.id, 2); stack.pop(); continue; }
      const step = list[frame.at++];
      if (state.get(step.to) === 1) back.add(step.index);          // ชี้กลับไปหาโหนดต้นทางของเส้นทางเดิม
      else if (!state.has(step.to)) { state.set(step.to, 1); stack.push({ id: step.to, at: 0 }); }
    }
  }

  const forward = edges.filter((edge, index) =>
    !back.has(index) && nodes.has(edge.from) && nodes.has(edge.to) && edge.from !== edge.to);

  const level = new Map([...nodes.keys()].map(id => [id, 0]));
  for (let pass = 0; pass <= nodes.size; pass++) {
    let changed = false;
    for (const edge of forward) {
      const want = level.get(edge.from) + 1;
      if (level.get(edge.to) < want) { level.set(edge.to, want); changed = true; }
    }
    if (!changed) break;
  }
  return level;
}

function toMxCells(parsed, prefix) {
  const { nodes, edges, groups, horizontal } = parsed;
  const level = assignLevels(nodes, edges);

  // ขนาดกล่องตามข้อความจริง ป้ายยาวอย่าง "WFCoupon GET · RemaQty (tons)" จะได้ไม่ถูกตัด
  const size = new Map();
  for (const [id, node] of nodes) {
    if (MARKER_SIZE[node.shape]) { size.set(id, { w: MARKER_SIZE[node.shape], h: MARKER_SIZE[node.shape] }); continue; }
    const lines = String(node.label).split('\n');
    const widest = Math.max(...lines.map(line => textWidth(line, 12) + 40));
    const w = Math.max(150, Math.min(300, widest));
    const rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(textWidth(line, 12) / (w - 30))), 0);
    const h = Math.max(52, 16 + rows * 22);
    // สี่เหลี่ยมข้าวหลามตัดกินพื้นที่ในแนวทแยง ต้องเผื่อขอบเพิ่มไม่งั้นข้อความล้น
    size.set(id, node.shape === 'diamond' ? { w: w + 50, h: h + 26 } : { w, h });
  }

  const byLevel = new Map();
  for (const [id, lv] of level) {
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(id);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  // เรียงลำดับในแต่ละระดับด้วย barycenter เพื่อให้เส้นตัดกันน้อยที่สุด
  const neighbours = new Map([...nodes.keys()].map(id => [id, []]));
  for (const edge of edges) {
    if (!neighbours.has(edge.from) || !neighbours.has(edge.to)) continue;
    neighbours.get(edge.from).push(edge.to);
    neighbours.get(edge.to).push(edge.from);
  }
  const order = new Map();
  for (const list of byLevel.values()) list.forEach((id, index) => order.set(id, index));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const list of byLevel.values()) {
      const bary = new Map();
      for (const id of list) {
        const across = neighbours.get(id).filter(other => level.get(other) !== level.get(id));
        bary.set(id, across.length ? across.reduce((sum, other) => sum + order.get(other), 0) / across.length : order.get(id));
      }
      list.sort((a, b) => (bary.get(a) - bary.get(b)) || a.localeCompare(b));
      list.forEach((id, index) => order.set(id, index));
    }
  }

  // ระยะตามทิศทางไหลของกราฟใช้ "ความหนา" ของกล่องในทิศนั้น ไม่ใช่ค่าคงที่สลับด้าน
  const alongGap = horizontal ? GAP_X + 40 : GAP_Y;   // แนวนอนเผื่อที่ให้ป้ายบนเส้น
  const acrossGap = horizontal ? GAP_Y : GAP_X;
  const thickness = id => (horizontal ? size.get(id).w : size.get(id).h);
  const breadth = id => (horizontal ? size.get(id).h : size.get(id).w);

  // subgraph แต่ละอันได้ "แถบ" ของตัวเองในแนวขวาง กล่องกลุ่มจึงไม่มีทางทับกัน
  // (เดิมวางกล่องเป็นกรอบครอบสมาชิกที่กระจายอยู่คนละระดับ ทำให้กรอบซ้อนกันมั่ว)
  const bandOf = id => nodes.get(id).group || '__free';
  const bands = [...groups.keys()];
  if ([...nodes.values()].some(node => !node.group)) bands.push('__free');
  const headerPad = groups.size ? 46 : 0;   // ที่ว่างสำหรับชื่อกลุ่มที่หัวกรอบ

  const alongStart = new Map();
  let cursor = (horizontal ? PAD : TITLE_CLEAR + headerPad);
  for (const lv of levels) {
    alongStart.set(lv, cursor);
    cursor += Math.max(...byLevel.get(lv).map(thickness)) + alongGap;
  }

  const pos = new Map();
  let bandCursor = horizontal ? TITLE_CLEAR : PAD;
  for (const band of bands) {
    const named = band !== '__free';
    const top = bandCursor + (named && horizontal ? headerPad : 0);
    let widest = 0;
    for (const lv of levels) {
      let across = top;
      for (const id of byLevel.get(lv).filter(member => bandOf(member) === band)) {
        pos.set(id, horizontal
          ? { x: alongStart.get(lv), y: across }
          : { x: across, y: alongStart.get(lv) });
        across += breadth(id) + acrossGap;
      }
      widest = Math.max(widest, across - top - acrossGap);
    }
    if (widest <= 0) continue;
    bandCursor = top + widest + acrossGap + (named ? 24 : 0);
  }

  const cells = [];
  for (const [id, node] of nodes) {
    const p = pos.get(id) || { x: PAD, y: TITLE_CLEAR };
    const { w, h } = size.get(id);
    const style = SHAPES[node.shape] || SHAPES.box;
    cells.push(`        <mxCell id="${prefix}-${id}" value="${escapeXml(node.label)}" style="${style}fontSize=12;" vertex="1" parent="1">
          <mxGeometry x="${Math.round(p.x)}" y="${Math.round(p.y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/>
        </mxCell>`);
  }

  edges.forEach((edge, index) => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    // เส้นที่ไหลไปข้างหน้าออกจากด้านท้ายเข้าด้านหน้าเสมอ ไม่งั้นจะลัดผ่ากลางกล่องอื่น
    // และป้ายบนเส้นจะไปทับข้อความในกล่องที่เส้นพาดผ่าน
    //
    // เส้นที่ข้ามมากกว่าหนึ่งระดับ (เช่น CANCELLED --> [*] ที่ข้ามอีก 3 สถานะ) ถ้าปล่อยให้
    // วิ่งตรงจะทะลุกล่องที่ขวางอยู่ จึงให้ออกและเข้าทางด้านข้างเดียวกัน เส้นจะอ้อมข้างคอลัมน์
    const gap = level.get(edge.to) - level.get(edge.from);
    const anchors = gap <= 0 ? ''
      : horizontal
        ? (gap === 1
          ? 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;'
          : 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;')
        : (gap === 1
          ? 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;'
          : 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;');
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=11;jumpStyle=arc;jumpSize=8;`
      + `labelBackgroundColor=#FFFFFF;${anchors}${edge.dashed ? 'dashed=1;' : ''}`;
    cells.push(`        <mxCell id="${prefix}-e${index}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${prefix}-${edge.from}" target="${prefix}-${edge.to}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`);
  });

  // กรอบกลุ่ม (subgraph) วาดเป็นกล่องพื้นหลังไว้ข้างหลัง
  const groupCells = [];
  for (const group of groups.values()) {
    const members = group.members.filter(id => pos.has(id));
    if (!members.length) continue;
    const minX = Math.min(...members.map(id => pos.get(id).x)) - 24;
    const minY = Math.min(...members.map(id => pos.get(id).y)) - 48;
    const maxX = Math.max(...members.map(id => pos.get(id).x + size.get(id).w)) + 24;
    const maxY = Math.max(...members.map(id => pos.get(id).y + size.get(id).h)) + 24;
    groupCells.push(`        <mxCell id="${prefix}-grp-${group.id}" value="${escapeXml(group.label)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#F5F5F5;strokeColor=#B3B3B3;verticalAlign=top;align=left;spacingLeft=14;spacingTop=4;fontStyle=1;fontSize=12;fontColor=#4D4D4D;" vertex="1" parent="1">
          <mxGeometry x="${Math.round(minX)}" y="${Math.round(minY)}" width="${Math.round(maxX - minX)}" height="${Math.round(maxY - minY)}" as="geometry"/>
        </mxCell>`);
  }

  return { cells: groupCells.concat(cells), nodeCount: nodes.size, edgeCount: edges.length };
}


const ROW_H = 26, HEADER_H = 32;

// ---------- erDiagram ----------
// ตัวอย่าง: SOHD ||--o{ SODT : "SOID"  และบล็อก  WFCoupon { int CouponID ... }
function parseEr(source) {
  const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
  const entities = new Map();   // name -> [{type, field, key}]
  const rels = [];
  let current = null;

  const ensure = name => { if (!entities.has(name)) entities.set(name, []); return entities.get(name); };

  for (const line of lines) {
    if (/^erDiagram/i.test(line) || line.startsWith('%%')) continue;

    if (current) {
      if (line === '}') { current = null; continue; }
      const field = /^(\S+)\s+(\S+)(?:\s+(PK|FK|UK))?/.exec(line);
      if (field) ensure(current).push({ type: field[1], field: field[2], key: field[3] || '' });
      continue;
    }

    const block = /^(\w+)\s*\{$/.exec(line);
    if (block) { current = block[1]; ensure(current); continue; }

    // ความสัมพันธ์: A <cardinality> B : "label" — cardinality เช่น ||--o{ หรือ }o..o|
    const rel = /^(\w+)\s+([|}o][-.|o{}]*[|{o])\s+(\w+)\s*:\s*"?([^"]*)"?$/.exec(line);
    if (rel) {
      ensure(rel[1]); ensure(rel[3]);
      rels.push({ from: rel[1], to: rel[3], label: rel[4].trim(), card: rel[2] });
    }
  }
  return entities.size ? { entities, rels } : null;
}

// แปลง cardinality ของ mermaid เป็นหัวลูกศรแบบ ER ของ draw.io (crow's foot)
const ER_END = {
  '||': 'ERmandOne',    // หนึ่งเท่านั้น
  '|o': 'ERzeroToOne', 'o|': 'ERzeroToOne',
  '}|': 'ERoneToMany', '|{': 'ERoneToMany',
  '}o': 'ERzeroToMany', 'o{': 'ERzeroToMany',
};

function erEnds(card) {
  const split = /^(.*?)(--|\.\.)(.*)$/.exec(card || '');
  if (!split) return { start: 'ERone', end: 'ERmany', dashed: false };
  return {
    start: ER_END[split[1]] || 'ERone',
    end: ER_END[split[3]] || 'ERmany',
    dashed: split[2] === '..',   // ความสัมพันธ์แบบ non-identifying
  };
}

function erCells(parsed, prefix, escapeXml) {
  const { entities, rels } = parsed;
  const cells = [];
  const names = [...entities.keys()];

  // ขนาดกล่องคำนวณจากเนื้อหาจริง ตารางจะได้ไม่บีบชื่อฟิลด์และไม่กว้างเกินจำเป็น
  const size = new Map();
  for (const name of names) {
    const fields = entities.get(name);
    const typeW = Math.min(130, Math.max(60, ...fields.map(f => textWidth(f.type, 11) + 20)));
    const fieldW = Math.max(120, ...fields.map(f => textWidth((f.field + ' ' + f.key).trim(), 11) + 22), textWidth(name, 13) + 28 - typeW);
    size.set(name, { w: Math.round(typeW + fieldW), typeW: Math.round(typeW), h: HEADER_H + fields.length * ROW_H });
  }

  const plan = layeredLayout(names, rels);
  const position = placeLayers(plan, size, 'LR', 120, 46, 90);

  for (const name of names) {
    const { w, typeW, h } = size.get(name);
    const { x, y } = position.get(name);

    // ตารางแบบ draw.io: shape=table เป็นหัวตาราง แถวเป็นลูก แก้ทีละช่องได้
    cells.push(`        <mxCell id="${prefix}-${name}" value="${escapeXml(name)}" style="shape=table;startSize=${HEADER_H};container=1;collapsible=0;childLayout=tableLayout;fillColor=#DAE8FC;strokeColor=#6C8EBF;fontStyle=1;fontSize=13;align=center;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
        </mxCell>`);

    entities.get(name).forEach((f, rowIndex) => {
      const rowId = `${prefix}-${name}-r${rowIndex}`;
      const label = f.key ? `${f.field}  (${f.key})` : f.field;
      cells.push(`        <mxCell id="${rowId}" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;strokeColor=#6C8EBF;top=0;left=0;right=0;bottom=0;" vertex="1" parent="${prefix}-${name}">
          <mxGeometry y="${HEADER_H + rowIndex * ROW_H}" width="${w}" height="${ROW_H}" as="geometry"/>
        </mxCell>
        <mxCell id="${rowId}-t" value="${escapeXml(f.type)}" style="shape=partialRectangle;connectable=0;fillColor=none;align=left;spacingLeft=6;overflow=hidden;strokeColor=#6C8EBF;top=0;left=0;bottom=0;right=0;fontSize=11;fontColor=#5B6B7B;" vertex="1" parent="${rowId}">
          <mxGeometry width="${typeW}" height="${ROW_H}" as="geometry"/>
        </mxCell>
        <mxCell id="${rowId}-f" value="${escapeXml(label)}" style="shape=partialRectangle;connectable=0;fillColor=none;align=left;spacingLeft=6;overflow=hidden;strokeColor=#6C8EBF;top=0;left=0;bottom=0;right=0;fontSize=11;${f.key ? 'fontStyle=1;' : ''}" vertex="1" parent="${rowId}">
          <mxGeometry x="${typeW}" width="${w - typeW}" height="${ROW_H}" as="geometry"/>
        </mxCell>`);
    });
  }

  rels.forEach((rel, index) => {
    const ends = erEnds(rel.card);
    // เส้นที่วิ่งไปข้างหน้าตามชั้น บังคับให้ออกขอบขวาเข้าขอบซ้าย จะได้ไม่อ้อมตัดตาราง
    const forward = plan.layer.get(rel.to) > plan.layer.get(rel.from);
    const anchors = forward ? 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;' : '';
    const style = `edgeStyle=entityRelationEdgeStyle;html=1;rounded=0;fontSize=11;jumpStyle=arc;jumpSize=8;`
      + `labelBackgroundColor=#FFFFFF;strokeColor=#4D6B94;${ends.dashed ? 'dashed=1;' : ''}${anchors}`
      + `startArrow=${ends.start};startFill=0;endArrow=${ends.end};endFill=0;`;
    cells.push(`        <mxCell id="${prefix}-er${index}" value="${escapeXml(rel.label)}" style="${style}" edge="1" parent="1" source="${prefix}-${rel.from}" target="${prefix}-${rel.to}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`);
  });

  return { cells, nodeCount: names.length, edgeCount: rels.length };
}

// ---------- classDiagram ----------
function parseClass(source) {
  const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
  const classes = new Map();
  const rels = [];
  let current = null;

  for (const line of lines) {
    if (/^classDiagram/i.test(line) || line.startsWith('%%')) continue;

    if (current) {
      if (line === '}') { current = null; continue; }
      classes.get(current).push(line.replace(/^[+\-#~]/, '').trim());
      continue;
    }

    const open = /^class\s+(\w+)\s*\{$/.exec(line);
    if (open) { current = open[1]; classes.set(current, []); continue; }

    const lone = /^class\s+(\w+)\s*$/.exec(line);
    if (lone) { if (!classes.has(lone[1])) classes.set(lone[1], []); continue; }

    // ความสัมพันธ์: A "1" --> "many" B : label  หรือ A --|> B
    const rel = /^(\w+)\s*(?:"([^"]*)")?\s*(<\|--|--\|>|\*--|o--|-->|--|\.\.>|\.\.\|>)\s*(?:"([^"]*)")?\s*(\w+)\s*(?::\s*(.*))?$/.exec(line);
    if (rel) {
      if (!classes.has(rel[1])) classes.set(rel[1], []);
      if (!classes.has(rel[5])) classes.set(rel[5], []);
      // จำนวนความสัมพันธ์ (multiplicity) เก็บไว้แสดงที่ปลายเส้นทั้งสองข้างแบบ UML
      rels.push({
        from: rel[1], to: rel[5], kind: rel[3],
        label: (rel[6] || '').trim(),
        fromMult: (rel[2] || '').trim(),
        toMult: (rel[4] || '').trim(),
      });
    }
  }
  return classes.size ? { classes, rels } : null;
}

/**
 * หัวลูกศร UML — ใน mermaid `A <|-- B` แปลว่า B สืบทอด A สามเหลี่ยมจึงอยู่ฝั่ง A ซึ่งเป็น source
 * ของเส้น ต้องใช้ startArrow ไม่ใช่ endArrow เช่นเดียวกับ `*--` และ `o--` ที่ข้าวหลามตัด
 * อยู่ฝั่งตัวรวม (source) เสมอ
 */
const CLASS_ARROW = {
  '<|--': 'startArrow=block;startFill=0;startSize=14;endArrow=none;',
  '--|>': 'endArrow=block;endFill=0;endSize=14;',
  '*--':  'startArrow=diamondThin;startFill=1;startSize=16;endArrow=none;',
  'o--':  'startArrow=diamondThin;startFill=0;startSize=16;endArrow=none;',
  '-->':  'endArrow=open;endFill=0;endSize=12;',
  '--':   'endArrow=none;',
  '..>':  'endArrow=open;endFill=0;dashed=1;',
  '..|>': 'endArrow=block;endFill=0;endSize=14;dashed=1;',
};

function classCells(parsed, prefix, escapeXml) {
  const { classes, rels } = parsed;
  const cells = [];
  const names = [...classes.keys()];

  const size = new Map();
  for (const name of names) {
    const members = classes.get(name);
    const width = Math.max(190, textWidth(name, 13) + 40, ...members.map(m => textWidth(m, 11) + 34));
    size.set(name, { w: Math.round(Math.min(width, 320)), h: HEADER_H + members.length * ROW_H });
  }

  // class diagram อ่านจากบนลงล่าง: คลาสฐานอยู่บน คลาสที่อ้างถึงอยู่ล่าง
  const plan = layeredLayout(names, rels);
  const position = placeLayers(plan, size, 'TB', 110, 70, 90);

  for (const name of names) {
    const { w, h } = size.get(name);
    const { x, y } = position.get(name);

    cells.push(`        <mxCell id="${prefix}-${name}" value="${escapeXml(name)}" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${HEADER_H};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;fillColor=#E1D5E7;strokeColor=#9673A6;fontSize=13;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
        </mxCell>`);

    classes.get(name).forEach((member, memberIndex) => {
      // เมธอดลงท้ายด้วย () แยกจากแอตทริบิวต์ด้วยสีข้อความ เพื่ออ่านง่ายแบบ UML ทั่วไป
      const isMethod = /\(\s*\)\s*$/.test(member);
      cells.push(`        <mxCell id="${prefix}-${name}-m${memberIndex}" value="${escapeXml(member)}" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=8;overflow=hidden;fontSize=11;${isMethod ? 'fontColor=#7A3E9D;' : ''}" vertex="1" parent="${prefix}-${name}">
          <mxGeometry y="${HEADER_H + memberIndex * ROW_H}" width="${w}" height="${ROW_H}" as="geometry"/>
        </mxCell>`);
    });
  }

  rels.forEach((rel, index) => {
    const down = plan.layer.get(rel.to) > plan.layer.get(rel.from);
    const anchors = down ? 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;' : '';
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;jumpStyle=arc;jumpSize=8;`
      + `labelBackgroundColor=#FFFFFF;strokeColor=#7A5B96;${anchors}${CLASS_ARROW[rel.kind] || 'endArrow=open;'}`;
    const edgeId = `${prefix}-c${index}`;
    cells.push(`        <mxCell id="${edgeId}" value="${escapeXml(rel.label)}" style="${style}" edge="1" parent="1" source="${prefix}-${rel.from}" target="${prefix}-${rel.to}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`);

    // ป้าย multiplicity เป็นลูกของเส้น (x=-1 คือปลาย source, x=1 คือปลาย target)
    const mult = (text, at, suffix) => {
      if (!text) return;
      cells.push(`        <mxCell id="${edgeId}-${suffix}" value="${escapeXml(text)}" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];fontSize=11;fontColor=#5B6B7B;" vertex="1" connectable="0" parent="${edgeId}">
          <mxGeometry x="${at}" relative="1" as="geometry"><mxPoint x="${at < 0 ? 14 : -14}" y="${at < 0 ? 14 : -14}" as="offset"/></mxGeometry>
        </mxCell>`);
    };
    mult(rel.fromMult, -1, 'ms');
    mult(rel.toMult, 1, 'mt');
  });

  return { cells, nodeCount: names.length, edgeCount: rels.length };
}

// ---------- sequenceDiagram ----------
/**
 * เก็บทุกคำสั่งเป็นลำดับเดียว ไม่ใช่เฉพาะข้อความ เพราะ Note และบล็อก alt/else/loop
 * กินพื้นที่แนวตั้งของตัวเองและต้องวาดตามลำดับจริงในไดอะแกรม
 */
function parseSequence(source) {
  const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
  const actors = [];          // { id, label, isActor }
  const steps = [];
  const seen = new Map();

  const addActor = (id, label, isActor) => {
    if (!seen.has(id)) { seen.set(id, { id, label: label || id, isActor: Boolean(isActor) }); actors.push(seen.get(id)); }
    else { if (label) seen.get(id).label = label; if (isActor) seen.get(id).isActor = true; }
  };

  for (const line of lines) {
    if (/^(sequenceDiagram|autonumber)/i.test(line) || line.startsWith('%%')) continue;

    const decl = /^(participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (decl) { addActor(decl[2], cleanLabel(decl[3]), /^actor$/i.test(decl[1])); continue; }

    // Note over A,B: ... | Note left of A: ... | Note right of A: ...
    const note = /^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/i.exec(line);
    if (note) {
      const targets = note[2].split(',').map(s => s.trim()).filter(Boolean);
      for (const id of targets) addActor(id);
      steps.push({ kind: 'note', placement: note[1].toLowerCase(), targets, label: cleanLabel(note[3]) });
      continue;
    }

    const open = /^(alt|opt|loop|par|critical|break)\b\s*(.*)$/i.exec(line);
    if (open) { steps.push({ kind: 'open', type: open[1].toLowerCase(), label: cleanLabel(open[2]) }); continue; }

    const alt = /^(else|and|option)\b\s*(.*)$/i.exec(line);
    if (alt) { steps.push({ kind: 'alt', label: cleanLabel(alt[2]) }); continue; }

    if (/^end$/i.test(line)) { steps.push({ kind: 'close' }); continue; }

    const act = /^(activate|deactivate)\s+([A-Za-z0-9_]+)$/i.exec(line);
    if (act) { addActor(act[2]); steps.push({ kind: act[1].toLowerCase(), actor: act[2] }); continue; }

    // ข้อความ: ->> เรียกแบบซิงค์ · -->> ตอบกลับ (เส้นประ) · --) แบบไม่รอผล (หัวลูกศรเปิด)
    const msg = /^([A-Za-z0-9_]+)\s*(-{1,2}>>?|-{1,2}\))([+-]?)\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (msg) {
      addActor(msg[1]); addActor(msg[4]);
      steps.push({
        kind: 'msg', from: msg[1], to: msg[4], label: cleanLabel(msg[5]),
        dashed: msg[2].startsWith('--'),
        async: msg[2].endsWith(')'),
        self: msg[1] === msg[4],
        activate: msg[3],
      });
    }
  }
  return actors.length ? { actors, steps } : null;
}

const FRAGMENT_LABEL = { alt: 'alt', opt: 'opt', loop: 'loop', par: 'par', critical: 'critical', break: 'break' };

/**
 * วาดผังลำดับ (sequence diagram)
 *
 * ทำสองรอบ เพราะ "แถบกำลังทำงาน" (activation bar) ต้องรู้ตำแหน่งแนวตั้งของทุกข้อความก่อน
 * ถึงจะคำนวณช่วงต้น-ท้ายของแถบได้ และหัวลูกศรต้องจบที่ขอบแถบ ไม่ใช่กลางเส้น lifeline
 *   รอบที่ 1 — คำนวณ y ของทุกคำสั่ง กรอบ alt/loop และโน้ต
 *   รอบที่ 2 — สร้าง mxCell โดยรู้แล้วว่าช่วงไหนของ lifeline ไหนกำลังทำงานอยู่
 */
function sequenceCells(parsed, prefix, escapeXml) {
  const { actors, steps } = parsed;
  const LANE_GAP = 60, HEAD_H = 54, SELF_W = 78, BAR_W = 12;
  const HEAD_Y = TITLE_CLEAR;
  const BODY_Y = HEAD_Y + HEAD_H + 44;

  // ความกว้างของแต่ละ lane ยืดตามชื่อจริง ชื่อยาวอย่าง "PATCH /api/so/:id/ship" จะได้ไม่ถูกตัด
  const lane = new Map();
  let left = 60;
  for (const actor of actors) {
    const w = Math.max(150, Math.min(280, textWidth(actor.label, 13) + 40));
    lane.set(actor.id, { left, w, mid: Math.round(left + w / 2) });
    left += w + LANE_GAP;
  }

  const noteHeight = (label, width) => {
    const rows = Math.max(1, Math.ceil(textWidth(label, 12) / Math.max(60, width - 34)));
    return 26 + rows * 18;
  };

  // ---------- รอบที่ 1: ตำแหน่งแนวตั้ง ----------
  const laid = [];
  const boxes = [];      // กรอบ alt/opt/loop ที่ปิดแล้ว
  const stack = [];
  let y = BODY_Y;
  let sequence = 0;

  const touch = ids => {
    for (const frame of stack) for (const id of ids) if (lane.has(id)) frame.members.add(id);
  };

  const closeFrame = (frame, bottom) => {
    const ids = frame.members.size ? [...frame.members] : [...lane.keys()];
    boxes.push({
      id: frame.id, type: frame.type, label: frame.label, dividers: frame.dividers,
      top: frame.top, bottom,
      from: Math.min(...ids.map(m => lane.get(m).left)) - 28,
      to: Math.max(...ids.map(m => lane.get(m).left + lane.get(m).w)) + 28,
    });
  };

  steps.forEach((step, index) => {
    const id = `${prefix}-s${index}`;

    if (step.kind === 'open') {
      stack.push({ id, type: step.type, label: step.label, top: y, members: new Set(), dividers: [] });
      y += 44;
      return;
    }
    if (step.kind === 'alt') {
      const frame = stack[stack.length - 1];
      if (frame) frame.dividers.push({ y: y + 4, label: step.label });
      y += 36;
      return;
    }
    if (step.kind === 'close') {
      const frame = stack.pop();
      if (frame) { closeFrame(frame, y + 14); y += 28; }
      return;
    }
    if (step.kind === 'note') {
      touch(step.targets);
      const known = step.targets.filter(target => lane.has(target));
      if (!known.length) return;
      let x, w;
      if (step.placement === 'over') {
        x = Math.min(...known.map(target => lane.get(target).left));
        w = Math.max(...known.map(target => lane.get(target).left + lane.get(target).w)) - x;
      } else if (step.placement === 'left of') {
        w = 220; x = lane.get(known[0]).left - w - 18;
      } else {
        w = 220; x = lane.get(known[0]).left + lane.get(known[0]).w + 18;
      }
      const h = noteHeight(step.label, w);
      laid.push({ kind: 'note', id, step, x, y, w, h });
      y += h + 24;
      return;
    }
    if (step.kind !== 'msg' || !lane.has(step.from) || !lane.has(step.to)) return;

    touch([step.from, step.to]);
    sequence++;
    if (step.self) {
      laid.push({ kind: 'msg', id, step, order: sequence, y: y + 6, bottom: y + 46 });
      y += 72;
    } else {
      laid.push({ kind: 'msg', id, step, order: sequence, y: y + 14, bottom: y + 14 });
      y += 52;
    }
  });

  while (stack.length) closeFrame(stack.pop(), y + 14);

  // ---------- แถบกำลังทำงาน ----------
  // ต้นฉบับของเราไม่ได้เขียน activate/deactivate ไว้ จึงอนุมานตามความหมายของ UML:
  // ผู้รับ "การเรียกแบบซิงค์" (เส้นทึบ ไม่ใช่การตอบกลับและไม่ใช่แบบไม่รอผล) เริ่มทำงาน
  // และทำงานจนถึงข้อความสุดท้ายที่ตนเกี่ยวข้อง — ถ้าต้นฉบับระบุ activate มาเองก็ใช้ตามนั้น
  const messages = laid.filter(item => item.kind === 'msg');
  const bars = new Map();
  const explicit = steps.some(step => step.kind === 'activate');
  for (const actor of actors) {
    const opening = messages.find(item =>
      item.step.to === actor.id && !item.step.self && !item.step.dashed && !item.step.async
      && (!explicit || item.step.activate === '+'));
    if (!opening) continue;
    const closing = [...messages].reverse().find(item => item.step.from === actor.id || item.step.to === actor.id);
    bars.set(actor.id, { top: opening.y - 10, bottom: closing.bottom + 18 });
  }
  const busy = (id, at) => bars.has(id) && at >= bars.get(id).top && at <= bars.get(id).bottom;

  // ---------- รอบที่ 2: สร้าง cell ----------
  const frameCells = [];
  for (const box of boxes) {
    frameCells.push(`        <mxCell id="${box.id}" value="${escapeXml(FRAGMENT_LABEL[box.type] || box.type)}" style="shape=umlFrame;whiteSpace=wrap;html=1;width=70;height=28;fillColor=none;strokeColor=#B85450;fontSize=11;fontStyle=1;fontColor=#B85450;" vertex="1" parent="1">
          <mxGeometry x="${Math.round(box.from)}" y="${Math.round(box.top)}" width="${Math.round(box.to - box.from)}" height="${Math.round(box.bottom - box.top)}" as="geometry"/>
        </mxCell>`);
    if (box.label) {
      frameCells.push(`        <mxCell id="${box.id}-c" value="${escapeXml('[' + box.label + ']')}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=#B85450;" vertex="1" parent="1">
          <mxGeometry x="${Math.round(box.from + 78)}" y="${Math.round(box.top + 2)}" width="${Math.round(box.to - box.from - 90)}" height="24" as="geometry"/>
        </mxCell>`);
    }
    box.dividers.forEach((divider, index) => {
      frameCells.push(`        <mxCell id="${box.id}-d${index}" value="" style="html=1;endArrow=none;dashed=1;strokeColor=#B85450;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="${Math.round(box.from)}" y="${Math.round(divider.y)}" as="sourcePoint"/>
            <mxPoint x="${Math.round(box.to)}" y="${Math.round(divider.y)}" as="targetPoint"/>
          </mxGeometry>
        </mxCell>`);
      frameCells.push(`        <mxCell id="${box.id}-dl${index}" value="${escapeXml('[' + (divider.label || 'else') + ']')}" style="text;html=1;align=left;verticalAlign=top;fontSize=11;fontColor=#B85450;" vertex="1" parent="1">
          <mxGeometry x="${Math.round(box.from + 12)}" y="${Math.round(divider.y + 2)}" width="240" height="22" as="geometry"/>
        </mxCell>`);
    });
  }

  const barCells = [];
  for (const [id, bar] of bars) {
    barCells.push(`        <mxCell id="${prefix}-bar-${id}" value="" style="html=1;points=[[0,0,0],[1,0,0],[0,1,0],[1,1,0]];perimeter=orthogonalPerimeter;outlineConnect=0;targetShapes=umlLifeline;fillColor=#FFFFFF;strokeColor=#2E4A6B;" vertex="1" parent="1">
          <mxGeometry x="${lane.get(id).mid - BAR_W / 2}" y="${Math.round(bar.top)}" width="${BAR_W}" height="${Math.round(bar.bottom - bar.top)}" as="geometry"/>
        </mxCell>`);
  }

  const body = [];
  for (const item of laid) {
    if (item.kind === 'note') {
      body.push(`        <mxCell id="${item.id}" value="${escapeXml(item.step.label)}" style="shape=note;whiteSpace=wrap;html=1;size=14;verticalAlign=middle;align=center;fillColor=#FFF2CC;strokeColor=#D6B656;fontSize=11;" vertex="1" parent="1">
          <mxGeometry x="${Math.round(item.x)}" y="${Math.round(item.y)}" width="${Math.round(item.w)}" height="${item.h}" as="geometry"/>
        </mxCell>`);
      continue;
    }

    const { step } = item;
    const head = step.async ? 'endArrow=open;endFill=0;endSize=10;' : 'endArrow=block;endFill=1;endSize=8;';
    const base = `html=1;fontSize=11;strokeColor=#2E4A6B;labelBackgroundColor=#FFFFFF;${head}${step.dashed ? 'dashed=1;' : ''}`;
    const label = item.order + '. ' + step.label;

    if (step.self) {
      // ข้อความหาตัวเอง วาดเป็นลูปออกทางขวาแล้ววนกลับ ป้ายวางชิดขอบลูป
      const edge = lane.get(step.from).mid + (busy(step.from, item.y) ? BAR_W / 2 : 0);
      body.push(`        <mxCell id="${item.id}" value="${escapeXml(label)}" style="${base}edgeStyle=orthogonalEdgeStyle;rounded=0;align=left;verticalAlign=middle;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="${edge}" y="${Math.round(item.y)}" as="sourcePoint"/>
            <mxPoint x="${edge}" y="${Math.round(item.bottom)}" as="targetPoint"/>
            <Array as="points">
              <mxPoint x="${edge + SELF_W}" y="${Math.round(item.y)}"/>
              <mxPoint x="${edge + SELF_W}" y="${Math.round(item.bottom)}"/>
            </Array>
            <mxPoint x="14" y="-12" as="offset"/>
          </mxGeometry>
        </mxCell>`);
      continue;
    }

    // ปลายลูกศรจบที่ขอบแถบกำลังทำงาน ไม่ใช่กลาง lifeline ตามแบบ UML
    const fromMid = lane.get(step.from).mid;
    const toMid = lane.get(step.to).mid;
    const dir = toMid > fromMid ? 1 : -1;
    const sx = fromMid + (busy(step.from, item.y) ? dir * BAR_W / 2 : 0);
    const tx = toMid - (busy(step.to, item.y) ? dir * BAR_W / 2 : 0);
    body.push(`        <mxCell id="${item.id}" value="${escapeXml(label)}" style="${base}align=center;verticalAlign=bottom;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="${Math.round(sx)}" y="${Math.round(item.y)}" as="sourcePoint"/>
            <mxPoint x="${Math.round(tx)}" y="${Math.round(item.y)}" as="targetPoint"/>
          </mxGeometry>
        </mxCell>`);
  }

  const lifelineH = Math.max(240, y + 46 - HEAD_Y);
  const heads = actors.map(actor => {
    const geometry = lane.get(actor.id);
    // หัว lifeline ใช้กล่องเหมือนกันทุกตัว — draw.io วาด participant=umlActor เป็นรูปคน
    // เต็มพื้นที่หัว ชื่อจะไปทับเส้นรูปคนจนอ่านไม่ออก จึงแยกความเป็น "คน" ด้วยสีเขียวแทน
    const style = 'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;'
      + 'recursiveResize=0;outlineConnect=0;dropTarget=0;fontSize=13;fontStyle=1;size=' + HEAD_H + ';'
      + (actor.isActor
        ? 'fillColor=#D5E8D4;strokeColor=#82B366;'
        : 'fillColor=#DAE8FC;strokeColor=#6C8EBF;');
    return `        <mxCell id="${prefix}-${actor.id}" value="${escapeXml(actor.label)}" style="${style}" vertex="1" parent="1">
          <mxGeometry x="${geometry.left}" y="${HEAD_Y}" width="${geometry.w}" height="${Math.round(lifelineH)}" as="geometry"/>
        </mxCell>`;
  });

  return {
    cells: heads.concat(frameCells, barCells, body),
    nodeCount: actors.length,
    edgeCount: sequence,
  };
}


/** คืน mxCell XML ถ้าแปลงได้ คืน null ถ้าเป็นชนิดที่ยังแปลงไม่ได้ */
function convert(source, prefix) {
  const first = source.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%')) || '';
  if (/^erDiagram/i.test(first)) {
    const er = parseEr(source);
    return er ? erCells(er, prefix, escapeXml) : null;
  }
  if (/^classDiagram/i.test(first)) {
    const cd = parseClass(source);
    return cd ? classCells(cd, prefix, escapeXml) : null;
  }
  if (/^sequenceDiagram/i.test(first)) {
    const sq = parseSequence(source);
    return sq ? sequenceCells(sq, prefix, escapeXml) : null;
  }
  if (!/^(flowchart|graph|stateDiagram)/i.test(first)) return null;
  const parsed = parseFlowchart(source);
  if (!parsed || parsed.nodes.size < 2) return null;
  return toMxCells(parsed, prefix);
}

module.exports = { convert, escapeXml };
