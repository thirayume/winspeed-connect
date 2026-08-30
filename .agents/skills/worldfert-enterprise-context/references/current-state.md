# Current state and corrections

Evidence date: 2026-08-25.

## Repository state

The working branch contains current behavior through database migration `100`. Recent changes cover:

- default backend database target behavior;
- coupon issuing, repair, and coupon-gap monitoring;
- resolving product code (`GoodCode`) for load-sequence remarks;
- writing ordered Description-tab remarks to `dbo.SOHDRemark`.

Check `git status` and the migration table before making deployment claims.

## Database-target warning

- `backend/db.js` currently defaults the backend target to the remote Azure environment unless overridden.
- E2E helpers and `scripts/smoke-api.js` default to local unless their explicit target variables are set.
- Backend smoke scripts inherit `DB_MODE`, so their default can differ from E2E/smoke-api.

Always state and verify the target before executing a test or migration. Never infer the target from the script name.

## Deployment divergence

The most recently supplied operating chat indicated migrations through `100` on the primary target, while another remote target may still lack `098`–`100`. Verify the migration ledger before relying on coupon repair/watch or GoodCode resolution.

## Latest live-operation evidence

The latest supplied chat reaches entry of corrected `I` and `C` series values for a two-line delivery transaction and then instructs saving. It does not include a confirmed post-save result. Therefore:

- do not claim that this live transaction completed;
- do not use it as proof of final 104/coupon success;
- require a saved document number, coupon rows, and/or database post-condition for closure.

## Open control gaps

- Abnormal-weight reason/approver/photo is a required operating control, but enforcement is incomplete in some UI/API paths.
- The TruckScale production-host guard depends on configuration; an empty guard list weakens environmental protection.
- Ignored/stale documentation can lag source behavior. Revalidate statements against code before publication.

## Required follow-up when behavior changes

Update this pack and the SOP set when any of these change: native document type/series, approval query, role matrix, App status transition, coupon procedure, TruckScale matching/writing, weight tolerance, database target defaults, or migration deployment state.
