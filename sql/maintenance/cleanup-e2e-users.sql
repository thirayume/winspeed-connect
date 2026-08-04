-- =============================================================
-- cleanup-e2e-users.sql — ล้างบัญชีทดสอบ e2e_* ออกจาก wf.AppUser
--
-- ใช้เมื่อ: จะส่งมอบระบบขึ้นใช้งานจริง หรือส่งหลักฐานให้ผู้ตรวจ
--           บัญชีทดสอบ 10 บัญชีนี้ใช้รหัสผ่านร่วมกันทั้งหมด และมีสิทธิ์ครบทุกบทบาท
--           รวมถึง ADMIN และ C_LEVEL ถ้าหลุดขึ้น production คือช่องทางเข้าระบบเต็มรูปแบบ
--
-- ⚠ อ่านก่อนรัน
--   บัญชีเหล่านี้เป็น fixture ที่ run-e2e.ps1 ใช้ทุกรอบ **ลบแล้วชุด E2E จะรันไม่ได้**
--   จนกว่าจะ seed ใหม่ด้วย db-init/e2e-seed.sql — ให้ลบเฉพาะบนฐาน production เท่านั้น
--   ห้ามรันบนฐาน DEV/UAT ที่ยังต้องเดินชุดทดสอบ
--
--   มี 33 foreign key และ 15 คอลัมน์อ้างผู้ใช้แบบไม่มี FK ชี้มาที่ wf.AppUser
--   บัญชีที่เคยอนุมัติหรือสร้างเอกสารไว้จึง **ลบไม่ได้** โดยไม่ทำลายหลักฐาน
--   สคริปต์นี้จึงลบเฉพาะบัญชีที่ไม่มีใครอ้างถึงเลย ที่เหลือปิดใช้งานและตัดรหัสผ่านทิ้ง
--
-- วิธีใช้: รันขั้นที่ 1 ดูผลก่อน แล้วจึงเอาคอมเมนต์ออกจากขั้นที่ 3 เมื่อพอใจ
-- =============================================================

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- ── ขั้นที่ 1 · ดูว่ามีอะไรบ้าง (อ่านอย่างเดียว) ─────────────────────────

DECLARE @Targets TABLE (Id INT PRIMARY KEY, Username NVARCHAR(100), Role NVARCHAR(30));

INSERT INTO @Targets (Id, Username, Role)
SELECT Id, Username, Role FROM wf.AppUser WHERE Username LIKE 'e2e[_]%';

SELECT N'บัญชีทดสอบที่พบ' AS รายการ, COUNT(*) AS จำนวน FROM @Targets;
SELECT Username, Role FROM @Targets ORDER BY Username;

-- นับการอ้างถึงจากทุกตารางที่มี foreign key มาที่ wf.AppUser
-- ตัวเลขนี้คือเหตุผลว่าทำไมบางบัญชีลบไม่ได้
SELECT t.Username, t.Role,
       (SELECT COUNT(*) FROM wf.SalesOrder        x WHERE x.SalesUserId       = t.Id) AS ใบสั่งขาย,
       (SELECT COUNT(*) FROM wf.SalesOrderAudit   x WHERE x.UserId            = t.Id) AS ประวัติใบสั่งขาย,
       (SELECT COUNT(*) FROM wf.RebateClaim       x WHERE x.SalesUserId       = t.Id
                                                      OR x.ApprovedBy         = t.Id) AS ใบขอเคลียร์,
       (SELECT COUNT(*) FROM wf.RebateClaimApproval x WHERE x.DecidedBy       = t.Id) AS อนุมัติเคลียร์,
       (SELECT COUNT(*) FROM wf.RebatePlanApproval  x WHERE x.DecidedBy       = t.Id) AS อนุมัติโปรโมชั่น,
       (SELECT COUNT(*) FROM wf.PriceBook         x WHERE x.CreatedBy         = t.Id
                                                      OR x.ApprovedBy         = t.Id
                                                      OR x.ActivatedBy        = t.Id) AS ตารางราคา,
       (SELECT COUNT(*) FROM wf.PriceBookSpecialPrice x WHERE x.RequestedBy   = t.Id
                                                          OR x.ApprovedBy     = t.Id) AS ราคาพิเศษ,
       (SELECT COUNT(*) FROM wf.WeighTicket       x WHERE x.CreatedBy         = t.Id
                                                      OR x.OverrideApprovedBy = t.Id) AS ใบชั่ง,
       (SELECT COUNT(*) FROM wf.PaperTrail        x WHERE x.HolderUserId      = t.Id) AS เอกสารในมือ,
       (SELECT COUNT(*) FROM wf.Quotation         x WHERE x.SalesUserId       = t.Id) AS ใบเสนอราคา,
       (SELECT COUNT(*) FROM wf.GiveawayBorrowRequest x WHERE x.RequesterId   = t.Id
                                                          OR x.ApproverId     = t.Id
                                                          OR x.LenderId       = t.Id) AS ขอยืมของแถม,
       (SELECT COUNT(*) FROM wf.UnlockRequest     x WHERE x.RequesterId       = t.Id
                                                      OR x.ApproverId         = t.Id) AS คำขอปลดล็อก,
       (SELECT COUNT(*) FROM wf.ApiAuditLog       x WHERE x.ActorUserId       = t.Id
                                                      OR x.EffectiveUserId    = t.Id) AS บันทึกเรียก_API
