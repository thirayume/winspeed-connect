# -*- coding: utf-8 -*-
"""WorldFert doc-gen: manifest-driven DOCX matrix (SRS, Tech Spec, User Guides) with
ISO doc-control + revision history + embedded mermaid diagrams. Source of truth = markdown."""
import os, glob, datetime, mistune
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ENT  = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIAG = os.path.join(ENT, "pipeline", "diagrams")
OUT  = os.path.join(ENT, "01-DOCX", "generated")
FONT = "Prompt"
TODAY = "21 กรกฎาคม 2569 (21 July 2026)"
md = mistune.create_markdown(renderer=None, plugins=["table","strikethrough","url"])

# ---------- document matrix ----------
# sections = markdown paths (relative to ENT); diagrams = png stems in DIAG
M = [
 {"id":"SRS-v1.0","title":"Software Requirements Specification (SRS)","docid":"WF-SRS-001","audience":"Product Owner · BA · Dev · QA","scope":"Full",
  "sections":["02-REQUIREMENTS/SRS-v8.md","02-REQUIREMENTS/ACCEPTANCE-CRITERIA.md","02-REQUIREMENTS/NFR-SLO-DR.md","01-BUSINESS-ANALYSIS/BUSINESS-RULES.md","02-REQUIREMENTS/TRACEABILITY-MATRIX.md"],
  "diagrams":["01-architecture","02-so-lifecycle","05-erd"]},
 {"id":"Technical-Spec-v1.0","title":"Technical Specification","docid":"WF-TECH-001","audience":"Solution Architect · Dev · DBA · Support","scope":"Full",
  "sections":["03-SOLUTION-ARCHITECTURE/SAD-v8.md","03-SOLUTION-ARCHITECTURE/C4-ARCHITECTURE.md","04-DATA-INTEGRATION/DATA-DESIGN.md","04-DATA-INTEGRATION/DATABASE-OVERVIEW.md","04-DATA-INTEGRATION/WINSPEED-SO-FLOW.md","04-DATA-INTEGRATION/REBATE-COUPON-SYSTEM.md","04-DATA-INTEGRATION/API-REFERENCE.md"],
  "diagrams":["01-architecture","05-erd","03-rebate-coupon-flow","04-rebate-sequence","08-uml-rebate-domain"]},
 {"id":"User-Guide-Full-v1.0","title":"User Guide — ฉบับเต็ม (Full)","docid":"WF-UG-FULL-001","audience":"ผู้ใช้ทุก Role","scope":"Full",
  "sections":["06-QUALITY-OPERATIONS/USER-GUIDE-DETAIL.md","06-QUALITY-OPERATIONS/SOP-DETAIL.md"],
  "diagrams":["07-swimlane-order-to-cash","02-so-lifecycle"]},
 {"id":"User-Guide-Brief-v1.0","title":"User Guide — ฉบับย่อ (Quick Reference)","docid":"WF-UG-BRIEF-001","audience":"ผู้ใช้ทุก Role","scope":"Brief",
  "sections":["06-QUALITY-OPERATIONS/TEST-CATALOG-CURRENT.md"],
  "diagrams":["07-swimlane-order-to-cash"], "brief":True},
 {"id":"User-Guide-Combined-Summary-v1.0","title":"User Guide — สรุปรวมทุก Role","docid":"WF-UG-SUM-001","audience":"ผู้บริหาร · หัวหน้างาน","scope":"Summary",
  "sections":[], "roles_summary":True, "diagrams":["06-rbac","07-swimlane-order-to-cash"]},
]
# per-role guides: role -> (menu groups relevant, extra diagrams)
ROLES = {
 "Sales":       {"docid":"WF-UG-SALES-001","groups":["หลัก","การเงิน"],   "diagrams":["02-so-lifecycle","03-rebate-coupon-flow"]},
 "Warehouse":   {"docid":"WF-UG-WH-001","groups":["หลัก"],               "diagrams":["07-swimlane-order-to-cash"]},
 "Weighbridge": {"docid":"WF-UG-WB-001","groups":["คลัง/ชั่ง"],          "diagrams":["04-rebate-sequence","02-so-lifecycle"]},
 "Accounting":  {"docid":"WF-UG-ACC-001","groups":["การเงิน","บัญชี"],    "diagrams":["03-rebate-coupon-flow","05-erd"]},
 "Admin":       {"docid":"WF-UG-ADM-001","groups":["หลัก","การเงิน","บัญชี","คลัง/ชั่ง","ตั้งค่าระบบ"],"diagrams":["01-architecture","06-rbac"]},
}

# ---------- docx helpers ----------
def base(doc):
    st=doc.styles["Normal"]; st.font.name=FONT; st.font.size=Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"),FONT); st.element.rPr.rFonts.set(qn("w:cs"),FONT)
def cs(r):
    r.font.name=FONT; rr=r._element.rPr
    if rr is not None and rr.rFonts is not None: rr.rFonts.set(qn("w:cs"),FONT); rr.rFonts.set(qn("w:eastAsia"),FONT)
