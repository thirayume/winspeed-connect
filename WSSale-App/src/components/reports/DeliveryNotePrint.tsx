/**
 * ใบจ่ายสินค้า — แทน RptSaYPan.rpt ของโปรแกรมชั่ง
 *
 * ไม่ได้ใช้ LegacyReportPdfModal เพราะตัวนั้นวางข้อมูลเป็นตาราง
 * แต่ใบนี้เป็นเอกสารหน้างาน: หัวเอกสาร · บรรทัดแบบประโยค · ยอดรวม · ช่องเซ็นสามช่อง
 * จึงเขียนแยกแต่ **ใช้คลาสสำหรับพิมพ์ชุดเดียวกัน** (report-modal-root / report-print-area /
 * report-page / report-no-print) เพื่อให้พฤติกรรมตอนสั่งพิมพ์เหมือนรายงานอื่นทุกใบ
 *
 * หัวเรื่องเปลี่ยนได้ผ่าน prop `variant` — ต้นฉบับมีหกใบที่หน้าตาเหมือนกันหมด
 * ต่างแค่หัวเรื่องกับเงื่อนไขกรอง (สายพาน · BULK · คลังสินค้า · อื่น ๆ · ส่ง · กางฉาง)
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, AlertTriangle } from 'lucide-react';
import { fetchDeliveryNote, type DeliveryNote } from '../../services/api';

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

const nf = (v: number, d = 2) =>
  Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                   'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/**
 * TruckScale เก็บวันที่เป็นข้อความ `dd/mm/yyyy` พ.ศ. ไม่ใช่ชนิดวันที่
 * ต้นฉบับพิมพ์เป็น `1/พฤษภาคม/2569` จึงแปลงตรงนี้ ไม่ผ่าน Date เพื่อเลี่ยงเรื่อง timezone
 * ถ้ารูปแบบไม่ตรงที่คาด คืนค่าเดิมไปดีกว่าเดาผิด
 */
function thaiLongDate(raw?: string): string {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return raw || '-';
  const day = Number(m[1]), mon = Number(m[2]);
  if (mon < 1 || mon > 12) return raw || '-';
  return `${day}/${TH_MONTHS[mon - 1]}/${m[3]}`;
}

export type DeliveryNoteVariant = 'saypan' | 'bulk' | 'klungsinka' | 'other' | 'sent' | 'kangchang';

const VARIANT_TITLE: Record<DeliveryNoteVariant, string> = {
  saypan: 'สายพาน',
  bulk: 'BULK',
  klungsinka: 'คลังสินค้า',
  other: 'อื่น ๆ',
  sent: 'ส่งสินค้า',
  kangchang: 'กางฉาง',
};

