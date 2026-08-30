# Source authority

Evidence baseline: 2026-08-25, Asia/Bangkok.

## Precedence

Use the first applicable source in this order:

1. Current source code and database migration stored in this repository.
2. Current database schema, stored procedure, and verified query result.
3. Current native-system observation with a saved result or post-condition.
4. Latest supplied chat transcript, limited to what the transcript actually confirms.
5. Current operator documentation.
6. `MEMORY.md` and historical notes.

When two sources conflict, record the conflict rather than blending them.

## Primary repository sources

- App routes and business rules: `backend/routes/`, `backend/services/`, `WSSale-App/src/`.
- Native integration procedures: `backend/migrations/` and `db-init/`.
- TruckScale schema evidence: `backend/db_truckscale.sql` and TruckScale services/routes.
- Test/runtime targeting: `backend/db.js`, `e2e/`, `scripts/smoke-api.js`.
- Historical operating evidence: `docs/`, `MEMORY.md`, and the latest user-supplied chat transcript.

## Claim labels

- **System-enforced**: a current UI/API/database guard rejects or prevents the action.
- **Procedural control**: the operator must comply, but software may not fully enforce it.
- **Observed**: verified through a native UI or saved database outcome.
- **Inference**: derived from schema or code without a complete native UI observation; state it explicitly.

## Known stale claims

Do not repeat these claims:

- `ValidDays=0` blocks WINSpeed approval. The actual approval gate is `CheckAll='Y'`.
- App confirmation creates WINSpeed `104`. It creates `103` only.
- TruckScale integration is read-only. The App also inserts pre-weigh data and writes shipped weights/products back.
- Existing coupon gaps can never be repaired. Normal operators cannot repair a saved `104`, but authorized support can use controlled `wf` procedures.
- Approval creates a separate AI document. Approval updates the same `103` document.

## Documentation standard

For procedures, always define scope, role, trigger, prerequisites, numbered steps, acceptance criteria, records, exceptions, stop points, escalation, and revision control. Use Thai labels with the verified English/system term in parentheses on first use.
