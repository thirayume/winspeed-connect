"""Validate current UAT candidates and source-aligned diagram renders.

This validator is read-only for artifacts. It writes one JSON evidence report and
never changes approval, release, or baseline state.
"""

from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
ENTERPRISE = REPO_ROOT / "docs" / "enterprise"
REPORT_DIR = ENTERPRISE / "pipeline" / "reports"
DOCX = ENTERPRISE / "01-DOCX" / "candidate" / "UAT-Full-Loop-Run-Plan-v1.0.docx"
XLSX = ENTERPRISE / "06-XLSX" / "candidate" / "UAT-Master-Script-v1.0.xlsx"
PREVIEW_DIR = ENTERPRISE / "06-XLSX" / "candidate" / "preview"
BUILD_REPORT = REPORT_DIR / "uat-candidate-build-report.json"
DIAGRAM_REPORT = ENTERPRISE / "04-DIAGRAMS-PNG" / "candidate" / "source-aligned" / "source-diagram-render-report.json"
OUTPUT_REPORT = REPORT_DIR / "uat-artifact-validation-report.json"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
SS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def validate_zip(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        broken = archive.testzip()
        if broken:
            raise ValueError(f"Corrupt ZIP member in {path.name}: {broken}")


def validate_docx(build: dict) -> dict:
    validate_zip(DOCX)
    with zipfile.ZipFile(DOCX) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        text = "".join(node.text or "" for node in document.iter(f"{W}t"))
        heading_counts: dict[str, int] = {}
        for paragraph in document.iter(f"{W}p"):
            style = paragraph.find(f"{W}pPr/{W}pStyle")
            if style is None:
                continue
            style_id = style.get(f"{W}val", "")
            if style_id.lower().startswith("heading"):
                heading_counts[style_id] = heading_counts.get(style_id, 0) + 1
        media = [name for name in archive.namelist() if name.startswith("word/media/") and not name.endswith("/")]
        doc_props = list(document.iter(f"{WP}docPr"))
        missing_alt = [node.get("id") for node in doc_props if not (node.get("descr") or "").strip()]
        table_count = sum(1 for _ in document.iter(f"{W}tbl"))

    render = build["outputs"]["docx"]["render"]
    render_dir = Path(render["outputDir"]) / "word-pdfium"
    pages = sorted(render_dir.glob("page-*.png"))
    page_metrics = []
    for page in pages:
        with Image.open(page) as image:
            gray = image.convert("L")
            histogram = gray.histogram()
            non_white = sum(histogram[:250])
            ratio = non_white / (image.width * image.height)
            page_metrics.append({"page": page.name, "width": image.width, "height": image.height, "nonWhiteRatio": round(ratio, 6)})

    checks = {
        "zipIntegrity": True,
        "documentIdCurrent": "WF-QA-022" in text and "WF-QA-010  |  Review" not in text,
        "tableCount": table_count,
        "mediaCount": len(media),
        "inlineImageProperties": len(doc_props),
        "missingImageAltCount": len(missing_alt),
        "headingCounts": heading_counts,
        "renderStatus": render["status"],
        "renderMethod": render["method"],
        "renderedPageCount": len(pages),
        "blankPageCount": sum(1 for metric in page_metrics if metric["nonWhiteRatio"] < 0.002),
        "pageSizeSet": sorted({f'{metric["width"]}x{metric["height"]}' for metric in page_metrics}),
        "minNonWhiteRatio": min((metric["nonWhiteRatio"] for metric in page_metrics), default=0),
        "maxNonWhiteRatio": max((metric["nonWhiteRatio"] for metric in page_metrics), default=0),
    }
    passed = (
        checks["documentIdCurrent"]
        and checks["tableCount"] >= 60
        and checks["mediaCount"] >= 5
        and checks["missingImageAltCount"] == 0
        and checks["renderStatus"] == "PASSED"
        and checks["renderedPageCount"] == render["pages"] == 22
        and checks["blankPageCount"] == 0
    )
    return {"status": "PASSED" if passed else "FAILED", "path": str(DOCX), "sha256": sha256(DOCX), "checks": checks, "pageMetrics": page_metrics}


def validate_xlsx(build: dict) -> dict:
    validate_zip(XLSX)
    with zipfile.ZipFile(XLSX) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet_names = [sheet.get("name", "") for sheet in workbook.findall(f".//{SS}sheet")]
        table_count = len([name for name in archive.namelist() if name.startswith("xl/tables/table") and name.endswith(".xml")])
        formula_count = 0
        xml_text = []
        for name in archive.namelist():
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
                content = archive.read(name)
                root = ET.fromstring(content)
                formula_count += sum(1 for _ in root.iter(f"{SS}f"))
                xml_text.append(content.decode("utf-8", errors="replace"))
            elif name == "xl/sharedStrings.xml":
                xml_text.append(archive.read(name).decode("utf-8", errors="replace"))
        joined = "\n".join(xml_text)
        formula_errors = [token for token in ("#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A") if token in joined]

    previews = sorted(PREVIEW_DIR.glob("*.png"))
    preview_metrics = []
    for preview in previews:
        with Image.open(preview) as image:
            preview_metrics.append({"name": preview.name, "width": image.width, "height": image.height, "bytes": preview.stat().st_size})
    required_sheets = ["README", "Run Control", "Dashboard", "UAT Cases", "Full Loop", "Defects", "Evidence", "Sign-off", "Lookups"]
    checks = {
        "zipIntegrity": True,
        "documentIdCurrent": "WF-QA-022-XLSX" in joined,
        "sheetNames": sheet_names,
        "requiredSheetsPresent": all(name in sheet_names for name in required_sheets),
        "sheetCount": len(sheet_names),
        "tableCount": table_count,
        "formulaCount": formula_count,
        "formulaErrors": formula_errors,
        "previewCount": len(previews),
        "emptyPreviewCount": sum(1 for metric in preview_metrics if metric["bytes"] <= 0 or metric["width"] <= 1 or metric["height"] <= 1),
        "generatorExit": build["outputs"]["xlsx"]["generatorExit"],
    }
    passed = (
        checks["documentIdCurrent"]
        and checks["requiredSheetsPresent"]
        and checks["sheetCount"] == 9
        and checks["tableCount"] >= 3
        and not checks["formulaErrors"]
        and checks["previewCount"] == 9
        and checks["emptyPreviewCount"] == 0
    )
    return {"status": "PASSED" if passed else "FAILED", "path": str(XLSX), "sha256": sha256(XLSX), "checks": checks, "previewMetrics": preview_metrics}


def validate_diagrams() -> dict:
    report = read_json(DIAGRAM_REPORT)
    checks = []
    for output in report["outputs"]:
        path = Path(output["output"])
        with Image.open(path) as image:
            actual = {"width": image.width, "height": image.height}
        expected = output["actualPixels"]
        item = {
            "name": path.name,
            "exists": path.exists(),
            "shaMatches": sha256(path) == output["sha256"],
            "dimensionsMatch": actual == expected,
            "actualPixels": actual,
            "readableScale": actual["width"] >= 1200 and actual["height"] >= 1000,
        }
        checks.append(item)
    passed = len(checks) == 3 and all(item["exists"] and item["shaMatches"] and item["dimensionsMatch"] and item["readableScale"] for item in checks)
    return {"status": "PASSED" if passed else "FAILED", "report": str(DIAGRAM_REPORT), "renderer": report["renderer"], "checks": checks}


def main() -> int:
    build = read_json(BUILD_REPORT)
    docx = validate_docx(build)
    xlsx = validate_xlsx(build)
    diagrams = validate_diagrams()
    evidence = build["e2eEvidence"]
    evidence_passed = evidence["status"] == "PASSED_COMPLETE" and evidence["currentForHead"] and evidence["counts"]["passed"] == evidence["counts"]["total"] == 10
    status = "PASSED" if docx["status"] == xlsx["status"] == diagrams["status"] == "PASSED" and evidence_passed else "FAILED"
    report = {
        "schemaVersion": 1,
        "kind": "worldfert-uat-artifact-validation",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "sourceCommit": build["sourceCommit"],
        "e2eEvidenceCurrent": evidence_passed,
        "e2eEvidence": evidence,
        "docx": docx,
        "xlsx": xlsx,
        "diagrams": diagrams,
        "releaseStatus": "Review - business/manual UAT, human approval, baselines and strict release gate remain open",
    }
    OUTPUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": status, "report": str(OUTPUT_REPORT), "docx": docx["status"], "xlsx": xlsx["status"], "diagrams": diagrams["status"], "e2eEvidenceCurrent": evidence_passed}, ensure_ascii=False, indent=2))
    return 0 if status == "PASSED" else 1


if __name__ == "__main__":
    sys.exit(main())
