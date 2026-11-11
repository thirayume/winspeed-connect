-- Migration 185: Multi-customer Sale Trip approval threshold & approval workflow
-- Requires approval before confirming a Sale Trip when distinct customer count >= configurable threshold (default 2)

IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES (
            'TRIP_MULTI_CUST_APPROVAL_MIN_CUSTOMERS',
            '2',
            N'จำนวนลูกค้าขั้นต่ำต่อ 1 Sale Trip ที่ต้องส่งขออนุมัติก่อนยืนยันการสั่งซื้อ (ราย, ค่าเริ่มต้น 2 รายขึ้นไป)'
        );
END;
GO

IF OBJECT_ID('wf.ApprovalPolicy', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.ApprovalPolicy WHERE CaseType = 'MULTI_CUST_TRIP' AND IsActive = 1)
        INSERT INTO wf.ApprovalPolicy (CaseType, MinAmount, MaxAmount, RequiredRole, EffectiveFrom, Note)
        VALUES (
            'MULTI_CUST_TRIP',
            NULL,
            NULL,
            'APPROVER',
            '2025-01-01',
            N'อนุมัติเปิด Sale Trip ที่มีลูกค้าหลายรายขึ้นไปก่อนยืนยันการสั่งซื้อ'
        );
END;
GO

IF OBJECT_ID('wf.TripMultiCustomerApproval', 'U') IS NULL
BEGIN
    CREATE TABLE wf.TripMultiCustomerApproval (
        Id                   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TripId               INT NOT NULL CONSTRAINT FK_TripMultiCustApp_Trip FOREIGN KEY REFERENCES wf.SalesTrip(TripId),
        TripCode             VARCHAR(50) NULL,
        TripRevision         INT NOT NULL CONSTRAINT DF_TripMultiCustApp_Rev DEFAULT (1),
        MinCustomersSetting  INT NOT NULL CONSTRAINT DF_TripMultiCustApp_MinCust DEFAULT (2),
        CustomerCount        INT NOT NULL,
        CustomerIdsJson      NVARCHAR(MAX) NOT NULL,
        CustomerSummary      NVARCHAR(1000) NULL,
        CustomerFingerprint  VARCHAR(64) NOT NULL,
        OrderCount           INT NOT NULL CONSTRAINT DF_TripMultiCustApp_Orders DEFAULT (0),
        TotalTon             DECIMAL(18,3) NOT NULL CONSTRAINT DF_TripMultiCustApp_Ton DEFAULT (0),
        TotalAmount          DECIMAL(18,2) NOT NULL CONSTRAINT DF_TripMultiCustApp_Amt DEFAULT (0),
        ReasonText           NVARCHAR(500) NULL,
        Status               VARCHAR(20) NOT NULL CONSTRAINT DF_TripMultiCustApp_Status DEFAULT ('PENDING'),
        RequestedBy          INT NOT NULL CONSTRAINT FK_TripMultiCustApp_ReqBy FOREIGN KEY REFERENCES wf.AppUser(Id),
        ApprovedBy           INT NULL CONSTRAINT FK_TripMultiCustApp_AppBy FOREIGN KEY REFERENCES wf.AppUser(Id),
        ApprovedAt           DATETIME2 NULL,
        ApprovalNote         NVARCHAR(500) NULL,
        CreatedAt            DATETIME2 NOT NULL CONSTRAINT DF_TripMultiCustApp_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt            DATETIME2 NULL
    );

    CREATE INDEX IX_TripMultiCustApp_TripId ON wf.TripMultiCustomerApproval(TripId);
    CREATE INDEX IX_TripMultiCustApp_Status ON wf.TripMultiCustomerApproval(Status);
END;
GO

