USE dbwins_worldfert9;
GO

-- SalesOrderAudit
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrderAudit') AND name = 'IX_SalesOrderAudit_SOID')
BEGIN
    CREATE NONCLUSTERED INDEX IX_SalesOrderAudit_SOID ON wf.SalesOrderAudit(SOID);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('wf.SalesOrderAudit') AND name = 'IX_SalesOrderAudit_CreatedAt')
BEGIN
    CREATE NONCLUSTERED INDEX IX_SalesOrderAudit_CreatedAt ON wf.SalesOrderAudit(CreatedAt);
END
GO

-- RebateClaim
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'IX_RebateClaim_PoolId')
BEGIN
    CREATE NONCLUSTERED INDEX IX_RebateClaim_PoolId ON wf.RebateClaim(PoolId);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'IX_RebateClaim_Status')
BEGIN
    CREATE NONCLUSTERED INDEX IX_RebateClaim_Status ON wf.RebateClaim(Status);
END
GO

-- PaperTrail
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('wf.PaperTrail') AND name = 'IX_PaperTrail_CreatedAt')
BEGIN
    CREATE NONCLUSTERED INDEX IX_PaperTrail_CreatedAt ON wf.PaperTrail(CreatedAt DESC);
END
GO

PRINT 'Additional indexes created successfully.';
