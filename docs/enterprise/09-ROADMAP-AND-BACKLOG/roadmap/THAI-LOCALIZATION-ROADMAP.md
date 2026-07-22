---
documentId: "WF-APP-004"
title: "Thai Accounting & Business Localization Roadmap (Future Scope)"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Draft"
sourceStatusDetail: "Roadmap — ยังไม่ implement (สำหรับวางแผน/เสนอขาย)"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Product Owner / Solution Architect"
normative: false
---
# Thai Accounting & Business Localization Roadmap (Future Scope)

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-APP-004` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. (+ future Thai SME/Enterprise customers) |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Product Owner / Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.

> เอกสารนี้เป็น **roadmap** สำหรับต่อยอด WS-Sale-App ให้รองรับระบบบัญชีไทยและองค์กรธุรกิจไทยเต็มรูปแบบ เพื่อขาย/ปรับแต่งให้ลูกค้ารายอื่น — **ไม่อยู่ในขอบเขต implement ปัจจุบัน** (ปัจจุบันใช้ WINSpeed เป็น system of record บัญชี)

---

## 1. เป้าหมายเชิงผลิตภัณฑ์
ปัจจุบัน WS-Sale-App เป็น operational layer ที่ "ไม่ทำบัญชีเอง" (WINSpeed ออกใบกำกับ/GL) — เหมาะกับลูกค้าที่ใช้ WINSpeed อยู่แล้ว
เพื่อขายลูกค้ารายอื่น (ที่ไม่มี/ไม่ผูก WINSpeed) ต้องเพิ่มความสามารถ 2 ทาง:
- **A) Accounting Adapter** — เชื่อมระบบบัญชีไทยยอดนิยมแทน WINSpeed (pluggable)
- **B) Thai Tax/Compliance Core** — จัดการภาษี/เอกสารตามกรมสรรพากร & DBD ในตัว (เมื่อลูกค้าไม่มี ERP)

> หลักการคงเดิม: สถาปัตยกรรม layered + adapter — ไม่ผูกตาย WINSpeed (ดู ADR-001/003)

## 2. โมดูลที่ต้องเพิ่ม (Capability Map)

### 2.1 Thai Tax Core (ภาษีไทย)
| ความสามารถ | รายละเอียด | เอกสาร/แบบ |
|---|---|---|
| VAT เต็มรูป | output/input VAT 7% (ไม่ใช่แค่ยกเว้นปุ๋ย), VAT type 1/3/7, รายงานภาษีขาย-ซื้อ | ใบกำกับภาษี, ภพ.30 |
| ใบกำกับภาษีเต็มรูป/อย่างย่อ | running per สาขา, สำเนา/ต้นฉบับ, ยกเลิก/แก้ไข | RD format |
| ภาษีหัก ณ ที่จ่าย (WHT) | คำนวณ + ออกหนังสือรับรอง (50 ทวิ), ประเภท ภงด.3/53 | ภงด.1/3/53 |
| CN/DN ภาษี | ใบเพิ่ม/ลดหนี้ผูกภาษี + อ้างใบกำกับเดิม | RD |
| ปิดงวดภาษี | สรุปภาษีรายเดือน + ล็อกงวด | — |

### 2.2 e-Tax & RD Integration (สรรพากรอิเล็กทรอนิกส์)
| ความสามารถ | รายละเอียด |
|---|---|
| e-Tax Invoice & e-Receipt | ออกใบกำกับ/ใบเสร็จอิเล็กทรอนิกส์ + ลายเซ็นดิจิทัล (digital signature/seal) ส่ง RD |
| e-Tax by Email | สำหรับ SME — ผ่านระบบ ETDA/RD |
| e-Withholding Tax (e-WHT) | ส่งหัก ณ ที่จ่ายผ่านธนาคาร |
| RD e-Filing | ยื่น ภพ.30 / ภงด. อัตโนมัติ/กึ่งอัตโนมัติ |

### 2.3 Accounting Adapter (เชื่อมบัญชีไทย แทน WINSpeed)
| ระบบเป้าหมาย | วิธีเชื่อม |
|---|---|
| PEAK, FlowAccount, AccCloud | REST API (cloud) |
| Express, WINSpeed, Prosoft ibiz | DB/import/SP adapter |
| SAP Business One, Dynamics 365 BC | API/connector |
| โหมด "ไม่มี ERP" | Thai Accounting Core ในตัว (GL + ผังบัญชี + งบ) |

### 2.4 Thai Business Org (องค์กรธุรกิจไทย)
| ความสามารถ | รายละเอียด |
|---|---|
| Multi-branch (สาขา) | รหัสสาขา 5 หลักตาม RD, running เอกสารแยกสาขา |
| Multi-company / multi-tenant | แยกข้อมูลต่อนิติบุคคล + config ต่อราย |
| Thai master | เลขผู้เสียภาษี 13 หลัก (validate), ที่อยู่ไทย (ตำบล/อำเภอ/จังหวัด/ไปรษณีย์), พ.ศ./ค.ศ. |
| Thai numbering | running เอกสารตามแบบไทย + reset รายปี/เดือน |
| ผังบัญชีไทย | chart of accounts มาตรฐาน + mapping GL |

### 2.5 Reporting & Compliance (รายงานตามกฎหมาย)
| รายงาน | ใช้กับ |
|---|---|
| รายงานภาษีขาย / ภาษีซื้อ | สรรพากร |
| ภพ.30, ภงด.1/3/53 | ยื่นภาษี |
| งบการเงิน (DBD e-Filing) | กรมพัฒนาธุรกิจการค้า |
| ประกันสังคม (สปส.1-10) | ประกันสังคม |
| รายงานสินค้าคงเหลือ/Stock card | RD ม.83/87 |

### 2.6 Inventory & Costing (ต้นทุนตามมาตรฐานไทย)
- วิธีต้นทุน FIFO / ถัวเฉลี่ยถ่วงน้ำหนัก (เลือกได้), stock card ตามกฎหมาย
- รองรับ TFRS for NPAEs / PAEs

## 3. แนวสถาปัตยกรรม (Architecture Direction)
- เพิ่ม schema/โมดูล `wf.tax`, `wf.localization`, `wf.gl_adapter` (แยกจาก core)
- **Accounting Connector Interface** — abstract การ post บัญชี (WINSpeed = หนึ่ง implementation; PEAK/FlowAccount/Core = implementation อื่น)
- **Tax Rule Engine** — config-driven (อัตราภาษี/ประเภท/เงื่อนไข) ปรับต่อประเทศ/ลูกค้าได้
- **Localization Pack** — ภาษา/วันที่/เลขที่/ฟอร์แมตเอกสารต่อ locale
- คงหลักการ Non-Invasive + audit + RBAC เดิม

## 4. Phasing (ข้อเสนอเฟส)
| เฟส | ขอบเขต | ผลลัพธ์ |
|---|---|---|
| **L1** | Thai Tax Core (VAT/WHT/ใบกำกับ/CN-DN) + multi-branch | ขายลูกค้าที่ต้องออกภาษีเองได้ |
| **L2** | e-Tax Invoice/e-Receipt + e-WHT + RD e-Filing | ครบ compliance อิเล็กทรอนิกส์ |
| **L3** | Accounting Adapter (PEAK/FlowAccount/SAP B1/D365) + GL mapping | เชื่อมบัญชีลูกค้าที่มีอยู่ |
| **L4** | Thai Accounting Core (GL/ผังบัญชี/งบ/DBD) + costing | โหมด standalone ไม่ต้องมี ERP |
| **L5** | Multi-tenant productization + localization pack | ขายเป็นผลิตภัณฑ์ SaaS หลายลูกค้า |

## 5. การกำกับ/ข้อควรพิจารณา
- ทุกเฟสต้องผ่าน gate เดียวกับ v7 (security/DR/UAT) และเพิ่ม **tax compliance test** (เทียบกับแบบ RD จริง)
- ต้องมี **ที่ปรึกษาบัญชี/ภาษีไทย** ร่วม validate ก่อน L1 go-live
- e-Tax ต้องขึ้นทะเบียนผู้ออกใบกำกับอิเล็กทรอนิกส์กับ RD + certificate (CA)
- multi-tenant: data isolation, per-tenant config, billing model
- อ้าง [OPEN-DECISIONS-REGISTER](../OPEN-DECISIONS-REGISTER.md) สำหรับ decision ที่เกี่ยวข้อง (DG-01 accounting boundary)

> สถานะ: roadmap เพื่อวางแผนเชิงพาณิชย์ · เริ่ม implement เมื่อมีลูกค้า/สัญญายืนยันเฟส
