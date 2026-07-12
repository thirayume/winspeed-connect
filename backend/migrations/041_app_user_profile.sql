-- Migration: 041_app_user_profile
-- Description: Add Address, Phone, Email, IdCardNo, TaxId, and SignatureFile to wf.AppUser

IF COL_LENGTH('wf.AppUser', 'Address') IS NULL
BEGIN
    ALTER TABLE wf.AppUser ADD Address NVARCHAR(500) NULL;
END
GO

IF COL_LENGTH('wf.AppUser', 'Phone') IS NULL
BEGIN
    ALTER TABLE wf.AppUser ADD Phone NVARCHAR(50) NULL;
END
GO

IF COL_LENGTH('wf.AppUser', 'Email') IS NULL
BEGIN
    ALTER TABLE wf.AppUser ADD Email NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('wf.AppUser', 'IdCardNo') IS NULL
BEGIN
    ALTER TABLE wf.AppUser ADD IdCardNo NVARCHAR(20) NULL;
END
GO

IF COL_LENGTH('wf.AppUser', 'TaxId') IS NULL
BEGIN
    ALTER TABLE wf.AppUser ADD TaxId NVARCHAR(20) NULL;
END
GO

IF COL_LENGTH('wf.AppUser', 'SignatureFile') IS NULL
BEGIN
    ALTER TABLE wf.AppUser ADD SignatureFile NVARCHAR(255) NULL;
END
GO
