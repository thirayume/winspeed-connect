import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { SpreadsheetFile, Workbook } = require("@oai/artifact-tool");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE = path.resolve(HERE, "../..");
const DEFAULT_DATA = path.join(HERE, "uat-cases.json");
const DEFAULT_OUTPUT = path.join(ENTERPRISE, "06-XLSX/candidate/UAT-Master-Script-v1.0.xlsx");

const COLORS = {
  navy: "#12304A",
  blue: "#176B87",
  teal: "#2A9D8F",
  sky: "#DCEEF5",
  pale: "#F4F8FA",
  line: "#C9D7DF",
  ink: "#1B2633",
  muted: "#5C6B76",
  white: "#FFFFFF",
  green: "#DFF3E4",
  greenText: "#176A39",
  amber: "#FFF1CC",
  amberText: "#8A5A00",
  red: "#FBE0DF",
  redText: "#A32828",
  gray: "#E8EDF0",
};

function argsFrom(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? argv[++i] : true;
  }
  return out;
}

const args = argsFrom(process.argv.slice(2));
const dataPath = path.resolve(args.data || DEFAULT_DATA);
const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);
const previewDir = args["preview-dir"] ? path.resolve(args["preview-dir"]) : null;
const sourceCommit = String(args["source-commit"] || process.env.WF_SOURCE_COMMIT || "UNVERIFIED");
const generatedAt = String(args["generated-at"] || new Date().toISOString());

const payload = JSON.parse(await fs.readFile(dataPath, "utf8"));
const cases = payload.cases || [];
if (!Array.isArray(cases) || cases.length === 0) throw new Error("uat-cases.json has no cases");

await fs.mkdir(path.dirname(outputPath), { recursive: true });
if (previewDir) await fs.mkdir(previewDir, { recursive: true });

const wb = Workbook.create();
const sheets = {};
for (const name of ["README", "Run Control", "Dashboard", "UAT Cases", "Full Loop", "Defects", "Evidence", "Sign-off", "Lookups"]) {
  sheets[name] = wb.worksheets.add(name);
}

function titleBand(sheet, endCol, title, subtitle) {
  sheet.getRange(`A1:${endCol}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A1:${endCol}1`).format = {
    fill: COLORS.navy,
    font: { name: "Kanit", size: 18, bold: true, color: COLORS.white },
    verticalAlignment: "center",
  };
  sheet.getRange(`A1:${endCol}1`).format.rowHeight = 36;
  sheet.getRange(`A2:${endCol}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format = {
    fill: COLORS.sky,
    font: { name: "Prompt", size: 10, color: COLORS.ink },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${endCol}2`).format.rowHeight = 30;
}

function header(range) {
  range.format = {
    fill: COLORS.blue,
    font: { name: "Prompt", size: 10, bold: true, color: COLORS.white },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: COLORS.white },
  };
}

function body(range) {
  range.format = {
    font: { name: "Prompt", size: 9, color: COLORS.ink },
    wrapText: true,
    verticalAlignment: "top",
    borders: { preset: "all", style: "thin", color: COLORS.line },
  };
}

function section(sheet, row, endCol, label) {
  const r = sheet.getRange(`A${row}:${endCol}${row}`);
  r.merge();
  sheet.getRange(`A${row}`).values = [[label]];
  r.format = {
    fill: COLORS.sky,
    font: { name: "Kanit", size: 12, bold: true, color: COLORS.navy },
    verticalAlignment: "center",
  };
  r.format.rowHeight = 24;
}