def inline(par,nodes,b=False,i=False):
    for n in nodes or []:
        t=n.get("type")
        if t=="text": r=par.add_run(n.get("raw","")); r.bold=b; r.italic=i; cs(r)
        elif t=="strong": inline(par,n["children"],True,i)
        elif t=="emphasis": inline(par,n["children"],b,True)
        elif t=="codespan": r=par.add_run(n.get("raw","")); r.font.name="Consolas"; r.font.size=Pt(9.5); r.font.color.rgb=RGBColor(0xC7,0x25,0x4E); cs(r)
        elif t in ("link","strikethrough"): inline(par,n["children"],b,i)
        elif t in ("linebreak","softbreak"): par.add_run(" ")
        elif "children" in n: inline(par,n["children"],b,i)
        elif "raw" in n: r=par.add_run(n["raw"]); cs(r)
def code(doc,txt):
    p=doc.add_paragraph(); p.paragraph_format.left_indent=Inches(0.2)
    r=p.add_run(txt.rstrip("\n")); r.font.name="Consolas"; r.font.size=Pt(8.5)
    sh=OxmlElement("w:shd"); sh.set(qn("w:fill"),"F2F2F2"); p._p.get_or_add_pPr().append(sh)
def table(doc,node):
    head=node["children"][0]; body=node["children"][1] if len(node["children"])>1 else None
    hc=head["children"]; nc=len(hc); rows=body["children"] if body else []
    tb=doc.add_table(rows=1,cols=nc); tb.style="Light Grid Accent 1"
    for j,c in enumerate(hc): tb.rows[0].cells[j].paragraphs[0].text=""; inline(tb.rows[0].cells[j].paragraphs[0],c["children"],True)
    for row in rows:
        cells=row["children"]; tr=tb.add_row().cells
        for j in range(nc):
            tr[j].paragraphs[0].text=""
            if j<len(cells): inline(tr[j].paragraphs[0],cells[j]["children"])
    doc.add_paragraph()
def rlist(doc,node,lvl=0):
    ordered=node.get("attrs",{}).get("ordered",False)
    for it in node["children"]:
        first=True
        for ch in it["children"]:
            ct=ch.get("type")
            if ct in ("block_text","paragraph"):
                p=doc.add_paragraph(style=("List Number" if ordered else "List Bullet") if first else None)
                if not first: p.paragraph_format.left_indent=Inches(0.5*(lvl+1))
                inline(p,ch["children"]); first=False
            elif ct=="list": rlist(doc,ch,lvl+1)
            elif ct=="block_code": code(doc,ch.get("raw",""))
def render(doc,tokens):
    for n in tokens:
        t=n.get("type")
        if t=="heading":
            lv=n.get("attrs",{}).get("level",1); p=doc.add_heading(level=min(lv,4)); inline(p,n["children"])
            for r in p.runs: cs(r)
        elif t=="paragraph": inline(doc.add_paragraph(),n["children"])
        elif t=="block_code": code(doc,n.get("raw",""))
        elif t=="block_quote":
            for ch in n["children"]:
                if ch.get("type")=="paragraph":
                    p=doc.add_paragraph(); p.paragraph_format.left_indent=Inches(0.3); inline(p,ch["children"])
                    for r in p.runs: r.italic=True; r.font.color.rgb=RGBColor(0x55,0x55,0x55)
                else: render(doc,[ch])
        elif t=="list": rlist(doc,n)
        elif t=="table": table(doc,n)
        elif t=="thematic_break": doc.add_paragraph("_"*36)
        elif "children" in n: render(doc,n["children"])
def add_md(doc,path):
    fp=os.path.join(ENT,path)
    if not os.path.exists(fp): return False
    txt=open(fp,encoding="utf-8").read().lstrip("﻿")
    render(doc,md(txt)); return True
def add_diagram(doc,stem,cap):
    png=os.path.join(DIAG,stem+".png")
    if not os.path.exists(png): return
    doc.add_page_break()
    h=doc.add_heading("แผนภาพ: "+cap,level=2)
    for r in h.runs: cs(r)
    doc.add_picture(png,width=Inches(6.6))
    doc.paragraphs[-1].alignment=WD_ALIGN_PARAGRAPH.CENTER

DIAG_TITLES={"01-architecture":"สถาปัตยกรรมระบบ 3 ชั้น","02-so-lifecycle":"วงจรใบสั่งขาย (SO Lifecycle)","03-rebate-coupon-flow":"Rebate/Coupon Flow","04-rebate-sequence":"Rebate Sequence","05-erd":"ERD (wf + dbo)","06-rbac":"RBAC · 7 Roles","07-swimlane-order-to-cash":"Swimlane · Order-to-Cash","08-uml-rebate-domain":"UML · Rebate Domain"}

