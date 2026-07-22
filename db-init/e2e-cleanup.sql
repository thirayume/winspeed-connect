-- E2E Test Data Cleanup

-- E2E users are stable fixtures. Keep them because SO/audit evidence from prior
-- runs can reference their IDs; deleting/reinserting them makes tests non-deterministic
-- and can violate foreign keys. Each seed run resets their role, password and EmpId.
PRINT 'E2E stable users retained for evidence traceability';

-- Optional: Cleanup generated test Quotations and Sales Orders
-- Since we don't want to accidentally delete real data, we only delete ones created by e2e_sales
-- (Uncomment these if strict cleanup is needed, else let test data remain for review)
/*
DECLARE @UserId INT = (SELECT Id FROM wf.AppUser WHERE Username = 'e2e_sales');
IF @UserId IS NOT NULL
BEGIN
  -- Delete Quotation dependencies
  DELETE FROM wf.QuotationLine WHERE QuoteId IN (SELECT Id FROM wf.Quotation WHERE SalesUserId = @UserId);
  DELETE FROM wf.QuotationSourceSO WHERE QuoteId IN (SELECT Id FROM wf.Quotation WHERE SalesUserId = @UserId);
  DELETE FROM wf.Quotation WHERE SalesUserId = @UserId;
  
  -- Delete Sales Order dependencies
  DELETE FROM wf.SalesOrderLine WHERE SoId IN (SELECT Id FROM wf.SalesOrder WHERE SalesUserId = @UserId);
  DELETE FROM wf.SalesOrderAudit WHERE SoId IN (SELECT Id FROM wf.SalesOrder WHERE SalesUserId = @UserId);
  DELETE FROM wf.UnlockRequest WHERE SoId IN (SELECT Id FROM wf.SalesOrder WHERE SalesUserId = @UserId);
  DELETE FROM wf.SalesOrder WHERE SalesUserId = @UserId;
END
*/
