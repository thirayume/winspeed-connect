/**
 * policy-contract.js — Service for system policy settings, validation, versioning, and audit
 *
 * Enforces:
 * 1. Whitelist validation of all system setting keys and allowable bounds (fail-closed, prototype-safe).
 * 2. Immutable PolicyVersion & coherent PolicySnapshot recording for every setting modification.
 * 3. Before/After change tracking in wf.ChangeEvent with mandatory reason.
 * 4. Reason validation against active wf.EditReason master (OTHER requires detail >= 5 chars).
 * 5. Optimistic concurrency control (expectedRevision) to prevent lost updates.
 * 6. Strictly ADMIN-authorized policy administration.
 */
const { sql, wfQuery, wfTransaction } = require('../db');

const POLICY_DEFINITIONS = Object.freeze(Object.assign(Object.create(null), {
  PICKUP_DUE_DEFAULT_DAYS: {
    policyName: 'PICKUP_POLICY',
    type: 'INT',
    min: 1,
    max: 365,
    default: 7,
    description: 'จำนวนวันกำหนดรับสินค้าค่าเริ่มต้นนับจาก SO Confirmation (วัน)',
  },
  PICKUP_DUE_OPTIONS: {
    policyName: 'PICKUP_POLICY',
    type: 'CSV_INT',
    default: '7,15,30,45',
    description: 'ตัวเลือกวันกำหนดรับสินค้าสำหรับหน้าสร้าง/แก้ไข SO',
    validator: (v) => {
      const parts = String(v).split(',').map(s => s.trim());
      if (!parts.length) return false;
      return parts.every(p => /^\d+$/.test(p) && parseInt(p, 10) >= 1 && parseInt(p, 10) <= 365);
    },
  },
  PICKUP_STRICT_MODE: {
    policyName: 'PICKUP_POLICY',
    type: 'BOOLEAN',
    default: 'false',
    description: 'true = บล็อกการดำเนินงานหากรับนอกกรอบวันกำหนดรับ · false = อนุญาตพร้อมคำเตือน (ค่าเริ่มต้น false)',
  },
  PICKUP_LEAD_TIME_DAYS: {
    policyName: 'PICKUP_POLICY',
    type: 'INT',
    min: 0,
    max: 60,
    default: 1,
    description: 'จำนวนวันล่วงหน้าขั้นต่ำสำหรับการนัดหมายรถเข้ารับสินค้า (วัน)',
  },
  CONTROL_TICKET_ALERT_DAYS: {
    policyName: 'TICKET_EXPIRY_POLICY',
    type: 'INT',
    min: 0,
    max: 90,
    default: 7,
    description: 'จำนวนวันแจ้งเตือนล่วงหน้าก่อนตั๋วคุมหมดอายุ (วัน)',
  },
  CONTROL_TICKET_BLOCK_EXPIRED: {
    policyName: 'TICKET_EXPIRY_POLICY',
    type: 'BOOLEAN',
    default: 'false',
    description: 'true = บล็อกการใช้ตั๋วคุมที่หมดอายุ · false = อนุญาตพร้อมคำเตือน (ค่าเริ่มต้น false)',
  },
  CUSTOMER_RATIO: {
    policyName: 'REBATE_POLICY',
    type: 'FLOAT',
    min: 0,
    max: 100,
    default: 100,
    description: 'สัดส่วนเงินรีเบทคืนลูกค้าตามนโยบายค่าเริ่มต้น (%)',
  },
  COMPANY_RATIO: {
    policyName: 'REBATE_POLICY',
    type: 'FLOAT',
    min: 0,
    max: 100,
    default: 0,
    description: 'สัดส่วนเงินรีเบทคงไว้ให้บริษัทตามนโยบายค่าเริ่มต้น (%)',
  },
  TRIP_CAPACITY_TON: {
    policyName: 'TRIP_CAPACITY_POLICY',
    type: 'FLOAT',
    min: 1,
    max: 100,
    default: 50,
    description: 'พิกัดความจุสินค้ามาตรฐานต่อเที่ยวรถ (ตัน)',
  },
  TRIP_OVERLOAD_TOLERANCE_PCT: {
    policyName: 'TRIP_CAPACITY_POLICY',
    type: 'FLOAT',
    min: 0,
    max: 20,
    default: 5,
    description: 'เปอร์เซ็นต์ส่วนต่างน้ำหนักเกินที่ยอมรับได้ตามดุลยพินิจธุรกิจ (%)',
  },
  WEIGHT_TOLERANCE_MIN_PCT: {
    policyName: 'WEIGHT_CALIBRATION_POLICY',
    type: 'FLOAT',
    min: 0,
    max: 10,
    default: 2.0,
    description: 'เปอร์เซ็นต์เกณฑ์ความต่างน้ำหนักต่ำสุดของเครื่องชั่ง (%)',
  },
  WEIGHT_TOLERANCE_MAX_PCT: {
    policyName: 'WEIGHT_CALIBRATION_POLICY',
    type: 'FLOAT',
    min: 0,
    max: 20,
    default: 5.0,
    description: 'เปอร์เซ็นต์เกณฑ์ความต่างน้ำหนักสูงสุดของเครื่องชั่ง (%)',
  },
  STANDARD_BAG_WEIGHT_KG: {
    policyName: 'WEIGHT_CALIBRATION_POLICY',
    type: 'FLOAT',
    min: 1,
    max: 100,
    default: 50.0,
    description: 'น้ำหนักกระสอบมาตรฐาน (กก.)',
  },
}));

