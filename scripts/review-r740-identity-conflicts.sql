/* Read-only identity review for R740-SRV\SQL2008.
   Displays personnel information in SSMS; do not commit result sets to git.
   A matching Username alone is not proof of a matching person. */
SET NOCOUNT ON;
IF DB_NAME() <> N'dbwins_worldfert9'
BEGIN
  RAISERROR(N'Connect to dbwins_worldfert9 before running this report.', 16, 1);
  RETURN;
END;

-- Result 1: the same numeric ID identifies different usernames in two databases.
SELECT a.Id AS PrimaryID, a.Username AS PrimaryUsername, a.DisplayName AS PrimaryName, a.EmpId AS PrimaryEmployee,
       b.Id AS SecondaryID, b.Username AS SecondaryUsername, b.DisplayName AS SecondaryName, b.EmpId AS SecondaryEmployee
FROM dbwins_worldfert9.wf.AppUser a
JOIN dbwins_worldfert2.wf.AppUser b ON a.Id = b.Id
WHERE RTRIM(a.Username) COLLATE DATABASE_DEFAULT <> RTRIM(b.Username) COLLATE DATABASE_DEFAULT
ORDER BY a.Id;

-- Result 2: the same username has different numeric IDs; a reviewer must verify identity.
SELECT a.Id AS PrimaryID, a.Username AS PrimaryUsername, a.DisplayName AS PrimaryName, a.EmpId AS PrimaryEmployee,
       b.Id AS SecondaryID, b.Username AS SecondaryUsername, b.DisplayName AS SecondaryName, b.EmpId AS SecondaryEmployee
FROM dbwins_worldfert9.wf.AppUser a
JOIN dbwins_worldfert2.wf.AppUser b ON RTRIM(a.Username) COLLATE DATABASE_DEFAULT = RTRIM(b.Username) COLLATE DATABASE_DEFAULT
WHERE a.Id <> b.Id
ORDER BY a.Username;
