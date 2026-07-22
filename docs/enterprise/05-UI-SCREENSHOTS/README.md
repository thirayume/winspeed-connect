---
documentId: "WF-EVD-001"
title: "05-UI-SCREENSHOTS — ภาพหน้าจอระบบจริง (v1.0)"
version: "v1.0"
status: Review
owner: "QA Lead"
normative: true
---
# 05-UI-SCREENSHOTS — ภาพหน้าจอระบบจริง (v1.0)

| รายการ | รายละเอียด |
|---|---|
| Version | v1.0 · App 1.0.0 |
| Capture | 21 กรกฎาคม 2569 · Playwright (headless Chromium @2x, 1600×1000, locale th-TH) |
| Source | `http://localhost:5173` (dev) · authenticated (UAT Test Admin / ADMIN) |
| จำนวน | 21 จอ ตาม `06-QUALITY-OPERATIONS/TEST-CATALOG-CURRENT.md` |

## รายการภาพ

| ไฟล์ | หน้าจอ | กลุ่มเมนู |
|---|---|---|
| 01-dashboard | Dashboard | หลัก |
| 02-sales-pos | Sales Portal (ขาย/POS) | หลัก |
| 03-quotation | ใบเสนอราคา | หลัก |
| 04-warehouse | คลัง (Picking/Receiving) | หลัก |
| 05-paper-trail | Paper Trail | หลัก |
| 06-aging | ตั๋วคงค้าง (Aging) | หลัก |
| 07-rebate-app | รีเบท (App) | การเงิน |
| 08-rebate-plan | Rebate Plan | การเงิน |
| 09-cn-rebate | CN Rebate | การเงิน |
| 10-giveaway | ของแถม | การเงิน |
| 11-accounting | บัญชี | บัญชี |
| 12-recon | กระทบยอด | บัญชี |
| 13-reports | รายงาน | บัญชี |
| 14-voucher | ชุดตั๋วคุม / Voucher | บัญชี |
| 15-truckscale | TruckScale | คลัง/ชั่ง |
| 16-weigh-inbox | Weigh Inbox | คลัง/ชั่ง |
| 17-master-data | ข้อมูลหลัก | ตั้งค่าระบบ |
| 18-approval-policy | นโยบายอนุมัติ | ตั้งค่าระบบ |
| 19-data-governance | กำกับข้อมูล (PDPA) | ตั้งค่าระบบ |
| 20-ops-status | สถานะระบบ | ตั้งค่าระบบ |
| 21-users | ผู้ใช้งาน | ตั้งค่าระบบ |

> ภาพชุด v6 เดิม (montage/architecture ฯลฯ) ย้ายไป `_archive/superseded-binaries/ui-screenshots-v6/`
> **วิธี re-capture:** login แอปใน Chrome → export auth → `node capture.js` (สคริปต์ใน pipeline/uicap; ใช้ session token, ไม่กรอกรหัสผ่าน)
