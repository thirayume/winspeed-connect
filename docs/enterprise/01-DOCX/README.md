---
documentId: "WF-ART-001"
title: "01-DOCX — Word Renders (สร้างจาก markdown)"
version: "v1.0"
status: Draft
owner: "Documentation Owner"
normative: false
---
# 01-DOCX — Word Renders (สร้างจาก markdown)

โฟลเดอร์นี้เก็บ **ไฟล์ Word ฉบับสมบูรณ์ชุดเดียว** ที่ pipeline สร้างจาก markdown (source of truth):

> **`WorldFert-Enterprise-Documentation-v1.0.docx`** — รวมทุก section (00–09) เป็นเล่มเดียว มีสารบัญ

## วิธีสร้าง/อัปเดต

```powershell
cd "..\pipeline"; ./build-docs.ps1 -Render     # ต้องมี pandoc (https://pandoc.org)
```

- ไฟล์ Word แยกเป็นชิ้น (รุ่น v8, 49 ไฟล์) ถูกย้ายไปที่ `_archive/superseded-binaries/docx-v8-fragments/` แล้ว — **ไม่ใช้ต่อ**
- markdown คือฉบับจริงเสมอ; ห้ามแก้ที่ .docx โดยตรง (จะถูกเขียนทับเมื่อ render ใหม่)
