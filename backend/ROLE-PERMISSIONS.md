# Role membership and permission grants

Migration 170 replaces the single-profile permission ceiling with explicit grants and many-to-many user membership. Migration 171 updates the authorization predicates of the current native document procedures without changing document construction, numbering, target guards, or approval evidence.

- A user receives the union of grants from every assigned role. An omitted grant does not deny a grant from another role.
- All permissions displayed in Role Management are editable. ADMIN is available as a template. Templates supply initial grants and business scope; creating a role does not automatically grant every permission.
- Existing users retain their assignments and permission defaults during migration. Existing migration files are not rewritten.
- Role membership includes inactive users. Deletion is refused until every member has moved out. Built-in roles use the same deletion rule.
- Batch assignment supports add, remove, and replace. A user must retain at least one role. The legacy primary role is the highest-ranked assigned template, retained for existing business rules and integrations.
- Role changes, assignment, account status changes, and deletion are serialized. The transaction must leave at least one active user with both `roles.manage` and `users.manage`.
- Permissions are read from the database on authenticated requests. Membership changes revoke existing sessions. Access As uses the intersection of the actor's and target's grants and retains the actual actor; it does not provide a way around a removed grant.
- Data scope is the union of assigned template scopes. Employee mapping, approval stages, actual-person/self-approval rules, native writer flags, and document target guards remain separate checks.

The role member tab shows all assigned users, their status, and their complete role list. User Management displays role chips and supports per-user or batch membership editing. Batch password resets and LINE unlinking retain their existing audit and session revocation behavior.

## Verification and rollout

Run the backend regression suite, offline migration rehearsal, frontend build, and the admin-management Playwright suite. Deploy the migrations and code together on UAT first. Verify union grants, immediate permission removal, membership changes, inactive-member deletion protection, last-administrator rollback, and all four batch actions on isolated test accounts. Keep runtime writer flags unchanged. Promote the identical commit to Production only after UAT verification and a fresh verified backup.

Deployment receipts and operational screenshots belong in private evidence storage; this document contains no operational account data.