/**
 * Validate a single setting key and value (fail-closed against prototype pollution and trailing garbage).
 * Returns { valid: true, formattedValue, policyName } or { valid: false, error: string }
 */
function validateSetting(key, val) {
  // Prototype key guard: must be an own property of POLICY_DEFINITIONS
  if (!Object.prototype.hasOwnProperty.call(POLICY_DEFINITIONS, key)) {
    return { valid: false, error: `ไม่อนุญาตให้แก้ไขการตั้งค่าที่ไม่ได้รับอนุญาต: ${key}` };
  }

  const def = POLICY_DEFINITIONS[key];
  if (!def) {
    return { valid: false, error: `ไม่อนุญาตให้แก้ไขการตั้งค่าที่ไม่ได้รับอนุญาต: ${key}` };
  }

  if (val === null || val === undefined || String(val).trim() === '') {
    return { valid: false, error: `ค่าของการตั้งค่า ${key} ต้องไม่เป็นค่าว่าง` };
  }

  const strVal = String(val).trim();

  switch (def.type) {
    case 'INT': {
      // Must not accept trailing junk (e.g. '80junk')
      if (typeof val === 'number') {
        if (!Number.isInteger(val) || !Number.isFinite(val)) {
          return { valid: false, error: `${key} ต้องเป็นจำนวนเต็ม` };
        }
      } else {
        if (!/^-?\d+$/.test(strVal)) {
          return { valid: false, error: `${key} ต้องเป็นจำนวนเต็ม (ไม่อนุญาตอักขระแปลกปลอม)` };
        }
      }

      const n = Number(strVal);
      if (!Number.isInteger(n) || !Number.isFinite(n)) {
        return { valid: false, error: `${key} ต้องเป็นจำนวนเต็ม` };
      }
      if (def.min !== undefined && n < def.min) {
        return { valid: false, error: `${key} ต้องมีค่าไม่ต่ำกว่า ${def.min}` };
      }
      if (def.max !== undefined && n > def.max) {
        return { valid: false, error: `${key} ต้องมีค่าไม่เกิน ${def.max}` };
      }
      return { valid: true, formattedValue: String(n), policyName: def.policyName };
    }

    case 'FLOAT': {
      // Must not accept trailing junk (e.g. '80junk')
      if (typeof val === 'number') {
        if (isNaN(val) || !Number.isFinite(val)) {
          return { valid: false, error: `${key} ต้องเป็นตัวเลข` };
        }
      } else {
        if (!/^-?\d+(\.\d+)?$/.test(strVal)) {
          return { valid: false, error: `${key} ต้องเป็นตัวเลข (ไม่อนุญาตอักขระแปลกปลอม)` };
        }
      }

      const n = Number(strVal);
      if (isNaN(n) || !Number.isFinite(n)) {
        return { valid: false, error: `${key} ต้องเป็นตัวเลข` };
      }

      // Max 2 decimal places precision check for monetary / ratio / tolerance fields
      const dotIdx = strVal.indexOf('.');
      if (dotIdx !== -1 && strVal.length - dotIdx - 1 > 2) {
        return { valid: false, error: `${key} รองรับทศนิยมสูงสุดไม่เกิน 2 ตำแหน่ง` };
      }

      if (def.min !== undefined && n < def.min) {
        return { valid: false, error: `${key} ต้องมีค่าไม่ต่ำกว่า ${def.min}` };
      }
      if (def.max !== undefined && n > def.max) {
        return { valid: false, error: `${key} ต้องมีค่าไม่เกิน ${def.max}` };
      }
      return { valid: true, formattedValue: String(n), policyName: def.policyName };
    }

    case 'BOOLEAN': {
      const lower = strVal.toLowerCase();
      if (lower === 'true' || lower === '1') {
        return { valid: true, formattedValue: 'true', policyName: def.policyName };
      }
      if (lower === 'false' || lower === '0') {
        return { valid: true, formattedValue: 'false', policyName: def.policyName };
      }
      return { valid: false, error: `${key} ต้องเป็นค่าความจริง (true หรือ false)` };
    }

    case 'CSV_INT': {
      const parts = strVal.split(',').map(s => s.trim());
      if (!parts.length || parts.some(p => !/^\d+$/.test(p))) {
        return { valid: false, error: `${key} ต้องเป็นชุดตัวเลขจำนวนเต็มบวกคั่นด้วยจุลภาค เช่น 7,15,30,45` };
      }
      const nums = [];
      for (const p of parts) {
        const num = parseInt(p, 10);
        if (isNaN(num) || num < 1 || num > 365) {
          return { valid: false, error: `${key} ตัวเลือกจำนวนวันแต่ละค่าต้องอยู่ระหว่าง 1 ถึง 365 วัน` };
        }
        nums.push(num);
      }
      return { valid: true, formattedValue: nums.join(','), policyName: def.policyName };
    }

    default:
      return { valid: true, formattedValue: strVal, policyName: def.policyName };
  }
}

