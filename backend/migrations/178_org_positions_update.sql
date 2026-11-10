-- =============================================================
-- 178_org_positions_update.sql
--
-- ปรับปรุงโครงสร้างผังองค์กร (wf.OrgPosition) ตามนโยบายองค์กรล่าสุด:
-- 1. เพิ่มตำแหน่งภายใต้ผู้จัดการฝ่ายบัญชี (MGR-ACC) Tier-3:
--    - ACC-COST-MAT: 'บัญชีต้นทุน-วัตถุดิบ' (Tier-4)
--    - ACC-COST-PUR: 'บัญชีต้นทุน-ซื้อ' (Tier-4)
-- 2. เพิ่มตำแหน่งภายใต้ผู้ช่วยสมุหบัญชี (ACC-CHIEF) Tier-4:
--    - ACC-SEC-SALE: 'บัญชีและเลขาฝ่ายขาย' (Tier-5)
-- 3. เพิ่มตำแหน่งกรรมการบริหารระดับสูง Tier-1:
--    - EXEC-PLANT: 'กรรมการบริหาร - โรงงานและสายการผลิต' (Tier-1)
-- 4. ปรับสายบังคับบัญชาของ ผู้จัดการโรงงานและสายการผลิต (MGR-PLANT) 
--    ให้ขึ้นตรงต่อ กรรมการบริหาร - โรงงานและสายการผลิต (EXEC-PLANT)
-- =============================================================

-- ── 1. เพิ่มและอัปเดตตำแหน่งด้วย MERGE (Idempotent ปลอดภัยรันซ้ำได้) ──
MERGE wf.OrgPosition AS t
USING (VALUES
  ('EXEC-PLANT',   N'กรรมการบริหาร - โรงงานและสายการผลิต', NULL,        N'บริหาร',        1, 'C_LEVEL',    1, N'สายโรงงานและสายการผลิต'),
  ('ACC-COST-MAT', N'บัญชีต้นทุน-วัตถุดิบ',              'MGR-ACC',   N'บัญชี-การเงิน', 4, 'ACCOUNTING', 0, N'บัญชีต้นทุนและวัตถุดิบ'),
  ('ACC-COST-PUR', N'บัญชีต้นทุน-ซื้อ',                  'MGR-ACC',   N'บัญชี-การเงิน', 4, 'ACCOUNTING', 0, N'บัญชีต้นทุนงานจัดซื้อ'),
  ('ACC-SEC-SALE', N'บัญชีและเลขาฝ่ายขาย',                'ACC-CHIEF', N'บัญชี-การเงิน', 5, 'ACCOUNTING', 0, N'บัญชีและประสานงานฝ่ายขาย')
) AS s (PositionCode, PositionName, ReportsTo, OrgUnit, Tier, DefaultRole, CanApprove, Note)
   ON t.PositionCode = s.PositionCode
WHEN MATCHED THEN UPDATE SET
    t.PositionName = s.PositionName,
    t.ReportsTo = s.ReportsTo,
    t.OrgUnit = s.OrgUnit,
    t.Tier = s.Tier,
    t.DefaultRole = s.DefaultRole,
    t.CanApprove = s.CanApprove,
    t.Note = s.Note,
    t.IsActive = 1
WHEN NOT MATCHED BY TARGET THEN
    INSERT (PositionCode, PositionName, ReportsTo, OrgUnit, Tier, DefaultRole, CanApprove, IsActive, Note)
    VALUES (s.PositionCode, s.PositionName, s.ReportsTo, s.OrgUnit, s.Tier, s.DefaultRole, s.CanApprove, 1, s.Note);
GO

-- ── 2. ปรับให้ผู้จัดการโรงงานและสายการผลิต (MGR-PLANT) รายงานตรงต่อ EXEC-PLANT ──
IF EXISTS (SELECT 1 FROM wf.OrgPosition WHERE PositionCode = 'EXEC-PLANT')
BEGIN
    UPDATE wf.OrgPosition
    SET ReportsTo = 'EXEC-PLANT'
    WHERE PositionCode = 'MGR-PLANT' AND (ReportsTo IS NULL OR ReportsTo = 'EXEC-FIN-HR');
END
GO
