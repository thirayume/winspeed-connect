-- Candidate schema only: this does not enable a WinSpeed guard or authorize a cut.
-- No application route is exposed until the linked trigger and review flow pass UAT.
IF OBJECT_ID('wf.CouponReservation','U') IS NULL OR OBJECT_ID('dbo.WFCoupon','U') IS NULL
BEGIN RAISERROR('COUPON_NATIVE_AUTH_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL
BEGIN
 CREATE TABLE wf.CouponNativeCutAuthorization (
  Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  DocuNo NVARCHAR(25) NOT NULL,
  State VARCHAR(16) NOT NULL CONSTRAINT DF_CouponNativeAuth_State_220 DEFAULT 'ACTIVE',
  ExpiresAt DATETIME2 NOT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponNativeAuth_Created_220 DEFAULT GETUTCDATE(),
  EffectiveUserId INT NOT NULL,
  ActorUserId INT NOT NULL,
  Reason NVARCHAR(500) NOT NULL,
  ClosedAt DATETIME2 NULL,
  ClosedBy INT NULL,
  ClosedActorId INT NULL,
  CloseReason NVARCHAR(500) NULL,
  CONSTRAINT UQ_CouponNativeAuth_IdDoc_220 UNIQUE(Id,DocuNo),
  CONSTRAINT CK_CouponNativeAuth_State_220 CHECK(State IN ('ACTIVE','CANCELLED','EXPIRED','USED'))
 );
END;
-- A separate active registry provides uniqueness without filtered indexes:
-- WinSpeed SQL2008 sessions may not have the SET options needed to update them.
IF OBJECT_ID('wf.CouponNativeActiveDocument','U') IS NULL
BEGIN
 CREATE TABLE wf.CouponNativeActiveDocument (
  DocuNo NVARCHAR(25) NOT NULL PRIMARY KEY,
  AuthorizationId BIGINT NOT NULL UNIQUE,
  CONSTRAINT FK_CouponNativeActiveDoc_Header_220 FOREIGN KEY(AuthorizationId,DocuNo)
    REFERENCES wf.CouponNativeCutAuthorization(Id,DocuNo)
 );
END;
IF OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL
BEGIN
 CREATE TABLE wf.CouponNativeCutAuthorizationLine (
  Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  AuthorizationId BIGINT NOT NULL,
  ReservationId INT NOT NULL,
  CouponId INT NOT NULL,
  AuthorizedQty DECIMAL(12,4) NOT NULL,
  CONSTRAINT FK_CouponNativeAuthLine_Header_220 FOREIGN KEY(AuthorizationId) REFERENCES wf.CouponNativeCutAuthorization(Id),
  CONSTRAINT FK_CouponNativeAuthLine_Reservation_220 FOREIGN KEY(ReservationId) REFERENCES wf.CouponReservation(Id),
  CONSTRAINT FK_CouponNativeAuthLine_Coupon_220 FOREIGN KEY(CouponId) REFERENCES dbo.WFCoupon(CouponID),
  CONSTRAINT CK_CouponNativeAuthLine_Qty_220 CHECK(AuthorizedQty>0),
  CONSTRAINT UQ_CouponNativeAuthLine_Coupon_220 UNIQUE(AuthorizationId,CouponId),
  CONSTRAINT UQ_CouponNativeAuthLine_Reservation_220 UNIQUE(AuthorizationId,ReservationId)
 );
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponNativeCutAuthorizationLine') AND name='IX_CouponNativeAuthLine_Reservation_220')
 CREATE INDEX IX_CouponNativeAuthLine_Reservation_220 ON wf.CouponNativeCutAuthorizationLine(ReservationId,AuthorizationId);
GO
