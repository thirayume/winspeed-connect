/**
 * ใบชั่งเข้า–ชั่งออก สำหรับพิมพ์ — อ่านจาก `dbo.WGHD` / `dbo.WGDT` ของ WINSpeed
 *
 * ใช้คลาสสำหรับพิมพ์ชุดเดียวกับ DeliveryNotePrint
 * (report-modal-root / report-print-area / report-page / report-no-print)
 * เพื่อให้พฤติกรรมตอนสั่งพิมพ์เหมือนเอกสารใบอื่นทั้งหมด
 *
 * ใบนี้เป็น **หลักฐานการชั่ง** จึงต้องมีครบสามชุดตัวเลขพร้อมวันเวลาของแต่ละครั้ง
 * และต้องบอกให้ชัดว่าน้ำหนักไหนคือรถเปล่า น้ำหนักไหนคือรถบรรทุกสินค้าแล้ว
 * เพราะ **ทิศทางกลับกันระหว่างขายออกกับซื้อเข้า**
 *
 *   ขายออก (SO) รถเข้ามาเปล่า ออกไปหนัก  ⇒ ชั่งเข้า = รถเปล่า
 *   ซื้อเข้า (PO) รถเข้ามาหนัก ออกไปเปล่า ⇒ ชั่งออก = รถเปล่า
 *
 * ถ้าชั่งยังไม่ครบ ต้องแสดงว่ายังไม่ครบ ไม่ใช่เติมศูนย์ให้ดูเหมือนชั่งแล้วได้ศูนย์
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, AlertTriangle } from 'lucide-react';
import { fetchWeighingTicket, type WeighingTicket } from '../../services/api';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > :not(.report-modal-root) { display: none !important; }
  .report-modal-root { display: block !important; position: static !important; }
  .report-print-area { width: 100%; margin: 0 !important; display: block !important; }
  .report-no-print { display: none !important; }
  .report-page { width: 100%; min-height: auto; box-shadow: none !important; border: 0 !important; }
}`;

const KG_PER_SACK = 50;
const nf = (v: unknown, d = 0) =>
  Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

/** ค่าที่ยังไม่มีต้องขึ้นว่า "ยังไม่ชั่ง" ไม่ใช่ 0 — ศูนย์เป็นน้ำหนักที่ชั่งได้จริงได้เหมือนกัน */
const weight = (v: number | null | undefined) =>
  v == null ? <span className="text-gray-400">ยังไม่ชั่ง</span> : <>{nf(v)} กก.</>;

const WGTYPE: Record<string, string> = { SO: 'ขายออก', PO: 'ซื้อเข้า', MO: 'เคลื่อนย้ายภายใน' };

