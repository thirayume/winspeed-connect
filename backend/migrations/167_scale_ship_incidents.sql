-- @transaction
-- Owner decisions (3 November 2026):
-- 1. The scale record (dbo.WGHD, dbo.WGDT) closes a bill by itself; people step in only when it does not check out.
-- 2. Weight tolerance is plus or minus 2%. The seeded +2% to +5% matched almost no real truck: 85% of Production
--    weighings since September fall between 0% and +1%. A value someone already changed stays as it is.
-- 3. A truck may still leave before WINSpeed approves its booking, but that and similar breaches are recorded in
--    wf.RuleIncident, with who did what, so they can be reviewed and stopped.
-- wf schema only, no dbo structure change. SQL Server 2008 compatible; idempotent.
IF OBJECT_ID('wf.RuleIncident','U') IS NULL
BEGIN
    CREATE TABLE wf.RuleIncident (
        Id           INT IDENTITY(1,1) NOT NULL,
        IncidentKey  NVARCHAR(120) NOT NULL,
        IncidentType VARCHAR(40)   NOT NULL,
        Severity     VARCHAR(10)   NOT NULL CONSTRAINT DF_RuleIncident_Severity DEFAULT 'WARN',
        SOID         INT           NULL,
        DocuNo       NVARCHAR(30)  NULL,
        WghdId       INT           NULL,
        Detail       NVARCHAR(500) NULL,
        OccurredAt   DATETIME      NULL,
        DetectedAt   DATETIME2     NOT NULL CONSTRAINT DF_RuleIncident_DetectedAt DEFAULT SYSUTCDATETIME(),
        Status       VARCHAR(12)   NOT NULL CONSTRAINT DF_RuleIncident_Status DEFAULT 'OPEN',
        AckBy        INT           NULL,
        AckAt        DATETIME2     NULL,
        AckNote      NVARCHAR(500) NULL,
        CONSTRAINT PK_RuleIncident PRIMARY KEY (Id),
        CONSTRAINT UQ_RuleIncident_Key UNIQUE (IncidentKey),
        CONSTRAINT CK_RuleIncident_Status CHECK (Status IN ('OPEN','ACK')),
        CONSTRAINT FK_RuleIncident_AckBy FOREIGN KEY (AckBy) REFERENCES wf.AppUser(Id)
    );
    CREATE INDEX IX_RuleIncident_Status ON wf.RuleIncident (Status, OccurredAt DESC);
    CREATE INDEX IX_RuleIncident_Soid ON wf.RuleIncident (SOID);
END;
GO
IF COL_LENGTH('wf.WeighTicket','ShipSource') IS NULL
    ALTER TABLE wf.WeighTicket ADD ShipSource VARCHAR(20) NULL, ScaleEventId INT NULL;
GO
UPDATE wf.SystemSetting SET SettingValue = '-2.0', Description = 'Weight tolerance below the planned tons (%)'
 WHERE SettingKey = 'WEIGHT_TOLERANCE_MIN_PCT' AND SettingValue IN ('2.0','2');
UPDATE wf.SystemSetting SET SettingValue = '2.0', Description = 'Weight tolerance above the planned tons (%)'
 WHERE SettingKey = 'WEIGHT_TOLERANCE_MAX_PCT' AND SettingValue IN ('5.0','5');
IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'INCIDENT_START_DATE')
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('INCIDENT_START_DATE', '2026-11-01', 'Rule incidents are recorded from this date (yyyy-mm-dd)');
GO
