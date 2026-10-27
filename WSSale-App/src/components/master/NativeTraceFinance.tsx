type Redemption = {
  redemptionId: number;
  redemptionDocuNo: string;
  couponId: number;
  couponNo: string;
  redeemedQtyTon: number;
  unitName: string | null;
  invoiceDocuNo: string | null;
  invoiceDocuType: number | null;
};

type FinanceDocument = {
  soInvId: number;
  docuNo: string;
  docuType: number;
  docuDate: string;
  netAmnt: number;
};

function financeDocumentLabel(docuType: number): string {
  if (docuType === 202) return 'เอกสารลูกหนี้ (202)';
  if (docuType === 107) return 'Invoice / ใบกำกับภาษี (107)';
  return `เอกสารการเงิน (${docuType})`;
}

export function NativeTraceFinance({
  redemptions = [],
  invoices = [],
}: {
  redemptions?: Redemption[];
  invoices?: FinanceDocument[];
}) {
  const hasInvoice107 = invoices.some((invoice) => invoice.docuType === 107);

  return (
    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-2">
      <div className="text-xs font-bold text-gray-400 uppercase">
        4. ประวัติตัดตั๋วและเอกสารการเงิน
      </div>

      {redemptions.length > 0 ? (
        redemptions.map((redemption, index) => (
          <div
            key={`${redemption.redemptionId}:${redemption.couponId}:${index}`}
            className="p-2 bg-gray-50 rounded-xl text-xs flex items-center justify-between gap-3"
          >
            <div>
              <span className="font-mono text-gray-700 mr-2">
                {redemption.redemptionDocuNo}
              </span>
              <span className="text-gray-500">ตั๋ว {redemption.couponNo}</span>
            </div>
            <div className="font-bold text-amber-700 text-right">
              {Number(redemption.redeemedQtyTon).toLocaleString()}{' '}
              {redemption.unitName || 'หน่วยตามเอกสาร'}
              {redemption.invoiceDocuNo && (
                <span className="block">
                  →{' '}
                  {redemption.invoiceDocuType === 107
                    ? 'Invoice'
                    : `เอกสารการเงิน (${redemption.invoiceDocuType ?? 'ไม่ระบุชนิด'})`}{' '}
                  {redemption.invoiceDocuNo}
                </span>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="text-xs text-gray-400">ยังไม่มีรายการตัดตั๋ว 116</p>
      )}

      {invoices.length > 0 && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <div className="text-[11px] font-bold text-gray-500">
            เอกสารการเงินที่เชื่อมโยง
          </div>
          {invoices.map((invoice) => (
            <div
              key={invoice.soInvId}
              className="p-2 bg-emerald-50/50 rounded-lg text-xs flex items-center justify-between gap-3 text-emerald-900"
            >
              <div>
                <div className="font-medium">
                  {financeDocumentLabel(invoice.docuType)}
                </div>
                <span className="font-mono font-bold mr-2">
                  {invoice.docuNo}
                </span>
                <span>{invoice.docuDate?.slice(0, 10)}</span>
              </div>
              <div className="font-mono font-bold whitespace-nowrap">
                {Number(invoice.netAmnt || 0).toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                })}{' '}
                บาท
              </div>
            </div>
          ))}
          <p className="text-[11px] text-gray-500">
            โปรดตรวจยอดลูกหนี้คงค้างจากรายงานบัญชี
          </p>
        </div>
      )}

      {!hasInvoice107 && (
        <p className="text-xs text-gray-400">ยังไม่มี Invoice 107</p>
      )}
    </div>
  );
}
