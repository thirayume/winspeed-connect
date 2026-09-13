-- =============================================================
-- 110_rebate_rounding_and_policy_snapshot.sql
--
-- SO-01 / SO-02 Correction (Findings R1-R9):
-- 1. สร้างตาราง wf.PolicySnapshot บันทึก Coherent Immutable Snapshot ของนโยบาย
-- 2. เพิ่ม PolicySnapshotId ใน wf.RebateClaim เพื่อผูกกับ Policy Snapshot ครบชุด
-- 3. เพิ่ม Master Reason Codes สำหรับการตั้งค่านโยบาย และยกเลิก/ลบ SO ใน wf.EditReason
-- 4. ปรับปรุง Check Constraints ของ wf.RebateClaim ให้รัดกุม (ตรวจ Range 0-100% และยอดรวม CustomerAmount + RetainedAmount = ClaimAmt)
-- 5. บันทึก Initial Baseline Snapshot ลง wf.PolicySnapshot
--
-- ⚠ ไม่แตะ schema dbo · ไม่มีคำสั่ง USE · รองรับ Idempotency
-- =============================================================

-- ── 1. ตาราง wf.PolicySnapshot ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicySnapshot]') AND type = N'U')
BEGIN
    CREATE TABLE wf.PolicySnapshot (
        SnapshotId      INT IDENTITY(1,1) NOT NULL,
        PolicyName      VARCHAR(50)   NOT NULL,
        RevisionNumber  INT           NOT NULL,
        SnapshotJson    NVARCHAR(MAX) NOT NULL,
        CustomerRatio   DECIMAL(5,2)  NULL,
        CompanyRatio    DECIMAL(5,2)  NULL,
        EffectiveFrom   DATETIME2     NOT NULL CONSTRAINT DF_PolicySnapshot_Effective DEFAULT SYSUTCDATETIME(),
        EffectiveTo     DATETIME2     NULL,
        ChangedBy       VARCHAR(50)   NOT NULL,
        ReasonCode      VARCHAR(30)   NULL,
        ReasonText      NVARCHAR(500) NULL,
        CreatedAt       DATETIME2     NOT NULL CONSTRAINT DF_PolicySnapshot_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PolicySnapshot PRIMARY KEY CLUSTERED (SnapshotId),
        CONSTRAINT UQ_PolicySnapshot_Revision UNIQUE (PolicyName, RevisionNumber)
    );

    CREATE NONCLUSTERED INDEX IX_PolicySnapshot_Active
        ON wf.PolicySnapshot (PolicyName, EffectiveFrom DESC);

    PRINT 'สร้างตาราง wf.PolicySnapshot แล้ว';
END
ELSE
    PRINT 'ตาราง wf.PolicySnapshot มีอยู่แล้ว — ข้าม';
GO

-- ── 2. เพิ่มคอลัมน์ PolicySnapshotId ใน wf.RebateClaim ──────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'PolicySnapshotId')
BEGIN
    ALTER TABLE [wf].[RebateClaim] ADD [PolicySnapshotId] INT NULL;
    IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicySnapshot]') AND type = N'U')
    BEGIN
        ALTER TABLE [wf].[RebateClaim] ADD CONSTRAINT [FK_RebateClaim_PolicySnapshot]
            FOREIGN KEY ([PolicySnapshotId]) REFERENCES [wf].[PolicySnapshot] ([SnapshotId]);
    END
    PRINT 'เพิ่มคอลัมน์ PolicySnapshotId ใน wf.RebateClaim แล้ว';
END
ELSE
    PRINT 'คอลัมน์ PolicySnapshotId มีอยู่แล้ว — ข้าม';
GO

-- ── 3. Seed / Update Master Reason Codes ใน wf.EditReason ───────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[EditReason]') AND type = N'U')
BEGIN
    MERGE wf.EditReason AS t
    USING (VALUES
      ('POLICY_ADJUSTMENT',     N'ปรับปรุงตามนโยบายบริษัท',                'POLICY',                          0, 10),
      ('BUSINESS_RULE_CHANGE',  N'เปลี่ยนเกณฑ์เงื่อนไขการค้า',               'POLICY',                          0, 20),
      ('SEASONAL_UPDATE',       N'ปรับเปลี่ยนตามฤดูกาลผลิต/จัดส่ง',          'POLICY',                          0, 30),
      ('SCALE_RECALIBRATION',   N'ปรับเกณฑ์เครื่องชั่งหลังสอบเทียบ',           'POLICY,LOADING',                  0, 40),
      ('SO_CANCELLED',          N'ลูกค้ายกเลิกคำสั่งซื้อ',                   'SO_CANCEL,SO_DELETE',             0, 50),
      ('SO_DELETED',            N'ลบบิลร่าง/บิลผิดพลาด',                    'SO_DELETE',                       0, 60),
      ('MANUAL_ADJUSTMENT',     N'ปรับปรุงยอดเคลมด้วยดุลยพินิจพิเศษ (Admin/Acc)', 'REBATE',                          0, 70)
    ) AS s (ReasonCode, ReasonText, AppliesTo, RequiresHold, SortOrder)
       ON t.ReasonCode = s.ReasonCode
    WHEN MATCHED THEN UPDATE SET
        t.ReasonText = s.ReasonText,
        t.AppliesTo = s.AppliesTo,
        t.SortOrder = s.SortOrder
    WHEN NOT MATCHED BY TARGET THEN
        INSERT (ReasonCode, ReasonText, AppliesTo, RequiresHold, SortOrder, IsActive)
        VALUES (s.ReasonCode, s.ReasonText, s.AppliesTo, s.RequiresHold, s.SortOrder, 1);

    -- ปรับปรุง OTHER ให้ครอบคลุมทุกบริบท
    UPDATE wf.EditReason
    SET AppliesTo = 'CONFIRMED,REGISTERED,LOADING,POLICY,SO_CANCEL,SO_DELETE,REBATE'
    WHERE ReasonCode = 'OTHER';

    PRINT 'Seed / Update Master Reason Codes ใน wf.EditReason เรียบร้อย';
