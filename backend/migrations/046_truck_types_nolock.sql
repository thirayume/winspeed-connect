ALTER TABLE [wf].[TruckType] ADD [MaxWeightMain] DECIMAL(10,2) NULL;
ALTER TABLE [wf].[TruckType] ADD [MaxWeightTrailer] DECIMAL(10,2) NULL;
GO
UPDATE [wf].[TruckType] 
SET [MaxWeightMain] = CAST([SlotCount] * [MaxTonPerSlot] AS DECIMAL(10,2)),
    [MaxWeightTrailer] = CASE WHEN [TrailerSlotCount] IS NOT NULL AND [TrailerSlotCount] > 0 THEN CAST([TrailerSlotCount] * [MaxTonPerSlot] AS DECIMAL(10,2)) ELSE NULL END;
GO
ALTER TABLE [wf].[TruckType] DROP COLUMN [SlotCount];
ALTER TABLE [wf].[TruckType] DROP COLUMN [TrailerSlotCount];
ALTER TABLE [wf].[TruckType] DROP COLUMN [MaxTonPerSlot];
GO
