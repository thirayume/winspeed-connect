IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[TruckType]') AND type in (N'U'))
BEGIN
    CREATE TABLE [wf].[TruckType] (
        [Id] VARCHAR(50) NOT NULL PRIMARY KEY,
        [Name] NVARCHAR(100) NOT NULL,
        [SlotCount] INT NOT NULL,
        [TrailerSlotCount] INT NULL,
        [MaxTonPerSlot] DECIMAL(10,2) NOT NULL,
        [IsActive] BIT NOT NULL DEFAULT 1,
        [CreatedAt] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        [UpdatedAt] DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );

    -- Seed initial data matching existing hardcoded TRUCK_TYPES
    INSERT INTO [wf].[TruckType] ([Id], [Name], [SlotCount], [TrailerSlotCount], [MaxTonPerSlot]) VALUES
    ('4w', N'รถกระบะ', 2, NULL, 1.5),
    ('6w', N'รถ 6 ล้อ', 4, NULL, 2.5),
    ('10w', N'รถ 10 ล้อ', 6, NULL, 2.5),
    ('trailer', N'รถพ่วง', 6, 6, 3.0),
    ('semi-trailer', N'รถเทรลเลอร์', 10, NULL, 3.0),
    ('container', N'ตู้คอนเทนเนอร์', 8, NULL, 3.5);
END
GO
