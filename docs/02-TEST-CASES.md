# 02 — Test Cases (กรณีทดสอบ)

> สำหรับ UAT / Regression / ISO 9001 · build v4.2.26
> รูปแบบ: **TC-รหัส | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role | ผ่าน/ไม่ผ่าน**
> วิธีบันทึกผล: คัดลอกตารางลง Excel/แบบฟอร์ม แล้วกรอกคอลัมน์ "ผล/วันที่/ผู้ทดสอบ"

## วิธีเตรียมทดสอบ
1. เข้าระบบด้วย user ตาม Role ที่ระบุ (ดู [03-USER-GUIDE.md](03-USER-GUIDE.md))
2. ตรวจปุ่มสลับ DB (ADMIN) = REMOTE สำหรับ production data หรือ LOCAL สำหรับ dev
3. TruckScale: ดูแถบสถานะ "เชื่อมต่อแล้ว" ที่หน้า TruckScale ก่อนทดสอบ

---

## A. Authentication & RBAC
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-A01 | เข้าระบบสำเร็จ | กรอก user/pass ถูก → Login | เข้าได้ เห็นเมนูตาม Role | ทุก |
| TC-A02 | รหัสผิด | กรอก pass ผิด | แจ้ง error ไม่เข้าระบบ | ทุก |
| TC-A03 | เมนูตาม Role | เข้าด้วย SALES | ไม่เห็นเมนู Rebate Plan/Reports/Admin/Master | SALES |
| TC-A04 | Token หมดอายุ | ทิ้งไว้เกินเวลา → เรียก API | เด้งออก/แจ้งหมดอายุ | ทุก |

## B. ขาย / SO (POS)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-B01 | สร้าง SO ใหม่ | เลือกลูกค้า → เพิ่มสินค้า → ระบุตัน/ทะเบียนรถ → บันทึก | SO สถานะ DRAFT, WfRef ออกเลข | SALES |
| TC-B02 | แสดง Rebate ขณะคีย์ | เพิ่มสินค้าที่ราคาขาย>NET | เห็น Rebate/ตัน + ยอดรวม real-time | SALES |
| TC-B03 | ของแถม | เพิ่มรายการของแถม (GoodPrice2=0) | ไม่คิดเงิน, ไม่ตั้ง rebate | SALES |
| TC-B04 | ตัดจากตั๋วคุม | เลือกตั๋วคุม (AI) → เพิ่มสินค้า | line อ้าง RefControlTicketNo | SALES |
| TC-B05 | ใช้ Rebate เป็นส่วนลด | ระบุ RebateDiscountAmt ตอน confirm | ตัด FIFO จาก RebateLedger ของลูกค้า | SALES |

## C. Verification Gate + State Machine (FR-022)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-C01 | confirm โดยยังไม่ตรวจ | SO DRAFT (ยังไม่ verify) → กดยืนยัน | **ถูกบล็อก** "ต้องตรวจซ้ำก่อนยืนยัน" | SALES |
| TC-C02 | ตรวจแล้ว (verify) | Paper Trail → การ์ด DRAFT → "ตรวจแล้ว" | ขึ้น ✓ ตรวจแล้ว, VerifiedAt บันทึก | COUNTER_SALES |
| TC-C03 | confirm หลัง verify | verify แล้ว → ยืนยัน | SO → CONFIRMED, เขียน `dbo.SOHD/SODT` เป็น WINSpeed WF `DocuType=103` (ไม่ใช่ 112), มียอดคงเหลือให้ WF menus ทำต่อ | SALES |
| TC-C04 | ADMIN bypass | ADMIN ยืนยัน SO ที่ยังไม่ verify | ผ่านได้ (bypass) | ADMIN |
| TC-C05 | audit | ดูประวัติ SO | มี VERIFIED/CONFIRMED ครบ (actor/time) | ADMIN |

## D. คลัง / Store + Weigh + TruckScale
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-D01 | เริ่มรับสินค้า | CONFIRMED → "เริ่มรับสินค้า" | SO → PICKING, dbo.SOHD PkgStatus=Y | WAREHOUSE |
| TC-D02 | ระบุลำดับโหลดแม่-ลูก | กำหนด sequence ต่อ line | LoadSequence บันทึก | WAREHOUSE |
| TC-D03 | ชั่งออก (manual) | ใส่ tare/gross (kg) + เครื่องชั่ง → ยืนยัน | net คำนวณ, SO → SHIPPED, wf.WeighTicket บันทึก | WEIGHBRIDGE |
| TC-D04 | **ดึงจาก TruckScale** | กด "ดึงน้ำหนักจาก TruckScale" | แสดงใบชั่งที่ทะเบียนตรงกับ SO | WEIGHBRIDGE |
| TC-D05 | เลือกใบชั่ง autofill | เลือกใบชั่ง 1 ใบ | tare/gross/scale/movebill เติมอัตโนมัติ | WEIGHBRIDGE |
| TC-D06 | ยืนยันหลัง autofill | กดยืนยัน/ส่งออก | SHIPPED + WeighTicket มี Movebill + net จริง | WEIGHBRIDGE |

