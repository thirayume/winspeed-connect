/**
 * พิมพ์เอกสาร WinSpeed จาก Sale-App (W2) — อ่านจาก dbo ของ WinSpeed อย่างเดียว
 *
 *   116 ใบขน / ใบตัดตั๋วปุ๋ย — WinSpeed ไม่มีฟอร์มลงทะเบียน จึงออกแบบจากข้อมูลจริงของใบ
 *   107 ใบส่งของ — ตามชื่อ "ฟอร์มใบส่งของ" ของ WinSpeed พร้อมหัวบริษัทจาก Header Master
 *       ปุ๋ยเป็นสินค้ายกเว้น VAT (ใบ 107 ปี 2569 เป็น VATType 3 ทั้งหมด) จึงไม่ใช้ชื่อ "ใบกำกับภาษี" และแสดงแถว VAT เฉพาะใบที่มี VAT
 *
 * ใช้คลาสสำหรับพิมพ์ชุดเดียวกับใบอื่น (report-modal-root / report-print-area / report-page / report-no-print)
 * ใบที่ยังไม่สมบูรณ์ (ยังไม่ตรวจครบ, ยังไม่ Post GL) แจ้งบนจอเท่านั้น ไม่พิมพ์ลงกระดาษ
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, AlertTriangle } from 'lucide-react';
import { fetchNativeSlipPrint, fetchNativeInvoicePrint, type NativeSlipDoc, type NativeInvoiceDoc } from '../../services/api';
import { thaiBahtText } from '../../utils/thaiBahtText';
import { useCan } from '../../utils/capabilities';

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

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** 'YYYY-MM-DD' (ค.ศ.) → '31 ตุลาคม 2569' โดยไม่ผ่าน Date เพื่อเลี่ยงเรื่อง timezone */
function thaiDate(raw?: string | null): string {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw || '-';
  return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}
const nf = (v: unknown, d = 2) =>
  Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
const field = (label: string, value?: string | null) => (
  <div>{label} <span className="ml-2 border-b border-dotted px-2">{value || '-'}</span></div>
);