// README
{
  const s = sheets.README;
  titleBand(s, "H", "WS-Sale-App — UAT Master Script", "Controlled candidate workbook • Source-driven from uat-cases.json • Business sign-off required");
  s.getRange("A4:B12").values = [
    ["Document ID", "WF-QA-022-XLSX"],
    ["Product", payload.product || "WS-Sale-App"],
    ["Client", payload.client || "World Fert Co., Ltd."],
    ["Runtime", payload.runtimeVersion || "1.0.0"],
    ["Source commit", sourceCommit],
    ["Generated at", `UTC ${generatedAt}`],
    ["Status", "Review / Candidate"],
    ["Confidentiality", "Confidential — Client / Authorized Partner Use Only"],
    ["Authoritative data", path.basename(dataPath)],
  ];
  s.getRange("B4:H12").merge(true);
  header(s.getRange("A4:A12"));
  body(s.getRange("B4:H12"));
  section(s, 14, "H", "วิธีใช้งาน / How to use");
  s.getRange("A15:H20").values = [
    ["1", "Run Control", "กรอก environment, build, commit, ผู้รับผิดชอบ และ dependency health ก่อนเริ่ม", "", "", "", "", ""],
    ["2", "UAT Cases", "มอบหมายผู้ทดสอบ ทำตามขั้นตอน บันทึก Actual Result, Status, Defect และ evidence", "", "", "", "", ""],
    ["3", "Full Loop", "ใช้ควบคุมลำดับข้าม role และ hold point ของกระบวนการหลัก", "", "", "", "", ""],
    ["4", "Defects / Evidence", "ทุก Fail ต้องมี defect ID และทุก Pass ต้องมี evidence ที่ตรวจย้อนกลับได้", "", "", "", "", ""],
    ["5", "Dashboard", "ตรวจ critical/overall pass และ open severity ก่อนเสนอ Sign-off", "", "", "", "", ""],
    ["6", "Sign-off", "ผู้มีอำนาจตัดสินใจลงชื่อ/วันที่/หลักฐาน; generator ห้ามอนุมัติแทน", "", "", "", "", ""],
  ];
  s.getRange("C15:H20").merge(true);
  body(s.getRange("A15:H20"));
  s.getRange("A15:A20").format = { fill: COLORS.teal, font: { name: "Kanit", bold: true, color: COLORS.white }, horizontalAlignment: "center", verticalAlignment: "center" };
  section(s, 22, "H", "ข้อควบคุมสำคัญ");
  s.getRange("A23:H27").values = [
    ["•", "Automated E2E เป็น supporting evidence และต้อง rerun เมื่อ tracked source/test hash เปลี่ยน", "", "", "", "", "", ""],
    ["•", "Critical ต้อง Pass 100%; ห้ามปิด defect หรือเปลี่ยน Fail เป็น Pass โดยไม่มี retest evidence", "", "", "", "", "", ""],
    ["•", "TruckScale online, WINSpeed reconciliation, security, performance และ restore เป็น manual gates", "", "", "", "", "", ""],
    ["•", "ใช้ข้อมูล synthetic/masked และไม่ฝัง secret/PII ที่ไม่จำเป็น", "", "", "", "", "", ""],
    ["•", "Workbook นี้เป็น Review candidate จนกว่าจะมีชื่อ/วันที่/decision/evidence ครบ", "", "", "", "", "", ""],
  ];
  s.getRange("B23:H27").merge(true);
  body(s.getRange("A23:H27"));
  s.getRange("A:A").format.columnWidth = 18;
  s.getRange("B:B").format.columnWidth = 24;
  s.getRange("C:H").format.columnWidth = 14;
  s.freezePanes.freezeRows(2);
}