## E. Unlock Request (FR-006/007)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-E01 | ขอปลดล็อก | การ์ด PICKING → "ขอปลดล็อก" → เหตุผล <10 ตัว | **ถูกปฏิเสธ** ต้อง ≥10 ตัว | WAREHOUSE |
| TC-E02 | ขอปลดล็อก (สำเร็จ) | เหตุผล ≥10 ตัว → ส่ง | สร้าง UnlockRequest PENDING + แจ้งเตือน | WAREHOUSE |
| TC-E03 | ขอซ้ำ | ขออีกครั้งขณะ PENDING | บล็อก "มีคำขอที่รออนุมัติแล้ว" | WAREHOUSE |
| TC-E04 | อนุมัติ | Paper Trail → "คำขอปลดล็อก (n)" → อนุมัติ | SO กลับ CONFIRMED, **reverse RebateLedger** (ReversedFlag=1 ไม่ลบ) | APPROVER |
| TC-E05 | ปฏิเสธ | กดปฏิเสธ + เหตุผล | UnlockRequest=REJECTED, SO คงสถานะ | APPROVER |

## F. Paper Trail — เอกสาร 4 สี + QR + Scan (FR-004/012/013)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-F01 | พิมพ์ 4 สี | การ์ด → "พิมพ์ 4 สี" | เห็น 4 สำเนา (ขาว/ฟ้า/ชมพู/เหลือง) + QR ต่างกัน | ทุก |
| TC-F02 | พิมพ์จริง | กด "พิมพ์" | browser print 4 หน้า (แต่ละสีหน้าใหม่) | ทุก |
| TC-F03 | scan → IN_TRANSIT | "สแกนเอกสาร" → กรอก QR → กำลังส่ง | สถานะสำเนา → IN_TRANSIT, log scan | WAREHOUSE |
| TC-F04 | scan → SIGNED | สแกน + เซ็นรับ | → SIGNED, เห็นในประวัติ | ทุก |
| TC-F05 | แจ้งหาย | สแกน + LOST | สำเนา=LOST, ขึ้น alert "ใบค้าง/หาย" | ทุก |
| TC-F06 | alert ค้างนาน | สำเนา PRINTED >3 วัน | ปรากฏใน /lost + badge | ทุก |

## G. Rebate (฿) — Accrual / FIFO / Claim (FR-010/011)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-G01 | accrual ตอน confirm | confirm SO ที่ราคาขาย>NET | RebateLedger = (ขาย−NET)×ตัน, Pool.AccruedAmt เพิ่ม | SALES |
| TC-G02 | ดู Pool/Ledger | เปิดหน้า รีเบท → เลือก pool | เห็น ledger FIFO เรียงเก่า→ใหม่ | ทุก |
| TC-G03 | ยื่นเคลม | เลือก pool → ยื่นเคลม ≤ ใช้ได้ | ตัด FIFO, ClaimedAmt เพิ่ม, Claim=PENDING | SALES |
| TC-G04 | เคลมเกิน | ยื่นเกินยอดใช้ได้ | บล็อก แจ้งยอดเกิน | SALES |
| TC-G05 | อนุมัติ + Ref | บัญชีอนุมัติ claim + กรอกเลขอ้างอิง WINSpeed เมื่อมี | Claim=APPROVED, CnDocuNo บันทึกเป็น WINSpeed Ref | ACCOUNTING |

## H. Rebate Plan + Allocation (FR-008/009)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-H01 | สร้าง Plan | กรอกสูตร/ภาค/ประเภท/งบ → สร้าง | Plan=DRAFT, PlanNo (RP69-xxx) | MANAGER |
| TC-H02 | เปิดใช้งาน | กด ▶ (activate) | Plan=ACTIVE | MANAGER |
| TC-H03 | จัดสรรงบ | เลือกพนักงาน + จำนวน | Pool.AllocatedAmt เพิ่ม + log allocation | MANAGER |
| TC-H04 | accrual match Plan | confirm SO สูตรตรง Plan ACTIVE | RebateLedger.PlanId/Region ถูก tag | SALES |
| TC-H05 | ปิด Plan | กด ⬛ (close) | Plan=CLOSED, ไม่ match accrual ใหม่ | MANAGER |

