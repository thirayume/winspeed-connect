-- ==============================================================================
-- 243_prototype_costlist_2026.sql
-- สร้างข้อมูลต้นแบบ Costlist เริ่มใช้ 1/1/2569 - 31/12/2569 (2026-01-01 ถึง 2026-12-31)
-- คำนวณค่าเริ่มต้นที่ 70% ของ Pricelist ปัดลงเป็นเลขลงตัวหลักร้อย (เช่น 17210 -> 17200)
-- ==============================================================================

IF OBJECT_ID('wf.CostBook', 'U') IS NOT NULL AND OBJECT_ID('wf.CostBookLine', 'U') IS NOT NULL
BEGIN
    DECLARE @CostBookId INT;
    SELECT TOP 1 @CostBookId = Id FROM wf.CostBook 
    WHERE EffectiveFrom = '2026-01-01' AND EffectiveTo = '2026-12-31';

    IF @CostBookId IS NULL
    BEGIN
        INSERT INTO wf.CostBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Status, Note, CreatedAt, UpdatedAt)
        VALUES (N'ตารางราคาทุนต้นแบบ พ.ศ. 2569 (70% Pricelist)', '2026-01', '2026-01-01', '2026-12-31', 'ACTIVE', N'คำนวณค่าเริ่มต้นที่ 70% ของ Pricelist ปัดลงเป็นเลขลงตัวหลักร้อย', GETUTCDATE(), GETUTCDATE());
        
        SET @CostBookId = SCOPE_IDENTITY();
    END

    -- บันทึกรายการราคาต้นทุน 70% ของราคากลางจาก PriceBook ที่มีอยู่
    IF OBJECT_ID('wf.PriceBookLine', 'U') IS NOT NULL AND OBJECT_ID('wf.PriceBook', 'U') IS NOT NULL
    BEGIN
        ;WITH LatestPrices AS (
            SELECT 
                pbl.GoodId,
                pbl.GoodCode,
                pbl.GoodName,
                pbl.GoodGroupId,
                pbl.GoodGroupName,
                pbl.Unit,
                pbl.Price,
                ROW_NUMBER() OVER (PARTITION BY pbl.GoodId ORDER BY pb.Id DESC, pbl.Id DESC) as rn
            FROM wf.PriceBookLine pbl
            JOIN wf.PriceBook pb ON pb.Id = pbl.PriceBookId
            WHERE pb.Status IN ('ACTIVE', 'APPROVED', 'ARCHIVED')
              AND pbl.Price IS NOT NULL
              AND pbl.Price > 0
        )
        INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note, UpdatedAt)
        SELECT 
            @CostBookId,
            lp.GoodId,
            lp.GoodCode,
            lp.GoodName,
            lp.GoodGroupId,
            lp.GoodGroupName,
            ISNULL(lp.Unit, N'ตัน'),
            FLOOR((lp.Price * 0.70) / 100.0) * 100.0,
            N'คำนวณ 70% จากราคาขาย ' + CAST(CAST(lp.Price AS INT) AS NVARCHAR(20)) + N' บาท/ตัน',
            GETUTCDATE()
        FROM LatestPrices lp
        WHERE lp.rn = 1
          AND NOT EXISTS (
              SELECT 1 FROM wf.CostBookLine cbl 
              WHERE cbl.CostBookId = @CostBookId AND cbl.GoodId = lp.GoodId
          );
    END

    -- เพิ่มสินค้าแม่ปุ๋ย/ปุ๋ยสูตรจาก EMGood ที่ยังไม่มีในตารางต้นทุน
    IF OBJECT_ID('dbo.EMGood', 'U') IS NOT NULL
    BEGIN
        INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note, UpdatedAt)
        SELECT 
            @CostBookId,
            CAST(g.GoodID AS NVARCHAR(50)),
            g.GoodCode,
            g.GoodName1,
            g.GoodGroupID,
            gg.GoodGroupName,
            ISNULL(u.GoodUnitName, N'ตัน'),
            NULL,
            N'ยังไม่มีราคาขายตั้งต้นใน Pricelist',
            GETUTCDATE()
        FROM dbo.EMGood g WITH (NOLOCK)
        LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
        LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = g.MainGoodUnitID
        WHERE g.GoodGroupID IN (1003, 1004)
          AND ISNULL(g.Inactive, 'A') = 'A'
          AND NOT EXISTS (
              SELECT 1 FROM wf.CostBookLine cbl 
              WHERE cbl.CostBookId = @CostBookId AND cbl.GoodId = CAST(g.GoodID AS NVARCHAR(50))
          );
    END
END
GO
