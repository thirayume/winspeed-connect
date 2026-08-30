---
name: worldfert-enterprise-context
description: Verified operating context for WorldFert WS-Sale-App, Prosoft WINSpeed, TruckScale, and their integrations. Use when analyzing, changing, testing, documenting, training, or operating this project so that document types, statuses, roles, controls, database targets, coupon rules, weighing rules, and cross-system ownership remain consistent with the current source code and verified operating evidence.
---

# WorldFert Enterprise Context

Use this skill as the project context pack. Treat the source code as authoritative for system behavior and use verified operating evidence for native WINSpeed and TruckScale steps that are not represented in the codebase.

## Start here

1. Read [source-authority.md](references/source-authority.md) before making factual claims.
2. Read only the domain references needed for the task:
   - [winspeed.md](references/winspeed.md)
   - [truckscale.md](references/truckscale.md)
   - [ws-sale-app.md](references/ws-sale-app.md)
   - [integration-controls.md](references/integration-controls.md)
3. Read [current-state.md](references/current-state.md) for known corrections, deployment differences, and unresolved evidence.

## Non-negotiable truths

- App confirmation creates a native WINSpeed booking document type `103`; it does not create delivery document type `104`.
- Native WINSpeed approval stamps the same `103` document. The approval-queue gate is `CheckAll='Y'`; `ValidDays=0` is not the gate.
- Native WINSpeed operators create `104`, calculate coupons per line, then save. A saved `104` is read-only to normal operators.
- The verified document chain is `I → I → C → J` and `K → K → D → N` for booking, delivery, coupon redemption, and invoice.
- App shipping writes a weigh result to both the App database and TruckScale. The TruckScale integration is controlled two-way integration, not read-only.
- For TruckScale write-back, an open row matching `movebill` is preferred; exact plate is the fallback. Multiple open rows by plate are ambiguous and must not be guessed.
- Normal App flow is Draft → Verify → Confirm → Pick → Load → Ship. Abnormal weights require an operationally documented reason, approver, and evidence even where UI/API enforcement is incomplete.
- Never edit native `dbo` operational data directly as an operator. Use approved UI workflows or authorized `wf` procedures and retain evidence.

## Working rules

- Separate facts into `system-enforced`, `procedural control`, and `inference`. Do not present a procedural rule as a hard software gate.
- State screen captions only when verified. For standalone TruckScale, describe verified fields and record semantics because native captions may differ by installation.
- Do not claim that the latest live `I/C` test completed unless a post-save result is available.
- Do not expose credentials, hosts, customer PII, or test identifiers in reusable documentation.
- When old memory or documents conflict with current code or this pack, flag the stale statement and follow the authority order in `source-authority.md`.

## Maintaining this pack

Update the pack in the same change whenever behavior, database migrations, workflow ownership, roles, or document-series rules change. Add the source path, evidence date, and any unresolved point. Keep task-specific SOP wording outside this pack.
