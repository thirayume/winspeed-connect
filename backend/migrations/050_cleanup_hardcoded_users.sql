-- =============================================================
-- 050_cleanup_hardcoded_users.sql
-- Remove hardcoded users to rely purely on EmpCode sync (except admin)
-- =============================================================

DELETE FROM wf.AppUser 
WHERE Username IN (
    'chai', 'bass', 'arm', 'ann', 'um', 'ton', 'na', 'don', 'oh', 
    'surachai', 'manas', 'sales1', 'sales2'
);
GO
