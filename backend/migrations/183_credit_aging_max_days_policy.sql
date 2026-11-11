-- Migration 183: เพิ่มการตั้งค่านโยบาย Aging สูงสุด (CREDIT_AGING_MAX_DAYS) และการแสดง Popup แจ้งเตือนในหน้าขาย (CREDIT_AGING_ALERT_POPUP)
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CREDIT_AGING_MAX_DAYS')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('CREDIT_AGING_MAX_DAYS', '90', N'เกณฑ์ Aging สูงสุดตามนโยบายบริษัท (วัน, ค่าเริ่มต้น 90 วัน) ใช้แจ้งเตือนเมื่อกำหนดค่าลูกค้าเกินหรือมีหนี้ค้างเกินเกณฑ์');

    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CREDIT_AGING_ALERT_POPUP')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('CREDIT_AGING_ALERT_POPUP', 'true', N'แสดงหน้าต่างแจ้งเตือนยืนยันก่อนบันทึกบิลขายเมื่อลูกค้าเกินวงเงินหรือเกิน Aging (true = แสดง, false = แจ้งเตือนในหน้าจอเท่านั้น)');
END;
GO

