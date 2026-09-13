-- Migration 122: SO-10 Admin-Only Report Header Master & Multiple Report Templates
-- Provides centralized database storage, versioning, audit logging, and report-level assignment for report headers and templates.

-- 1. Table wf.ReportHeaderMaster
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'wf.ReportHeaderMaster') AND type = N'U')
BEGIN
    CREATE TABLE wf.ReportHeaderMaster (
        HeaderId           INT IDENTITY(1,1) NOT NULL,
        HeaderCode         VARCHAR(50)       NOT NULL,
        HeaderName         NVARCHAR(100)     NOT NULL,
        CompanyNameTh      NVARCHAR(200)     NOT NULL,
        CompanyNameEn      NVARCHAR(200)     NOT NULL,
        BranchNameTh       NVARCHAR(100)     NULL,
        BranchCode         VARCHAR(20)       NULL,
        AddressTh          NVARCHAR(400)     NOT NULL,
        Tel                NVARCHAR(100)     NULL,
        Fax                NVARCHAR(100)     NULL,
        TaxId              VARCHAR(30)       NOT NULL,
        LogoUrl            NVARCHAR(MAX)     NULL,
        FooterNote         NVARCHAR(300)     NULL,
        TermsAndConditions NVARCHAR(MAX)     NULL,
        Version            INT               NOT NULL CONSTRAINT DF_ReportHeaderMaster_Version DEFAULT 1,
        IsActive           BIT               NOT NULL CONSTRAINT DF_ReportHeaderMaster_IsActive DEFAULT 1,
        CreatedBy          VARCHAR(50)       NOT NULL,
        CreatedAt          DATETIME2         NOT NULL CONSTRAINT DF_ReportHeaderMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedBy          VARCHAR(50)       NOT NULL,
        UpdatedAt          DATETIME2         NOT NULL CONSTRAINT DF_ReportHeaderMaster_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ReportHeaderMaster PRIMARY KEY CLUSTERED (HeaderId),
        CONSTRAINT UQ_ReportHeaderMaster_Code UNIQUE (HeaderCode)
    );
    PRINT 'Created table wf.ReportHeaderMaster';
END
GO

-- 2. Table wf.ReportTemplate
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'wf.ReportTemplate') AND type = N'U')
BEGIN
    CREATE TABLE wf.ReportTemplate (
        TemplateId             INT IDENTITY(1,1) NOT NULL,
        TemplateCode           VARCHAR(50)       NOT NULL,
        TemplateName           NVARCHAR(100)     NOT NULL,
        HeaderId               INT               NOT NULL,
        ReportCategory         VARCHAR(50)       NULL,
        Orientation            VARCHAR(20)       NOT NULL CONSTRAINT DF_ReportTemplate_Orientation DEFAULT 'portrait',
        PaperSize              VARCHAR(20)       NOT NULL CONSTRAINT DF_ReportTemplate_PaperSize DEFAULT 'A4',
        ShowPageNumber         BIT               NOT NULL CONSTRAINT DF_ReportTemplate_ShowPageNumber DEFAULT 1,
        ShowSignatures         BIT               NOT NULL CONSTRAINT DF_ReportTemplate_ShowSignatures DEFAULT 1,
        SignatureSalesLabel    NVARCHAR(100)     NULL CONSTRAINT DF_ReportTemplate_SigSales DEFAULT N'พนักงานขาย',
        SignatureApprovedLabel NVARCHAR(100)     NULL CONSTRAINT DF_ReportTemplate_SigAppv DEFAULT N'ผู้อนุมัติ',
        SignatureWarehouseLabel NVARCHAR(100)    NULL CONSTRAINT DF_ReportTemplate_SigWh DEFAULT N'พนักงานคลังสินค้า',
        CustomCss              NVARCHAR(MAX)     NULL,
        Version                INT               NOT NULL CONSTRAINT DF_ReportTemplate_Version DEFAULT 1,
        IsActive               BIT               NOT NULL CONSTRAINT DF_ReportTemplate_IsActive DEFAULT 1,
        CreatedBy              VARCHAR(50)       NOT NULL,
        CreatedAt              DATETIME2         NOT NULL CONSTRAINT DF_ReportTemplate_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedBy              VARCHAR(50)       NOT NULL,
        UpdatedAt              DATETIME2         NOT NULL CONSTRAINT DF_ReportTemplate_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ReportTemplate PRIMARY KEY CLUSTERED (TemplateId),
        CONSTRAINT UQ_ReportTemplate_Code UNIQUE (TemplateCode),
        CONSTRAINT FK_ReportTemplate_Header FOREIGN KEY (HeaderId) REFERENCES wf.ReportHeaderMaster (HeaderId)
    );
    PRINT 'Created table wf.ReportTemplate';
END
GO

