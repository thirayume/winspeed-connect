-- Rollback of 242: the standard ticket life returns to the earlier 180 days.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
    UPDATE wf.SystemSetting
    SET SettingValue = '180', Description = N'จำนวนวันอายุตั๋วปุ๋ยปริยายหลังเปิดบิล (วัน)', UpdatedAt = GETUTCDATE()
    WHERE SettingKey = 'TICKET_EXPIRY_DEFAULT_DAYS';
COMMIT TRANSACTION;