## I. WF Rebate Trail (dbo, อ่าน) (FR — ประวัติ)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-I01 | สรุปตามพนักงาน | เปิด WF Rebate Trail | เห็นยอดรวมคูปอง/การใช้สิทธิ์/ใบกำกับต่อพนักงานขาย (จาก dbo จริง) | ACCOUNTING |
| TC-I02 | กรองปี | เลือกปี | รายการกรองตามปี | ACCOUNTING |
| TC-I03 | drill WF trail | คลิกพนักงาน → SO → detail | เห็น trail ใบจอง/ใบสั่งขาย → คูปอง → Redemption → Invoice/Receipt/GL | ACCOUNTING |

## J. Voucher (dbo WFCoupon, อ่าน)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-J01 | สรุปคูปอง | เปิด Voucher | ยอดคงค้าง (ตัน) ต่อพนักงานขาย | ทุก |
| TC-J02 | drill ลูกค้า→ใบ | คลิกพนักงาน → ลูกค้า → ใบคูปอง | เห็นใบคูปอง (ออก/เบิก/คงเหลือ) | ทุก |

## K. ชุดตั๋วคุม / Control Ticket (FR-021)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-K01 | รายการคงค้าง | เปิด ชุดตั๋วคุม | เห็นตั๋ว AI ที่ Total>Drawn + bar คงเหลือ | ทุก |
| TC-K02 | ค้นหา | พิมพ์ลูกค้า/เลขตั๋ว | กรองถูกต้อง | ทุก |
| TC-K03 | drill | คลิกตั๋ว | เห็นรายการสินค้า + **ประวัติการตัด** (SO 104) | ทุก |

## L. ของแถม / Giveaway (FR-020)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-L01 | งบรายภาค | เปิด ของแถม | เห็นงบ/เบิก/คงเหลือ ต่อภาค→พนักงาน | ทุก |
| TC-L02 | เบิก | เบิกของแถม ≤ งบ | คงเหลือลด | SALES |
| TC-L03 | เบิกเกินงบ | เบิก > งบ | อนุญาต (ติดลบ) + **เตือน** | SALES |

## M. Reports + Excel (FR-017)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-M01 | เลือกรายงาน | เปิด รายงาน → เลือกชนิด | ตารางแสดงข้อมูล | ACCOUNTING |
| TC-M02 | Export Excel | กด Export Excel | ดาวน์โหลด .xlsx เปิดได้ หัวตารางไทย | ACCOUNTING |
| TC-M03 | ครบ 5 ชนิด | ทดสอบ so-status/rebate-pools/giveaway/paper-status/cn-rebate (WF Rebate Trail) | ทุกชนิดมีข้อมูล/ส่งออกได้ | ACCOUNTING |

## N. TruckScale (MySQL live) (FR-024/025/026)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-N01 | สถานะเชื่อมต่อ | เปิด TruckScale | แถบ "เชื่อมต่อแล้ว · NNN,NNN ใบชั่ง" | WEIGHBRIDGE |
| TC-N02 | ค้นด้วยทะเบียน | เลือก "ทะเบียนรถ" → พิมพ์ → ค้นหา | แสดงใบชั่ง (in/out/net kg) | WEIGHBRIDGE |
| TC-N03 | ค้นด้วย movebill | เลือก movebill → พิมพ์เลข | แสดงใบชั่งตรงเลข | WEIGHBRIDGE |
| TC-N04 | รายละเอียด | คลิกแถว | เห็นน้ำหนัก + สินค้าในใบชั่ง | WEIGHBRIDGE |
| TC-N05 | ไม่เชื่อมต่อ (negative) | ปิด MYSQL_* แล้วเปิดหน้า | แถบ "เชื่อมต่อไม่ได้" ไม่ crash | ADMIN |

## O. Admin / Master
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง | Role |
|----|-----------|---------|--------------|------|
| TC-O01 | สร้าง user + map พนักงาน | Admin → เพิ่ม user + EmpId | user ใช้งานได้ | ADMIN |
| TC-O02 | แก้ราคา NET (Price Book) | Master → Prices → แก้ราคา | บันทึก dbo.EMSetPriceDT, ราคาใหม่ใช้คำนวณ rebate | ADMIN |
| TC-O03 | clone ราคาเดือนถัดไป | bulk-extend | สร้างชุดราคาใหม่ตามเดือน | ADMIN |

