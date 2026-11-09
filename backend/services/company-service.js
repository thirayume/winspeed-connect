'use strict';

/**
 * company-service.js — ดึงและจัดการข้อมูลบริษัทจาก WINSpeed dbo.EMComp
 * 
 * ใช้เป็นแหล่งข้อมูลความจริงเดียว (Single Source of Truth) สำหรับ:
 * - ชื่อบริษัทไทยและอังกฤษ (เช่น "WORLD FERT CO., LTD.", "บริษัท เวิลด์ เฟอท จำกัด")
 * - ที่อยู่สำนักงาน, เลขประจำตัวผู้เสียภาษี 13 หลัก, เบอร์โทร, แฟกซ์, อีเมล
 * - นำไปแสดงผลในส่วนหัวของระบบ (Navbar), หน้าเข้าสู่ระบบ (LoginPage), และหัวรายงาน/เอกสารทั้งหมด
 */

const { query, getDbName } = require('../db');

const DEFAULT_COMPANY = Object.freeze({
  compCode: '001',
  compName: 'บริษัท เวิลด์ เฟอท จำกัด',
  compNameEng: 'WORLD FERT CO., LTD.',
  compOwner: 'บริษัท เวิลด์ เฟอท จำกัด',
  compOwnerEng: 'WORLDFERT CO., LTD.',
  taxId: '0105531024397',
  taxId13: '0105531024397',
  addr1: '933  อาคารรวมทนุไทย ชั้น 11 ถนนมหาไชย แขวงวังบูรพาภิรมย์',
  addr2: 'เขตพระนคร  กรุงเทพมหานคร 10200',
  addr3: null,
  addr1Eng: '11th. Fl., Ruamdhanuthai Bldg. 933 Mahachai Road,',
  addr2Eng: 'Pranakorn, Bangkok 10200. Thailand',
  addr3Eng: null,
  tel: '02 2218444',
  fax: '02 2263069',
  email: 'worldfert_office@yahoo.com',
  homepage: null,
});

const cacheByDb = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 นาที

function sanitizeString(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str.length > 0 ? str : null;
}

function normalizeCompanyRecord(row) {
  if (!row || typeof row !== 'object') return { ...DEFAULT_COMPANY };
  const compName = sanitizeString(row.CompName) || DEFAULT_COMPANY.compName;
  const compNameEng = sanitizeString(row.CompNameEng) || DEFAULT_COMPANY.compNameEng;
  const taxId = sanitizeString(row.TaxID) || DEFAULT_COMPANY.taxId;
  const taxId13 = sanitizeString(row.TaxID13) || taxId || DEFAULT_COMPANY.taxId13;

  return {
    compCode: sanitizeString(row.CompCode) || DEFAULT_COMPANY.compCode,
    compName,
    compNameEng,
    compOwner: sanitizeString(row.CompOwner) || compName,
    compOwnerEng: sanitizeString(row.CompOwnerEng) || compNameEng,
    taxId,
    taxId13,
    addr1: sanitizeString(row.Addr1) || DEFAULT_COMPANY.addr1,
    addr2: sanitizeString(row.Addr2) || DEFAULT_COMPANY.addr2,
    addr3: sanitizeString(row.Addr3),
    addr1Eng: sanitizeString(row.Addr1Eng) || DEFAULT_COMPANY.addr1Eng,
    addr2Eng: sanitizeString(row.Addr2Eng) || DEFAULT_COMPANY.addr2Eng,
    addr3Eng: sanitizeString(row.Addr3Eng),
    tel: sanitizeString(row.Tel) || DEFAULT_COMPANY.tel,
    fax: sanitizeString(row.Fax) || DEFAULT_COMPANY.fax,
    email: sanitizeString(row.Email) || DEFAULT_COMPANY.email,
    homepage: sanitizeString(row.Homepage),
  };
}

async function getCompanyInfo(options = {}) {
  const { forceRefresh = false, customQueryFn = null } = options;
  const dbKey = (typeof getDbName === 'function' ? getDbName() : null) || 'DEFAULT';
  const now = Date.now();
  const cached = cacheByDb.get(dbKey);
  if (!forceRefresh && cached && now < cached.expiry) {
    return cached.data;
  }

  try {
    const qFn = customQueryFn || query;
    const res = await qFn(`
      SELECT TOP 1
        CompID, CompCode, CompName, CompOwner, TaxID,
        Addr1, Addr2, Addr3, Tel, Fax, Email, Homepage,
        CompNameEng, CompOwnerEng, Addr1Eng, Addr2Eng, Addr3Eng,
        TaxID13
      FROM dbo.EMComp
    `);
    const row = (Array.isArray(res) ? res[0] : res?.recordset?.[0]) || null;
    const data = normalizeCompanyRecord(row);
    cacheByDb.set(dbKey, { data, expiry: now + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error('[company-service] Failed to query dbo.EMComp:', err.message);
    if (cached) return cached.data;
    return { ...DEFAULT_COMPANY };
  }
}

function clearCompanyCache() {
  cacheByDb.clear();
}

module.exports = {
  DEFAULT_COMPANY,
  normalizeCompanyRecord,
  getCompanyInfo,
  clearCompanyCache,
};