-- 3. Table wf.ReportTemplateAssignment
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'wf.ReportTemplateAssignment') AND type = N'U')
BEGIN
    CREATE TABLE wf.ReportTemplateAssignment (
        AssignmentId INT IDENTITY(1,1) NOT NULL,
        ReportKey    VARCHAR(50)       NOT NULL,
        TemplateId   INT               NOT NULL,
        IsActive     BIT               NOT NULL CONSTRAINT DF_ReportTemplateAssignment_IsActive DEFAULT 1,
        UpdatedBy    VARCHAR(50)       NOT NULL,
        UpdatedAt    DATETIME2         NOT NULL CONSTRAINT DF_ReportTemplateAssignment_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ReportTemplateAssignment PRIMARY KEY CLUSTERED (AssignmentId),
        CONSTRAINT UQ_ReportTemplateAssignment_ReportKey UNIQUE (ReportKey),
        CONSTRAINT FK_ReportTemplateAssignment_Template FOREIGN KEY (TemplateId) REFERENCES wf.ReportTemplate (TemplateId)
    );
    PRINT 'Created table wf.ReportTemplateAssignment';
END
GO

-- 4. Seed baseline Header Masters
IF NOT EXISTS (SELECT 1 FROM wf.ReportHeaderMaster WHERE HeaderCode = 'CORP_HQ')
BEGIN
    INSERT INTO wf.ReportHeaderMaster (
        HeaderCode, HeaderName, CompanyNameTh, CompanyNameEn,
        BranchNameTh, BranchCode, AddressTh, Tel, Fax, TaxId,
        LogoUrl, FooterNote, TermsAndConditions, Version, IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
        'CORP_HQ',
        N'สำนักงานใหญ่ (World Fert HQ)',
        N'บริษัท เวิลด์ เฟอท จำกัด',
        'WORLD FERT CO., LTD.',
        N'สำนักงานใหญ่',
        '00000',
        N'933 อาคารรวมทุนไทย ชั้น 11 ถนนมหาไชย แขวงวังบูรพาภิรมย์ เขตพระนคร กรุงเทพมหานคร 10200',
        '02 2218444, 02 2263069',
        '02 2263069',
        '0105531024397',
        NULL,
        N'เอกสารนี้ออกโดยระบบอัตโนมัติ WINSpeed-Connect · บริษัท เวิลด์ เฟอท จำกัด',
        N'เอกสารนี้เป็นหลักฐานแสดงการบันทึกข้อมูลในระบบ ERP ห้ามแก้ไข ดัดแปลง หรือปลอมแปลงเอกสารโดยเด็ดขาด',
        1, 1, 'SYSTEM', 'SYSTEM'
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM wf.ReportHeaderMaster WHERE HeaderCode = 'FACTORY_LOGISTICS')
BEGIN
    INSERT INTO wf.ReportHeaderMaster (
        HeaderCode, HeaderName, CompanyNameTh, CompanyNameEn,
        BranchNameTh, BranchCode, AddressTh, Tel, Fax, TaxId,
        LogoUrl, FooterNote, TermsAndConditions, Version, IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
        'FACTORY_LOGISTICS',
        N'โรงงานและคลังสินค้า (Factory & Logistics)',
        N'บริษัท เวิลด์ เฟอท จำกัด',
        'WORLD FERT CO., LTD.',
        N'สาขาโรงงานนครปฐม',
        '00001',
        N'88 หมู่ 3 ตำบลบางระกำ อำเภอนครชัยศรี จังหวัดนครปฐม 73120',
        '034 123456, 034 123457',
        '034 123458',
        '0105531024397',
        NULL,
        N'เอกสารคลังสินค้าและการชั่งน้ำหนัก · แผนกควบคุมการจ่ายสินค้าโรงงาน',
        N'น้ำหนักสินค้าที่ตรวจนับและชั่งผ่านตาชั่งมาตรฐานโรงงาน ใช้เป็นเกณฑ์ในการส่งมอบสินค้า',
        1, 1, 'SYSTEM', 'SYSTEM'
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM wf.ReportHeaderMaster WHERE HeaderCode = 'FINANCE_REBATE')
BEGIN
    INSERT INTO wf.ReportHeaderMaster (
        HeaderCode, HeaderName, CompanyNameTh, CompanyNameEn,
        BranchNameTh, BranchCode, AddressTh, Tel, Fax, TaxId,
        LogoUrl, FooterNote, TermsAndConditions, Version, IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
        'FINANCE_REBATE',
        N'การเงินและบัญชีรีเบท (Finance & Rebate Audit)',
        N'บริษัท เวิลด์ เฟอท จำกัด',
        'WORLD FERT CO., LTD.',
        N'ฝ่ายบัญชีและการเงิน',
        '00000',
        N'933 อาคารรวมทุนไทย ชั้น 11 ถนนมหาไชย แขวงวังบูรพาภิรมย์ เขตพระนคร กรุงเทพมหานคร 10200',
        '02 2218444',
        '02 2263069',
        '0105531024397',
        NULL,
        N'เอกสารตรวจสอบทางการเงินและสิทธิประโยชน์การค้า (Rebate Settlement Audit)',
        N'การอนุมัติยอดรีเบทมีผลสมบูรณ์เมื่อผ่านการพิจารณาตามเกณฑ์ Policy Schedule ครบทุกระดับ',
        1, 1, 'SYSTEM', 'SYSTEM'
    );
