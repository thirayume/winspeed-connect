SELECT TOP 5 * FROM SOInvHD WHERE ARID IS NOT NULL;
-- แล้วเช็คว่า ARID ตรงกับ PK ของตารางใด (น่าจะ ARTrans/AROption?)
SELECT name FROM sys.tables WHERE name LIKE 'AR%';

SELECT TOP 20 h.DocuNo, h.DocuDate, d.FromGoodID, d.PriceAmnt, d.PriceFlag
FROM ICPriceHD h JOIN ICPriceDT d ON h.DocuID = d.DocuID
ORDER BY h.DocuDate DESC;

SELECT g.GoodCode, g.MainGoodUnitID, g.SaleGoodUnitID, u.GoodUnitName, u.RateQty
FROM EMGood g JOIN EMGoodUnit u ON g.SaleGoodUnitID = u.GoodUnitID
WHERE g.GoodCode LIKE '%15-5-35%';

SELECT SERVERPROPERTY('Collation'), @@VERSION;