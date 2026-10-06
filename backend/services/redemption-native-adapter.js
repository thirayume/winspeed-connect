'use strict';

/**
 * redemption-native-adapter.js
 *
 * Native WinSpeed 116 (DocuType '116') Coupon Redemption Adapter.
 *
 * SPECIFICATION SOURCE:
 * - Live empirical evidence from WinSpeed 9.0.0.0648 #23 on dbwins_worldfert9_test_v2
 *   (docs/sale-app/qa/WINSPEED-116-LIVE-EVIDENCE-20260924.md)
 * - Review and gate requirements in docs/sale-app/qa/ANTIGRAVITY-INTEGRATED-NATIVE-UAT-GATE-20260924.md
 *
 * STRICT INVARIANTS:
 * 1. Feature Gate: Gated at service boundary. Fails closed unless COUPON_NATIVE_POSTING_ENABLED === 'true'.
 * 2. Database Protection: Refuses to execute against production DB (dbwins_worldfert9).
 * 3. DocuNo: Taken directly from physical delivery / scale ticket. NEVER generated, NO prefixes, NEVER touch dbo.EMRunBrch.
 * 4. DocuStatus: Strictly 'N', PostInv = 'N', IsCheckAll = 'Y', IsCheck = 'Y'.
 * 5. RedemtionID: ISNULL(MAX(RedemtionID), 0) + 1 under (UPDLOCK, HOLDLOCK) with retry loop on PK collision.
 * 6. DT Snapshot: WFRedemtionDT.RemaQty records balance BEFORE deduction.
 * 7. Optimistic Deduction: UPDATE dbo.WFCoupon SET RemaQty = RemaQty - @qty WHERE RemaQty >= @qty.
 * 8. Lock Ordering: Sort lines by couponId ASC to prevent deadlocks under concurrent multi-coupon writebacks.
 * 9. Repeated Lines: Reject duplicate couponId lines explicitly (Mirror PK is (RedemtionID, CouponID)).
 * 10. Authoritative Verification: Validate goodId, goodUnitId, and couponNo against authoritative dbo.WFCoupon data.
 * 11. Provenance: Record origin in wf.CouponRedemptionMirror (Source = 'SALE_APP', Status = 'COMPLETED').
 * 12. Audit Trail: Insert 1 row in dbo.SMAudit to maintain WinSpeed ERP audit trail continuity.
 * 13. Reversal: Marked BLOCKED_SPEC until WinSpeed cancellation lifecycle is empirically captured on live evidence.
 */

const { sql, wfTransaction, query } = require('../db');

function isFeatureEnabled() {
  return String(process.env.COUPON_NATIVE_POSTING_ENABLED || '').toLowerCase().trim() === 'true';
}

/**
 * Asserts service-level boundary safety before executing any native writes.
 * Validates the exact connection/transaction executing mutations.
 */