def cover(doc,spec):
    for _ in range(3): doc.add_paragraph()
    t=doc.add_paragraph(); t.alignment=1; r=t.add_run("World Fert · WS-Sale-App"); r.bold=True; r.font.size=Pt(22); r.font.color.rgb=RGBColor(0x0C,0x44,0x7C); cs(r)
    t=doc.add_paragraph(); t.alignment=1; r=t.add_run(spec["title"]); r.bold=True; r.font.size=Pt(28); cs(r)
    for line in [f"Version v1.0 · App 1.0.0 · {spec['scope']}", TODAY, f"Audience: {spec['audience']}", "Confidential — Client / Authorized Partner Use Only"]:
        p=doc.add_paragraph(); p.alignment=1; r=p.add_run(line); r.font.size=Pt(12); cs(r)
    doc.add_page_break()
    # doc control
    h=doc.add_heading("การควบคุมเอกสาร (Document Control)",level=1); [cs(r) for r in h.runs]
    tb=doc.add_table(rows=0,cols=2); tb.style="Light List Accent 1"
    for k,v in [("Document ID",spec["docid"]),("Product","WS-Sale-App"),("Client","World Fert Co., Ltd."),("Version","v1.0"),("App build","1.0.0"),("Date",TODAY),("Scope",spec["scope"]),("Audience",spec["audience"]),("Status","Released"),("Classification","Confidential")]:
        c=tb.add_row().cells; c[0].paragraphs[0].add_run(k).bold=True; c[1].paragraphs[0].add_run(v)
        for cell in c:
            for rr in cell.paragraphs[0].runs: cs(rr)
    doc.add_paragraph()
    h=doc.add_heading("ประวัติการแก้ไข (Revision History)",level=2); [cs(r) for r in h.runs]
    rt=doc.add_table(rows=1,cols=4); rt.style="Light Grid Accent 1"
    for j,x in enumerate(["Version","Date","Author","Change"]): rt.rows[0].cells[j].paragraphs[0].add_run(x).bold=True
    c=rt.add_row().cells; [c[j].paragraphs[0].add_run(v) for j,v in enumerate(["v1.0",TODAY,"Doc-gen pipeline","Initial consolidated v1.0 baseline"])]
    doc.add_paragraph()
    h=doc.add_heading("สารบัญ (Table of Contents)",level=1); [cs(r) for r in h.runs]
    p=doc.add_paragraph(); run=p.add_run(); fld=OxmlElement("w:fldSimple"); fld.set(qn("w:instr"),r'TOC \o "1-2" \h \z \u'); run._r.addnext(fld)
    doc.add_paragraph("(คลิกขวา → Update Field เพื่อสร้างเลขหน้า)")
    doc.add_page_break()

def build(spec):
    doc=Document(); base(doc); cover(doc,spec)
    if spec.get("roles_summary"):
        h=doc.add_heading("สรุปการใช้งานตาม Role",level=1); [cs(r) for r in h.runs]
        for rn,ri in ROLES.items():
            hh=doc.add_heading(rn,level=2); [cs(r) for r in hh.runs]
            p=doc.add_paragraph(); p.add_run("เมนูที่เกี่ยวข้อง: ").bold=True; p.add_run(", ".join(ri["groups"]))
            for r in p.runs: cs(r)
        add_md(doc,"06-QUALITY-OPERATIONS/USER-GUIDE-DETAIL.md")
    else:
        for s in spec["sections"]:
            add_md(doc,s); doc.add_page_break()
    for d in spec.get("diagrams",[]): add_diagram(doc,d,DIAG_TITLES.get(d,d))
    out=os.path.join(OUT,spec["id"]+".docx"); doc.save(out); return out

def build_role(role,info):
    spec={"id":f"User-Guide-{role}-v1.0","title":f"User Guide — Role: {role}","docid":info["docid"],
          "audience":f"Role: {role}","scope":"Per-Role"}
    doc=Document(); base(doc); cover(doc,spec)
    h=doc.add_heading(f"หน้าที่และเมนูสำหรับ Role: {role}",level=1); [cs(r) for r in h.runs]
    p=doc.add_paragraph(); p.add_run("กลุ่มเมนูที่ใช้: ").bold=True; p.add_run(", ".join(info["groups"]))
    for r in p.runs: cs(r)
    doc.add_paragraph("รายละเอียดหน้าจอดูใน Test Catalog / User Guide ด้านล่าง (เน้นเฉพาะส่วนที่ Role นี้ใช้).")
    add_md(doc,"06-QUALITY-OPERATIONS/USER-GUIDE-DETAIL.md")
    for d in info["diagrams"]: add_diagram(doc,d,DIAG_TITLES.get(d,d))
    out=os.path.join(OUT,spec["id"]+".docx"); doc.save(out); return out

os.makedirs(OUT,exist_ok=True)
built=[]
for spec in M: built.append(build(spec))
for role,info in ROLES.items(): built.append(build_role(role,info))
print(f"built {len(built)} DOCX -> {OUT}")
for b in built: print("  -", os.path.basename(b))
