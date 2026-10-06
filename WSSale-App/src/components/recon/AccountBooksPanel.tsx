import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, RefreshCw } from 'lucide-react';
import { fetchActiveBooks, fetchAccountMismatches, type ActiveBooks, type AccountMismatch } from '../../services/api';

// R12 K-F4: บิล K (บัญชี 2) ต้องจบที่ใบกำกับเล่ม N · บิล I (บัญชี 1) จบที่เล่ม J
// แผงนี้อ่านอย่างเดียว: บอกว่า WINSpeed ใช้ชุดเลขไหนอยู่ และใบตัดตั๋วไหนได้ใบกำกับผิดบัญชี
export function AccountBooksPanel() {
  const [books, setBooks] = useState<ActiveBooks | null>(null);
  const [mismatches, setMismatches] = useState<AccountMismatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, m] = await Promise.all([fetchActiveBooks(), fetchAccountMismatches(60)]);
      setBooks(b);
      setMismatches(m.data || []);
    } catch (e: unknown) {
      setError((e as Error).message || 'โหลดข้อมูลชุดเลขไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <BookOpen size={16} className="text-[#0C447C]" /> ชุดเลขเอกสาร WINSpeed ขณะนี้ (บัญชี 1 = I/C/J · บัญชี 2 = K/D/N)
        </h3>
        <button onClick={load} disabled={loading} className="text-xs text-[#0C447C] flex items-center gap-1 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> รีเฟรช
        </button>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {books && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {books.books.map(b => (
              <div key={b.runCode} className={`rounded-xl border p-2.5 text-xs ${b.activeAccount === 2 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-gray-500">{b.label}</div>
                <div className="font-bold text-gray-800">
                  ชุด {b.activeBook || '?'}{b.activeAccount ? ` · บัญชี ${b.activeAccount}` : ''}
                </div>
                <div className="font-mono text-[11px] text-gray-500">{b.lastNo || '-'}</div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-gray-500">
            ใบตัดตั๋วที่ยังไม่มีใบกำกับ (60 วัน): บัญชี 1 {books.cutsAwaitingInvoice.account1} ใบ · บัญชี 2 {books.cutsAwaitingInvoice.account2} ใบ
          </div>
          <div className="text-[11px] text-gray-400">{books.note}</div>
        </>
      )}

      <div className="pt-2 border-t border-gray-100">
        <div className={`text-xs font-bold flex items-center gap-1.5 ${mismatches.length ? 'text-red-600' : 'text-emerald-600'}`}>
          <AlertTriangle size={13} /> ใบกำกับผิดบัญชี (60 วัน): {mismatches.length} รายการ
        </div>
        {mismatches.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2">ใบตัดตั๋ว</th><th className="py-1 pr-2">วันที่</th><th className="py-1 pr-2">ตั๋ว</th>
                  <th className="py-1 pr-2">ใบสั่งขาย</th><th className="py-1 pr-2">ใบกำกับ</th><th className="py-1">ต้องเป็นเล่ม</th>
                </tr>
              </thead>
              <tbody>
                {mismatches.map(m => (
                  <tr key={`${m.RedemtionID}-${m.SOInvID}`} className="border-t border-gray-100" title={m.message}>
                    <td className="py-1 pr-2 font-mono">{m.CutNo}</td>
                    <td className="py-1 pr-2">{m.CutDate}</td>
                    <td className="py-1 pr-2 font-mono">{m.CouponNo}</td>
                    <td className="py-1 pr-2 font-mono">{m.CouponSoNo}</td>
                    <td className="py-1 pr-2 font-mono text-red-600 font-bold">{m.InvoiceNo}</td>
                    <td className="py-1 font-bold">{m.expectedInvoiceSeries} (บัญชี {m.account})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
