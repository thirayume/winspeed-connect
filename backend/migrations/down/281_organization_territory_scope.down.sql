-- @transaction
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF EXISTS(SELECT 1 FROM wf.SalesTerritory) BEGIN RAISERROR('ROLLBACK_TERRITORY_DATA_REQUIRES_REVIEW',16,1);RETURN;END;
DROP PROCEDURE wf.sp_ValidateEmployeeLink;
DROP PROCEDURE wf.sp_OrganizationSaveEmployee;
DROP FUNCTION wf.fn_OrganizationJsonQuote;
DROP FUNCTION wf.fn_IsOrganizationSuperior;
DROP FUNCTION wf.fn_UserInOrganizationScope;
DROP FUNCTION wf.fn_UserScopeAll;
DROP TABLE wf.SalesTerritoryProvince;
DROP TABLE wf.SalesTerritory;
ALTER TABLE wf.OrgPosition DROP CONSTRAINT CK_OrgPosition_RecordScope;
ALTER TABLE wf.OrgPosition DROP CONSTRAINT DF_OrgPosition_RecordScope;
ALTER TABLE wf.OrgPosition DROP COLUMN RecordScope;
GO
