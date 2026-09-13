/**
 * admin-reports.js — Admin-Only Header Master & Report Templates Management (SO-10)
 * 
 * Strict Admin Access:
 * - All routes guarded by requireAuth and requireRole('ADMIN')
 * - All update/create operations require a mandatory 'reason'
 * - Records full before/after audit log in wf.ChangeEvent
 * - Bumps version number on edits
 */
const router = require('express').Router();
const { wfQuery, sql, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logChangeEvent } = require('../services/policy-contract');

// Enforce ADMIN role across all admin-reports endpoints
router.use(requireAuth);
router.use(requireRole('ADMIN'));

// ── 1. Header Master Endpoints ──────────────────────────────────────────

// GET /api/admin/reports/headers or /api/admin/report-headers
router.get(['/headers', '/report-headers'], async (req, res) => {
  try {
    const result = await wfQuery(`
      SELECT 
        HeaderId, HeaderCode, HeaderName, CompanyNameTh, CompanyNameEn,
        BranchNameTh, BranchCode, AddressTh, Tel, Fax, TaxId, LogoUrl,
        FooterNote, TermsAndConditions, Version, IsActive,
        CreatedBy, CreatedAt, UpdatedBy, UpdatedAt
      FROM wf.ReportHeaderMaster WITH (NOLOCK)
      ORDER BY HeaderId ASC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error fetching report headers:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/reports/headers/:id
router.get(['/headers/:id', '/report-headers/:id'], async (req, res) => {
  try {
    const id = req.params.id;
    const result = await wfQuery(`
      SELECT * FROM wf.ReportHeaderMaster WITH (NOLOCK)
      WHERE HeaderId = @id OR HeaderCode = @code
    `, {
      id: { type: sql.Int, value: Number(id) || 0 },
      code: { type: sql.VarChar(50), value: String(id) }
    });

    if (!result.recordset || result.recordset.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหัวกระดาษรายงาน' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error fetching report header:', err);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/reports/headers
router.post(['/headers', '/report-headers'], async (req, res) => {
  try {
    const {
      headerCode, HeaderCode,
      headerName, HeaderName,
      companyNameTh, CompanyNameTh,
      companyNameEn, CompanyNameEn,
      branchNameTh, BranchNameTh,
      branchCode, BranchCode,
      addressTh, AddressTh,
      tel, Tel,
      fax, Fax,
      taxId, TaxId,
      logoUrl, LogoUrl,
      footerNote, FooterNote,
      termsAndConditions, TermsAndConditions,
      reason
    } = req.body || {};

    const finalHeaderCode = headerCode || HeaderCode;
    const finalHeaderName = headerName || HeaderName;
    const finalCompanyNameTh = companyNameTh || CompanyNameTh;
    const finalAddressTh = addressTh || AddressTh;
    const finalTaxId = taxId || TaxId;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'ต้องระบุเหตุผลในการสร้างข้อมูลหัวกระดาษ (reason is required)' });
    }

    if (!finalHeaderCode || !finalHeaderName || !finalCompanyNameTh || !finalAddressTh || !finalTaxId) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็น: headerCode, headerName, companyNameTh, addressTh, taxId' });
    }

    const cleanCode = String(finalHeaderCode).trim().toUpperCase();
    const actor = req.user?.username || req.user?.sub || 'ADMIN';

    const newRecord = await wfTransaction(async (tx) => {
      // Check duplicate with lock
      const existing = (await tx.request()
        .input('code', sql.VarChar(50), cleanCode)
        .query(`SELECT HeaderId FROM wf.ReportHeaderMaster WITH (UPDLOCK, HOLDLOCK) WHERE HeaderCode = @code`)).recordset;

      if (existing && existing.length > 0) {
        throw Object.assign(new Error(`รหัสหัวกระดาษ '${cleanCode}' มีอยู่ในระบบแล้ว`), { status: 409 });
      }

      const fCompanyNameEn = companyNameEn || CompanyNameEn;
      const fBranchNameTh = branchNameTh || BranchNameTh;
      const fBranchCode = branchCode || BranchCode;
      const fTel = tel || Tel;
      const fFax = fax || Fax;
      const fLogoUrl = logoUrl || LogoUrl;
      const fFooterNote = footerNote || FooterNote;
      const fTermsAndConditions = termsAndConditions || TermsAndConditions;

      const insertResult = await tx.request()
        .input('headerCode', sql.VarChar(50), cleanCode)
        .input('headerName', sql.NVarChar(100), String(finalHeaderName).trim())
        .input('companyNameTh', sql.NVarChar(200), String(finalCompanyNameTh).trim())
        .input('companyNameEn', sql.NVarChar(200), fCompanyNameEn ? String(fCompanyNameEn).trim() : '')
        .input('branchNameTh', sql.NVarChar(100), fBranchNameTh ? String(fBranchNameTh).trim() : null)
        .input('branchCode', sql.VarChar(20), fBranchCode ? String(fBranchCode).trim() : null)
        .input('addressTh', sql.NVarChar(400), String(finalAddressTh).trim())
        .input('tel', sql.NVarChar(100), fTel ? String(fTel).trim() : null)
        .input('fax', sql.NVarChar(100), fFax ? String(fFax).trim() : null)
        .input('taxId', sql.VarChar(30), String(finalTaxId).trim())
        .input('logoUrl', sql.NVarChar(sql.MAX), fLogoUrl ? String(fLogoUrl) : null)
        .input('footerNote', sql.NVarChar(300), fFooterNote ? String(fFooterNote).trim() : null)
        .input('termsAndConditions', sql.NVarChar(sql.MAX), fTermsAndConditions ? String(fTermsAndConditions).trim() : null)
        .input('actor', sql.VarChar(50), String(actor))
        .query(`
          INSERT INTO wf.ReportHeaderMaster (
            HeaderCode, HeaderName, CompanyNameTh, CompanyNameEn,
            BranchNameTh, BranchCode, AddressTh, Tel, Fax, TaxId,
            LogoUrl, FooterNote, TermsAndConditions, Version, IsActive,
            CreatedBy, CreatedAt, UpdatedBy, UpdatedAt
          )
          OUTPUT INSERTED.*
          VALUES (
            @headerCode, @headerName, @companyNameTh, @companyNameEn,
            @branchNameTh, @branchCode, @addressTh, @tel, @fax, @taxId,
            @logoUrl, @footerNote, @termsAndConditions, 1, 1,
            @actor, SYSUTCDATETIME(), @actor, SYSUTCDATETIME()
          )
        `);

      const record = insertResult.recordset[0];

      await logChangeEvent(tx, {
        entityType: 'REPORT_HEADER',
        entityId: String(record.HeaderId),
        action: 'CREATE',
        beforeJson: null,
        afterJson: record,
        reasonCode: 'HEADER_CREATE',
        reasonText: String(reason).trim(),
        userId: String(actor),
        ipAddress: req.ip
      });

      return record;
    });

    res.status(201).json(newRecord);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Error creating report header:', err);
    res.status(status).json({ message: err.message });
  }
});

// PUT /api/admin/reports/headers/:id
router.put(['/headers/:id', '/report-headers/:id'], async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid Header ID' });

    const {
      headerName, HeaderName,
      companyNameTh, CompanyNameTh,
      companyNameEn, CompanyNameEn,
      branchNameTh, BranchNameTh,
      branchCode, BranchCode,
      addressTh, AddressTh,
      tel, Tel,
      fax, Fax,
      taxId, TaxId,
      logoUrl, LogoUrl,
      footerNote, FooterNote,
      termsAndConditions, TermsAndConditions,
      isActive, IsActive,
      expectedVersion, ExpectedVersion,
      reason
    } = req.body || {};

    const finalExpectedVersion = expectedVersion !== undefined ? expectedVersion : ExpectedVersion;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'ต้องระบุเหตุผลในการแก้ไขข้อมูลหัวกระดาษ (reason is required)' });
    }

    if (finalExpectedVersion === undefined || finalExpectedVersion === null || isNaN(Number(finalExpectedVersion))) {
      return res.status(400).json({ message: 'ต้องระบุ expectedVersion สำหรับการตรวจสอบความสอดคล้องของข้อมูล (Optimistic Concurrency Control)' });
    }

    const actor = req.user?.username || req.user?.sub || 'ADMIN';

    const afterRecord = await wfTransaction(async (tx) => {
      // Fetch before with UPDLOCK
      const prevResult = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT * FROM wf.ReportHeaderMaster WITH (UPDLOCK, ROWLOCK) WHERE HeaderId = @id`);

      if (!prevResult.recordset || prevResult.recordset.length === 0) {
        throw Object.assign(new Error('ไม่พบข้อมูลหัวกระดาษที่ต้องการแก้ไข'), { status: 404 });
      }
      const beforeRecord = prevResult.recordset[0];

      if (Number(beforeRecord.Version) !== Number(finalExpectedVersion)) {
        throw Object.assign(
          new Error(`ข้อมูลหัวกระดาษถูกแก้ไขโดยผู้อื่นแล้ว (เวอร์ชันปัจจุบัน: ${beforeRecord.Version}, ที่ส่งมา: ${finalExpectedVersion}) กรุณาโหลดข้อมูลใหม่`),
          { status: 409, currentVersion: beforeRecord.Version }
        );
      }

      const fHeaderName = headerName !== undefined ? headerName : HeaderName;
      const fCompanyNameTh = companyNameTh !== undefined ? companyNameTh : CompanyNameTh;
      const fCompanyNameEn = companyNameEn !== undefined ? companyNameEn : CompanyNameEn;
      const fBranchNameTh = branchNameTh !== undefined ? branchNameTh : BranchNameTh;
      const fBranchCode = branchCode !== undefined ? branchCode : BranchCode;
      const fAddressTh = addressTh !== undefined ? addressTh : AddressTh;
      const fTel = tel !== undefined ? tel : Tel;
      const fFax = fax !== undefined ? fax : Fax;
      const fTaxId = taxId !== undefined ? taxId : TaxId;
      const fLogoUrl = logoUrl !== undefined ? logoUrl : LogoUrl;
      const fFooterNote = footerNote !== undefined ? footerNote : FooterNote;
      const fTermsAndConditions = termsAndConditions !== undefined ? termsAndConditions : TermsAndConditions;
      const fIsActive = isActive !== undefined ? isActive : IsActive;

      const updateResult = await tx.request()
        .input('id', sql.Int, id)
        .input('expectedVersion', sql.Int, Number(finalExpectedVersion))
        .input('headerName', sql.NVarChar(100), fHeaderName != null ? String(fHeaderName).trim() : null)
        .input('companyNameTh', sql.NVarChar(200), fCompanyNameTh != null ? String(fCompanyNameTh).trim() : null)
        .input('companyNameEn', sql.NVarChar(200), fCompanyNameEn != null ? String(fCompanyNameEn).trim() : null)
        .input('branchNameTh', sql.NVarChar(100), fBranchNameTh !== undefined ? (fBranchNameTh ? String(fBranchNameTh).trim() : null) : beforeRecord.BranchNameTh)
        .input('branchCode', sql.VarChar(20), fBranchCode !== undefined ? (fBranchCode ? String(fBranchCode).trim() : null) : beforeRecord.BranchCode)
        .input('addressTh', sql.NVarChar(400), fAddressTh != null ? String(fAddressTh).trim() : null)
        .input('tel', sql.NVarChar(100), fTel !== undefined ? (fTel ? String(fTel).trim() : null) : beforeRecord.Tel)
        .input('fax', sql.NVarChar(100), fFax !== undefined ? (fFax ? String(fFax).trim() : null) : beforeRecord.Fax)
        .input('taxId', sql.VarChar(30), fTaxId != null ? String(fTaxId).trim() : null)
        .input('logoUrl', sql.NVarChar(sql.MAX), fLogoUrl !== undefined ? (fLogoUrl ? String(fLogoUrl) : null) : beforeRecord.LogoUrl)
        .input('footerNote', sql.NVarChar(300), fFooterNote !== undefined ? (fFooterNote ? String(fFooterNote).trim() : null) : beforeRecord.FooterNote)
        .input('termsAndConditions', sql.NVarChar(sql.MAX), fTermsAndConditions !== undefined ? (fTermsAndConditions ? String(fTermsAndConditions).trim() : null) : beforeRecord.TermsAndConditions)
        .input('isActive', sql.Bit, typeof fIsActive === 'boolean' ? (fIsActive ? 1 : 0) : null)
        .input('actor', sql.VarChar(50), String(actor))
        .query(`
          UPDATE wf.ReportHeaderMaster
          SET 
            HeaderName = ISNULL(@headerName, HeaderName),
            CompanyNameTh = ISNULL(@companyNameTh, CompanyNameTh),
            CompanyNameEn = ISNULL(@companyNameEn, CompanyNameEn),
            BranchNameTh = @branchNameTh,
            BranchCode = @branchCode,
            AddressTh = ISNULL(@addressTh, AddressTh),
            Tel = @tel,
            Fax = @fax,
            TaxId = ISNULL(@taxId, TaxId),
            LogoUrl = @logoUrl,
            FooterNote = @footerNote,
            TermsAndConditions = @termsAndConditions,
            IsActive = ISNULL(@isActive, IsActive),
            Version = Version + 1,
            UpdatedBy = @actor,
            UpdatedAt = SYSUTCDATETIME()
          OUTPUT INSERTED.*
          WHERE HeaderId = @id AND Version = @expectedVersion
        `);

      if (!updateResult.recordset || updateResult.recordset.length === 0) {
        throw Object.assign(new Error('เกิดข้อขัดแย้งขณะบันทึกข้อมูล (Version Concurrency Mismatch) กรุณาโหลดข้อมูลใหม่'), { status: 409 });
      }

      const updated = updateResult.recordset[0];

      await logChangeEvent(tx, {
        entityType: 'REPORT_HEADER',
        entityId: String(id),
        action: 'UPDATE',
        beforeJson: beforeRecord,
        afterJson: updated,
        reasonCode: 'HEADER_UPDATE',
        reasonText: String(reason).trim(),
        userId: String(actor),
        ipAddress: req.ip
      });

      return updated;
    });

    res.json(afterRecord);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Error updating report header:', err);
    res.status(status).json({ message: err.message, currentVersion: err.currentVersion });
  }
});