function SlipBody({ d }: { d: NativeSlipDoc }) {
  const first = d.items[0];
  const total = d.items.reduce((s, i) => s + Number(i.GoodQty || 0), 0);
  const source = d.appApproval?.SlipSource === 'SCALE' ? 'จากตาชั่ง (MoveBill)'
    : d.appApproval?.SlipSource === 'MANUAL' ? 'กรอกเอง (ข้อยกเว้น)' : d.scale ? 'ตรงกับบันทึกชั่ง' : 'ไม่พบบันทึกชั่ง';
  return (
    <>
      <div className="flex items-start justify-between">
        <div className="text-[15px]">
          <div>เลขที่ใบขน <span className="ml-2 text-lg font-semibold">{d.DocuNo}</span></div>
          <div className="mt-1 text-gray-600">ที่มาเลขใบขน: {source}</div>
        </div>
        <h1 className="mt-1 text-2xl font-bold">ใบขน / ใบตัดตั๋วปุ๋ย</h1>
        <div className="pt-1 text-right text-[15px]">วันที่ {thaiDate(d.DocuDate)}</div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-10 gap-y-2 text-[15px]">
        {field('ลูกค้า', first?.CustName ? `${first.CustCode || ''} ${first.CustName}`.trim() : null)}
        {field('ผู้รับสินค้า', d.Receiver)}
        {field('ใบสั่งจอง', first?.BookingNo)}
        {field('ทะเบียนรถ', d.Plate)}
        {field('ใบสั่งขาย (104)', first?.DeliveryNo)}
        {field('ใบส่งของ (107)', first?.InvoiceNo)}
      </div>

      <table className="mt-6 w-full text-[15px]">
        <thead className="border-b border-gray-300 text-left">
          <tr>
            <th className="py-1 font-medium">เลขตั๋ว</th>
            <th className="py-1 font-medium">สินค้า</th>
            <th className="py-1 font-medium">คลัง / ที่เก็บ</th>
            <th className="py-1 text-right font-medium">จำนวน (ตัน)</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map(i => (
            <tr key={i.Listno} className="border-b border-gray-100">
              <td className="py-1">{i.CouponNo || '-'}</td>
              <td className="py-1">{i.GoodCode} {i.GoodName}</td>
              <td className="py-1">{[i.InveName, i.LocaName].filter(Boolean).join(' / ') || '-'}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodQty, 3)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5" colSpan={3}>รวม</td>
            <td className="py-1.5 text-right tabular-nums">{nf(total, 3)}</td>
          </tr>
        </tbody>
      </table>

      {d.scale && (
        <table className="mt-6 w-full text-[15px]">
          <tbody>
            <tr><td className="py-1 pr-4">ชั่งเข้า (รถเปล่า)</td><td className="py-1 pr-8 text-right tabular-nums">{nf(d.scale.WeightIn, 0)} กก.</td><td className="py-1 text-gray-600">{d.scale.DateIn || ''}</td></tr>
            <tr><td className="py-1 pr-4">ชั่งออก (รถ + สินค้า)</td><td className="py-1 pr-8 text-right tabular-nums">{nf(d.scale.WeightOut, 0)} กก.</td><td className="py-1 text-gray-600">{d.scale.DateOut || ''}</td></tr>
            <tr className="border-t border-gray-300 font-semibold">
              <td className="py-1.5 pr-4">น้ำหนักสุทธิ</td>
              <td className="py-1.5 pr-8 text-right tabular-nums">{nf(d.scale.WeightNet, 0)} กก.</td>
              <td className="py-1.5 text-gray-600">{total > 0 && d.scale.WeightNet != null ? `ต่างจากตั๋ว ${nf((Number(d.scale.WeightNet) - total * 1000) / (total * 1000) * 100, 2)}%` : ''}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="mt-16 flex justify-around text-center text-[15px]">
        {[
          ['ผู้บันทึก', d.RecorderCode ? `${d.RecorderCode} ${d.RecorderName || ''}` : null],
          ['ผู้อนุมัติ', d.appApproval?.ApproverCode ? `${d.appApproval.ApproverCode} ${d.appApproval.ApproverName || ''}` : d.NativeApproverCode ? `${d.NativeApproverCode} ${d.NativeApproverName || ''}` : null],
          ['ผู้รับสินค้า', d.Receiver],
        ].map(([t, name]) => (
          <div key={t} className="w-56">
            <div className="h-6 text-sm">{name || ''}</div>
            <div className="border-b border-dotted" />
            <div className="mt-1">{t}</div>
          </div>
        ))}
      </div>

      {d.IsCheckAll !== 'Y' && (
        <p className="report-no-print mt-4 flex items-center gap-1 text-sm text-amber-700">
          <AlertTriangle size={14} /> ใบนี้ยังไม่ติ๊ก "ตรวจสอบทั้งใบ" ใน WinSpeed
        </p>
      )}
      <div className="report-no-print mt-8 border-t pt-2 text-xs text-gray-500">
        WFRedemtionHD #{d.RedemtionID}{d.scale ? ` · WGHD #${d.scale.Id}` : ''} · แหล่งข้อมูล WINSpeed · อ่านอย่างเดียว
      </div>
    </>
  );
}

function InvoiceBody({ d }: { d: NativeInvoiceDoc }) {
  const c = d.company;
  const address = [d.BillAddr1, d.BillAddr2, d.District, d.Amphur, d.Province, d.PostCode].filter(Boolean).join(' ');
  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div className="text-[14px] leading-6">
          <div className="text-lg font-bold">{c?.companyNameTh || '-'}</div>
          {c?.companyNameEn && <div>{c.companyNameEn}</div>}
          {c?.addressTh && <div>{c.addressTh}</div>}
          <div>{[c?.tel && `โทร ${c.tel}`, c?.fax && `แฟกซ์ ${c.fax}`].filter(Boolean).join(' · ')}</div>
          {c?.taxId && <div>เลขประจำตัวผู้เสียภาษี {c.taxId}{c.branchNameTh ? ` · ${c.branchNameTh}` : ''}</div>}
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold">ใบส่งของ</h1>
          <div className="mt-2 text-[15px]">เลขที่ <span className="ml-2 font-semibold">{d.DocuNo}</span></div>
          <div className="text-[15px]">วันที่ {thaiDate(d.DocuDate)}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-10 gap-y-2 text-[15px]">
        {field('ลูกค้า', d.CustName ? `${d.CustCode || ''} ${d.CustName}`.trim() : null)}
        {field('เลขประจำตัวผู้เสียภาษี', d.CustTaxId)}
        <div className="col-span-2">{field('ที่อยู่', address)}</div>
        {field('เครดิต', d.CreditDays != null ? `${d.CreditDays} วัน` : null)}
        {field('ครบกำหนด', d.DueDate ? thaiDate(d.DueDate) : null)}
        {field('พนักงานขาย', d.SalesCode ? `${d.SalesCode} ${d.SalesName || ''}` : null)}
        {field('ใบขน (116)', d.slips.join(', '))}
      </div>

      <table className="mt-6 w-full text-[15px]">
        <thead className="border-b border-gray-300 text-left">
          <tr>
            <th className="py-1 font-medium">ลำดับ</th>
            <th className="py-1 font-medium">สินค้า</th>
            <th className="py-1 font-medium">อ้างอิง</th>
            <th className="py-1 text-right font-medium">จำนวน</th>
            <th className="py-1 text-right font-medium">ราคา/หน่วย</th>
            <th className="py-1 text-right font-medium">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map(i => (
            <tr key={i.ListNo} className="border-b border-gray-100">
              <td className="py-1">{i.ListNo}</td>
              <td className="py-1">{i.GoodCode} {i.GoodName}</td>
              <td className="py-1">{i.RefDocuNo || '-'}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodQty2, 3)} {i.UnitName || ''}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodPrice2)}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodAmnt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="w-80 text-[15px]">
          <tbody>
            <tr><td className="py-0.5">รวมเงิน</td><td className="py-0.5 text-right tabular-nums">{nf(d.SumGoodAmnt)}</td></tr>
            {Number(d.BillDiscAmnt || 0) > 0 && <tr><td className="py-0.5">ส่วนลด</td><td className="py-0.5 text-right tabular-nums">{nf(d.BillDiscAmnt)}</td></tr>}
            {Number(d.VATAmnt || 0) > 0 && <tr><td className="py-0.5">ภาษีมูลค่าเพิ่ม {nf(d.VATRate, 0)}%{Number(d.VATType) === 2 ? ' (รวมในราคา)' : ''}</td><td className="py-0.5 text-right tabular-nums">{nf(d.VATAmnt)}</td></tr>}
            <tr className="border-t border-gray-300 font-semibold"><td className="py-1">จำนวนเงินรวมทั้งสิ้น</td><td className="py-1 text-right tabular-nums">{nf(d.NetAmnt)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-right text-[15px]">({thaiBahtText(Number(d.NetAmnt || 0))})</div>
      {Number(d.VATType) === 3 && <div className="mt-1 text-right text-sm text-gray-600">สินค้ายกเว้นภาษีมูลค่าเพิ่ม</div>}

      <div className="mt-16 flex justify-around text-center text-[15px]">
        {['ผู้รับสินค้า', 'ผู้ส่งสินค้า', 'ผู้มีอำนาจลงนาม'].map(t => (
          <div key={t} className="w-56"><div className="border-b border-dotted" /><div className="mt-1">{t}</div></div>
        ))}
      </div>

      {d.PostGL !== 'Y' && (
        <p className="report-no-print mt-4 flex items-center gap-1 text-sm text-amber-700">
          <AlertTriangle size={14} /> ใบนี้ยังไม่ Post GL ใน WinSpeed
        </p>
      )}
      <div className="report-no-print mt-8 border-t pt-2 text-xs text-gray-500">
        SOInvHD #{d.SOInvID} · แหล่งข้อมูล WINSpeed · อ่านอย่างเดียว · แบบพิมพ์นี้รอยืนยันกับฟอร์ม WinSpeed "ฟอร์มใบส่งของ"
      </div>
    </>
  );
}

export function NativeDocPrint({ type, docuNo, onClose }: { type: 116 | 107; docuNo: string; onClose: () => void }) {
  const [data, setData] = useState<NativeSlipDoc | NativeInvoiceDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    (type === 116 ? fetchNativeSlipPrint(docuNo) : fetchNativeInvoicePrint(docuNo))
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || 'โหลดเอกสารไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [type, docuNo]);

  const title = type === 116 ? 'ใบขน / ใบตัดตั๋วปุ๋ย (116)' : 'ใบส่งของ (107)';
  const body = (
    <div className="report-modal-root fixed inset-0 z-[110] overflow-auto bg-black/50 p-4">
      <div className="report-no-print mx-auto mb-3 flex max-w-[210mm] items-center justify-between rounded-lg bg-white px-4 py-2 shadow">
        <span className="font-medium">{title} · {docuNo}</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} disabled={!data}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">
            <Printer size={16} /> พิมพ์
          </button>
          <button onClick={onClose} className="rounded border px-3 py-1.5" aria-label="ปิด"><X size={16} /></button>
        </div>
      </div>
      <div className="report-print-area mx-auto max-w-[210mm]">
        <div className="report-page bg-white p-10 shadow" style={{ fontFamily: '"Sarabun","TH Sarabun New",sans-serif' }}>
          {error && <p className="text-red-600">{error}</p>}
          {!data && !error && <p>กำลังโหลด...</p>}
          {data && data.type === 116 && <SlipBody d={data} />}
          {data && data.type === 107 && <InvoiceBody d={data} />}
        </div>
      </div>
      <style>{PRINT_CSS}</style>
    </div>
  );
  return createPortal(body, document.body);
}

