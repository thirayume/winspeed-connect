-- ======================================================
-- WINSpeed CRUD Test Queries for Sales Orders
-- Use these to verify data integrity and API behavior
-- ======================================================

-- 1. READ: Fetch all Sales Orders with Customer names
-- (Similar to GET /api/sales-orders)
SELECT TOP 10 
    S.SOID, 
    S.DocuNo, 
    S.DocuDate, 
    C.CustName, 
    S.NetAmnt,
    CASE 
        WHEN S.clearflag = 'Y' THEN 'Shipped'
        WHEN S.PkgStatus = 'Y' THEN 'Picking'
        WHEN S.AppvFlag = 'Y' THEN 'Confirmed'
        ELSE 'Draft'
    END as CurrentStatus
FROM SOHD S
LEFT JOIN EMCust C ON S.CustID = C.CustID
ORDER BY S.DocuDate DESC;


-- 2. CREATE: Insert a new Sales Order (Transaction recommended)
-- Replace @NextID with a valid unused integer ID
BEGIN TRANSACTION;
    -- Insert Header
    INSERT INTO SOHD (SOID, DocuNo, CustID, DocuDate, NetAmnt, AppvFlag, PkgStatus, clearflag, BrchID, EmpID)
    VALUES (9999, 'SO-TEST-001', 1, GETDATE(), 550.00, 'N', 'N', 'N', 1, 1);

    -- Insert Details (Line items)
    INSERT INTO SODT (SOID, ListNo, GoodID, GoodQty1, GoodPrice1, DocuType, GoodType, VatType)
    VALUES (9999, 1, 101, 2, 275.00, '112', '1', '1');
COMMIT;


-- 3. UPDATE: Change Order Status to "Confirmed"
-- (Similar to PUT /api/sales-orders/:id/status)
UPDATE SOHD 
SET AppvFlag = 'Y' 
WHERE SOID = 9999;


-- 4. UPDATE: Change Customer and Totals
-- (Similar to PUT /api/sales-orders/:id)
UPDATE SOHD 
SET CustID = 2, NetAmnt = 600.00 
WHERE SOID = 9999;


-- 5. READ: Check specific order details
SELECT D.*, G.GoodName1 
FROM SODT D
JOIN EMGood G ON D.GoodID = G.GoodID
WHERE D.SOID = 9999;


-- 6. DELETE: Cleanup test data
-- (Similar to DELETE /api/sales-orders/:id)
BEGIN TRANSACTION;
    DELETE FROM SODT WHERE SOID = 9999;
    DELETE FROM SOHD WHERE SOID = 9999;
COMMIT;