// Run Control
{
  const s = sheets["Run Control"];
  titleBand(s, "H", "Run Control", "กรอกให้ครบก่อนเริ่มทดสอบ — ช่องว่างหมายถึง Entry Gate ยังไม่ผ่าน");
  section(s, 4, "H", "Baseline and environment");
  const fields = [
    ["Run ID", "", "Environment", "UAT", "Application version", payload.runtimeVersion || "1.0.0", "Source commit", sourceCommit],
    ["Source hash", "", "Test hash", "", "Configuration baseline", "", "Test data batch", ""],
    ["Frontend URL", "", "API URL", "", "SQL Server", "Unknown", "TruckScale MySQL", "Unknown"],
    ["WINSpeed connectivity", "Unknown", "Backup ID", "", "Evidence root", "", "Defect tracker", ""],
    ["Start date/time", "", "End date/time", "", "QA Lead", "", "Business Owner", ""],
    ["Release candidate", "No", "Change freeze", "No", "Entry decision", "Not Ready", "Decision evidence", ""],
  ];
  s.getRange("A5:H10").values = fields;
  for (const col of ["A", "C", "E", "G"]) header(s.getRange(`${col}5:${col}10`));
  for (const col of ["B", "D", "F", "H"]) body(s.getRange(`${col}5:${col}10`));
  s.getRange("F7:H8").dataValidation = { rule: { type: "list", values: ["Online", "Degraded", "Offline", "Unknown"] } };
  s.getRange("B10:D10").dataValidation = { rule: { type: "list", values: ["Yes", "No"] } };
  s.getRange("F10").dataValidation = { rule: { type: "list", values: ["Ready", "Not Ready", "Conditional"] } };
  section(s, 12, "H", "Entry checklist");
  s.getRange("A13:H13").values = [["ID", "Control", "Owner", "Status", "Evidence/Reference", "Reviewer", "Review date", "Comment"]];
  header(s.getRange("A13:H13"));
  const entry = [
    ["ENT-01", "Build/commit/source/test hash ถูกบันทึกและตรงกัน", "QA", "Not Checked", "", "", "", ""],
    ["ENT-02", "Frontend/API/SQL health ผ่านและ dependency state ถูกระบุ", "IT", "Not Checked", "", "", "", ""],
    ["ENT-03", "Test users/roles พร้อมและใช้ least privilege", "Admin/Security", "Not Checked", "", "", "", ""],
    ["ENT-04", "Synthetic/masked test data พร้อมและ reset ได้", "Data Owner", "Not Checked", "", "", "", ""],
    ["ENT-05", "Evidence root, defect tracker และ communication channel พร้อม", "QA", "Not Checked", "", "", "", ""],
    ["ENT-06", "Backup/rollback owner และ restore prerequisite พร้อม", "IT", "Not Checked", "", "", "", ""],
    ["ENT-07", "Required reviewers และ run schedule ได้รับการยืนยัน", "Business Owner", "Not Checked", "", "", "", ""],
  ];
  s.getRange(`A14:H${13 + entry.length}`).values = entry;
  body(s.getRange(`A14:H${13 + entry.length}`));
  s.getRange(`D14:D${13 + entry.length}`).dataValidation = { rule: { type: "list", values: ["Not Checked", "Pass", "Fail", "N/A"] } };
  s.getRange(`D14:D${13 + entry.length}`).conditionalFormats.add("containsText", { text: "Pass", format: { fill: COLORS.green, font: { color: COLORS.greenText, bold: true } } });
  s.getRange(`D14:D${13 + entry.length}`).conditionalFormats.add("containsText", { text: "Fail", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
  s.getRange("A:H").format.columnWidth = 16;
  s.getRange("B:B").format.columnWidth = 42;
  s.getRange("E:E").format.columnWidth = 34;
  s.freezePanes.freezeRows(13);
}

// UAT Cases
{
  const s = sheets["UAT Cases"];
  titleBand(s, "T", "UAT Cases", `${cases.length} controlled cases • Automated and manual acceptance • Status starts as Not Run`);
  s.getRange("A4:T4").values = [["Case ID", "Type", "Area", "Scenario / วัตถุประสงค์", "Requirement IDs", "Actor", "Critical", "Preconditions", "Test Data", "Test Steps", "Expected Result", "Required Evidence", "Automation Ref", "Status", "Actual Result", "Defect ID", "Tested By", "Test Date", "Reviewer", "Review Date"]];
  header(s.getRange("A4:T4"));
  const rows = cases.map((c) => [
    c.id, c.type, c.area, c.titleTh, (c.requirementIds || []).join(", "), c.actor, c.critical ? "Yes" : "No",
    c.preconditions, c.testData, (c.steps || []).map((x, i) => `${i + 1}. ${x}`).join("\n"), c.expected,
    c.evidence, c.automationRef || "Manual", c.status || "Not Run", "", "", "", "", "", "",
  ]);
  const last = 4 + rows.length;
  s.getRange(`A5:T${last}`).values = rows;
  body(s.getRange(`A5:T${last}`));
  s.getRange(`N5:N${last}`).dataValidation = { rule: { type: "list", formula1: "Lookups!$A$2:$A$6" } };
  s.getRange(`N5:N${last}`).conditionalFormats.add("containsText", { text: "Pass", format: { fill: COLORS.green, font: { color: COLORS.greenText, bold: true } } });
  s.getRange(`N5:N${last}`).conditionalFormats.add("containsText", { text: "Fail", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
  s.getRange(`N5:N${last}`).conditionalFormats.add("containsText", { text: "Blocked", format: { fill: COLORS.amber, font: { color: COLORS.amberText, bold: true } } });
  s.getRange(`G5:G${last}`).conditionalFormats.add("containsText", { text: "Yes", format: { fill: COLORS.amber, font: { color: COLORS.redText, bold: true } } });
  const t = s.tables.add(`A4:T${last}`, true, "UATCasesTable");
  t.style = "TableStyleMedium2";
  t.showBandedRows = true;
  const widths = [15, 12, 22, 42, 18, 20, 10, 40, 34, 54, 44, 40, 30, 13, 38, 15, 18, 15, 18, 15];
  "ABCDEFGHIJKLMNOPQRST".split("").forEach((col, i) => { s.getRange(`${col}:${col}`).format.columnWidth = widths[i]; });
  s.getRange(`A5:T${last}`).format.rowHeight = 78;
  s.freezePanes.freezeRows(4);
  s.freezePanes.freezeColumns(3);
}

// Full Loop
{
  const s = sheets["Full Loop"];
  titleBand(s, "J", "UAT Full Loop", "Cross-role control sheet — run in order and stop at failed hold points");
  s.getRange("A4:J4").values = [["Seq", "Case ID", "Role", "Business action", "Exit check / Hold point", "Evidence", "Status", "Defect", "Tester", "Date"]];
  header(s.getRange("A4:J4"));
  const primary = cases.filter((c) => /^UAT-E2E-00[2-6]$/.test(c.id));
  const manual = cases.filter((c) => ["UAT-MAN-001", "UAT-MAN-002", "UAT-MAN-003", "UAT-MAN-004", "UAT-MAN-005", "UAT-MAN-006", "UAT-MAN-007", "UAT-MAN-008"].includes(c.id));
  const loop = [...primary, ...manual].map((c, i) => [i + 1, c.id, c.actor, c.titleTh, c.expected, c.evidence, "Not Run", "", "", ""]);
  s.getRange(`A5:J${4 + loop.length}`).values = loop;
  body(s.getRange(`A5:J${4 + loop.length}`));
  s.getRange(`G5:G${4 + loop.length}`).dataValidation = { rule: { type: "list", formula1: "Lookups!$A$2:$A$6" } };
  s.getRange(`G5:G${4 + loop.length}`).conditionalFormats.add("containsText", { text: "Pass", format: { fill: COLORS.green, font: { color: COLORS.greenText, bold: true } } });
  s.getRange(`G5:G${4 + loop.length}`).conditionalFormats.add("containsText", { text: "Fail", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
  s.getRange(`G5:G${4 + loop.length}`).conditionalFormats.add("containsText", { text: "Blocked", format: { fill: COLORS.amber, font: { color: COLORS.amberText, bold: true } } });
  [8, 16, 24, 40, 46, 38, 13, 14, 18, 15].forEach((w, i) => s.getRange(`${String.fromCharCode(65 + i)}:${String.fromCharCode(65 + i)}`).format.columnWidth = w);
  s.getRange(`A5:J${4 + loop.length}`).format.rowHeight = 68;
  s.freezePanes.freezeRows(4);
  s.freezePanes.freezeColumns(2);
}

// Defects
{
  const s = sheets.Defects;
  titleBand(s, "L", "Defect & Retest Log", "Every Fail requires a defect; every closure requires retest evidence and reviewer");
  s.getRange("A4:L4").values = [["Defect ID", "UAT Case", "Severity", "Title", "Description / Actual", "Owner", "Target Date", "Status", "Retest Result", "Retest Evidence", "Reviewer", "Review Date"]];
  header(s.getRange("A4:L4"));
  const blank = Array.from({ length: 30 }, () => Array(12).fill(""));
  s.getRange("A5:L34").values = blank;
  body(s.getRange("A5:L34"));
  s.getRange("C5:C34").dataValidation = { rule: { type: "list", formula1: "Lookups!$B$2:$B$5" } };
  s.getRange("H5:H34").dataValidation = { rule: { type: "list", formula1: "Lookups!$C$2:$C$6" } };
  s.getRange("I5:I34").dataValidation = { rule: { type: "list", values: ["Not Retested", "Pass", "Fail", "Blocked"] } };
  s.getRange("C5:C34").conditionalFormats.add("containsText", { text: "Sev-1", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
  s.getRange("C5:C34").conditionalFormats.add("containsText", { text: "Sev-2", format: { fill: COLORS.amber, font: { color: COLORS.amberText, bold: true } } });
  const t = s.tables.add("A4:L34", true, "DefectsTable");
  t.style = "TableStyleMedium2";
  [16, 16, 12, 28, 42, 18, 15, 18, 16, 36, 18, 15].forEach((w, i) => s.getRange(`${String.fromCharCode(65 + i)}:${String.fromCharCode(65 + i)}`).format.columnWidth = w);
  s.getRange("A5:L34").format.rowHeight = 42;
  s.freezePanes.freezeRows(4);
}

// Evidence
{
  const s = sheets.Evidence;
  titleBand(s, "L", "Evidence Register", "Use controlled references and hashes; mask secrets and unnecessary personal data");
  s.getRange("A4:L4").values = [["Evidence ID", "UAT Case", "Run ID", "Type", "File / Controlled Link", "SHA-256", "Captured By", "Captured At", "Reviewer", "Review Date", "Classification", "Retention/Comment"]];
  header(s.getRange("A4:L4"));
  s.getRange("A5:L54").values = Array.from({ length: 50 }, () => Array(12).fill(""));
  body(s.getRange("A5:L54"));
  s.getRange("D5:D54").dataValidation = { rule: { type: "list", formula1: "Lookups!$E$2:$E$8" } };
  s.getRange("K5:K54").dataValidation = { rule: { type: "list", values: ["Confidential", "Internal", "Public"] } };
  const t = s.tables.add("A4:L54", true, "EvidenceTable");
  t.style = "TableStyleMedium2";
  [16, 16, 16, 16, 48, 46, 18, 20, 18, 16, 18, 34].forEach((w, i) => s.getRange(`${String.fromCharCode(65 + i)}:${String.fromCharCode(65 + i)}`).format.columnWidth = w);
  s.getRange("A5:L54").format.rowHeight = 36;
  s.freezePanes.freezeRows(4);
}

// Sign-off
{
  const s = sheets["Sign-off"];
  titleBand(s, "I", "UAT Sign-off & Go/No-Go", "Blank name/date/evidence means the gate is not passed");
  section(s, 4, "I", "Decision criteria");
  s.getRange("A5:I8").values = [
    ["Gate", "Rule", "Result", "Evidence", "Owner", "Reviewer", "Review date", "Risk/Exception", "Decision"],
    ["Critical cases", "100% Pass", "", "", "QA Lead", "", "", "", "Pending"],
    ["Overall cases", ">= 90% Pass", "", "", "QA Lead", "", "", "", "Pending"],
    ["Open defects", "No Sev-1/Sev-2", "", "", "QA + Owners", "", "", "", "Pending"],
  ];
  header(s.getRange("A5:I5"));
  body(s.getRange("A6:I8"));
  s.getRange("I6:I8").dataValidation = { rule: { type: "list", values: ["Pending", "Pass", "Fail", "Waived"] } };
  section(s, 10, "I", "Required approvals");
  s.getRange("A11:I11").values = [["Role", "Name", "Scope", "Decision", "Date", "Evidence / Signature", "Conditions", "Due Date", "Status"]];
  header(s.getRange("A11:I11"));
  const approvals = [
    ["Sales Process Owner", "", "Sales/customer/order", "Pending", "", "", "", "", "Open"],
    ["Manager/Admin Owner", "", "Approval/audit", "Pending", "", "", "", "", "Open"],
    ["Counter/Weighbridge Owner", "", "TruckScale/queue", "Pending", "", "", "", "", "Open"],
    ["Warehouse Owner", "", "Pick/load/ship", "Pending", "", "", "", "", "Open"],
    ["Accounting/WINSpeed Owner", "", "Reconciliation/rebate/CN", "Pending", "", "", "", "", "Open"],
    ["IT/Security/Operations", "", "Security/performance/BCP", "Pending", "", "", "", "", "Open"],
    ["QA Lead", "", "Test/evidence/defects", "Pending", "", "", "", "", "Open"],
    ["Business Sponsor", "", "Final Go/No-Go", "Pending", "", "", "", "", "Open"],
  ];
  s.getRange("A12:I19").values = approvals;
  body(s.getRange("A12:I19"));
  s.getRange("D12:D19").dataValidation = { rule: { type: "list", formula1: "Lookups!$D$2:$D$5" } };
  s.getRange("I12:I19").dataValidation = { rule: { type: "list", values: ["Open", "Complete", "Rejected"] } };
  section(s, 21, "I", "Final decision");
  s.getRange("A22:I25").values = [
    ["Decision", "Pending", "Decision date", "", "Effective build", "", "Approver", "", ""],
    ["Conditions / residual risks", "", "", "", "", "", "", "", ""],
    ["Rollback / contingency reference", "", "", "", "", "", "", "", ""],
    ["Decision evidence / meeting record", "", "", "", "", "", "", "", ""],
  ];
  s.getRange("B23:I25").merge(true);
  for (const col of ["A", "C", "E", "G"]) header(s.getRange(`${col}22`));
  body(s.getRange("A22:I25"));
  s.getRange("B22").dataValidation = { rule: { type: "list", values: ["Pending", "Go", "Conditional Go", "No-Go"] } };
  [26, 22, 30, 20, 16, 34, 32, 16, 14].forEach((w, i) => s.getRange(`${String.fromCharCode(65 + i)}:${String.fromCharCode(65 + i)}`).format.columnWidth = w);
  s.freezePanes.freezeRows(11);
}

// Lookups
{
  const s = sheets.Lookups;
  titleBand(s, "F", "Controlled Lookups", "Values used by data validation — change only through reviewed source/template update");
  s.getRange("A4:F4").values = [["UAT Status", "Severity", "Defect Status", "Decision", "Evidence Type", "Critical"]];
  header(s.getRange("A4:F4"));
  const matrix = [
    ["Not Run", "Sev-1", "Open", "Pending", "Screenshot", "Yes"],
    ["Pass", "Sev-2", "In Progress", "Accept", "Playwright Attachment", "No"],
    ["Fail", "Sev-3", "Ready for Retest", "Conditional Accept", "API/Query Extract", ""],
    ["Blocked", "Sev-4", "Closed", "Reject", "Log", ""],
    ["N/A", "", "Rejected", "", "Reconciliation", ""],
    ["", "", "", "", "Signed Form", ""],
    ["", "", "", "", "Other", ""],
  ];
  s.getRange("A5:F11").values = matrix;
  body(s.getRange("A5:F11"));
  s.getRange("A:F").format.columnWidth = 24;
  s.freezePanes.freezeRows(4);
}

// Dashboard is created after source sheets so formulas can reference them.
{
  const s = sheets.Dashboard;
  titleBand(s, "L", "UAT Dashboard", "Live formulas from UAT Cases and Defects • Do not use as approval without evidence review");
  section(s, 4, "F", "Case status");
  s.getRange("A5:B10").values = [["Metric", "Value"], ["Total", ""], ["Pass", ""], ["Fail", ""], ["Blocked", ""], ["Not Run", ""]];
  header(s.getRange("A5:B5"));
  body(s.getRange("A6:B10"));
  const last = 4 + cases.length;
  s.getRange("B6:B10").formulas = [
    [`=COUNTA('UAT Cases'!$A$5:$A$${last})`],
    [`=COUNTIF('UAT Cases'!$N$5:$N$${last},"Pass")`],
    [`=COUNTIF('UAT Cases'!$N$5:$N$${last},"Fail")`],
    [`=COUNTIF('UAT Cases'!$N$5:$N$${last},"Blocked")`],
    [`=COUNTIF('UAT Cases'!$N$5:$N$${last},"Not Run")`],
  ];
  s.getRange("D5:F10").values = [
    ["Quality gate", "Target", "Result"],
    ["Critical pass", "100%", ""],
    ["Overall pass", ">=90%", ""],
    ["Sev-1 open", "0", ""],
    ["Sev-2 open", "0", ""],
    ["Final readiness", "All manual gates + signatures", "Pending"],
  ];
  header(s.getRange("D5:F5"));
  body(s.getRange("D6:F10"));
  s.getRange("F6").formulas = [[`=IF(COUNTIFS('UAT Cases'!$G$5:$G$${last},"Yes",'UAT Cases'!$N$5:$N$${last},"<>Pass")=0,"PASS","NOT READY")`]];
  s.getRange("F7").formulas = [[`=IF(B6=0,"NOT READY",IF(B7/B6>=0.9,"PASS","NOT READY"))`]];
  s.getRange("F8").formulas = [[`=COUNTIFS(Defects!$C$5:$C$34,"Sev-1",Defects!$H$5:$H$34,"<>Closed")`]];
  s.getRange("F9").formulas = [[`=COUNTIFS(Defects!$C$5:$C$34,"Sev-2",Defects!$H$5:$H$34,"<>Closed")`]];
  s.getRange("F6:F10").conditionalFormats.add("containsText", { text: "PASS", format: { fill: COLORS.green, font: { color: COLORS.greenText, bold: true } } });
  s.getRange("F6:F10").conditionalFormats.add("containsText", { text: "NOT READY", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
  section(s, 12, "L", "Manual acceptance gates");
  s.getRange("A13:L13").values = [["Gate", "TruckScale Online", "WINSpeed Reconcile", "Rebate/CN", "Giveaway", "Paper Exception", "Backup/Restore", "RBAC/Security", "Performance", "Evidence Review", "Signatures", "Final"]];
  header(s.getRange("A13:L13"));
  s.getRange("A14:L14").values = [["Status", "Pending", "Pending", "Pending", "Pending", "Pending", "Pending", "Pending", "Pending", "Pending", "Pending", "Pending"]];
  body(s.getRange("A14:L14"));
  s.getRange("B14:L14").dataValidation = { rule: { type: "list", values: ["Pending", "Pass", "Fail", "N/A"] } };
  s.getRange("B14:L14").conditionalFormats.add("containsText", { text: "Pass", format: { fill: COLORS.green, font: { color: COLORS.greenText, bold: true } } });
  s.getRange("B14:L14").conditionalFormats.add("containsText", { text: "Fail", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
  s.getRange("A:L").format.columnWidth = 17;
  s.getRange("A:A").format.columnWidth = 22;
  s.getRange("D:D").format.columnWidth = 22;
  s.freezePanes.freezeRows(2);
}

const exported = await SpreadsheetFile.exportXlsx(wb);
await exported.save(outputPath);

const inspection = await wb.inspect({
  kind: "workbook,sheet,table,formula",
  include: "id,name,range,values,formulas",
  maxChars: 16000,
  tableMaxRows: 5,
  tableMaxCols: 10,
  tableMaxCellChars: 120,
});
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  maxChars: 5000,
});
await fs.writeFile(`${outputPath}.inspection.ndjson`, `${inspection.ndjson}\n${errors.ndjson}\n`, "utf8");

if (previewDir) {
  for (const name of Object.keys(sheets)) {
    const image = await wb.render({ sheetName: name, autoCrop: "all", scale: 1.25, format: "png" });
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await fs.writeFile(path.join(previewDir, `${safe}.png`), new Uint8Array(await image.arrayBuffer()));
  }
}

console.log(JSON.stringify({ output: outputPath, previews: previewDir, cases: cases.length, sourceCommit, generatedAt }, null, 2));
if (previewDir) process.exit(0);
