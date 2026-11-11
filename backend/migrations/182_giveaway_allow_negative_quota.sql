-- Migration 182: เพิ่มการตั้งค่า GIVEAWAY_ALLOW_NEGATIVE_QUOTA ใน wf.SystemSetting (ค่าเริ่มต้น = 'true')
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'GIVEAWAY_ALLOW_NEGATIVE_QUOTA')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('GIVEAWAY_ALLOW_NEGATIVE_QUOTA', 'true', N'อนุญาตให้ออกบิลของแถมได้แม้โควต้าไม่พอ (ยอดโควต้าติดลบ)');
END;

