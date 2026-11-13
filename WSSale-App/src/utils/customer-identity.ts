/**
 * Extract the base customer code before the first "-" so branch/sub-account codes
 * such as "0462002" and "0462002-1" resolve to the same customer ("0462002").
 */
export function getBaseCustCode(custCode?: string | null): string {
  const raw = String(custCode || '').trim().toUpperCase();
  if (!raw) return '';
  const dashIdx = raw.indexOf('-');
  const prefix = dashIdx >= 0 ? raw.slice(0, dashIdx).trim() : raw;
  return prefix || raw;
}

/**
 * Canonical customer grouping key shared between frontend trip UI and backend
 * multi-customer approval snapshot calculation.
 */
export function getCustomerGroupKey(member: {
  custId?: string | number | null;
  custCode?: string | null;
  custName?: string | null;
  CustId?: string | number | null;
  CustCode?: string | null;
  CustName?: string | null;
}): string {
  const rawCustCode = member.custCode ?? member.CustCode ?? '';
  const baseCode = getBaseCustCode(rawCustCode);
  if (baseCode) return `CODE:${baseCode}`;

  const rawCustId = String(member.custId ?? member.CustId ?? '').trim();
  if (rawCustId) return rawCustId;

  const rawCustName = String(member.custName ?? member.CustName ?? '').trim();
  return rawCustName ? `NAME:${rawCustName}` : '';
}