END
GO

-- 5. Seed baseline Report Templates
DECLARE @HqId INT = (SELECT HeaderId FROM wf.ReportHeaderMaster WHERE HeaderCode = 'CORP_HQ');
DECLARE @LogisticsId INT = (SELECT HeaderId FROM wf.ReportHeaderMaster WHERE HeaderCode = 'FACTORY_LOGISTICS');
DECLARE @FinanceId INT = (SELECT HeaderId FROM wf.ReportHeaderMaster WHERE HeaderCode = 'FINANCE_REBATE');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplate WHERE TemplateCode = 'TPL_STANDARD_TABLE')
BEGIN
    INSERT INTO wf.ReportTemplate (
        TemplateCode, TemplateName, HeaderId, ReportCategory,
        Orientation, PaperSize, ShowPageNumber, ShowSignatures,
        SignatureSalesLabel, SignatureApprovedLabel, SignatureWarehouseLabel,
        Version, IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
        'TPL_STANDARD_TABLE',
        N'แม่แบบมาตรฐานบริษัท (Corporate Standard Table)',
        @HqId,
        'sales',
        'portrait',
        'A4',
        1, 1,
        N'พนักงานขาย',
        N'ผู้อนุมัติ',
        N'พนักงานคลังสินค้า',
        1, 1, 'SYSTEM', 'SYSTEM'
    );
END

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplate WHERE TemplateCode = 'TPL_LOGISTICS_DISPATCH')
BEGIN
    INSERT INTO wf.ReportTemplate (
        TemplateCode, TemplateName, HeaderId, ReportCategory,
        Orientation, PaperSize, ShowPageNumber, ShowSignatures,
        SignatureSalesLabel, SignatureApprovedLabel, SignatureWarehouseLabel,
        Version, IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
        'TPL_LOGISTICS_DISPATCH',
        N'แม่แบบคลังสินค้าและการจัดส่ง (Logistics & Weigh Dispatch)',
        @LogisticsId,
        'logistics',
        'portrait',
        'A4',
        1, 1,
        N'ผู้จัดทำ/เบิก',
        N'ผู้ตรวจสอบจ่ายสินค้า',
        N'พนักงานชั่ง/คลังสินค้า',
        1, 1, 'SYSTEM', 'SYSTEM'
    );
END

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplate WHERE TemplateCode = 'TPL_FINANCIAL_REBATE')
BEGIN
    INSERT INTO wf.ReportTemplate (
        TemplateCode, TemplateName, HeaderId, ReportCategory,
        Orientation, PaperSize, ShowPageNumber, ShowSignatures,
        SignatureSalesLabel, SignatureApprovedLabel, SignatureWarehouseLabel,
        Version, IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
        'TPL_FINANCIAL_REBATE',
        N'แม่แบบการเงินและรีเบท (Rebate Audit & Settlement)',
        @FinanceId,
        'rebate',
        'landscape',
        'A4',
        1, 1,
        N'ผู้ยื่นคำขอ',
        N'ผู้จัดการเขต/สายงาน',
        N'ฝ่ายบัญชีและการเงิน',
        1, 1, 'SYSTEM', 'SYSTEM'
    );
END
GO

-- 6. Seed baseline Report Template Assignments
DECLARE @StdTplId INT = (SELECT TemplateId FROM wf.ReportTemplate WHERE TemplateCode = 'TPL_STANDARD_TABLE');
DECLARE @LogisticsTplId INT = (SELECT TemplateId FROM wf.ReportTemplate WHERE TemplateCode = 'TPL_LOGISTICS_DISPATCH');
DECLARE @FinanceTplId INT = (SELECT TemplateId FROM wf.ReportTemplate WHERE TemplateCode = 'TPL_FINANCIAL_REBATE');

-- Fallback default
IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'default')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('default', @StdTplId, 1, 'SYSTEM');

-- Logistics & Warehouse Archetypes
IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'customer-dispatch')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('customer-dispatch', @LogisticsTplId, 1, 'SYSTEM');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'wh-dispatch-daily')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('wh-dispatch-daily', @LogisticsTplId, 1, 'SYSTEM');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'weighbridge-log')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('weighbridge-log', @LogisticsTplId, 1, 'SYSTEM');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'weighbridge-detail')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('weighbridge-detail', @LogisticsTplId, 1, 'SYSTEM');

-- Rebate & Financial Archetypes
IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'rebate-claim-detail')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('rebate-claim-detail', @FinanceTplId, 1, 'SYSTEM');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'rebate-pools')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('rebate-pools', @FinanceTplId, 1, 'SYSTEM');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'cn-rebate')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('cn-rebate', @FinanceTplId, 1, 'SYSTEM');

IF NOT EXISTS (SELECT 1 FROM wf.ReportTemplateAssignment WHERE ReportKey = 'ar-aging-summary')
    INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, IsActive, UpdatedBy) VALUES ('ar-aging-summary', @FinanceTplId, 1, 'SYSTEM');

PRINT 'Seeded baseline header masters, templates, and assignments.';
GO