## P. ข้ามระบบ (Integration / Non-functional)
| TC | สถานการณ์ | ขั้นตอน | ผลที่คาดหวัง |
|----|-----------|---------|--------------|
| TC-P01 | สลับ DB LOCAL/REMOTE | ADMIN สลับปุ่ม | ทุกหน้าตามแหล่งที่เลือก (ไม่ปนกัน) |
| TC-P02 | Realtime | 2 จอ: จอ A เปลี่ยนสถานะ SO | จอ B อัปเดต (Socket.IO) |
| TC-P03 | LOCAL=REMOTE schema | รัน migrate ทั้ง 2 | 0 errors, view/sp checksum ตรงกัน |
| TC-P04 | dbo READ-ONLY (ยกเว้นที่ระบุ) | ตรวจว่าไม่มีการเขียน dbo นอกเหนือ confirm/picking/ship/cancel/prices | GL ยังออกโดย WINSpeed |

---

## Current Addendum - 2026-07-08 Test Cases

| TC | Scenario | Steps | Expected Result | Role |
|---|---|---|---|---|
| TC-A05 | LINE Login first-time self-link | Click `Login with LINE` using a new LINE account, then enter an existing active username/password | LINE is linked to that `wf.AppUser` and user logs in with existing role | Any |
| TC-A06 | LINE Login already linked | Click `Login with LINE` after self-link is complete | User logs in with mapped `wf.AppUser` role | Any |
| TC-B06 | SO requested/transport flags | Create SO with requested date/time, own truck/no truck/P-Sling | Values persist and show in detail | SALES |
| TC-B07 | 5-level price color | Enter prices above/equal/below Set Price | Color band matches green/light-green/yellow/orange/red rule | SALES |
| TC-B08 | Giveaway confirm block | Tick giveaway line and confirm before approval | Confirm is blocked with manager approval message | SALES |
| TC-B09 | Giveaway approval pass | Manager/Admin approves giveaway line, then confirm | Confirm succeeds and line shows approved | MANAGER |
| TC-H06 | Rebate Plan Ref Doc | Create/edit plan with Ref Doc fields | Ref Doc is saved and reloaded | MANAGER |
| TC-O04 | Customer request create | Master Data > Customers > create new customer request | `wf.CustomerRequest` row is PENDING; no `dbo.EMCust` auto-write | ADMIN |
| TC-O05 | Customer request close | Admin completes request with WINSpeed customer id | Request becomes COMPLETED with `WinspeedCustId` | ADMIN |
| TC-O06 | LINE support override | Admin edits user and clears/replaces LINE User ID for a support case | `wf.AppUser.LineUserId` remains unique and user can self-link again if cleared | ADMIN |
| TC-P05 | Migration batch 031-035 | After DB restore, apply migrations 031-035 and restart backend | SO/Rebate/Giveaway/CustomerRequest/LINE Login features are available | IT |

## Current Addendum - 2026-07-13 Automated QA / Access As

| TC | Scenario | Steps | Expected Result | Role |
|---|---|---|---|---|
| TC-A07 | Access As candidate list | Login as Admin/Manager/Accounting/Approver/Counter Sale and open the Access As control in the topbar | User sees only same-or-lower allowed roles according to the role hierarchy | ADMIN, MANAGER, ACCOUNTING, APPROVER, COUNTER_SALES |
| TC-A08 | Access As effective permissions | Select a lower-role user and open Sales Portal/Dashboard | Menus, customer visibility, and data access follow the effective user, not the real actor | ADMIN, MANAGER, ACCOUNTING, APPROVER, COUNTER_SALES |
| TC-A09 | Access As audit | Start Access As, perform a small read/write action, then stop Access As | `wf.AccessAsAudit` records START/STOP; `wf.ApiAuditLog` records actor and effective user | IT, ADMIN |
| TC-A10 | Refresh with token | Login, refresh with F5/CTRL+F5, then test an expired/invalid token scenario | Valid token keeps the session; invalid token redirects to Login cleanly | Any |
| TC-QA01 | Query smoke | Run `npm run smoke:queries` after DB restore/migration | Dashboard, master goods, transports, quotation migration, Paper Trail, aging, and SO distribution checks pass | IT |
| TC-QA02 | API smoke | Run `npm run smoke:api:local` | Temporary backend starts, API smoke passes, backend stops automatically | IT |
| TC-QA03 | Build and lint | Run `cd WSSale-App; npm run lint; cd ..; npm run build` | Lint exits with 0 errors and production build succeeds | IT |

Detailed automated steps and latest measured results are maintained in [09-AUTOMATED-QA-v4.2.26.md](09-AUTOMATED-QA-v4.2.26.md).
**เกณฑ์ผ่าน (Go-Live):** ทุก TC สถานะ "ผ่าน" 100% สำหรับ critical (B,C,D,E,G,N) · NFR (P) ผ่าน · บันทึกผลพร้อมผู้ทดสอบ+วันที่