export function DeliveryNotePrint({
  sequence, variant = 'saypan', onClose,
}: { sequence: string; variant?: DeliveryNoteVariant; onClose: () => void }) {
  const [data, setData] = useState<DeliveryNote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchDeliveryNote(sequence)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [sequence]);

  // ยอดที่ชั่งได้จริงเทียบกับยอดที่คีย์ไว้ — ถ้าต่างกันแปลว่าเอกสารกับตาชั่งไม่ตรงกัน
  // ต้นฉบับไม่มีการตรวจนี้ แต่ข้อมูลมีอยู่แล้วและเป็นสิ่งที่คนอ่านเอกสารอยากรู้
  const keyedKg = data ? data.items.reduce((s, i) => s + Number(i.Bag || 0) * Number(i.KgPerBag || 0), 0) : 0;
  const scaleKg = Number(data?.WeightNet || 0);
  const mismatch = data && scaleKg > 0 && Math.abs(keyedKg - scaleKg) > 1;

  const body = (
    <div className="report-modal-root fixed inset-0 z-50 overflow-auto bg-black/50 p-4">
      <div className="report-no-print mx-auto mb-3 flex max-w-[210mm] items-center justify-between rounded-lg bg-white px-4 py-2 shadow">
        <span className="font-medium">ใบจ่ายสินค้า — {VARIANT_TITLE[variant]}</span>
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
              <div className="flex items-start justify-between text-[15px]">
                <div>
                  <div>ใบจ่ายสินค้า</div>
                  <div className="mt-1">
                    เลขที่ใบสั่งจ่าย <span className="ml-3">{data.issueNo || '-'}</span>
                  </div>
                </div>
                <h1 className="mt-1 text-3xl font-bold">{VARIANT_TITLE[variant]}</h1>
                <div className="pt-1">วันที่ {thaiLongDate(data.DateOut || data.DateIn)}</div>
              </div>

              {data.issueNoAll.length > 1 && (
                <p className="report-no-print mt-2 flex items-center gap-1 text-sm text-amber-700">
                  <AlertTriangle size={14} />
                  ใบนี้มีเลขใบสั่งจ่ายมากกว่าหนึ่ง: {data.issueNoAll.join(' · ')}
                </p>
              )}

              <div className="mt-6 flex gap-10 text-[15px]">
                <div className="flex-1">
                  ชื่อร้านลูกค้า <span className="ml-2 border-b border-dotted px-2">{data.CustName || '-'}</span>
                </div>
                <div>
                  ทะเบียนรถ <span className="ml-2 border-b border-dotted px-2">{data.Plate || '-'}</span>
                </div>
              </div>

              <div className="mt-6 space-y-3 text-[15px]">
                {data.items.map(i => (
                  <div key={i.Id} className="flex flex-wrap items-baseline gap-x-2">
                    <span>ปุ๋ยสูตร</span>
                    <span className="min-w-[170px] border-b border-dotted px-1">{i.GoodName || i.GoodCode}</span>
                    <span>ตรา</span>
                    <span className="min-w-[90px] border-b border-dotted px-1">{i.Brand && i.Brand !== '-' ? i.Brand : ''}</span>
                    <span>จำนวน</span>
                    <span className="min-w-[60px] border-b border-dotted px-1 text-right">{nf(i.Bag, 0)}</span>
                    <span>กส.</span>
                    <span>จำนวน</span>
                    <span className="min-w-[70px] border-b border-dotted px-1 text-right">{nf(i.Ton)}</span>
                    <span>ตัน</span>
                    <span>หมายเหตุ</span>
                    <span className="min-w-[80px] border-b border-dotted px-1">
                      {[i.Destination, i.StoreNote].find(v => v && v !== '-' && v !== '0') || ''}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-wrap items-baseline gap-x-2 text-[15px]">
                <span>เหลือที่ตั๋ว</span>
                <span className="min-w-[60px] border-b border-dotted px-1 text-right">0</span>
                <span>กระสอบ</span>
                <span className="min-w-[60px] border-b border-dotted px-1 text-right">0</span>
                <span>ตัน</span>
                <span className="ml-8">รวมทั้งหมด</span>
                <span className="min-w-[70px] border-b border-dotted px-1 text-right font-medium">{nf(data.totals.bag, 0)}</span>
                <span>กระสอบ</span>
                <span className="min-w-[80px] border-b border-dotted px-1 text-right font-medium">{nf(data.totals.ton)}</span>
                <span>ตัน</span>
              </div>
              <div className="mt-2 text-[15px]">หมายเหตุ</div>

              {mismatch && (
                <p className="report-no-print mt-3 flex items-center gap-1 text-sm text-red-700">
                  <AlertTriangle size={14} />
                  ยอดที่คีย์ {nf(keyedKg, 0)} กก. ไม่ตรงกับน้ำหนักสุทธิที่ชั่งได้ {nf(scaleKg, 0)} กก.
                </p>
              )}

              <div className="mt-20 flex justify-around text-center text-[15px]">
                {['ผู้สั่งจ่ายสินค้า', 'ผู้สั่งจ่ายกระสอบ', 'ผู้ตรวจสอบ'].map(t => (
                  <div key={t} className="w-56">
                    <div className="border-b border-dotted" />
                    <div className="mt-1">{t}</div>
                  </div>
                ))}
              </div>

              <div className="report-no-print mt-8 border-t pt-2 text-xs text-gray-500">
                ใบชั่ง {data.Sequence} · เลขที่ขน {data.Movebill} · น้ำหนักสุทธิ {nf(scaleKg, 0)} กก.
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
