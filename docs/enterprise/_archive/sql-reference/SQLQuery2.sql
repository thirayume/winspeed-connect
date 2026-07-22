USE [master];
CREATE LOGIN wf_reader WITH PASSWORD = 'ChangeMe_Strong#2026';
USE [dbwins_worldfert9];
CREATE USER wf_reader FOR LOGIN wf_reader;
ALTER ROLE db_datareader ADD MEMBER wf_reader;   
-- อ่านอย่างเดียวทั้ง DB
-- ไม่ให้สิทธิ์เขียนใดๆ บน dbo