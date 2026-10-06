-- ============================================================================
-- 147_pthep_line_under_isan.sql
-- Interim org chart: the ปุ๋ยเทพ line reports to the Isan senior manager
--
-- Background (owner instruction 2026-10-07, SHARED-CONTEXT §123.6):
-- The owner asked Claude to use the preliminary org mapping, and to fill any needed
-- position left vacant from the database history.
-- - PTHEP-HEAD (หัวหน้าสายปุ๋ยเทพ) is vacant. In WINSpeed the last ผอ.ตรา ปุ๋ยเทพ
--   (EMEmp 1019) is no longer active.
-- - Both active ปุ๋ยเทพ salespeople (EMEmp 8010 and 9002) have EmpHead 1024, the Isan
--   senior manager (บุญเยี่ยม, position SMGR-ISAN).
-- - One user holds one position, so he cannot also hold PTHEP-HEAD. Instead the vacant
--   PTHEP-HEAD now reports to SMGR-ISAN. People stay on their real positions (SALE-PTHEP),
--   and the Isan senior manager sees their work as WINSpeed already shows.
--
-- Only moves the row when it is still where migration 102 put it (AMD-MKT), so a later
-- owner decision is never overwritten. Reverse by setting ReportsTo back to 'AMD-MKT', Tier 3.
--
-- SQL 2008 R2 safe; wf data only; no structure change.
-- ============================================================================

UPDATE wf.OrgPosition
SET ReportsTo = 'SMGR-ISAN',
    Tier = 4,
    Note = N'ชั่วคราว 2026-10-07: สายปุ๋ยเทพขึ้นกับผู้จัดการอาวุโสภาคอีสาน (หัวหน้าใน WINSpeed ของพนักงานขายปุ๋ยเทพ) จนกว่าจะมีหัวหน้าสายปุ๋ยเทพ'
WHERE PositionCode = 'PTHEP-HEAD'
  AND ReportsTo = 'AMD-MKT'
  AND EXISTS (SELECT 1 FROM wf.OrgPosition WHERE PositionCode = 'SMGR-ISAN');
GO
