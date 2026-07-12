const db = require('./db');
db.ownerReady.then(async () => {
  try {
    await db.ownerPool.request().query(`
      CREATE TABLE wf.SalesOrder (
          Id                INT IDENTITY(1,1) PRIMARY KEY,
          WfRef             NVARCHAR(30)  NOT NULL UNIQUE,
          SoPrefix          NVARCHAR(5)   NOT NULL CONSTRAINT chk_SO_Prefix CHECK (SoPrefix IN ('I','K','AI')),
          CustId            NVARCHAR(20)  NOT NULL,
          CustName          NVARCHAR(200) NOT NULL,
          TruckPlate        NVARCHAR(30)  NULL,
          ControlTicketNo   NVARCHAR(20)  NULL,
          DeliveryDate      DATE          NULL,
          Remark            NVARCHAR(500) NULL,
          Status            NVARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
            CONSTRAINT chk_SO_Status CHECK (Status IN ('DRAFT','CONFIRMED','PICKING','SHIPPED','IMPORTED','CANCELLED')),
          SalesUserId       INT           NULL REFERENCES wf.AppUser(Id),
          ImportFilePath    NVARCHAR(500) NULL,
          ImportedDocuNo    NVARCHAR(20)  NULL,
          ImportedAt        DATETIME2     NULL,
          CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
          UpdatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE()
      )
    `);
    console.log('Created successfully');
  } catch(e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
});