FROM @Targets t
ORDER BY t.Username;
GO

-- ── ขั้นที่ 2 · ปิดใช้งานและตัดรหัสผ่านทิ้ง (ปลอดภัย ทำได้ทันที) ──────────
--
-- ทำให้บัญชีเข้าระบบไม่ได้อีกโดยไม่แตะหลักฐานใด ๆ
-- ตั้ง PasswordHash เป็นค่าที่ไม่มีรหัสผ่านใดแฮชออกมาตรงได้ จึงเข้าไม่ได้แม้รู้รหัสเดิม
-- และหลุดจากกลุ่ม "รหัสผ่านซ้ำ" ไปด้วย เพราะแต่ละบัญชีได้ค่าไม่ซ้ำกัน

UPDATE wf.AppUser
SET IsActive           = 0,
    MustChangePassword = 1,
    PasswordHash       = CONCAT(N'disabled-e2e-', CONVERT(NVARCHAR(36), NEWID())),
    UpdatedAt          = GETUTCDATE()
WHERE Username LIKE 'e2e[_]%'
  AND IsActive = 1;

SELECT N'ปิดใช้งานแล้ว' AS ผลลัพธ์, @@ROWCOUNT AS จำนวนบัญชี;
GO

-- ── ขั้นที่ 3 · ลบบัญชีที่ไม่มีใครอ้างถึงเลย (เอาคอมเมนต์ออกเมื่อพอใจผลขั้นที่ 1) ──
--
-- เงื่อนไข NOT EXISTS ครบทุกตารางที่มี foreign key มาที่ wf.AppUser
-- ถ้าบัญชีใดมีการอ้างถึงแม้แถวเดียว จะถูกข้ามไปโดยอัตโนมัติ ไม่ล้มทั้งสคริปต์

/*
DELETE FROM wf.UserSaleArea
WHERE UserId IN (SELECT Id FROM wf.AppUser WHERE Username LIKE 'e2e[_]%');

DELETE u
FROM wf.AppUser u
WHERE u.Username LIKE 'e2e[_]%'
  AND NOT EXISTS (SELECT 1 FROM wf.SalesOrder            x WHERE x.SalesUserId       = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.SalesOrderAudit       x WHERE x.UserId            = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.RebateClaim           x WHERE x.SalesUserId       = u.Id OR x.ApprovedBy = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.RebateClaimApproval   x WHERE x.DecidedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.RebatePlan            x WHERE x.CreatedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.RebatePlanApproval    x WHERE x.DecidedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.RebatePool            x WHERE x.SalesUserId       = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.PriceBook             x WHERE x.CreatedBy         = u.Id OR x.ApprovedBy = u.Id OR x.ActivatedBy = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.PriceBookSpecialPrice x WHERE x.RequestedBy       = u.Id OR x.ApprovedBy = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.WeighTicket           x WHERE x.CreatedBy         = u.Id OR x.OverrideApprovedBy = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.WeighTicketItemLog    x WHERE x.WeighedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.PaperTrail            x WHERE x.HolderUserId      = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.PaperCopy             x WHERE x.HolderUserId      = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.PaperScan             x WHERE x.ScannerUserId     = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.Quotation             x WHERE x.SalesUserId       = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.GiveawayBorrowRequest x WHERE x.RequesterId       = u.Id OR x.ApproverId = u.Id OR x.LenderId = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget        x WHERE x.SalesUserId       = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal    x WHERE x.SalesUserId       = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.UnlockRequest         x WHERE x.RequesterId       = u.Id OR x.ApproverId = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.ApprovalPolicy        x WHERE x.CreatedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.CreditMaster          x WHERE x.UpdatedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.OperationalStock      x WHERE x.UpdatedBy         = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.ReconResolution       x WHERE x.ResolvedBy        = u.Id)
  AND NOT EXISTS (SELECT 1 FROM wf.DsarLog               x WHERE x.RequestedBy       = u.Id);

SELECT N'ลบออกแล้ว' AS ผลลัพธ์, @@ROWCOUNT AS จำนวนบัญชี;
*/
GO

-- ── ขั้นที่ 4 · ตรวจผล ─────────────────────────────────────────────────

SELECT Username, Role, IsActive, MustChangePassword,
       CASE WHEN PasswordHash LIKE N'disabled-e2e-%' THEN N'ตัดรหัสผ่านแล้ว' ELSE N'ยังใช้รหัสเดิม' END AS สถานะรหัสผ่าน
FROM wf.AppUser
WHERE Username LIKE 'e2e[_]%'
ORDER BY Username;

SELECT N'บัญชี e2e ที่ยังเข้าระบบได้' AS ตรวจสอบ, COUNT(*) AS จำนวน
FROM wf.AppUser WHERE Username LIKE 'e2e[_]%' AND IsActive = 1;
-- ต้องได้ 0
GO