// ── 2. Report Template Endpoints ────────────────────────────────────────

// GET /api/admin/reports/templates or /api/admin/report-templates
router.get(['/templates', '/report-templates'], async (req, res) => {
  try {
    const result = await wfQuery(`
      SELECT 
        t.TemplateId, t.TemplateCode, t.TemplateName, t.HeaderId,
        t.ReportCategory, t.Orientation, t.PaperSize,
        t.ShowPageNumber, t.ShowSignatures,
        t.SignatureSalesLabel, t.SignatureApprovedLabel, t.SignatureWarehouseLabel,
        t.CustomCss, t.Version, t.IsActive,
        t.CreatedBy, t.CreatedAt, t.UpdatedBy, t.UpdatedAt,
        h.HeaderCode, h.HeaderName, h.CompanyNameTh, h.TaxId
      FROM wf.ReportTemplate t WITH (NOLOCK)
      JOIN wf.ReportHeaderMaster h WITH (NOLOCK) ON h.HeaderId = t.HeaderId
      ORDER BY t.TemplateId ASC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error fetching report templates:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/reports/templates/:id
router.get(['/templates/:id', '/report-templates/:id'], async (req, res) => {
  try {
    const id = req.params.id;
    const result = await wfQuery(`
      SELECT 
        t.*,
        h.HeaderCode, h.HeaderName, h.CompanyNameTh, h.CompanyNameEn,
        h.BranchNameTh, h.BranchCode, h.AddressTh, h.Tel, h.Fax, h.TaxId,
        h.LogoUrl, h.FooterNote, h.TermsAndConditions
      FROM wf.ReportTemplate t WITH (NOLOCK)
      JOIN wf.ReportHeaderMaster h WITH (NOLOCK) ON h.HeaderId = t.HeaderId
      WHERE t.TemplateId = @id OR t.TemplateCode = @code
    `, {
      id: { type: sql.Int, value: Number(id) || 0 },
      code: { type: sql.VarChar(50), value: String(id) }
    });

    if (!result.recordset || result.recordset.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลแม่แบบรายงาน' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error fetching report template:', err);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/reports/templates
router.post(['/templates', '/report-templates'], async (req, res) => {
  try {
    const {
      templateCode, TemplateCode,
      templateName, TemplateName,
      headerId, HeaderId,
      reportCategory, ReportCategory,
      orientation, Orientation,
      paperSize, PaperSize,
      showPageNumber, ShowPageNumber,
      showSignatures, ShowSignatures,
      signatureSalesLabel, SignatureSalesLabel,
      signatureApprovedLabel, SignatureApprovedLabel,
      signatureWarehouseLabel, SignatureWarehouseLabel,
      customCss, CustomCss,
      reason
    } = req.body || {};

    const fTemplateCode = templateCode || TemplateCode;
    const fTemplateName = templateName || TemplateName;
    const fHeaderId = headerId || HeaderId;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'ต้องระบุเหตุผลในการสร้างแม่แบบ (reason is required)' });
    }

    if (!fTemplateCode || !fTemplateName || !fHeaderId) {
      return res.status(400).json({ message: 'กรุณากรอก templateCode, templateName, และ headerId' });
    }

    const cleanCode = String(fTemplateCode).trim().toUpperCase();
    const actor = req.user?.username || req.user?.sub || 'ADMIN';

    const newRecord = await wfTransaction(async (tx) => {
      // Validate active header under lock
      const headerCheck = (await tx.request()
        .input('headerId', sql.Int, Number(headerId))
        .query(`SELECT HeaderId, IsActive FROM wf.ReportHeaderMaster WITH (HOLDLOCK) WHERE HeaderId = @headerId`)).recordset;

      if (!headerCheck || headerCheck.length === 0 || !headerCheck[0].IsActive) {
        throw Object.assign(new Error('หัวกระดาษที่เลือกไม่มีอยู่ในระบบหรือไม่เปิดใช้งาน'), { status: 400 });
      }

      // Check duplicate template code
      const existing = (await tx.request()
        .input('code', sql.VarChar(50), cleanCode)
        .query(`SELECT TemplateId FROM wf.ReportTemplate WITH (UPDLOCK, HOLDLOCK) WHERE TemplateCode = @code`)).recordset;

      if (existing && existing.length > 0) {
        throw Object.assign(new Error(`รหัสแม่แบบ '${cleanCode}' มีอยู่ในระบบแล้ว`), { status: 409 });
      }

      const fReportCategory = reportCategory || ReportCategory;
      const fOrientation = orientation || Orientation;
      const fPaperSize = paperSize || PaperSize;
      const fShowPageNumber = showPageNumber !== undefined ? showPageNumber : ShowPageNumber;
      const fShowSignatures = showSignatures !== undefined ? showSignatures : ShowSignatures;
      const fSignatureSalesLabel = signatureSalesLabel || SignatureSalesLabel;
      const fSignatureApprovedLabel = signatureApprovedLabel || SignatureApprovedLabel;
      const fSignatureWarehouseLabel = signatureWarehouseLabel || SignatureWarehouseLabel;
      const fCustomCss = customCss || CustomCss;

      const insertResult = await tx.request()
        .input('templateCode', sql.VarChar(50), cleanCode)
        .input('templateName', sql.NVarChar(100), String(fTemplateName).trim())
        .input('headerId', sql.Int, Number(fHeaderId))
        .input('reportCategory', sql.VarChar(50), fReportCategory ? String(fReportCategory).trim() : null)
        .input('orientation', sql.VarChar(20), fOrientation === 'landscape' ? 'landscape' : 'portrait')
        .input('paperSize', sql.VarChar(20), fPaperSize ? String(fPaperSize).trim() : 'A4')
        .input('showPageNumber', sql.Bit, fShowPageNumber !== false ? 1 : 0)
        .input('showSignatures', sql.Bit, fShowSignatures !== false ? 1 : 0)
        .input('sigSales', sql.NVarChar(100), fSignatureSalesLabel != null ? String(fSignatureSalesLabel).trim() : null)
        .input('sigAppv', sql.NVarChar(100), fSignatureApprovedLabel != null ? String(fSignatureApprovedLabel).trim() : null)
        .input('sigWh', sql.NVarChar(100), fSignatureWarehouseLabel != null ? String(fSignatureWarehouseLabel).trim() : null)
        .input('customCss', sql.NVarChar(sql.MAX), fCustomCss ? String(fCustomCss) : null)
        .input('actor', sql.VarChar(50), String(actor))
        .query(`
          INSERT INTO wf.ReportTemplate (
            TemplateCode, TemplateName, HeaderId, ReportCategory,
            Orientation, PaperSize, ShowPageNumber, ShowSignatures,
            SignatureSalesLabel, SignatureApprovedLabel, SignatureWarehouseLabel,
            CustomCss, Version, IsActive, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt
          )
          OUTPUT INSERTED.*
          VALUES (
            @templateCode, @templateName, @headerId, @reportCategory,
            @orientation, @paperSize, @showPageNumber, @showSignatures,
            @sigSales, @sigAppv, @sigWh,
            @customCss, 1, 1, @actor, SYSUTCDATETIME(), @actor, SYSUTCDATETIME()
          )
        `);

      const record = insertResult.recordset[0];

      await logChangeEvent(tx, {
        entityType: 'REPORT_TEMPLATE',
        entityId: String(record.TemplateId),
        action: 'CREATE',
        beforeJson: null,
        afterJson: record,
        reasonCode: 'TEMPLATE_CREATE',
        reasonText: String(reason).trim(),
        userId: String(actor),
        ipAddress: req.ip
      });

      return record;
    });

    res.status(201).json(newRecord);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Error creating report template:', err);
    res.status(status).json({ message: err.message });
  }
});

// PUT /api/admin/reports/templates/:id
router.put(['/templates/:id', '/report-templates/:id'], async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid Template ID' });

    const {
      templateName, TemplateName,
      headerId, HeaderId,
      reportCategory, ReportCategory,
      orientation, Orientation,
      paperSize, PaperSize,
      showPageNumber, ShowPageNumber,
      showSignatures, ShowSignatures,
      signatureSalesLabel, SignatureSalesLabel,
      signatureApprovedLabel, SignatureApprovedLabel,
      signatureWarehouseLabel, SignatureWarehouseLabel,
      customCss, CustomCss,
      isActive, IsActive,
      expectedVersion, ExpectedVersion,
      reason
    } = req.body || {};

    const finalExpectedVersion = expectedVersion !== undefined ? expectedVersion : ExpectedVersion;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'ต้องระบุเหตุผลในการแก้ไขแม่แบบ (reason is required)' });
    }

    if (expectedVersion === undefined || expectedVersion === null || isNaN(Number(expectedVersion))) {
      return res.status(400).json({ message: 'ต้องระบุ expectedVersion สำหรับการตรวจสอบความสอดคล้องของข้อมูล (Optimistic Concurrency Control)' });
    }

    const actor = req.user?.username || req.user?.sub || 'ADMIN';

    const afterRecord = await wfTransaction(async (tx) => {
      // Fetch before with lock
      const prevResult = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT * FROM wf.ReportTemplate WITH (UPDLOCK, ROWLOCK) WHERE TemplateId = @id`);

      if (!prevResult.recordset || prevResult.recordset.length === 0) {
        throw Object.assign(new Error('ไม่พบแม่แบบที่ต้องการแก้ไข'), { status: 404 });
      }
      const beforeRecord = prevResult.recordset[0];

      if (Number(beforeRecord.Version) !== Number(finalExpectedVersion)) {
        throw Object.assign(
          new Error(`ข้อมูลแม่แบบรายงานถูกแก้ไขโดยผู้อื่นแล้ว (เวอร์ชันปัจจุบัน: ${beforeRecord.Version}, ที่ส่งมา: ${finalExpectedVersion}) กรุณาโหลดข้อมูลใหม่`),
          { status: 409, currentVersion: beforeRecord.Version }
        );
      }

      const fTemplateName = templateName !== undefined ? templateName : TemplateName;
      const fHeaderId = headerId !== undefined ? headerId : HeaderId;
      const fReportCategory = reportCategory !== undefined ? reportCategory : ReportCategory;
      const fOrientation = orientation !== undefined ? orientation : Orientation;
      const fPaperSize = paperSize !== undefined ? paperSize : PaperSize;
      const fShowPageNumber = showPageNumber !== undefined ? showPageNumber : ShowPageNumber;
      const fShowSignatures = showSignatures !== undefined ? showSignatures : ShowSignatures;
      const fSignatureSalesLabel = signatureSalesLabel !== undefined ? signatureSalesLabel : SignatureSalesLabel;
      const fSignatureApprovedLabel = signatureApprovedLabel !== undefined ? signatureApprovedLabel : SignatureApprovedLabel;
      const fSignatureWarehouseLabel = signatureWarehouseLabel !== undefined ? signatureWarehouseLabel : SignatureWarehouseLabel;
      const fCustomCss = customCss !== undefined ? customCss : CustomCss;
      const fIsActive = isActive !== undefined ? isActive : IsActive;

      if (fHeaderId != null) {
        const headerCheck = (await tx.request()
          .input('headerId', sql.Int, Number(fHeaderId))
          .query(`SELECT HeaderId, IsActive FROM wf.ReportHeaderMaster WITH (HOLDLOCK) WHERE HeaderId = @headerId`)).recordset;

        if (!headerCheck || headerCheck.length === 0 || !headerCheck[0].IsActive) {
          throw Object.assign(new Error('หัวกระดาษที่เลือกไม่มีอยู่ในระบบหรือไม่เปิดใช้งาน'), { status: 400 });
        }
      }

      const updateResult = await tx.request()
        .input('id', sql.Int, id)
        .input('expectedVersion', sql.Int, Number(finalExpectedVersion))
        .input('templateName', sql.NVarChar(100), fTemplateName != null ? String(fTemplateName).trim() : null)
        .input('headerId', sql.Int, fHeaderId != null ? Number(fHeaderId) : null)
        .input('reportCategory', sql.VarChar(50), fReportCategory != null ? String(fReportCategory).trim() : null)
        .input('orientation', sql.VarChar(20), fOrientation != null ? String(fOrientation).trim() : null)
        .input('paperSize', sql.VarChar(20), fPaperSize != null ? String(fPaperSize).trim() : null)
        .input('showPageNumber', sql.Bit, typeof fShowPageNumber === 'boolean' ? (fShowPageNumber ? 1 : 0) : null)
        .input('showSignatures', sql.Bit, typeof fShowSignatures === 'boolean' ? (fShowSignatures ? 1 : 0) : null)
        .input('sigSales', sql.NVarChar(100), fSignatureSalesLabel != null ? String(fSignatureSalesLabel).trim() : null)
        .input('sigAppv', sql.NVarChar(100), fSignatureApprovedLabel != null ? String(fSignatureApprovedLabel).trim() : null)
        .input('sigWh', sql.NVarChar(100), fSignatureWarehouseLabel != null ? String(fSignatureWarehouseLabel).trim() : null)
        .input('customCss', sql.NVarChar(sql.MAX), fCustomCss != null ? String(fCustomCss) : null)
        .input('isActive', sql.Bit, typeof fIsActive === 'boolean' ? (fIsActive ? 1 : 0) : null)
        .input('actor', sql.VarChar(50), String(actor))
        .query(`
          UPDATE wf.ReportTemplate
          SET 
            TemplateName = ISNULL(@templateName, TemplateName),
            HeaderId = ISNULL(@headerId, HeaderId),
            ReportCategory = @reportCategory,
            Orientation = ISNULL(@orientation, Orientation),
            PaperSize = ISNULL(@paperSize, PaperSize),
            ShowPageNumber = ISNULL(@showPageNumber, ShowPageNumber),
            ShowSignatures = ISNULL(@showSignatures, ShowSignatures),
            SignatureSalesLabel = @sigSales,
            SignatureApprovedLabel = @sigAppv,
            SignatureWarehouseLabel = @sigWh,
            CustomCss = @customCss,
            IsActive = ISNULL(@isActive, IsActive),
            Version = Version + 1,
            UpdatedBy = @actor,
            UpdatedAt = SYSUTCDATETIME()
          OUTPUT INSERTED.*
          WHERE TemplateId = @id AND Version = @expectedVersion
        `);

      if (!updateResult.recordset || updateResult.recordset.length === 0) {
        throw Object.assign(new Error('เกิดข้อขัดแย้งขณะบันทึกข้อมูล (Version Concurrency Mismatch) กรุณาโหลดข้อมูลใหม่'), { status: 409 });
      }

      const updated = updateResult.recordset[0];

      await logChangeEvent(tx, {
        entityType: 'REPORT_TEMPLATE',
        entityId: String(id),
        action: 'UPDATE',
        beforeJson: beforeRecord,
        afterJson: updated,
        reasonCode: 'TEMPLATE_UPDATE',
        reasonText: String(reason).trim(),
        userId: String(actor),
        ipAddress: req.ip
      });

      return updated;
    });

    res.json(afterRecord);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Error updating report template:', err);
    res.status(status).json({ message: err.message, currentVersion: err.currentVersion });
  }
});

