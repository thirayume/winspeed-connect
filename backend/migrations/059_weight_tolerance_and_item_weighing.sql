-- =============================================================
-- 059_weight_tolerance_and_item_weighing.sql
-- System settings for machine calibration error tolerance (+2% to +5%),
-- intermediate item weighing logs, and theoretical target reconciliation.
-- Safe to re-run (idempotent)
-- =============================================================

-- 1. System Setting Table
IF OBJECT_ID('wf.SystemSetting', 'U') IS NULL
BEGIN
  CREATE TABLE wf.SystemSetting (
    SettingKey   NVARCHAR(50) PRIMARY KEY,
    SettingValue NVARCHAR(200) NOT NULL,
    Description  NVARCHAR(300) NULL,
    UpdatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
  );
END
GO

-- Seed default settings if missing
IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'WEIGHT_TOLERANCE_MIN_PCT')
  INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description) VALUES ('WEIGHT_TOLERANCE_MIN_PCT', '2.0', 'Minimum error tolerance percentage for machine calibration (+2%)');

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'WEIGHT_TOLERANCE_MAX_PCT')
  INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description) VALUES ('WEIGHT_TOLERANCE_MAX_PCT', '5.0', 'Maximum error tolerance percentage for machine calibration (+5%)');

IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'STANDARD_BAG_WEIGHT_KG')
  INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description) VALUES ('STANDARD_BAG_WEIGHT_KG', '50.0', 'Standard bag weight in kg');
GO

-- 2. Enhance WeighTicket Table
IF COL_LENGTH('wf.WeighTicket', 'ExpectedNetKg') IS NULL
  ALTER TABLE wf.WeighTicket ADD ExpectedNetKg DECIMAL(12,2) NULL;
GO
IF COL_LENGTH('wf.WeighTicket', 'VarianceKg') IS NULL
  ALTER TABLE wf.WeighTicket ADD VarianceKg DECIMAL(12,2) NULL;
GO
IF COL_LENGTH('wf.WeighTicket', 'VariancePct') IS NULL
  ALTER TABLE wf.WeighTicket ADD VariancePct DECIMAL(6,2) NULL;
GO
IF COL_LENGTH('wf.WeighTicket', 'WeightStatus') IS NULL
  ALTER TABLE wf.WeighTicket ADD WeightStatus NVARCHAR(20) NULL DEFAULT 'UNVERIFIED';
GO

-- 3. Intermediate Item-Level Weighing Passes Table
IF OBJECT_ID('wf.WeighTicketItemLog', 'U') IS NULL
BEGIN
  CREATE TABLE wf.WeighTicketItemLog (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    SoId             NVARCHAR(50)  NOT NULL,
    LineNum          INT           NULL,
    GoodCode         NVARCHAR(50)  NULL,
    GoodName         NVARCHAR(200) NULL,
    PassNo           INT           NOT NULL DEFAULT 1,
    GrossScaleKg     DECIMAL(10,2) NOT NULL,
    IncrementalNetKg DECIMAL(10,2) NULL,
    Note             NVARCHAR(300) NULL,
    WeighedBy        INT           NULL REFERENCES wf.AppUser(Id),
    WeighedAt        DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_WeighTicketItemLog_So ON wf.WeighTicketItemLog(SoId);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader;
GO
PRINT '✓ WF migration 059 complete (SystemSetting, WeighTicket tolerance columns, and WeighTicketItemLog)';
GO
