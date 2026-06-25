IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[CustomerExt]') AND type in (N'U'))
BEGIN
    CREATE TABLE [wf].[CustomerExt](
        [CustId] [varchar](20) NOT NULL,
        [Remark] [nvarchar](500) NULL,
        [UpdatedAt] [datetime] NULL DEFAULT (GETUTCDATE()),
    CONSTRAINT [PK_CustomerExt] PRIMARY KEY CLUSTERED 
    (
        [CustId] ASC
    )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
    ) ON [PRIMARY]
END
GO
