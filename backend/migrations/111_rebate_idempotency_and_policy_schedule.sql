-- =============================================================
-- 111_rebate_idempotency_and_policy_schedule.sql
--
-- SO-01 / SO-02 Corrective Acceptance (Findings A2-A4) & SO-03 Schema:
-- 1. เพิ่ม IdempotencyKey และ RequestPayloadHash ใน wf.RebateClaim ป้องกัน double submission
-- 2. สร้าง Filtered Unique Index UQ_RebateClaim_IdempotencyKey
-- 3. เพิ่มคอลัมน์ PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId ใน wf.SalesOrder
-- 4. เพิ่มคอลัมน์ PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId ใน wf.SalesOrderExt
-- 5. สร้าง Index รองรับ PolicySnapshot Effective Date lookup
--
-- ⚠ ไม่แตะ schema dbo · ไม่มีคำสั่ง USE · รองรับ Idempotency
-- =============================================================

-- ── 1. คอลัมน์ Idempotency ใน wf.RebateClaim ────────────────────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND type = N'U')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'IdempotencyKey')
    BEGIN
        ALTER TABLE [wf].[RebateClaim] ADD [IdempotencyKey] VARCHAR(100) NULL;
        PRINT 'เพิ่มคอลัมน์ IdempotencyKey ใน wf.RebateClaim แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'RequestPayloadHash')
    BEGIN
        ALTER TABLE [wf].[RebateClaim] ADD [RequestPayloadHash] VARCHAR(64) NULL;
        PRINT 'เพิ่มคอลัมน์ RequestPayloadHash ใน wf.RebateClaim แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_RebateClaim_IdempotencyKey' AND object_id = OBJECT_ID(N'[wf].[RebateClaim]'))
    BEGIN
        EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX UQ_RebateClaim_IdempotencyKey
            ON [wf].[RebateClaim] ([IdempotencyKey])
            WHERE [IdempotencyKey] IS NOT NULL;');
        PRINT 'สร้าง Unique Index UQ_RebateClaim_IdempotencyKey แล้ว';
    END
END
GO

-- ── 2. คอลัมน์ Pickup Due ใน wf.SalesOrder (SO-03) ───────────────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[SalesOrder]') AND type = N'U')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrder]') AND name = 'PickupDueDate')
    BEGIN
        ALTER TABLE [wf].[SalesOrder] ADD [PickupDueDate] DATE NULL;
        PRINT 'เพิ่มคอลัมน์ PickupDueDate ใน wf.SalesOrder แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrder]') AND name = 'PickupDueType')
    BEGIN
        ALTER TABLE [wf].[SalesOrder] ADD [PickupDueType] VARCHAR(20) NULL CONSTRAINT DF_SalesOrder_PickupDueType DEFAULT 'DEFAULT';
        PRINT 'เพิ่มคอลัมน์ PickupDueType ใน wf.SalesOrder แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrder]') AND name = 'ConfirmedAt')
    BEGIN
        ALTER TABLE [wf].[SalesOrder] ADD [ConfirmedAt] DATETIME2 NULL;
        PRINT 'เพิ่มคอลัมน์ ConfirmedAt ใน wf.SalesOrder แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrder]') AND name = 'PickupPolicySnapshotId')
    BEGIN
        ALTER TABLE [wf].[SalesOrder] ADD [PickupPolicySnapshotId] INT NULL;
        PRINT 'เพิ่มคอลัมน์ PickupPolicySnapshotId ใน wf.SalesOrder แล้ว';
    END
END
GO

-- ── 3. คอลัมน์ Pickup Due ใน wf.SalesOrderExt (SO-03) ────────────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[SalesOrderExt]') AND type = N'U')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrderExt]') AND name = 'PickupDueDate')
    BEGIN
        ALTER TABLE [wf].[SalesOrderExt] ADD [PickupDueDate] DATE NULL;
        PRINT 'เพิ่มคอลัมน์ PickupDueDate ใน wf.SalesOrderExt แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrderExt]') AND name = 'PickupDueType')
    BEGIN
        ALTER TABLE [wf].[SalesOrderExt] ADD [PickupDueType] VARCHAR(20) NULL;
        PRINT 'เพิ่มคอลัมน์ PickupDueType ใน wf.SalesOrderExt แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrderExt]') AND name = 'ConfirmedAt')
    BEGIN
        ALTER TABLE [wf].[SalesOrderExt] ADD [ConfirmedAt] DATETIME2 NULL;
        PRINT 'เพิ่มคอลัมน์ ConfirmedAt ใน wf.SalesOrderExt แล้ว';
    END

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[SalesOrderExt]') AND name = 'PickupPolicySnapshotId')
    BEGIN
        ALTER TABLE [wf].[SalesOrderExt] ADD [PickupPolicySnapshotId] INT NULL;
        PRINT 'เพิ่มคอลัมน์ PickupPolicySnapshotId ใน wf.SalesOrderExt แล้ว';
    END
END
GO

-- ── 4. ดัชนี PolicySnapshot Effective lookup ────────────────────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicySnapshot]') AND type = N'U')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PolicySnapshot_EffectiveLookup' AND object_id = OBJECT_ID(N'[wf].[PolicySnapshot]'))
    BEGIN
        CREATE NONCLUSTERED INDEX IX_PolicySnapshot_EffectiveLookup
            ON [wf].[PolicySnapshot] (PolicyName, EffectiveFrom, EffectiveTo)
            INCLUDE (SnapshotId, RevisionNumber, CustomerRatio, CompanyRatio);
        PRINT 'สร้าง Index IX_PolicySnapshot_EffectiveLookup แล้ว';
    END
END
GO
