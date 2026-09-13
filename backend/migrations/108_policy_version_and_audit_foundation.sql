-- =============================================================
-- 108_policy_version_and_audit_foundation.sql
--
-- SO-01: Policy contract + version + audit/reason foundation
-- 1. สร้างตาราง wf.PolicyVersion ติดตามเวอร์ชันและประวัติการเปลี่ยนแปลงของแต่ละ Policy
-- 2. สร้างตาราง wf.ChangeEvent บันทึก Audit Log แบบ Before/After ครบทุก Entity
-- 3. ตั้งค่า Master ค่าเริ่มต้นสำหรับ Pickup Due, Ticket Expiry, Rebate Ratio, Trip Capacity
-- 4. บันทึก Baseline ลง PolicyVersion สำหรับการทำงานแบบ Versioned & Audited
--
-- ⚠ ไม่แตะ schema dbo · ไม่มีคำสั่ง USE · รองรับ Idempotency
-- =============================================================

-- ── 1. ตาราง wf.PolicyVersion ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicyVersion]') AND type = N'U')
BEGIN
    CREATE TABLE wf.PolicyVersion (
        PolicyVersionId  INT IDENTITY(1,1) NOT NULL,
        PolicyName       VARCHAR(50)   NOT NULL,
        VersionNumber    INT           NOT NULL,
        SettingKey       NVARCHAR(50)  NOT NULL,
        OldValue         NVARCHAR(500) NULL,
        NewValue         NVARCHAR(500) NOT NULL,
        EffectiveFrom    DATETIME2     NOT NULL CONSTRAINT DF_PolicyVersion_Effective DEFAULT SYSUTCDATETIME(),
        ChangedBy        VARCHAR(50)   NOT NULL,
        ReasonCode       VARCHAR(30)   NULL,
        ReasonText       NVARCHAR(400) NULL,
        CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_PolicyVersion_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PolicyVersion PRIMARY KEY CLUSTERED (PolicyVersionId)
    );

    CREATE NONCLUSTERED INDEX IX_PolicyVersion_SettingKey
        ON wf.PolicyVersion (SettingKey, EffectiveFrom DESC);

    PRINT 'สร้างตาราง wf.PolicyVersion แล้ว';
END
ELSE
    PRINT 'ตาราง wf.PolicyVersion มีอยู่แล้ว — ข้าม';
GO

-- ── 2. ตาราง wf.ChangeEvent ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[ChangeEvent]') AND type = N'U')
BEGIN
    CREATE TABLE wf.ChangeEvent (
        EventId     BIGINT IDENTITY(1,1) NOT NULL,
        EntityType  VARCHAR(50)   NOT NULL,
        EntityId    VARCHAR(100)  NOT NULL,
        Action      VARCHAR(30)   NOT NULL,
        BeforeJson  NVARCHAR(MAX) NULL,
        AfterJson   NVARCHAR(MAX) NULL,
        ReasonCode  VARCHAR(30)   NULL,
        ReasonText  NVARCHAR(500) NULL,
        UserId      VARCHAR(50)   NOT NULL,
        IpAddress   VARCHAR(50)   NULL,
        CreatedAt   DATETIME2     NOT NULL CONSTRAINT DF_ChangeEvent_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ChangeEvent PRIMARY KEY CLUSTERED (EventId)
    );

    CREATE NONCLUSTERED INDEX IX_ChangeEvent_Entity
        ON wf.ChangeEvent (EntityType, EntityId, CreatedAt DESC);

    PRINT 'สร้างตาราง wf.ChangeEvent แล้ว';
END
ELSE
    PRINT 'ตาราง wf.ChangeEvent มีอยู่แล้ว — ข้าม';
GO

