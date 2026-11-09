-- @transaction
-- SQL Server 2008 R2 compatible. Idempotent.
-- บทบาทพิเศษ SEPARATION สำหรับพนักงานสิ้นสภาพ (ลาออก เกษียณ เลิกจ้าง หมดสัญญา เสียชีวิต)
-- เป็น Protected System Role เช่นเดียวกับ ADMIN: ห้ามลบ ห้ามแก้ไข ไม่มีบทบาทต้นแบบ และไม่มีสิทธิ์ใดๆ
-- ผู้ใช้ที่ได้รับบทบาทนี้จะถูกตั้งค่า IsActive = 0 (Inactive) และปลดจากผังตำแหน่งทันที

IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'SEPARATION')
    BEGIN
        INSERT INTO wf.RoleProfile (Code, Name, BaseRole, DisabledActions, Revision, UpdatedBy, UpdatedAt)
        VALUES ('SEPARATION', N'Separation', 'NONE', '[]', 1, 1, GETUTCDATE());
    END
    ELSE
    BEGIN
        -- ปรับปรุงกรณีที่มีการสร้างไว้ก่อนหน้า ให้ไม่มีบทบาทต้นแบบ
        UPDATE wf.RoleProfile
        SET BaseRole = 'NONE', Name = N'Separation'
        WHERE Code = 'SEPARATION' AND (BaseRole <> 'NONE' OR Name <> N'Separation');
    END;

    -- ถอดสิทธิ์ทั้งหมดออกจากบทบาท SEPARATION
    DELETE FROM wf.RolePermission WHERE RoleCode = 'SEPARATION';
END;

-- ปรับสถานะผู้ใช้ทุกคนที่ถือบทบาท SEPARATION ให้เป็น Inactive ทันที
IF OBJECT_ID('wf.UserRole', 'U') IS NOT NULL AND OBJECT_ID('wf.AppUser', 'U') IS NOT NULL
BEGIN
    UPDATE u
    SET u.IsActive = 0,
        u.PositionCode = NULL,
        u.AuthVersion = u.AuthVersion + 1,
        u.UpdatedAt = GETUTCDATE()
    FROM wf.AppUser u
    WHERE (
        EXISTS (SELECT 1 FROM wf.UserRole r WHERE r.UserId = u.Id AND r.RoleCode = 'SEPARATION')
        OR u.RoleCode = 'SEPARATION'
        OR u.Role = 'SEPARATION'
    )
    AND (u.IsActive = 1 OR u.PositionCode IS NOT NULL);
END;