/** ปุ่มเปิดพิมพ์เอกสาร WinSpeed ด้วยเลขที่ — ใช้ได้ทั้งใบที่ Sale-App ออกและที่ทำใน WinSpeed */
export function NativeDocPrintLauncher() {
  const can = useCan();
  const types = ([116, 107] as const).filter(t => can(`native.print-${t}`));
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<116 | 107>(types[0] ?? 116);
  const [no, setNo] = useState('');
  const [show, setShow] = useState<{ type: 116 | 107; no: string } | null>(null);
  if (!types.length) return null;
  const valid = /^[A-Za-z0-9-]{3,25}$/.test(no.trim());
  const go = () => { if (valid) { setShow({ type, no: no.trim() }); setOpen(false); } };
  return (
    <>
      <button onClick={() => setOpen(true)} className="whitespace-nowrap px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white text-gray-700 rounded-lg text-xs sm:text-sm font-semibold hover:bg-gray-50 transition-colors flex items-center gap-1.5 border border-gray-200">
        <Printer size={14} className="sm:w-4 sm:h-4" /> พิมพ์เอกสาร WinSpeed
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="พิมพ์เอกสาร WinSpeed">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#0C447C]">พิมพ์เอกสาร WinSpeed</h2>
            <label className="mt-4 block text-sm">ประเภท
              <select value={type} onChange={e => setType(Number(e.target.value) as 116 | 107)} className="mt-1 w-full rounded-lg border p-2">
                {types.includes(116) && <option value={116}>116 ใบขน / ใบตัดตั๋ว</option>}
                {types.includes(107) && <option value={107}>107 ใบส่งของ</option>}
              </select>
            </label>
            <label className="mt-3 block text-sm">เลขที่เอกสาร
              <input autoFocus value={no} onChange={e => setNo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }}
                placeholder={type === 116 ? 'เลขใบขน 7 หลัก' : 'เช่น J69-00001'} maxLength={25} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <div className="mt-5 flex justify-end gap-2 text-sm">
              <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2">ปิด</button>
              <button disabled={!valid} onClick={go} className="rounded-lg bg-blue-800 px-3 py-2 text-white disabled:opacity-50">เปิดเอกสาร</button>
            </div>
          </div>
        </div>, document.body)}
      {show && <NativeDocPrint type={show.type} docuNo={show.no} onClose={() => setShow(null)} />}
    </>
  );
}
