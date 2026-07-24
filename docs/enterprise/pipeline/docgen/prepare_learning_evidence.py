#!/usr/bin/env python3
"""Create a source-bound screenshot library for learning candidates.

The script copies current Playwright screenshots without modifying pixels,
records hashes/provenance, and classifies evidence boundaries. It never treats
loading or empty-state screenshots as proof of a successful business outcome.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
ENTERPRISE = HERE.parent.parent
REPO = ENTERPRISE.parent.parent
EVIDENCE_PATH = REPO / "test-results" / "e2e-evidence.json"
OUTPUT = ENTERPRISE / "05-UI-SCREENSHOTS" / "candidate" / "20260723-e2e-current"


SCREENSHOTS = {
    "e2e/comprehensive-sales.spec.ts": {
        "name": "01-sales-multi-bill-verification-gate.png",
        "role": "SALES / COUNTER_SALES",
        "use": "training",
        "caption": "Multi-bill trip detail used to explain the verification gate and document grouping.",
        "boundary": "Automated synthetic data; not accounting sign-off.",
    },
    "e2e/uat-full-loop.spec.ts#1": {
        "name": "02-sales-so-draft-loading-boundary.png",
        "role": "SALES",
        "use": "boundary",
        "caption": "Loading overlay after SO action; use only for the duplicate-action prevention drill.",
        "boundary": "Loading state does not prove that the SO was saved successfully.",
    },
    "e2e/uat-full-loop.spec.ts#2": {
        "name": "03-manager-admin-paper-trail.png",
        "role": "MANAGER / ADMIN",
        "use": "training",
        "caption": "Paper Trail card after verification/confirmation flow.",
        "boundary": "Supports navigation and trace examples; business approval remains manual.",
    },
    "e2e/uat-full-loop.spec.ts#3": {
        "name": "04-counter-sales-truckscale-health.png",
        "role": "COUNTER_SALES",
        "use": "training",
        "caption": "TruckScale health banner and lookup controls.",
        "boundary": "Development MySQL evidence; not production scale calibration.",
    },
    "e2e/uat-full-loop.spec.ts#4": {
        "name": "05-warehouse-empty-result-boundary.png",
        "role": "WAREHOUSE",
        "use": "boundary",
        "caption": "Warehouse empty-result view used for exception and escalation training.",
        "boundary": "Empty result does not prove pick/load/ship completion.",
    },
    "e2e/uat-full-loop.spec.ts#5": {
        "name": "06-admin-final-paper-trail-empty-boundary.png",
        "role": "ADMIN",
        "use": "boundary",
        "caption": "Paper Trail search with no visible card, retained for evidence completeness.",
        "boundary": "Does not prove SHIPPED state or final audit completion.",
    },
    "e2e/workflow.spec.ts#ADMIN": {
        "name": "07-admin-dashboard-after-access-as.png",
        "role": "ADMIN",
        "use": "training",
        "caption": "Admin dashboard after the Access As navigation test.",
        "boundary": "The screenshot does not itself display START/STOP audit records.",
    },
    "e2e/workflow.spec.ts#SALES": {
        "name": "08-sales-quotation-loading-boundary.png",
        "role": "SALES",
        "use": "boundary",
        "caption": "Quotation loading overlay used in safe retry training.",
        "boundary": "Loading state does not prove Quotation access or save completion.",
    },
    "e2e/workflow.spec.ts#COUNTER_SALES": {
        "name": "09-counter-sales-truckscale-navigation.png",
        "role": "COUNTER_SALES",
        "use": "training",
        "caption": "Counter Sales can reach TruckScale and see explicit health.",
        "boundary": "Navigation/health evidence only; no production ticket was matched.",
    },
    "e2e/workflow.spec.ts#WAREHOUSE": {
        "name": "10-warehouse-scale-queue-empty-boundary.png",
        "role": "WAREHOUSE",
        "use": "boundary",
        "caption": "Warehouse scale queue empty state used for exception handling.",
        "boundary": "Does not prove that loading or weighing completed.",
    },
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def mapping_key(test: dict) -> str:
    file = test["file"]
    title = test["title"]
    if file.endswith("comprehensive-sales.spec.ts"):
        return file
    if file.endswith("uat-full-loop.spec.ts"):
        for step in range(1, 6):
            if f"> {step}." in title:
                return f"{file}#{step}"
    if file.endswith("workflow.spec.ts"):
        for role in ("ADMIN", "SALES", "COUNTER_SALES", "WAREHOUSE"):
            if f"> {role} " in title:
                return f"{file}#{role}"
    raise KeyError(f"No learning screenshot mapping for {title}")


def main() -> int:
    evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8-sig"))
    if evidence.get("status") != "PASSED_COMPLETE" or not evidence.get("sourceStability", {}).get("stable"):
        raise SystemExit("Current Playwright evidence must be PASSED_COMPLETE with stable source.")
    if evidence.get("counts", {}).get("total") != 10 or evidence.get("counts", {}).get("passed") != 10:
        raise SystemExit("Expected complete 10/10 Playwright evidence.")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for test in evidence["tests"]:
        key = mapping_key(test)
        config = SCREENSHOTS[key]
        attachment = next(
            item for item in test.get("attachments", [])
            if item.get("contentType") == "image/png" and item.get("path")
        )
        source = REPO / attachment["path"]
        target = OUTPUT / config["name"]
        shutil.copyfile(source, target)
        source_hash = sha256(source)
        target_hash = sha256(target)
        if source_hash != target_hash:
            raise SystemExit(f"Screenshot copy hash mismatch: {target}")
        records.append(
            {
                "sequence": len(records) + 1,
                "file": target.relative_to(REPO).as_posix(),
                "sha256": target_hash,
                "source": source.relative_to(REPO).as_posix(),
                "sourceSha256": source_hash,
                "test": test["title"],
                "testStatus": test["status"],
                "role": config["role"],
                "recommendedUse": config["use"],
                "caption": config["caption"],
                "evidenceBoundary": config["boundary"],
            }
        )

    manifest = {
        "schemaVersion": 1,
        "kind": "WS-Sale-App Learning Screenshot Evidence",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "Review",
        "approvalBoundary": "Training/documentation candidate only; does not replace manual business UAT.",
        "e2e": {
            "runId": evidence["runId"],
            "status": evidence["status"],
            "commit": evidence["git"]["commit"],
            "sourceStable": evidence["sourceStability"]["stable"],
            "counts": evidence["counts"],
            "environment": evidence["environment"],
            "evidenceSha256": sha256(EVIDENCE_PATH),
        },
        "summary": {
            "total": len(records),
            "training": sum(item["recommendedUse"] == "training" for item in records),
            "boundary": sum(item["recommendedUse"] == "boundary" for item in records),
        },
        "screenshots": records,
    }
    manifest_path = OUTPUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    readme = [
        "---",
        'documentId: "WF-EVD-101"',
        'title: "Current E2E Screenshot Evidence for Learning Artifacts"',
        'version: "v1.0-candidate"',
        "status: Review",
        'owner: "QA Lead / Training Lead"',
        "normative: false",
        "---",
        "# Current E2E Screenshot Evidence for Learning Artifacts",
        "",
        f"- Run: `{evidence['runId']}`",
        f"- Result: `{evidence['status']}` — 10/10 passed",
        f"- Commit: `{evidence['git']['commit']}`; source stable during run",
        f"- Recommended training screenshots: {manifest['summary']['training']}",
        f"- Boundary-only screenshots: {manifest['summary']['boundary']}",
        "",
        "ภาพถูกคัดลอกโดยไม่แก้ pixel และตรวจ SHA-256 ตรงกับ Playwright attachment ทุกไฟล์ "
        "รายการ loading/empty state ต้องใช้เพื่อสอน exception เท่านั้น ไม่ใช่หลักฐานว่าธุรกิจเสร็จสมบูรณ์",
        "",
        "| # | File | Role | Use | Evidence boundary |",
        "|---:|---|---|---|---|",
    ]
    for item in records:
        readme.append(
            f"| {item['sequence']} | `{Path(item['file']).name}` | {item['role']} | "
            f"{item['recommendedUse']} | {item['evidenceBoundary']} |"
        )
    (OUTPUT / "README.md").write_text("\n".join(readme) + "\n", encoding="utf-8")
    print(json.dumps(manifest["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