async function assertServiceGate(tx = null) {
  if (!isFeatureEnabled()) {
    throw Object.assign(
      new Error('การตัดส่งตั๋วปุ๋ย native (DocuType 116) ยังไม่เปิดใช้งาน (Feature Flag COUPON_NATIVE_POSTING_ENABLED=false)'),
      { code: 'NATIVE_POSTING_DISABLED', status: 400 }
    );
  }

  const targetCheck = tx
    ? (await tx.request().query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db, SYSTEM_USER AS usr, IS_SRVROLEMEMBER('sysadmin') AS isSysadmin")).recordset?.[0]
    : (await query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db, SYSTEM_USER AS usr, IS_SRVROLEMEMBER('sysadmin') AS isSysadmin"))[0];

  const rawSrv = targetCheck?.srv;
  const rawDb = targetCheck?.db;
  const rawUsr = targetCheck?.usr;
  const rawSysadmin = targetCheck?.isSysadmin;

  const srvName = typeof rawSrv === 'string' ? rawSrv.trim().toLowerCase() : '';
  const dbName = typeof rawDb === 'string' ? rawDb.trim().toLowerCase() : '';
  const userName = typeof rawUsr === 'string' ? rawUsr.trim().toLowerCase() : '';

  // 1. Strict fail-closed verification of sysadmin: must be known literal 0
  if (rawSysadmin === null || rawSysadmin === undefined || rawSysadmin !== 0) {
    throw Object.assign(
      new Error(`SAFETY BLOCK: Permission result for sysadmin is invalid or privileged (srv: "${srvName}", db: "${dbName}", user: "${userName}", sysadmin: ${rawSysadmin})!`),
      { code: 'PRODUCTION_WRITE_BLOCKED', status: 403 }
    );
  }

  // 2. Strict production refusal
  if (dbName === 'dbwins_worldfert9' || dbName.includes('prod')) {
    throw Object.assign(
      new Error(`SAFETY BLOCK: Refusing native writeback against production database context (srv: "${srvName}", db: "${dbName}", user: "${userName}")!`),
      { code: 'PRODUCTION_WRITE_BLOCKED', status: 403 }
    );
  }

  // 3. Strict exact Server allowlist: sanctioned Hostinger test server only
  if (srvName !== '21181f44f254') {
    throw Object.assign(
      new Error(`SERVER DENIED: Native writeback permitted only on sanctioned TEST server "21181f44f254" (connected to server: "${srvName}")!`),
      { code: 'UNAUTHORIZED_SERVER', status: 403 }
    );
  }

  // 4. Strict exact Database allowlist: sanctioned TEST database only
  if (dbName !== 'dbwins_worldfert9_test_v2') {
    throw Object.assign(
      new Error(`TARGET DENIED: Native writeback permitted only on sanctioned TEST database "dbwins_worldfert9_test_v2" (connected to: "${dbName}")!`),
      { code: 'UNAUTHORIZED_TARGET', status: 403 }
    );
  }

  // 5. Strict exact Principal allowlist: engine-restricted test principal only
  if (userName !== 'wf_test') {
    throw Object.assign(
      new Error(`PRINCIPAL DENIED: Native writeback requires engine-restricted test principal "wf_test" (connected as: "${userName}")!`),
      { code: 'UNAUTHORIZED_PRINCIPAL', status: 403 }
    );
  }

  // 6. Engine-level boundary verification: Principal MUST NOT have access to production database
  const accessCheck = tx
    ? (await tx.request().query("SELECT HAS_DBACCESS('dbwins_worldfert9') AS prodAccess")).recordset?.[0]
    : (await query("SELECT HAS_DBACCESS('dbwins_worldfert9') AS prodAccess"))[0];
  const rawProdAccess = accessCheck?.prodAccess;

  // Strict fail-closed verification of prodAccess: must be known literal 0
  if (rawProdAccess === null || rawProdAccess === undefined || rawProdAccess !== 0) {
    throw Object.assign(
      new Error(`SECURITY BREACH: Permission result for production access is invalid or privileged (user: "${userName}", prodAccess: ${rawProdAccess})!`),
      { code: 'PRODUCTION_ACCESS_DETECTED', status: 403 }
    );
  }
}

/**
 * Creates a native WinSpeed 116 redemption document.
 *
 * @param {Object} params
 * @param {string} params.docuNo - Delivery document number from scale/gate (mandatory)
 * @param {string|Date} [params.docuDate] - Document date (default: today)
 * @param {string} params.carLicense - Vehicle license plate (mandatory)
 * @param {number|null} [params.saveEmpId] - Employee ID saving the record (optional, null allowed)
 * @param {Array<Object>} params.lines - Redemption items:
 *   [{ couponId, couponNo, goodId, goodUnitId, goodPrice, goodQty, inveId, locaId }]
 * @param {Object} [systemOptions] - Internal system options (NOT exposed to end-user request payloads)
 * @param {string} [systemOptions.operatorName='SaleApp']
 * @param {string} [systemOptions.computerName='SALE-APP-BACKEND']
 * @param {Object} [systemOptions.existingTx=null]
 * @returns {Promise<Object>} Created document summary
 */
async function createRedemptionDocument(params = {}, systemOptions = {}) {
  // 1. Service Gate Enforcement
  await assertServiceGate(systemOptions.existingTx);

  const {
    docuNo,
    docuDate,
    carLicense,
    saveEmpId = null,
    lines = [],
  } = params;

  const operatorName = systemOptions.operatorName || 'SaleApp';
  const computerName = systemOptions.computerName || 'SALE-APP-BACKEND';
  const existingTx = systemOptions.existingTx || null;

  // 2. Strict Input Validation
  const cleanDocuNo = String(docuNo || '').trim();
  if (!cleanDocuNo) {
    throw Object.assign(new Error('เลขที่เอกสาร/ใบขน (docuNo) เป็นข้อมูลบังคับ ห้ามว่าง'), {
      code: 'MISSING_DOCU_NO',
      status: 400,
    });
  }
  if (cleanDocuNo.length > 25) {
    throw Object.assign(new Error('เลขที่เอกสาร/ใบขน (docuNo) ความยาวเกิน 25 ตัวอักษร (ข้อจำกัด WinSpeed WFRedemtionHD.DocuNo)'), {
      code: 'DOCU_NO_TOO_LONG',
      status: 400,
    });
  }

  const cleanCarLicense = String(carLicense || '').trim();
  if (!cleanCarLicense) {
    throw Object.assign(new Error('ทะเบียนรถ (carLicense) เป็นข้อมูลบังคับ ห้ามว่าง'), {
      code: 'MISSING_CAR_LICENSE',
      status: 400,
    });
  }
  if (cleanCarLicense.length > 25) {
    throw Object.assign(new Error('ทะเบียนรถ (carLicense) ความยาวเกิน 25 ตัวอักษร (ข้อจำกัด WinSpeed WFRedemtionHD.CarLicense)'), {
      code: 'CAR_LICENSE_TOO_LONG',
      status: 400,
    });
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw Object.assign(new Error('รายการตัดตั๋ว (lines) ต้องมีอย่างน้อย 1 รายการ'), {
      code: 'EMPTY_REDEMPTION_LINES',
      status: 400,
    });
  }

  // 3. Line validation, precision checks, and duplicate coupon rejection
  const seenCoupons = new Set();
  const validatedLines = [];
  let totalQty = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const cid = Number(l.couponId);
    if (!Number.isInteger(cid) || cid <= 0) {
      throw Object.assign(new Error(`รายการที่ ${i + 1}: couponId ต้องเป็นจำนวนเต็มบวก`), {
        code: 'INVALID_COUPON_ID',
        status: 400,
      });
    }

    if (seenCoupons.has(cid)) {
      throw Object.assign(
        new Error(`พบคูปอง ID ${cid} ซ้ำกันในคำขอเดียวกัน กรุณารวมยอดตันในรายการเดียว`),
        { code: 'DUPLICATE_COUPON_IN_LINES', status: 400 }
      );
    }
    seenCoupons.add(cid);

    const rawQty = Number(l.goodQty);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      throw Object.assign(new Error(`รายการที่ ${i + 1}: จำนวนตัน (goodQty) ต้องเป็นตัวเลขบวกที่ถูกต้อง`), {
        code: 'INVALID_GOOD_QTY',
        status: 400,
      });
    }

    // Standardize to 3 decimal places
    const cleanQty = Math.round(rawQty * 1000) / 1000;
    if (cleanQty <= 0) {
      throw Object.assign(new Error(`รายการที่ ${i + 1}: จำนวนตันต้องมากกว่า 0`), {
        code: 'INVALID_GOOD_QTY',
        status: 400,
      });
    }

    totalQty += cleanQty;
    validatedLines.push({
      ...l,
      couponId: cid,
      goodQty: cleanQty,
      goodPrice: l.goodPrice !== undefined ? Number(l.goodPrice) : null,
    });
  }

  totalQty = Math.round(totalQty * 1000) / 1000;

  // 4. Deadlock Prevention: Sort lines by couponId ASC
  validatedLines.sort((a, b) => a.couponId - b.couponId);

  const effectiveDate = docuDate ? new Date(docuDate) : new Date();
  if (isNaN(effectiveDate.getTime())) {
    throw Object.assign(new Error('วันที่เอกสาร (docuDate) ไม่ถูกต้อง'), {
      code: 'INVALID_DOCU_DATE',
      status: 400,
    });
  }

  const executionBody = async (tx) => {
    // Assert service gate directly on the active transaction connection
    await assertServiceGate(tx);

    // 5. Strict Duplicate DocuNo Rejection under transaction lock
    const dupCheck = await tx.request()
      .input('docuNo', sql.VarChar(50), cleanDocuNo)
      .query(`SELECT TOP 1 RedemtionID FROM dbo.WFRedemtionHD WITH (UPDLOCK, HOLDLOCK) WHERE DocuNo = @docuNo`);
    if (dupCheck.recordset?.length > 0) {
      throw Object.assign(
        new Error(`เลขที่เอกสาร/ใบขน "${cleanDocuNo}" มีอยู่ในระบบแล้ว (RedemtionID: ${dupCheck.recordset[0].RedemtionID})`),
        { code: 'DUPLICATE_DELIVERY_DOCU_NO', status: 400 }
      );
    }

    // 6. Allocate RedemtionID with retry on collision
    const maxRetries = 3;
    let redemtionId = null;
    let hdInserted = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const idResult = await tx.request().query(`
        SELECT ISNULL(MAX(RedemtionID), 0) + 1 AS NextRedemtionID
        FROM dbo.WFRedemtionHD WITH (UPDLOCK, HOLDLOCK)
      `);
      redemtionId = Number(idResult.recordset[0].NextRedemtionID);

      try {
        await tx.request()
          .input('redemtionId', sql.Int, redemtionId)
          .input('docuNo', sql.VarChar(50), cleanDocuNo)
          .input('docuDate', sql.Date, effectiveDate)
          .input('docuType', sql.VarChar(10), '116')
          .input('carLicense', sql.VarChar(50), cleanCarLicense)
          .input('saveEmpId', sql.Int, saveEmpId ? Number(saveEmpId) : null)
          .input('sumGoodQty', sql.Decimal(18, 3), totalQty)
          .query(`
            INSERT INTO dbo.WFRedemtionHD (
              RedemtionID, DocuNo, DocuDate, DocuType,
              CardNo, IssueName, CarLicense,
              SaveEmpID, IssueEmpID, AppvEmpID,
              SumGoodQty, DocuStatus, IsCheckAll
            ) VALUES (
              @redemtionId, @docuNo, @docuDate, @docuType,
              NULL, NULL, @carLicense,
              @saveEmpId, NULL, NULL,
              @sumGoodQty, 'N', 'Y'
            )
          `);
        hdInserted = true;
        break;
      } catch (err) {
        if ((err.number === 2627 || err.number === 2601) && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }

    if (!hdInserted) {
      throw new Error('Failed to insert WFRedemtionHD record after max retries');
    }

    // 7. Process Details and Deduct WFCoupon in ordered sequence
    for (let i = 0; i < validatedLines.length; i++) {
      const line = validatedLines[i];
      const listno = i + 1;
      const cid = line.couponId;
      const qty = line.goodQty;

      // 7.1 Authoritative Verification against dbo.WFCoupon
      const cpRes = await tx.request()
        .input('cid', sql.Int, cid)
        .query(`
          SELECT CouponID, CouponNo, GoodID, GoodUnitID, GoodPrice, RemaQty
          FROM dbo.WFCoupon WITH (UPDLOCK, ROWLOCK)
          WHERE CouponID = @cid
        `);
      const couponRecord = cpRes.recordset?.[0];
      if (!couponRecord) {
        throw Object.assign(new Error(`ไม่พบคูปอง ID ${cid} ในระบบ`), {
          code: 'COUPON_NOT_FOUND',
          status: 404,
        });
      }

      // Check product and unit fidelity — NEVER silently substitute
      if (line.goodId && Number(line.goodId) !== Number(couponRecord.GoodID)) {
        throw Object.assign(
          new Error(`สินค้าไม่ตรงกับตั๋วคุม (ระบุ GoodID ${line.goodId}, ในตั๋วคือ ${couponRecord.GoodID})`),
          { code: 'GOOD_ID_MISMATCH', status: 400 }
        );
      }
      if (line.goodUnitId && Number(line.goodUnitId) !== Number(couponRecord.GoodUnitID)) {
        throw Object.assign(
          new Error(`หน่วยสินค้าไม่ตรงกับตั๋วคุม (ระบุ GoodUnitID ${line.goodUnitId}, ในตั๋วคือ ${couponRecord.GoodUnitID})`),
          { code: 'GOOD_UNIT_MISMATCH', status: 400 }
        );
      }
      if (line.couponNo && String(line.couponNo).trim() !== String(couponRecord.CouponNo).trim()) {
        throw Object.assign(
          new Error(`เลขที่ตั๋วไม่ตรงกับระบบ (ระบุ "${line.couponNo}", ในระบบคือ "${couponRecord.CouponNo}")`),
          { code: 'COUPON_NO_MISMATCH', status: 400 }
        );
      }

      const beforeRemaQty = Math.round(Number(couponRecord.RemaQty) * 1000) / 1000;
      if (beforeRemaQty < qty) {
        throw Object.assign(
          new Error(`ยอดคงเหลือของคูปอง ${couponRecord.CouponNo} (คงเหลือ: ${beforeRemaQty} ตัน) ไม่เพียงพอสำหรับการตัด ${qty} ตัน`),
          { code: 'INSUFFICIENT_COUPON_REMA_QTY', status: 400 }
        );
      }

      const effectiveGoodId = Number(couponRecord.GoodID);
      const effectiveGoodUnitId = Number(couponRecord.GoodUnitID);
      const effectiveGoodPrice = line.goodPrice !== null ? line.goodPrice : Number(couponRecord.GoodPrice || 0);
      const effectiveCouponNo = String(couponRecord.CouponNo).trim();
      const inveId = Number(line.inveId || 1000);
      const locaId = Number(line.locaId || 1000);

      // 7.2 Insert WFRedemtionDT with snapshot RemaQty (BEFORE deduction)
      await tx.request()
        .input('redemtionId', sql.Int, redemtionId)
        .input('listno', sql.SmallInt, listno)
        .input('goodId', sql.Int, effectiveGoodId)
        .input('inveId', sql.Int, inveId)
        .input('locaId', sql.Int, locaId)
        .input('goodUnitId', sql.Int, effectiveGoodUnitId)
        .input('goodPrice', sql.Decimal(18, 4), effectiveGoodPrice)
        .input('couponId', sql.Int, cid)
        .input('couponNo', sql.VarChar(50), effectiveCouponNo)
        .input('goodQty', sql.Decimal(18, 3), qty)
        .input('remaQty', sql.Decimal(18, 3), beforeRemaQty)
        .query(`
          INSERT INTO dbo.WFRedemtionDT (
            RedemtionID, Listno, GoodID, InveID, LocaID, GoodUnitID, GoodPrice,
            CouponID, CouponNo, PostInv, GoodQty, RemaQty,
            SOInvID, SOListNo, IsCheck
          ) VALUES (
            @redemtionId, @listno, @goodId, @inveId, @locaId, @goodUnitId, @goodPrice,
            @couponId, @couponNo, 'N', @goodQty, @remaQty,
            NULL, NULL, 'Y'
          )
        `);

      // 7.3 Optimistic deduction in dbo.WFCoupon
      const updateCouponRes = await tx.request()
        .input('cid', sql.Int, cid)
        .input('qty', sql.Decimal(18, 3), qty)
        .query(`
          UPDATE dbo.WFCoupon
          SET RemaQty = RemaQty - @qty
          WHERE CouponID = @cid AND RemaQty >= @qty
        `);

      if (updateCouponRes.rowsAffected?.[0] !== 1) {
        throw Object.assign(
          new Error(`การตัดยอดคูปอง ${effectiveCouponNo} ล้มเหลวเนื่องจากการแย่งใช้งาน (Concurrency / Insufficient balance)`),
          { code: 'CONCURRENT_COUPON_DEDUCTION_FAILED', status: 409 }
        );
      }

      // 7.4 Provenance tracking in wf.CouponRedemptionMirror
      await tx.request()
        .input('redemtionId', sql.Int, redemtionId)
        .input('couponId', sql.Int, cid)
        .input('redeemedTon', sql.Decimal(18, 3), qty)
        .input('docuNo', sql.NVarChar(50), cleanDocuNo)
        .input('source', sql.NVarChar(50), 'SALE_APP')
        .input('status', sql.NVarChar(20), 'COMPLETED')
        .query(`
          INSERT INTO wf.CouponRedemptionMirror (
            RedemtionID, CouponID, AppliedSOInvID, AppliedInvoiceNo,
            RedeemedTon, RedeemedAt, DocuNo, Source, Status
          ) VALUES (
            @redemtionId, @couponId, NULL, NULL,
            @redeemedTon, SYSUTCDATETIME(), @docuNo, @source, @status
          )
        `);
    }

    // 8. Insert dbo.SMAudit to maintain WinSpeed ERP audit trail continuity
    const auditIdRes = await tx.request().query(`
      SELECT ISNULL(MAX(audit_id), 0) + 1 AS NextAuditId
      FROM dbo.SMAudit WITH (UPDLOCK, HOLDLOCK)
    `);
    const nextAuditId = Number(auditIdRes.recordset[0].NextAuditId);

    await tx.request()
      .input('auditId', sql.Int, nextAuditId)
      .input('auditSystem', sql.Int, 3)
      .input('auditScreen', sql.Int, 2098003052)
      .input('auditUsername', sql.VarChar(100), operatorName.slice(0, 100))
      .input('auditAction', sql.Char(1), 'I')
      .input('auditDocuNo', sql.VarChar(50), cleanDocuNo.slice(0, 50))
      .input('auditDocuDate', sql.Date, effectiveDate)
      .input('auditColumnId', sql.Int, redemtionId)
      .input('brchId', sql.Int, 1)
      .input('auditComputerName', sql.VarChar(255), computerName.slice(0, 255))
      .input('auditRefId', sql.VarChar(50), String(nextAuditId))
      .input('version', sql.VarChar(50), '1.0.0.0648')
      .query(`
        INSERT INTO dbo.SMAudit (
          audit_id, audit_system, audit_screen, audit_datetime,
          audit_username, audit_action, audit_docuno, audit_docudate,
          audit_columnid, brchid, audit_computername, audit_query,
          audit_refid, audit_logouttime, Version
        ) VALUES (
          @auditId, @auditSystem, @auditScreen, GETDATE(),
          @auditUsername, @auditAction, @auditDocuNo, @auditDocuDate,
          @auditColumnId, @brchId, @auditComputerName, NULL,
          @auditRefId, NULL, @version
        )
      `);

    return {
      success: true,
      redemtionId,
      docuNo: cleanDocuNo,
      docuDate: effectiveDate,
      docuType: '116',
      carLicense: cleanCarLicense,
      sumGoodQty: totalQty,
      docuStatus: 'N',
      isCheckAll: 'Y',
      linesCount: validatedLines.length,
      auditId: nextAuditId,
    };
  };

  if (existingTx) {
    return await executionBody(existingTx);
  }
  return await wfTransaction(executionBody);
}

/**
 * Reverses a native WinSpeed 116 redemption document.
 *
 * NOTE: Per Codex review (ANTIGRAVITY-INTEGRATED-NATIVE-UAT-GATE-20260924.md §2),
 * native cancellation lifecycle semantics in WinSpeed ERP (DocuStatus transition,
 * detail flags, effect on invoice selection) have not been captured on live TEST evidence.
 * Therefore, reversal is strictly gated as BLOCKED_SPEC to avoid guessing ERP state.
 */
async function reverseRedemptionDocument() {
  await assertServiceGate();

  throw Object.assign(
    new Error('WinSpeed 116 native document reversal semantics are BLOCKED_SPEC: cancellation lifecycle in WinSpeed ERP has not been empirically captured on live evidence. Reversal is disabled.'),
    { code: 'BLOCKED_SPEC', status: 501 }
  );
}

module.exports = {
  createRedemptionDocument,
  reverseRedemptionDocument,
  isFeatureEnabled,
  assertServiceGate,
};
