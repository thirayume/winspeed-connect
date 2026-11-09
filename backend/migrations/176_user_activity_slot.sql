-- 176_user_activity_slot.sql: Track 15-minute user concurrency & HR analytics
-- Idempotent migration

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name = 'wf' AND t.name = 'UserActivitySlot'
)
BEGIN
    CREATE TABLE wf.UserActivitySlot (
        ActivityDate DATE NOT NULL,
        TimeSlot TINYINT NOT NULL,          -- 0..95 (each slot is 15 minutes: hour * 4 + minute / 15)
        UserId INT NOT NULL,
        RequestCount INT NOT NULL DEFAULT 1,
        LastActiveAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserActivitySlot PRIMARY KEY CLUSTERED (ActivityDate, TimeSlot, UserId)
    );

    CREATE NONCLUSTERED INDEX IX_UserActivitySlot_Date_Slot
    ON wf.UserActivitySlot (ActivityDate, TimeSlot);

    CREATE NONCLUSTERED INDEX IX_UserActivitySlot_User_Date
    ON wf.UserActivitySlot (UserId, ActivityDate);
END
GO
