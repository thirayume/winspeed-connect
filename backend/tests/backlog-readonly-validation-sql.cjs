'use strict';
// Generates a SELECT-only aggregate check, without executing it. Pin the SQL
// instance and rehearsal database separately before running its output.
const sql = require('../routes/reports').__testing.REPORTS['so-backlog'].sql;
const end = 'ORDER BY DocuDate DESC, CustName, GoodName';
if (!sql.includes(end) || sql.indexOf(end) !== sql.lastIndexOf(end)) throw new Error('Unexpected backlog query shape');
const body = sql.replace(end, '');
if (/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|INTO)\b/i.test(body)) throw new Error('Unexpected non-read-only statement');
const check = `SET NOCOUNT ON;
DECLARE @globalStartDate date = '20260101', @legacyCut date = '20220101';
SELECT 'candidate', COUNT_BIG(*),
  CAST(ISNULL(SUM(CASE WHEN q.DocuNo = N'ยอดค้างส่งยกมา' THEN q.BacklogTon ELSE 0 END),0) AS DECIMAL(19,3)),
  CAST(ISNULL(SUM(CASE WHEN q.DocuDate IS NOT NULL THEN q.BacklogTon ELSE 0 END),0) AS DECIMAL(19,3)),
  CAST(ISNULL(SUM(q.BacklogTon),0) AS DECIMAL(19,3))
FROM (${body}) q;
SELECT 'independent', COUNT_BIG(*),
  CAST(ISNULL(SUM(CASE WHEN hd.DocuDate < @globalStartDate THEN dt.RemaQty ELSE 0 END),0) AS DECIMAL(19,3)),
  CAST(ISNULL(SUM(CASE WHEN hd.DocuDate >= @globalStartDate AND (hd.DocuDate >= @legacyCut OR RTRIM(hd.TransRegistration) = N'ตั๋วคุม') THEN dt.RemaQty ELSE 0 END),0) AS DECIMAL(19,3)),
  CAST(ISNULL(SUM(dt.RemaQty),0) AS DECIMAL(19,3))
FROM dbo.SOHD hd JOIN dbo.SODT dt ON dt.SOID = hd.SOID
WHERE hd.DocuType=103 AND ISNULL(hd.DocuStatus,'N')<>'C' AND dt.RemaQty > 0;`;
process.stdout.write('SQL_BASE64=' + Buffer.from(check, 'utf8').toString('base64') + '\n');