// ── 3. Report Assignment Endpoints ──────────────────────────────────────

// GET /api/admin/reports/assignments or /api/admin/report-assignments
router.get(['/assignments', '/report-assignments'], async (req, res) => {
  try {
    const result = await wfQuery(`
      SELECT 
        a.AssignmentId, a.ReportKey, a.TemplateId, a.Version, a.IsActive, a.UpdatedBy, a.UpdatedAt,
        t.TemplateCode, t.TemplateName, t.Orientation, t.PaperSize,
        h.HeaderId, h.HeaderCode, h.HeaderName, h.CompanyNameTh
      FROM wf.ReportTemplateAssignment a WITH (NOLOCK)
      JOIN wf.ReportTemplate t WITH (NOLOCK) ON t.TemplateId = a.TemplateId
      JOIN wf.ReportHeaderMaster h WITH (NOLOCK) ON h.HeaderId = t.HeaderId
      ORDER BY a.ReportKey ASC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error fetching report assignments:', err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/admin/reports/assignments/:reportKey
router.put(['/assignments/:reportKey', '/report-assignments/:reportKey'], async (req, res) => {
  try {
    const reportKey = String(req.params.reportKey || '').trim().toLowerCase();
    const { templateId, isActive, expectedVersion, reason } = req.body || {};

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'ต้องระบุเหตุผลในการกำหนดแม่แบบรายงาน (reason is required)' });
    }

    if (!templateId) {
      return res.status(400).json({ message: 'ต้องระบุ templateId' });
    }

    const actor = req.user?.username || req.user?.sub || 'ADMIN';

    const afterRecord = await wfTransaction(async (tx) => {
      // 1. Transaction-scoped exclusive application lock to prevent create-if-absent and update race conditions
      await tx.request().query(
        `EXEC sp_getapplock @Resource = 'ReportAssignment_${reportKey.replace(/'/g, "''")}', @LockMode = 'Exclusive', @LockOwner = 'Transaction'`
      );

      // 2. Validate that target template exists and is active
      const tCheck = (await tx.request()
        .input('templateId', sql.Int, Number(templateId))
        .query(`SELECT TemplateId, IsActive FROM wf.ReportTemplate WITH (HOLDLOCK) WHERE TemplateId = @templateId`)).recordset;

      if (!tCheck || tCheck.length === 0 || !tCheck[0].IsActive) {
        throw Object.assign(new Error('แม่แบบรายงานที่เลือกไม่มีอยู่ในระบบหรือไม่เปิดใช้งาน'), { status: 400 });
      }

      // 3. Check current assignment with lock
      const prevResult = await tx.request()
        .input('reportKey', sql.VarChar(50), reportKey)
        .query(`SELECT * FROM wf.ReportTemplateAssignment WITH (UPDLOCK, ROWLOCK) WHERE ReportKey = @reportKey`);

      const beforeRecord = prevResult.recordset?.[0] || null;

      let updated;
      if (beforeRecord) {
        // Concurrency guard: update on existing assignment MUST provide valid expectedVersion matching current Version
        if (expectedVersion === undefined || expectedVersion === null || isNaN(Number(expectedVersion)) || Number(expectedVersion) <= 0) {
          throw Object.assign(
            new Error(`การแก้ไขการกำหนดแม่แบบรายงานสำหรับ '${reportKey}' จำเป็นต้องระบุ expectedVersion ที่ถูกต้อง`),
            { status: 400 }
          );
        }

        if (Number(beforeRecord.Version) !== Number(expectedVersion)) {
          throw Object.assign(
            new Error(`การกำหนดแม่แบบสำหรับรายงานนี้ถูกแก้ไขโดยผู้อื่นแล้ว (เวอร์ชันปัจจุบัน: ${beforeRecord.Version}, ที่ส่งมา: ${expectedVersion}) กรุณาโหลดข้อมูลใหม่`),
            { status: 409, currentVersion: beforeRecord.Version }
          );
        }

        const up = await tx.request()
          .input('reportKey', sql.VarChar(50), reportKey)
          .input('templateId', sql.Int, Number(templateId))
          .input('isActive', sql.Bit, typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null)
          .input('actor', sql.VarChar(50), String(actor))
          .query(`
            UPDATE wf.ReportTemplateAssignment
            SET 
              TemplateId = @templateId,
              IsActive = ISNULL(@isActive, IsActive),
              Version = Version + 1,
              UpdatedBy = @actor,
              UpdatedAt = SYSUTCDATETIME()
            OUTPUT INSERTED.*
            WHERE ReportKey = @reportKey
          `);
        updated = up.recordset[0];
      } else {
        // Create-if-absent semantics: if client specified an expectedVersion > 0, it assumed an existing record
        if (expectedVersion !== undefined && expectedVersion !== null && !isNaN(Number(expectedVersion)) && Number(expectedVersion) > 0) {
          throw Object.assign(
            new Error(`ไม่พบการกำหนดแม่แบบรายงานสำหรับ '${reportKey}' ที่เวอร์ชัน ${expectedVersion}`),
            { status: 404 }
          );
        }

        const ins = await tx.request()
          .input('reportKey', sql.VarChar(50), reportKey)
          .input('templateId', sql.Int, Number(templateId))
          .input('isActive', sql.Bit, typeof isActive === 'boolean' ? (isActive ? 1 : 0) : 1)
          .input('actor', sql.VarChar(50), String(actor))
          .query(`
            INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, Version, IsActive, UpdatedBy, UpdatedAt)
            OUTPUT INSERTED.*
            VALUES (@reportKey, @templateId, 1, ISNULL(@isActive, 1), @actor, SYSUTCDATETIME())
          `);
        updated = ins.recordset[0];
      }

      await logChangeEvent(tx, {
        entityType: 'REPORT_ASSIGNMENT',
        entityId: reportKey,
        action: beforeRecord ? 'UPDATE' : 'CREATE',
        beforeJson: beforeRecord,
        afterJson: updated,
        reasonCode: 'ASSIGNMENT_UPDATE',
        reasonText: String(reason).trim(),
        userId: String(actor),
        ipAddress: req.ip
      });

      return updated;
    });

    res.json(afterRecord);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Error updating report assignment:', err);
    res.status(status).json({ message: err.message, currentVersion: err.currentVersion });
  }
});

// ── 4. Audit Trail Endpoints ────────────────────────────────────────────

// GET /api/admin/reports/audit
router.get(['/audit', '/report-audit'], async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const result = await wfQuery(`
      SELECT TOP (@limit)
        EventId, EntityType, EntityId, Action,
        ReasonCode, ReasonText, UserId, IpAddress, CreatedAt,
        BeforeJson, AfterJson
      FROM wf.ChangeEvent WITH (NOLOCK)
      WHERE EntityType IN ('REPORT_HEADER', 'REPORT_TEMPLATE', 'REPORT_ASSIGNMENT')
      ORDER BY EventId DESC
    `, {
      limit: { type: sql.Int, value: limit }
    });
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error fetching report audit history:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