END
GO

-- ── 4. ปรับปรุง Check Constraints ของ wf.RebateClaim ───────────
-- ปลด Constraint เดิมที่ตรวจเฉพาะผลรวม
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE object_id = OBJECT_ID(N'[wf].[CK_RebateClaim_RatioSum]'))
BEGIN
    ALTER TABLE [wf].[RebateClaim] DROP CONSTRAINT [CK_RebateClaim_RatioSum];
    PRINT 'ปลด Constraint CK_RebateClaim_RatioSum เดิมแล้ว';
END
GO

-- สร้าง Constraint ใหม่: บังคับ Range 0.00-100.00% ทั้งสองส่วน และผลรวมเท่ากับ 100.00
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE object_id = OBJECT_ID(N'[wf].[CK_RebateClaim_RatioSum]'))
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'CustomerRatio')
BEGIN
    ALTER TABLE [wf].[RebateClaim]
    ADD CONSTRAINT [CK_RebateClaim_RatioSum]
    CHECK (
        CustomerRatio IS NOT NULL AND CompanyRatio IS NOT NULL
        AND CustomerRatio >= 0.00 AND CustomerRatio <= 100.00
        AND CompanyRatio >= 0.00 AND CompanyRatio <= 100.00
        AND ROUND(CustomerRatio + CompanyRatio, 2) = 100.00
    );
    PRINT 'สร้าง Constraint CK_RebateClaim_RatioSum ฉบับเข้มงวดแล้ว';
END
GO

-- ตรวจสอบยอดเงิน CustomerAmount + RetainedAmount = ClaimAmt (กรณีระบุยอด)
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE object_id = OBJECT_ID(N'[wf].[CK_RebateClaim_AmountSum]'))
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'CustomerAmount')
BEGIN
    ALTER TABLE [wf].[RebateClaim]
    ADD CONSTRAINT [CK_RebateClaim_AmountSum]
    CHECK (
        (CustomerAmount IS NULL AND RetainedAmount IS NULL)
        OR (
            CustomerAmount >= 0.00 AND RetainedAmount >= 0.00
            AND ROUND(CustomerAmount + RetainedAmount, 2) = ROUND(ClaimAmt, 2)
        )
    );
    PRINT 'สร้าง Constraint CK_RebateClaim_AmountSum แล้ว';
END
GO

-- ── 5. บันทึก Initial Baseline Snapshot ลง wf.PolicySnapshot ─────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicySnapshot]') AND type = N'U')
   AND NOT EXISTS (SELECT 1 FROM wf.PolicySnapshot WHERE PolicyName = 'REBATE_POLICY')
BEGIN
    INSERT INTO wf.PolicySnapshot (
        PolicyName, RevisionNumber, SnapshotJson, CustomerRatio, CompanyRatio, ChangedBy, ReasonCode, ReasonText
    )
    VALUES (
        'REBATE_POLICY',
        1,
        N'{"CUSTOMER_RATIO":100.00,"COMPANY_RATIO":0.00}',
        100.00,
        0.00,
        'SYSTEM_INIT',
        'INITIAL_V2',
        N'Baseline Rebate Policy 100/0 snapshot'
    );
    PRINT 'บันทึก Initial Rebate Snapshot ลง wf.PolicySnapshot แล้ว';
END
GO

IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicySnapshot]') AND type = N'U')
   AND NOT EXISTS (SELECT 1 FROM wf.PolicySnapshot WHERE PolicyName = 'SYSTEM_POLICY')
BEGIN
    INSERT INTO wf.PolicySnapshot (
        PolicyName, RevisionNumber, SnapshotJson, ChangedBy, ReasonCode, ReasonText
    )
    VALUES (
        'SYSTEM_POLICY',
        1,
        N'{"PICKUP_DUE_DEFAULT_DAYS":7,"PICKUP_DUE_OPTIONS":"7,15,30,45","PICKUP_STRICT_MODE":false,"PICKUP_LEAD_TIME_DAYS":1,"CONTROL_TICKET_ALERT_DAYS":7,"CONTROL_TICKET_BLOCK_EXPIRED":false,"CUSTOMER_RATIO":100,"COMPANY_RATIO":0,"TRIP_CAPACITY_TON":50,"TRIP_OVERLOAD_TOLERANCE_PCT":5,"WEIGHT_TOLERANCE_MIN_PCT":2.0,"WEIGHT_TOLERANCE_MAX_PCT":5.0,"STANDARD_BAG_WEIGHT_KG":50.0}',
        'SYSTEM_INIT',
        'INITIAL_V2',
        N'Baseline System Policy snapshot'
    );
    PRINT 'บันทึก Initial System Policy Snapshot ลง wf.PolicySnapshot แล้ว';
END
GO