-- ── 3. กำหนดค่าเริ่มต้นใน wf.SystemSetting หากยังไม่มี ────────
IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'PICKUP_DUE_DEFAULT_DAYS')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PICKUP_DUE_DEFAULT_DAYS', '7', N'จำนวนวันกำหนดรับสินค้าค่าเริ่มต้นนับจาก SO Confirmation (วัน)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'PICKUP_DUE_OPTIONS')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PICKUP_DUE_OPTIONS', '7,15,30,45', N'ตัวเลือกวันกำหนดรับสินค้าสำหรับหน้าสร้าง/แก้ไข SO');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'PICKUP_STRICT_MODE')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PICKUP_STRICT_MODE', 'false', N'true = บล็อกการดำเนินงานหากรับนอกกรอบวันกำหนดรับ · false = อนุญาตพร้อมคำเตือน (ค่าเริ่มต้น false)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'PICKUP_LEAD_TIME_DAYS')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('PICKUP_LEAD_TIME_DAYS', '1', N'จำนวนวันล่วงหน้าขั้นต่ำสำหรับการนัดหมายรถเข้ารับสินค้า (วัน)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CONTROL_TICKET_ALERT_DAYS')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('CONTROL_TICKET_ALERT_DAYS', '7', N'จำนวนวันแจ้งเตือนล่วงหน้าก่อนตั๋วคุมหมดอายุ (วัน)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('CONTROL_TICKET_BLOCK_EXPIRED', 'false', N'true = บล็อกการใช้ตั๋วคุมที่หมดอายุ · false = อนุญาตพร้อมคำเตือน (ค่าเริ่มต้น false)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CUSTOMER_RATIO')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('CUSTOMER_RATIO', '100', N'สัดส่วนเงินรีเบทคืนลูกค้าตามนโยบายค่าเริ่มต้น (%)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'COMPANY_RATIO')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('COMPANY_RATIO', '0', N'สัดส่วนเงินรีเบทคงไว้ให้บริษัทตามนโยบายค่าเริ่มต้น (%)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TRIP_CAPACITY_TON')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('TRIP_CAPACITY_TON', '50', N'พิกัดความจุสินค้ามาตรฐานต่อเที่ยวรถ (ตัน)');
GO

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TRIP_OVERLOAD_TOLERANCE_PCT')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('TRIP_OVERLOAD_TOLERANCE_PCT', '5', N'เปอร์เซ็นต์ส่วนต่างน้ำหนักเกินที่ยอมรับได้ตามดุลยพินิจธุรกิจ (%)');
GO

-- ── 4. บันทึก Initial Baseline ลง wf.PolicyVersion ─────────────
IF NOT EXISTS (SELECT 1 FROM wf.PolicyVersion)
BEGIN
    INSERT INTO wf.PolicyVersion (PolicyName, VersionNumber, SettingKey, OldValue, NewValue, ChangedBy, ReasonCode, ReasonText)
    SELECT
        CASE
            WHEN s.SettingKey LIKE 'PICKUP_%' THEN 'PICKUP_POLICY'
            WHEN s.SettingKey LIKE 'CONTROL_TICKET_%' THEN 'TICKET_EXPIRY_POLICY'
            WHEN s.SettingKey LIKE '%_RATIO' THEN 'REBATE_POLICY'
            WHEN s.SettingKey LIKE 'TRIP_%' THEN 'TRIP_CAPACITY_POLICY'
            WHEN s.SettingKey LIKE 'WEIGHT_%' OR s.SettingKey = 'STANDARD_BAG_WEIGHT_KG' THEN 'WEIGHT_CALIBRATION_POLICY'
            ELSE 'SYSTEM_SETTINGS'
        END AS PolicyName,
        1 AS VersionNumber,
        s.SettingKey,
        NULL AS OldValue,
        s.SettingValue AS NewValue,
        'SYSTEM_INIT' AS ChangedBy,
        'INITIAL_V2' AS ReasonCode,
        N'Baseline v2.0.0 policy foundation' AS ReasonText
    FROM wf.SystemSetting s;

    PRINT 'บันทึก Initial Baseline ใน wf.PolicyVersion แล้ว';
END
GO
