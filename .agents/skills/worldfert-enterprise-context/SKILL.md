---
name: worldfert-enterprise-context
description: Read the canonical WorldFert operating context from docs before changing this project.
---
# WorldFert context loader

Business documentation lives only in docs/. This file is an agent entrypoint, not a second context pack.

1. Read [handover package & SSOT index](../../../docs/sale-app/handover/README.md) and [agent collaboration log](../../../docs/sale-app/handover/AGENT-COLLABORATION.md).
2. Read [master documentation index](../../../docs/README.md) and [source authority](../../../docs/context/source-authority.md).
3. For workflow work read [requirements and document trace](../../../docs/01-REQUIREMENTS-AND-TRACE.md).
4. For implementation roadmap and status read [implementation plan](../../../docs/03-IMPLEMENTATION-PLAN.md).
5. For deployment read [on-premises & CI/CD](../../../docs/02-ONPREM-AND-CICD.md) and [database runbook](../../../docs/DEPLOYMENT-DATABASE-RUNBOOK-V1.7.0.md).

Current code and migration definitions determine software behavior. Distinguish enforced controls, human procedures, historical observations and inferences. Never promote an archived statement into a verified current fact. Update the canonical docs in the same change when behavior changes. Preserve existing user edits and do not expose credentials or operational personal data in reusable documentation.
