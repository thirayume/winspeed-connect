import { useEffect, useState } from 'react';
import { fetchRebateCustomerOverview, type RebateCustomerOverview } from '../../services/api';

export function RebateCustomersOverview({ onSelect }: { onSelect: (id: number) => void }) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [after, setAfter] = useState(0);
  const [result, setResult] = useState<RebateCustomerOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setResult(null); setError(''); setLoading(true);
    fetchRebateCustomerOverview(after, search).then(data => {
      if (!cancelled) setResult(data);
    }).catch(() => {
      if (!cancelled) setError('ยังไม่สามารถแสดงกอง Rebate ใหม่ได้ กรุณาตรวจสอบกับผู้ดูแลระบบ');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [after, search]);
  return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm space-y-3">
    <div><h2 className="font-bold text-[#0C447C]">กอง Rebate รายลูกค้า</h2>
      <p className="text-xs text-gray-600 mt-1">แสดงลูกค้าที่มีรายการสะสมจากการขนส่งในรอบปัจจุบันตามสิทธิ์ของคุณ รวมยอดยกมา รายการที่ตรวจไม่ได้จะไม่แสดงเป็นยอดศูนย์</p>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setAfter(0); setSearch(input.trim()); }}>
      <label htmlFor="rebate-customer-search" className="sr-only">ค้นหาลูกค้า</label>
      <input id="rebate-customer-search" value={input} maxLength={100} onChange={e => setInput(e.target.value)}
        placeholder="ค้นหารหัสหรือชื่อลูกค้า" className="rounded-lg border px-3 py-2 text-sm" />
      <button className="rounded-lg bg-[#0C447C] px-3 py-2 text-sm text-white" type="submit">ค้นหา</button>
    </form>
    {loading && <p role="status" className="text-sm text-gray-600">กำลังตรวจยอดลูกค้า...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th className="p-2">ลูกค้า</th><th className="p-2">ยอดคงเหลือ</th><th className="p-2">สถานะ</th><th className="p-2">รายละเอียด</th></tr></thead>
        <tbody>{result.items.map(row => <tr key={row.custId} className="border-t">
          <td className="p-2">{row.custCode || row.custId} · {row.custName || 'ไม่พบข้อมูลลูกค้า'}</td>
          <td className="p-2">{row.status === 'ready' && row.balance != null ? `฿${row.balance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'ไม่พร้อมแสดง'}</td>
          <td className="p-2">{row.status === 'ready' ? 'ตรวจต้นทางแล้ว' : 'ต้องตรวจหลักฐาน'}</td>
          <td className="p-2"><button type="button" disabled={row.status !== 'ready'} onClick={() => onSelect(row.custId)} className="text-blue-700 underline disabled:text-gray-400">ดูคิว FIFO</button></td>
        </tr>)}</tbody>
      </table></div>
      {!result.items.length && <p className="text-sm text-gray-500">ไม่พบลูกค้าที่มีรายการสะสมตามเงื่อนไขนี้</p>}
      <div className="flex gap-3 text-sm">
        {after > 0 && <button type="button" onClick={() => setAfter(0)} className="text-blue-700 underline">กลับหน้าแรก</button>}
        {result.nextAfter != null && <button type="button" onClick={() => setAfter(result.nextAfter!)} className="text-blue-700 underline">หน้าถัดไป</button>}
      </div>
    </>}
  </section>;
}
