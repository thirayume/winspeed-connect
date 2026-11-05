-- @transaction
-- Versioned operational sign-off. Uses only the Sale-App schema and SQL Server 2008 syntax.
IF OBJECT_ID(N'wf.ReadinessSignoff', N'U') IS NULL
BEGIN
    CREATE TABLE wf.ReadinessSignoff (
        TopicCode          VARCHAR(40)    NOT NULL,
        Revision           INT            NOT NULL,
        Status             VARCHAR(12)    NOT NULL,
        ProcedureText      NVARCHAR(1500) NOT NULL,
        EvidenceReference  NVARCHAR(500)  NOT NULL,
        Reviewer           NVARCHAR(100)  NOT NULL,
        ReviewDate         DATE           NULL,
        SavedByUserId      INT            NOT NULL,
        SavedByUsername    NVARCHAR(50)   NOT NULL,
        SavedAt            DATETIME2      NOT NULL CONSTRAINT DF_ReadinessSignoff_SavedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ReadinessSignoff PRIMARY KEY (TopicCode, Revision),
        CONSTRAINT CK_ReadinessSignoff_Revision CHECK (Revision > 0),
        CONSTRAINT CK_ReadinessSignoff_Status CHECK (Status IN ('PENDING','IN_REVIEW','CONFIRMED')),
        CONSTRAINT CK_ReadinessSignoff_Confirmed CHECK (
            Status <> 'CONFIRMED' OR
            (LEN(ProcedureText) > 0 AND LEN(EvidenceReference) > 0 AND LEN(Reviewer) > 0 AND ReviewDate IS NOT NULL)
        )
    );
END;
GO