/**
 * Validate Reason Code against active wf.EditReason master table.
 * If reasonCode === 'OTHER', reasonText must be provided with length >= 5.
 */
async function validateReasonCode(txOrReq, reasonCode, reasonText, context = 'POLICY') {
  if (!reasonCode || typeof reasonCode !== 'string' || !reasonCode.trim()) {
    return { valid: false, error: 'ต้องระบุรหัสเหตุผล (reasonCode)' };
  }
  const cleanCode = reasonCode.trim().toUpperCase();
  const cleanText = reasonText ? String(reasonText).trim() : '';

  let row = null;
  const sqlQuery = `
    SELECT ReasonCode, ReasonText, AppliesTo, IsActive
    FROM wf.EditReason
    WHERE ReasonCode = @code
  `;

  if (txOrReq && typeof txOrReq.request === 'function') {
    const r = txOrReq.request();
    r.input('code', sql.VarChar(30), cleanCode);
    const res = await r.query(sqlQuery);
    row = res.recordset?.[0];
  } else {
    const res = await wfQuery(sqlQuery, { code: { type: sql.VarChar(30), value: cleanCode } });
    row = res.recordset?.[0];
  }

  if (!row || !row.IsActive) {
    return { valid: false, error: `รหัสเหตุผล "${cleanCode}" ไม่ถูกต้องหรือยังไม่เปิดใช้งานในระบบ` };
  }

  if (context && row.AppliesTo) {
    const validContexts = row.AppliesTo.split(',').map(s => s.trim().toUpperCase());
    if (!validContexts.includes(context.toUpperCase()) && !validContexts.includes('ALL')) {
      return { valid: false, error: `รหัสเหตุผล "${cleanCode}" ไม่สามารถใช้กับบริบท ${context} ได้` };
    }
  }

  if (cleanCode === 'OTHER') {
    if (!cleanText || cleanText.length < 5) {
      return { valid: false, error: 'กรณีเลือกเหตุผล "อื่น ๆ" ต้องระบุรายละเอียดเพิ่มเติมอย่างน้อย 5 ตัวอักษร' };
    }
  }

  return { valid: true, reasonCode: cleanCode, reasonText: cleanText || row.ReasonText };
}

/**
 * Validate full settings payload and cross-field constraints.
 */
