import { formatThaiDate } from './date';

export const MAE_PUI_GOOD_GROUP_ID = 1004;
export const DEFAULT_MAE_PUI_MAX_VALID_DAYS = 3;

export function isMaePuiGood(
  g?: {
    GoodGroupID?: number | string | null;
    GoodGroupName?: string | null;
    goodGroupId?: number | string | null;
    goodGroupName?: string | null;
    IsMaePui?: boolean;
  } | null
): boolean {
  if (!g) return false;
  if (g.IsMaePui) return true;
  const gid = Number(g.GoodGroupID ?? g.goodGroupId ?? 0);
  const gname = String(g.GoodGroupName ?? g.goodGroupName ?? '');
  return gid === MAE_PUI_GOOD_GROUP_ID || gname.includes('แม่ปุ๋ย');
}

/** Local/Bangkok calendar YYYY-MM-DD shifted by offsetDays without DST surprises */
export function getLocalDateStr(offsetDays = 0, baseDateStr?: string): string {
  let d: Date;
  if (baseDateStr && /^\d{4}-\d{2}-\d{2}/.test(baseDateStr)) {
    const clean = baseDateStr.slice(0, 10);
    d = new Date(`${clean}T00:00:00Z`);
  } else {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    d = new Date(`${local.toISOString().slice(0, 10)}T00:00:00Z`);
  }
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function parseMaePuiMaxValidDays(
  raw?: Record<string, any> | null,
  settings?: Record<string, any> | null
): number {
  const candidate = Number(
    raw?.QUOTATION_MAE_PUI_MAX_VALID_DAYS ??
      settings?.QUOTATION_MAE_PUI_MAX_VALID_DAYS ??
      DEFAULT_MAE_PUI_MAX_VALID_DAYS
  );
  return Number.isInteger(candidate) && candidate >= 1 && candidate <= 90
    ? candidate
    : DEFAULT_MAE_PUI_MAX_VALID_DAYS;
}

export function formatThaiShortDate(dateStr?: string | null): string {
  return formatThaiDate(dateStr, false);
}

