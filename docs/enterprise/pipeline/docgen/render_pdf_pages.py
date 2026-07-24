#!/usr/bin/env python3
"""Render every PDF page to PNG using pypdfium2 and emit a compact JSON result."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pypdfium2 as pdfium


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--dpi", type=int, default=150)
    args = parser.parse_args()

    src = args.pdf.resolve()
    out = args.output_dir.resolve()
    if not src.exists():
        raise FileNotFoundError(src)
    out.mkdir(parents=True, exist_ok=True)

    pdf = pdfium.PdfDocument(str(src))
    scale = args.dpi / 72
    files = []
    for index, page in enumerate(pdf):
        target = out / f"page-{index + 1:03d}.png"
        page.render(scale=scale).to_pil().save(target)
        files.append(str(target))
    print(json.dumps({"pdf": str(src), "pages": len(pdf), "dpi": args.dpi, "files": files}, indent=2))


if __name__ == "__main__":
    main()