function validateSettingsPayload(updates, currentSettings = {}) {
  const errors = [];
  const validated = {};

  for (const [key, val] of Object.entries(updates)) {
    const result = validateSetting(key, val);
    if (!result.valid) {
      errors.push(result.error);
    } else {
      validated[key] = {
        value: result.formattedValue,
        policyName: result.policyName,
      };
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Cross-field validation: Rebate Ratios must sum to 100%
  const effectiveCustRatio = validated.CUSTOMER_RATIO
    ? parseFloat(validated.CUSTOMER_RATIO.value)
    : (currentSettings.CUSTOMER_RATIO !== undefined ? parseFloat(currentSettings.CUSTOMER_RATIO) : 100);

  const effectiveCompRatio = validated.COMPANY_RATIO
    ? parseFloat(validated.COMPANY_RATIO.value)
    : (currentSettings.COMPANY_RATIO !== undefined ? parseFloat(currentSettings.COMPANY_RATIO) : 0);

  if (Math.abs((effectiveCustRatio + effectiveCompRatio) - 100) > 0.001) {
    errors.push(`สัดส่วนเงินรีเบทลูกค้า (${effectiveCustRatio}%) และบริษัท (${effectiveCompRatio}%) รวมกันต้องเท่ากับ 100%`);
  }

  // Cross-field validation: Weight tolerance min <= max
  const effectiveMinPct = validated.WEIGHT_TOLERANCE_MIN_PCT
    ? parseFloat(validated.WEIGHT_TOLERANCE_MIN_PCT.value)
    : (currentSettings.WEIGHT_TOLERANCE_MIN_PCT !== undefined ? parseFloat(currentSettings.WEIGHT_TOLERANCE_MIN_PCT) : 2.0);

  const effectiveMaxPct = validated.WEIGHT_TOLERANCE_MAX_PCT
    ? parseFloat(validated.WEIGHT_TOLERANCE_MAX_PCT.value)
    : (currentSettings.WEIGHT_TOLERANCE_MAX_PCT !== undefined ? parseFloat(currentSettings.WEIGHT_TOLERANCE_MAX_PCT) : 5.0);

  if (effectiveMinPct > effectiveMaxPct) {
    errors.push(`เกณฑ์ความต่างน้ำหนักต่ำสุด (${effectiveMinPct}%) ต้องไม่มากกว่าเกณฑ์สูงสุด (${effectiveMaxPct}%)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    validated,
  };
}

/**
 * Log an audit change event into wf.ChangeEvent
 */
async function logChangeEvent(txOrReq, {
  entityType,
  entityId,
  action,
  beforeJson,
  afterJson,
  reasonCode,
  reasonText,
  userId,
  ipAddress,
}) {
  const sqlStr = `
    INSERT INTO wf.ChangeEvent (
      EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonCode, ReasonText, UserId, IpAddress
    ) VALUES (
      @entityType, @entityId, @action, @beforeJson, @afterJson, @reasonCode, @reasonText, @userId, @ipAddress
    );
  `;

  const params = {
    entityType: { type: sql.VarChar(50), value: String(entityType || '').slice(0, 50) },
    entityId:   { type: sql.VarChar(100), value: String(entityId || '').slice(0, 100) },
    action:     { type: sql.VarChar(30), value: String(action || '').slice(0, 30) },
    beforeJson: { type: sql.NVarChar(sql.MAX), value: beforeJson ? (typeof beforeJson === 'string' ? beforeJson : JSON.stringify(beforeJson)) : null },
    afterJson:  { type: sql.NVarChar(sql.MAX), value: afterJson ? (typeof afterJson === 'string' ? afterJson : JSON.stringify(afterJson)) : null },
    reasonCode: { type: sql.VarChar(30), value: reasonCode ? String(reasonCode).slice(0, 30) : null },
    reasonText: { type: sql.NVarChar(500), value: reasonText ? String(reasonText).slice(0, 500) : null },
    userId:     { type: sql.VarChar(50), value: String(userId || 'SYSTEM').slice(0, 50) },
    ipAddress:  { type: sql.VarChar(50), value: ipAddress ? String(ipAddress).slice(0, 50) : null },
  };

  if (txOrReq && typeof txOrReq.request === 'function') {
    const r = txOrReq.request();
    for (const [k, { type, value }] of Object.entries(params)) r.input(k, type, value);
    await r.query(sqlStr);
  } else {
    await wfQuery(sqlStr, params);
  }
}

/**
 * Retrieve current system settings with type-parsed dictionary, raw rows, and policy version history.
 */
async function getPolicySettings() {
  const rows = (await wfQuery(`
    SELECT SettingKey, SettingValue, Description, UpdatedAt
    FROM wf.SystemSetting
  `)).recordset || [];

  const raw = {};
  const typed = {};

  for (const r of rows) {
    raw[r.SettingKey] = r.SettingValue;
    const def = POLICY_DEFINITIONS[r.SettingKey];
    if (def) {
      if (def.type === 'INT') typed[r.SettingKey] = parseInt(r.SettingValue, 10);
      else if (def.type === 'FLOAT') typed[r.SettingKey] = parseFloat(r.SettingValue);
      else if (def.type === 'BOOLEAN') typed[r.SettingKey] = r.SettingValue === 'true';
      else typed[r.SettingKey] = r.SettingValue;
    } else {
      typed[r.SettingKey] = r.SettingValue;
    }
  }

  // Populate defaults for any missing definitions
  for (const [key, def] of Object.entries(POLICY_DEFINITIONS)) {
    if (raw[key] === undefined) {
      raw[key] = String(def.default);
      if (def.type === 'INT') typed[key] = parseInt(def.default, 10);
      else if (def.type === 'FLOAT') typed[key] = parseFloat(def.default);
      else if (def.type === 'BOOLEAN') typed[key] = def.default === 'true';
      else typed[key] = def.default;
    }
  }

  // Latest policy snapshots (coherent immutable set)
  let snapshots = [];
  try {
    snapshots = (await wfQuery(`
      SELECT ps.*
      FROM wf.PolicySnapshot ps
      INNER JOIN (
        SELECT PolicyName, MAX(RevisionNumber) AS MaxRev
        FROM wf.PolicySnapshot
        GROUP BY PolicyName
      ) mr ON ps.PolicyName = mr.PolicyName AND ps.RevisionNumber = mr.MaxRev
    `)).recordset || [];
  } catch (_) {}

  // Latest policy versions (legacy individual keys)
  let versions = [];
  try {
    versions = (await wfQuery(`
      SELECT pv.*
      FROM wf.PolicyVersion pv
      INNER JOIN (
        SELECT PolicyName, MAX(VersionNumber) AS MaxVersion
        FROM wf.PolicyVersion
        GROUP BY PolicyName
      ) mv ON pv.PolicyName = mv.PolicyName AND pv.VersionNumber = mv.MaxVersion
    `)).recordset || [];
  } catch (_) {}

  // Current revision number
  const maxRev = snapshots.reduce((m, s) => Math.max(m, Number(s.RevisionNumber) || 0), 0)
    || versions.reduce((m, v) => Math.max(m, Number(v.VersionNumber) || 0), 0)
    || 1;

  return {
    settings: typed,
    raw,
    rows,
    versions,
    snapshots,
    currentRevision: maxRev,
    definitions: POLICY_DEFINITIONS,
  };
}

/**
 * Update policy settings with strict validation, coherent version incrementing, and change event auditing.
 * All mutations execute inside a single atomic database transaction.
 */
async function updatePolicySettings({ updates, expectedRevision, userId, reasonCode, reasonText, ipAddress, effectiveFrom }) {
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw { status: 400, message: 'ไม่มีข้อมูลการตั้งค่าที่จะปรับปรุง' };
  }

  return await wfTransaction(async (tx) => {
    // 1. Validate Reason Code against wf.EditReason master
    const reasonCheck = await validateReasonCode(tx, reasonCode, reasonText, 'POLICY');
    if (!reasonCheck.valid) {
      throw { status: 400, message: reasonCheck.error };
    }
    const cleanReasonCode = reasonCheck.reasonCode;
    const cleanReasonText = reasonCheck.reasonText;

    // 2. Concurrency / Optimistic Locking check (A4, R8)
    // expectedRevision is strictly mandatory for all normal Admin updates
    const revCheck = await tx.request().query(`
      SELECT ISNULL(MAX(RevisionNumber), 0) AS CurrentRev
      FROM wf.PolicySnapshot WITH (UPDLOCK, HOLDLOCK)
    `);
    const currentRev = Number(revCheck.recordset?.[0]?.CurrentRev || 0);

    const parsedExpectedRev = Number(expectedRevision);
    if (
      expectedRevision === undefined ||
      expectedRevision === null ||
      !Number.isInteger(parsedExpectedRev) ||
      parsedExpectedRev <= 0
    ) {
      throw {
        status: 400,
        message: 'ต้องระบุ expectedRevision ที่เป็นจำนวนเต็มบวกสำหรับการปรับปรุงนโยบาย เพื่อป้องกันการแก้ไขทับซ้อน (Optimistic Concurrency Control)',
      };
    }

    if (currentRev > 0 && currentRev !== parsedExpectedRev) {
      throw {
        status: 409,
        message: `การตั้งค่าถูกปรับปรุงโดยผู้ดูแลระบบท่านอื่นแล้ว (เวอร์ชันปัจจุบัน: ${currentRev}, ที่ส่งมา: ${expectedRevision}) กรุณารีเฟรชหน้าจอแล้วทำรายการใหม่`,
      };
    }

    // Parse optional effectiveFrom date
    let effectiveDate = null;
    if (effectiveFrom) {
      const parsed = new Date(effectiveFrom);
      if (isNaN(parsed.getTime())) {
        throw { status: 400, message: 'รูปแบบวันที่มีผลบังคับใช้ (effectiveFrom) ไม่ถูกต้อง' };
      }
      effectiveDate = parsed;
    }

    // 3. Fetch current settings with lock
    const currentRows = (await tx.request().query(`
      SELECT SettingKey, SettingValue
      FROM wf.SystemSetting WITH (UPDLOCK, HOLDLOCK)
    `)).recordset || [];

    const currentMap = {};
    for (const r of currentRows) {
      currentMap[r.SettingKey] = r.SettingValue;
    }

    // 4. Validate payload
    const validation = validateSettingsPayload(updates, currentMap);
    if (!validation.valid) {
      throw { status: 400, message: validation.errors.join('; ') };
    }

    const updatedKeys = [];
    const beforeSnapshots = {};
    const afterSnapshots = {};
    const affectedPolicies = new Set();

    // 5. Process each setting update
    for (const [key, { value: newVal, policyName }] of Object.entries(validation.validated)) {
      const oldVal = currentMap[key] !== undefined ? currentMap[key] : null;

      // Only record if value actually changed
      if (oldVal === newVal) continue;

      beforeSnapshots[key] = oldVal;
      afterSnapshots[key] = newVal;
      updatedKeys.push(key);
      affectedPolicies.add(policyName);

      const isImmediate = (!effectiveDate || effectiveDate <= new Date());

      // 5.1 Upsert into wf.SystemSetting only if effective immediately (C3)
      // Future scheduled settings must NOT overwrite current active settings!
      if (isImmediate) {
        const reqMerge = tx.request();
        reqMerge.input('k', sql.NVarChar(50), key);
        reqMerge.input('v', sql.NVarChar(200), newVal);
        reqMerge.input('desc', sql.NVarChar(500), POLICY_DEFINITIONS[key]?.description || null);
        await reqMerge.query(`
          MERGE wf.SystemSetting AS t
          USING (SELECT @k AS SettingKey) AS s
          ON t.SettingKey = s.SettingKey
          WHEN MATCHED THEN
            UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (SettingKey, SettingValue, Description) VALUES (@k, @v, @desc);
        `);
      }

      // 5.2 Determine next version number for this policy (wf.PolicyVersion)
      const reqVer = tx.request();
      reqVer.input('pname', sql.VarChar(50), policyName);
      const verRes = await reqVer.query(`
        SELECT ISNULL(MAX(VersionNumber), 0) + 1 AS NextVersion
        FROM wf.PolicyVersion WITH (UPDLOCK, HOLDLOCK)
        WHERE PolicyName = @pname
      `);
      const nextVersion = verRes.recordset?.[0]?.NextVersion || 1;

      // 5.3 Insert into wf.PolicyVersion
      const reqPv = tx.request();
      reqPv.input('pname', sql.VarChar(50), policyName);
      reqPv.input('ver', sql.Int, nextVersion);
      reqPv.input('k', sql.NVarChar(50), key);
      reqPv.input('oldV', sql.NVarChar(500), oldVal);
      reqPv.input('newV', sql.NVarChar(500), newVal);
      reqPv.input('by', sql.VarChar(50), String(userId || 'ADMIN'));
      reqPv.input('rcode', sql.VarChar(30), cleanReasonCode);
      reqPv.input('rtext', sql.NVarChar(400), cleanReasonText);
      await reqPv.query(`
        INSERT INTO wf.PolicyVersion (
          PolicyName, VersionNumber, SettingKey, OldValue, NewValue, ChangedBy, ReasonCode, ReasonText
        ) VALUES (
          @pname, @ver, @k, @oldV, @newV, @by, @rcode, @rtext
        )
      `);
    }

    // 6. Create Coherent PolicySnapshot for affected policies (R3, C3)
    if (updatedKeys.length > 0) {
      // Build full updated map
      const mergedMap = { ...currentMap };
      for (const [k, v] of Object.entries(afterSnapshots)) {
        mergedMap[k] = v;
      }

      const isImmediate = (!effectiveDate || effectiveDate <= new Date());

      // Check if Rebate Policy affected
      if (affectedPolicies.has('REBATE_POLICY')) {
        const custRatio = mergedMap.CUSTOMER_RATIO !== undefined ? parseFloat(mergedMap.CUSTOMER_RATIO) : 100.00;
        const compRatio = mergedMap.COMPANY_RATIO !== undefined ? parseFloat(mergedMap.COMPANY_RATIO) : 0.00;

        const reqRev = tx.request();
        const revRes = await reqRev.query(`
          SELECT ISNULL(MAX(RevisionNumber), 0) + 1 AS NextRev
          FROM wf.PolicySnapshot WITH (UPDLOCK, HOLDLOCK)
          WHERE PolicyName = 'REBATE_POLICY'
        `);
        const nextRev = revRes.recordset?.[0]?.NextRev || 1;

        if (isImmediate) {
          await tx.request().query(`
            UPDATE wf.PolicySnapshot
            SET EffectiveTo = SYSUTCDATETIME()
            WHERE PolicyName = 'REBATE_POLICY'
              AND EffectiveTo IS NULL
              AND EffectiveFrom <= SYSUTCDATETIME()
          `);
        } else {
          const reqRetire = tx.request();
          reqRetire.input('effDate', sql.DateTime2, effectiveDate);
          await reqRetire.query(`
            UPDATE wf.PolicySnapshot
            SET EffectiveTo = @effDate
            WHERE PolicyName = 'REBATE_POLICY'
              AND (EffectiveTo IS NULL OR EffectiveTo > @effDate)
              AND EffectiveFrom < @effDate
          `);
        }

        const reqSnap = tx.request();
        reqSnap.input('rev', sql.Int, nextRev);
        reqSnap.input('json', sql.NVarChar(sql.MAX), JSON.stringify({ CUSTOMER_RATIO: custRatio, COMPANY_RATIO: compRatio }));
        reqSnap.input('cRatio', sql.Decimal(5,2), custRatio);
        reqSnap.input('compRatio', sql.Decimal(5,2), compRatio);
        reqSnap.input('by', sql.VarChar(50), String(userId || 'ADMIN'));
        reqSnap.input('rcode', sql.VarChar(30), cleanReasonCode);
        reqSnap.input('rtext', sql.NVarChar(500), cleanReasonText);
        reqSnap.input('effFrom', sql.DateTime2, effectiveDate);
        await reqSnap.query(`
          INSERT INTO wf.PolicySnapshot (
            PolicyName, RevisionNumber, SnapshotJson, CustomerRatio, CompanyRatio, ChangedBy, ReasonCode, ReasonText, EffectiveFrom
          ) VALUES (
            'REBATE_POLICY', @rev, @json, @cRatio, @compRatio, @by, @rcode, @rtext, ISNULL(@effFrom, SYSUTCDATETIME())
          )
        `);
      }

      // Record System-wide snapshot
      const reqSysRev = tx.request();
      const sysRevRes = await reqSysRev.query(`
        SELECT ISNULL(MAX(RevisionNumber), 0) + 1 AS NextRev
        FROM wf.PolicySnapshot WITH (UPDLOCK, HOLDLOCK)
        WHERE PolicyName = 'SYSTEM_POLICY'
      `);
      const nextSysRev = sysRevRes.recordset?.[0]?.NextRev || 1;

      if (isImmediate) {
        await tx.request().query(`
          UPDATE wf.PolicySnapshot
          SET EffectiveTo = SYSUTCDATETIME()
          WHERE PolicyName = 'SYSTEM_POLICY'
            AND EffectiveTo IS NULL
            AND EffectiveFrom <= SYSUTCDATETIME()
        `);
      } else {
        const reqSysRetire = tx.request();
        reqSysRetire.input('effDate', sql.DateTime2, effectiveDate);
        await reqSysRetire.query(`
          UPDATE wf.PolicySnapshot
          SET EffectiveTo = @effDate
          WHERE PolicyName = 'SYSTEM_POLICY'
            AND (EffectiveTo IS NULL OR EffectiveTo > @effDate)
            AND EffectiveFrom < @effDate
        `);
      }

      const reqSysSnap = tx.request();
      reqSysSnap.input('rev', sql.Int, nextSysRev);
      reqSysSnap.input('json', sql.NVarChar(sql.MAX), JSON.stringify(mergedMap));
      reqSysSnap.input('by', sql.VarChar(50), String(userId || 'ADMIN'));
      reqSysSnap.input('rcode', sql.VarChar(30), cleanReasonCode);
      reqSysSnap.input('rtext', sql.NVarChar(500), cleanReasonText);
      reqSysSnap.input('effFrom', sql.DateTime2, effectiveDate);
      await reqSysSnap.query(`
        INSERT INTO wf.PolicySnapshot (
          PolicyName, RevisionNumber, SnapshotJson, ChangedBy, ReasonCode, ReasonText, EffectiveFrom
        ) VALUES (
          'SYSTEM_POLICY', @rev, @json, @by, @rcode, @rtext, ISNULL(@effFrom, SYSUTCDATETIME())
        )
      `);

      // 7. Record ChangeEvent inside the same transaction (R2)
      const entityIdStr = updatedKeys.length > 3
        ? `${updatedKeys.length}_SETTINGS:${updatedKeys.slice(0, 2).join(',')}`.slice(0, 100)
        : updatedKeys.join(',').slice(0, 100);

      await logChangeEvent(tx, {
        entityType: 'POLICY_SETTINGS',
        entityId: entityIdStr,
        action: 'UPDATE',
        beforeJson: beforeSnapshots,
        afterJson: afterSnapshots,
        reasonCode: cleanReasonCode,
        reasonText: cleanReasonText,
        userId: String(userId || 'ADMIN'),
        ipAddress: ipAddress || null,
      });
    }

    return {
      updatedKeys,
      updatedCount: updatedKeys.length,
      before: beforeSnapshots,
      after: afterSnapshots,
    };
  });
}

/**
 * Retrieve the active/effective policy snapshot for a given policy name as of a target date.
 * Fail-closed: If no snapshot is effective (EffectiveFrom <= asOf < EffectiveTo), throws an Error.
 */
async function getEffectivePolicySnapshot(policyName, asOfDate = null) {
  const cleanName = String(policyName || '').trim();
  const querySql = `
    SELECT TOP 1 SnapshotId, PolicyName, RevisionNumber, CustomerRatio, CompanyRatio, SnapshotJson,
                 EffectiveFrom, EffectiveTo, ChangedBy, ReasonCode, ReasonText, CreatedAt
    FROM wf.PolicySnapshot
    WHERE PolicyName = @pname
      AND EffectiveFrom <= @asOf
      AND (EffectiveTo IS NULL OR EffectiveTo > @asOf)
    ORDER BY EffectiveFrom DESC, RevisionNumber DESC
  `;
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  const res = await wfQuery(querySql, {
    pname: { type: sql.VarChar(50), value: cleanName },
    asOf: { type: sql.DateTime2, value: asOf },
  });
  const snap = res.recordset?.[0];
  if (!snap) {
    throw new Error(`ไม่พบนโยบายที่กำลังมีผลบังคับใช้ (Active Policy Snapshot) ในระบบ สำหรับ ${cleanName}`);
  }
  return snap;
}

module.exports = {
  POLICY_DEFINITIONS,
  validateSetting,
  validateReasonCode,
  validateSettingsPayload,
  logChangeEvent,
  getPolicySettings,
  updatePolicySettings,
  getEffectivePolicySnapshot,
};