export function WeighTicketPrint({ id, onClose }: { id: number; onClose: () => void }) {
  const [data, setData] = useState<WeighingTicket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchWeighingTicket(id)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [id]);

  const isPurchase = data?.WGType === 'PO';
  // ป้ายกำกับต้องสลับตามทิศทาง ไม่งั้นใบซื้อเข้าจะอ่านผิดว่ารถเข้ามาเปล่า
  const labelIn = isPurchase ? 'ชั่งเข้า (รถ + สินค้า)' : 'ชั่งเข้า (รถเปล่า)';
  const labelOut = isPurchase ? 'ชั่งออก (รถเปล่า)' : 'ชั่งออก (รถ + สินค้า)';

  // ยอดที่คีย์ไว้ในบรรทัดสินค้า เทียบกับน้ำหนักสุทธิที่ชั่งได้ (1 กระสอบ = 50 กก.)
  const keyedKg = data ? data.totals.kasob * KG_PER_SACK : 0;
  const netKg = data?.WeightNet == null ? null : Math.abs(Number(data.WeightNet));
  const mismatch = netKg != null && netKg > 0 && keyedKg > 0 && Math.abs(keyedKg - netKg) > KG_PER_SACK;
  const notWeighed = data && (data.WeightIn == null || data.WeightOut == null);

  const body = (
    <div className="report-modal-root fixed inset-0 z-50 overflow-auto bg-black/50 p-4">
      <div className="report-no-print mx-auto mb-3 flex max-w-[210mm] items-center justify-between rounded-lg bg-white px-4 py-2 shadow">
        <span className="font-medium">ใบชั่งเข้า–ชั่งออก {data ? `#${data.Id}` : ''}</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} disabled={!data}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">
            <Printer size={16} /> พิมพ์
          </button>
          <button onClick={onClose} className="rounded border px-3 py-1.5"><X size={16} /></button>
        </div>
      </div>

      <div className="report-print-area mx-auto max-w-[210mm]">
        <div className="report-page bg-white p-10 shadow" style={{ fontFamily: '"Sarabun","TH Sarabun New",sans-serif' }}>
          {error && <p className="text-red-600">เกิดข้อผิดพลาด: {error}</p>}
          {!data && !error && <p>กำลังโหลด...</p>}

          {data && (
            <>
              <div className="flex items-start justify-between">
                <div className="text-[15px]">
                  <div>ใบชั่งเข้า–ชั่งออก</div>
                  <div className="mt-1">เลขที่เที่ยว <span className="ml-2">{data.MoveBill || '-'}</span></div>
                </div>
                <h1 className="mt-1 text-2xl font-bold">{(data.WGType && WGTYPE[data.WGType]) || data.WGType || 'การชั่ง'}</h1>
                <div className="pt-1 text-right text-[15px]">
                  <div>วันที่ {String(data.DateReg || '').slice(0, 10)}</div>
                  <div className="mt-1 text-gray-600">สถานะ {data.Status} · {data.StatusText}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-x-10 gap-y-2 text-[15px]">
                <div>{isPurchase ? 'ผู้ขาย' : 'ลูกค้า'} <span className="ml-2 border-b border-dotted px-2">{data.CVName || '-'}</span></div>
                <div>ทะเบียนรถ <span className="ml-2 border-b border-dotted px-2">{data.CarNo || '-'}</span></div>
                <div>รหัส <span className="ml-2 border-b border-dotted px-2">{data.CVCode || '-'}</span></div>
                <div>คนขับ <span className="ml-2 border-b border-dotted px-2">{data.DriverName || '-'}</span></div>
                <div>ใบสั่งจอง <span className="ml-2 border-b border-dotted px-2">{data.SODocuNo || '-'}</span></div>
                <div>ใบอนุมัติ <span className="ml-2 border-b border-dotted px-2">{data.AppvDocuNo || '-'}</span></div>
              </div>

              <table className="mt-6 w-full text-[15px]">
                <tbody>
                  <tr>
                    <td className="py-1 pr-4 align-top">{labelIn}</td>
                    <td className="py-1 pr-8 text-right tabular-nums">{weight(data.WeightIn)}</td>
                    <td className="py-1 text-gray-600">{data.DateInText || ''}</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-4 align-top">{labelOut}</td>
                    <td className="py-1 pr-8 text-right tabular-nums">{weight(data.WeightOut)}</td>
                    <td className="py-1 text-gray-600">{data.DateOutText || ''}</td>
                  </tr>
                  <tr className="border-t border-gray-300 font-semibold">
                    <td className="py-1.5 pr-4">น้ำหนักสินค้าสุทธิ</td>
                    <td className="py-1.5 pr-8 text-right tabular-nums">{weight(data.WeightNet)}</td>
                    <td className="py-1.5 text-gray-600">
                      {netKg != null && <>= {nf(netKg / 1000, 2)} ตัน · {nf(netKg / KG_PER_SACK, 0)} กระสอบ</>}
                    </td>
                  </tr>
                </tbody>
              </table>

              {notWeighed && (
                <p className="report-no-print mt-3 flex items-center gap-1 text-sm text-amber-700">
                  <AlertTriangle size={14} />
                  ใบนี้ยังชั่งไม่ครบ — พิมพ์ออกไปจะเป็นเอกสารที่ยังไม่สมบูรณ์
                </p>
              )}

              <div className="mt-8 text-[15px] font-medium">รายการสินค้า</div>
              <table className="mt-2 w-full text-[15px]">
                <thead className="border-b border-gray-300 text-left">
                  <tr>
                    <th className="py-1 font-medium">สินค้า</th>
                    <th className="py-1 font-medium">คลัง</th>
                    <th className="py-1 text-right font-medium">ตัน</th>
                    <th className="py-1 text-right font-medium">กระสอบ</th>
                    <th className="py-1 font-medium">เลขตั๋วคุม</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(i => (
                    <tr key={i.Id} className="border-b border-gray-100">
                      <td className="py-1">{i.GoodName}</td>
                      <td className="py-1">{i.StoreName || i.StoreCode || '—'}</td>
                      <td className="py-1 text-right tabular-nums">{nf(i.GoodTon, 2)}</td>
                      <td className="py-1 text-right tabular-nums">{nf(i.GoodKasob)}</td>
                      <td className="py-1">{i.CouponNo || <span className="text-gray-400">—</span>}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5" colSpan={2}>รวม</td>
                    <td className="py-1.5 text-right tabular-nums">{nf(data.totals.ton, 2)}</td>
                    <td className="py-1.5 text-right tabular-nums">{nf(data.totals.kasob)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>

              {mismatch && (
                <p className="report-no-print mt-3 flex items-center gap-1 text-sm text-red-700">
                  <AlertTriangle size={14} />
                  ยอดที่คีย์ {nf(keyedKg)} กก. ({nf(data.totals.kasob)} กระสอบ × {KG_PER_SACK})
                  ไม่ตรงกับน้ำหนักสุทธิที่ชั่งได้ {nf(netKg)} กก.
                </p>
              )}

              <div className="mt-16 flex justify-around text-center text-[15px]">
                {['ผู้ชั่งเข้า', 'ผู้ชั่งออก', 'ผู้ตรวจสอบ'].map(t => (
                  <div key={t} className="w-56">
                    <div className="border-b border-dotted" />
                    <div className="mt-1">{t}</div>
                  </div>
                ))}
              </div>

              <div className="report-no-print mt-8 border-t pt-2 text-xs text-gray-500">
                WGHD #{data.Id} · SPID {data.SPID ?? '—'} · แหล่งข้อมูล WINSpeed (dbo.WGHD / dbo.WGDT) · อ่านอย่างเดียว
              </div>
            </>
          )}
        </div>
      </div>
      <style>{PRINT_CSS}</style>
    </div>
  );

  return createPortal(body, document.body);
}
