---
name: output-files
description: Reference to study output files in ./out/ directory
metadata: 
  node_type: memory
  type: reference
  originSessionId: da6c89bd-7eca-48d2-a863-b9894015ab77
---

Working root = `M:\My Drive\World Fert`. Research files under `wf\out\`; deliverables at root.

**Deliverables (root):** `WorldFert_SRS_v3_0.docx`, `WorldFert_Workflow.pptx`

**Research + scripts (`wf\out\`):**
| File | Contents |
|---|---|
| `open_items_answers.md` | Answers to 3 open questions + evidence queries |
| `relationships.csv` | 50 convention-FK pairs, verified Y/N |
| `gl_flow.md` | GL chain + correct/incorrect joins + 5-row sample |
| `schema_inventory.md` | All tables across 6 modules with columns + row counts |
| `findings.md` | Empty tables, risks, recommendations |
| `workflow.md` | Document flow + 8 scenarios + join keys |
| `workflow_tests.md` | 16 real test queries + outputs |
| `wf_schema.sql` | DDL for schema wf (T-SQL/SQL Server, not yet run) |
| `make_srs_v3.js` / `make_pptx_v3.js` | Generators → output to root |
