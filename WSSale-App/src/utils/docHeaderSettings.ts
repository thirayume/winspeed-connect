export interface DocHeaderConfig {
  companyNameTh: string;
  companyNameEn: string;
  addressTh: string;
  tel: string;
  fax: string;
  taxId: string;
  logoUrl: string;
  verificationBaseUrl: string;
  // Signatures & Footers
  signatureSalesLabel: string;
  signatureApprovedLabel: string;
  signatureWarehouseLabel: string;
  footerNote: string;
  showSignatures: boolean;
  showFooterNote: boolean;
  showPageNumber: boolean;
  updatedAt?: string;
}

// Official World Fert W Logo SVG as base64 / Data URL
export const DEFAULT_WF_LOGO_DATA_URL = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path d="M15 15 L50 15 L75 85 L98 30 L122 85 L147 15 L182 15 L140 100 L108 100 L98 70 L88 100 L56 100 Z" fill="%231F2A38"/><path d="M24 22 L46 22 L68 80 L87 35 L98 62 L109 35 L128 80 L150 22 L172 22 L137 94 L110 94 L98 64 L86 94 L59 94 Z" fill="%233A4C63"/><path d="M72 82 L87 42 L98 68 L109 42 L124 82 L110 88 L98 64 L86 88 Z" fill="%23566B85"/></svg>`;

export const DEFAULT_HEADER_CONFIG: DocHeaderConfig = {
  companyNameTh: 'บริษัท เวิลด์ เฟอท จำกัด',
  companyNameEn: 'WORLD FERT CO., LTD.',
  addressTh: '933 อาคารรวมทุนไทย ชั้น 11 ถนนมหาไชย แขวงวังบูรพาภิรมย์ เขตพระนคร กรุงเทพมหานคร 10200',
  tel: '02 2218444, 02 2263069',
  fax: '02 2263069',
  taxId: '0105531024397',
  logoUrl: DEFAULT_WF_LOGO_DATA_URL,
  verificationBaseUrl: typeof window !== 'undefined' ? `${window.location.origin}/verify` : 'https://winspeed.worldfert.com/verify',
  signatureSalesLabel: 'พนักงานขาย',
  signatureApprovedLabel: 'ผู้อนุมัติ',
  signatureWarehouseLabel: 'พนักงานคลังสินค้า',
  footerNote: 'เอกสารนี้ออกโดยระบบอัตโนมัติ WINSpeed-Connect · บริษัท เวิลด์ เฟอท จำกัด',
  showSignatures: true,
  showFooterNote: true,
  showPageNumber: true,
};

const GLOBAL_STORAGE_KEY = 'wf_doc_header_global_config';
const REPORT_STORAGE_PREFIX = 'wf_doc_header_report_config_';

function normalizeReportId(id?: string): string | undefined {
  if (!id) return undefined;
  return id.trim().toUpperCase().replace(/-/g, '_');
}

/**
 * ดึงการตั้งค่าหัวกระดาษ/ท้ายกระดาษ
 * @param reportId - หากระบุ จะตรวจสอบการตั้งค่าเฉพาะของรายงานนั้นก่อน หากไม่มีจะใช้การตั้งค่าส่วนกลาง
 */
export function getDocHeaderConfig(reportId?: string): DocHeaderConfig {
  if (typeof window === 'undefined') return DEFAULT_HEADER_CONFIG;
  try {
    const globalSaved = localStorage.getItem(GLOBAL_STORAGE_KEY) || localStorage.getItem('wf_doc_header_config');
    const globalConfig: DocHeaderConfig = globalSaved ? { ...DEFAULT_HEADER_CONFIG, ...JSON.parse(globalSaved) } : DEFAULT_HEADER_CONFIG;

    const normalizedId = normalizeReportId(reportId);
    if (normalizedId) {
      const reportSaved = localStorage.getItem(`${REPORT_STORAGE_PREFIX}${normalizedId}`);
      if (reportSaved) {
        return { ...globalConfig, ...JSON.parse(reportSaved) };
      }
    }

    return globalConfig;
  } catch (e) {
    console.error('Failed to parse doc header config from localStorage:', e);
  }
  return DEFAULT_HEADER_CONFIG;
}

/**
 * บันทึกการตั้งค่าหัวกระดาษ/ท้ายกระดาษ
 * @param config - ค่าที่จะบันทึก
 * @param scope - 'REPORT' (เฉพาะรายงานนี้), 'GLOBAL' (มีผลกับทุกรายงาน), 'SET_DEFAULT' (ตั้งเป็นค่าเริ่มต้นระบบ)
 * @param reportId - รหัสของรายงาน (ในกรณีที่บันทึกแบบ REPORT)
 */
export function saveDocHeaderConfig(
  config: Partial<DocHeaderConfig>,
  scope: 'REPORT' | 'GLOBAL' | 'SET_DEFAULT' = 'GLOBAL',
  reportId?: string
): DocHeaderConfig {
  const currentGlobal = getDocHeaderConfig();
  const updatedWithTimestamp = { ...config, updatedAt: new Date().toISOString() };
  const normalizedId = normalizeReportId(reportId);

  try {
    if (scope === 'REPORT' && normalizedId) {
      // Save specifically for this report
      const currentReport = getDocHeaderConfig(normalizedId);
      const updatedReport = { ...currentReport, ...updatedWithTimestamp };
      localStorage.setItem(`${REPORT_STORAGE_PREFIX}${normalizedId}`, JSON.stringify(updatedReport));
      window.dispatchEvent(new CustomEvent('doc-header-settings-updated', {
        detail: { config: updatedReport, reportId: normalizedId, scope: 'REPORT' }
      }));
      return updatedReport;
    } else if (scope === 'SET_DEFAULT') {
      // Save as Global and optionally reset report overrides
      const updatedGlobal = { ...DEFAULT_HEADER_CONFIG, ...updatedWithTimestamp };
      localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(updatedGlobal));
      localStorage.setItem('wf_doc_header_config', JSON.stringify(updatedGlobal));

      // Broadcast update
      window.dispatchEvent(new CustomEvent('doc-header-settings-updated', {
        detail: { config: updatedGlobal, scope: 'SET_DEFAULT' }
      }));
      return updatedGlobal;
    } else {
      // Save as Global (Apply to All)
      const updatedGlobal = { ...currentGlobal, ...updatedWithTimestamp };
      localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(updatedGlobal));
      localStorage.setItem('wf_doc_header_config', JSON.stringify(updatedGlobal));

      // Broadcast update to all listeners
      window.dispatchEvent(new CustomEvent('doc-header-settings-updated', {
        detail: { config: updatedGlobal, scope: 'GLOBAL' }
      }));
      return updatedGlobal;
    }
  } catch (e) {
    console.error('Failed to save doc header config to localStorage:', e);
  }
  return { ...currentGlobal, ...config };
}

/**
 * รีเซ็ตการตั้งค่าเฉพาะของรายงานกลับไปใช้ค่าส่วนกลางของระบบ
 */
export function resetReportDocHeaderConfig(reportId: string): DocHeaderConfig {
  const normalizedId = normalizeReportId(reportId);
  if (typeof window !== 'undefined' && normalizedId) {
    localStorage.removeItem(`${REPORT_STORAGE_PREFIX}${normalizedId}`);
  }
  const globalConfig = getDocHeaderConfig();
  window.dispatchEvent(new CustomEvent('doc-header-settings-updated', {
    detail: { config: globalConfig, reportId: normalizedId, scope: 'RESET' }
  }));
  return globalConfig;
}
