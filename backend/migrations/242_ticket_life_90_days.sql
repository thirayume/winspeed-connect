-- @transaction
-- Owner policy, 17 November 2026: a fertilizer ticket's standard life is 90 days from its sales order (104).
-- An expired ticket may still be used; the app warns and records a TICKET_USED_EXPIRED rule incident.
-- Only wf.SystemSetting changes. Idempotent. Rollback: down/242_ticket_life_90_days.down.sql.
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TICKET_EXPIRY_DEFAULT_DAYS')
        UPDATE wf.SystemSetting
        SET SettingValue = '90',
            Description = N'อายุมาตรฐานของตั๋วปุ๋ยนับจากวันที่ใบสั่งขาย (วัน) — หมดอายุแล้วยังใช้ได้ แต่แจ้งเตือนและบันทึกเหตุการณ์ผิดปกติ',
            UpdatedAt = GETUTCDATE()
        WHERE SettingKey = 'TICKET_EXPIRY_DEFAULT_DAYS'
          AND (SettingValue IS NULL OR SettingValue <> '90'
               OR Description IS NULL OR Description <> N'อายุมาตรฐานของตั๋วปุ๋ยนับจากวันที่ใบสั่งขาย (วัน) — หมดอายุแล้วยังใช้ได้ แต่แจ้งเตือนและบันทึกเหตุการณ์ผิดปกติ');
    ELSE
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description, UpdatedAt)
        VALUES ('TICKET_EXPIRY_DEFAULT_DAYS', '90',
                N'อายุมาตรฐานของตั๋วปุ๋ยนับจากวันที่ใบสั่งขาย (วัน) — หมดอายุแล้วยังใช้ได้ แต่แจ้งเตือนและบันทึกเหตุการณ์ผิดปกติ',
                GETUTCDATE());
END
