/**
 * พิมพ์เอกสาร WinSpeed จาก Sale-App (W2) — อ่านจาก dbo ของ WinSpeed อย่างเดียว
 *
 *   104 ใบสั่งจ่ายสินค้า — พิมพ์ลงกระดาษพิมพ์หัวตามตำแหน่งฟอร์ม WinSpeed (DeliveryOrderForm.tsx)
 *   116 ใบขน / ใบตัดตั๋วปุ๋ย — WinSpeed ไม่มีฟอร์มลงทะเบียน จึงออกแบบจากข้อมูลจริงของใบ
 *   107 ใบส่งของ — จัดตามฟอร์มเริ่มต้นของ WinSpeed (dr_so_saleorder_tax_worldfart) พร้อมหัวบริษัทจาก Header Master
 *       ปุ๋ยเป็นสินค้ายกเว้น VAT (ใบ 107 ปี 2569 เป็น VATType 3 ทั้งหมด) จึงไม่ใช้ชื่อ "ใบกำกับภาษี" และแสดงแถว VAT เฉพาะใบที่มี VAT
 *
 * ใช้คลาสสำหรับพิมพ์ชุดเดียวกับใบอื่น (report-modal-root / report-print-area / report-page / report-no-print)
 * ใบที่ยังไม่สมบูรณ์ (ยังไม่ตรวจครบ, ยังไม่ Post GL) แจ้งบนจอเท่านั้น ไม่พิมพ์ลงกระดาษ
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, AlertTriangle } from 'lucide-react';
import { fetchNativeSlipPrint, fetchNativeInvoicePrint, fetchNativeDeliveryOrderPrint, type NativeSlipDoc, type NativeInvoiceDoc, type NativeDeliveryOrderDoc } from '../../services/api';
import { thaiBahtText } from '../../utils/thaiBahtText';
import { useCan } from '../../utils/capabilities';
import { DeliveryOrderPages, DELIVERY_ORDER_PRINT_CSS } from './DeliveryOrderForm';

export type NativeDocType = 104 | 116 | 107;

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

/** 'YYYY-MM-DD' → '31/10/2569' แบบฟอร์ม WinSpeed (dd/mm/ปี พ.ศ.) */
function shortDate(raw?: string | null): string {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : '';
}

/**
 * ใบส่งของ (107) ตามฟอร์มเริ่มต้นของ WinSpeed "dr_so_saleorder_tax_worldfart":
 * หัวใบ (ลูกค้า / สถานที่ส่งของ / ใบกำกับ) · แถวอ้างอิงหกช่อง · รายการเจ็ดคอลัมน์ ·
 * ท้ายใบ (ทะเบียนรถ เลขตั๋วปุ๋ย เลขใบเคลื่อนย้าย หมายเหตุ ยอดเงิน) · ข้อความกรรมสิทธิ์ · ลายเซ็นห้าช่อง
 */
function InvoiceBody({ d }: { d: NativeInvoiceDoc }) {
  const c = d.company;
  const n = (v: unknown) => Number(v || 0);
  const soNo = d.SONo || [...new Set(d.items.map(i => i.RefDocuNo).filter(Boolean))].join(', ');
  const cell = (label: string, value?: string | null) => (
    <div className="border border-gray-400 px-2 py-1">
      <div className="text-[12px] text-gray-600">{label}</div>
      <div className="min-h-5">{value || ''}</div>
    </div>
  );
  const line = (label: string, value?: string | null) => (
    <div className="flex gap-2"><span className="w-28 shrink-0 text-gray-600">{label}</span><span>{value || ''}</span></div>
  );
  const sum = (label: string, value: unknown, extra?: string | null) => (
    <tr><td className="py-0.5">{label}</td><td className="py-0.5 text-right">{extra || ''}</td><td className="w-32 py-0.5 text-right tabular-nums">{nf(value)}</td></tr>
  );
  return (
    <div className="text-[14px] leading-6">
      {c?.companyNameTh && (
        <div className="mb-3">
          <div className="text-lg font-bold">{c.companyNameTh}</div>
          {c.addressTh && <div>{c.addressTh}</div>}
          <div>{[c.tel && `โทร. ${c.tel}`, c.fax && `โทรสาร ${c.fax}`, c.taxId && `เลขประจำตัวผู้เสียภาษี ${c.taxId}`].filter(Boolean).join('  ')}</div>
        </div>
      )}
      <div className="flex items-end justify-between">
        <h1 className="flex-1 text-center text-2xl font-bold">ใบส่งของ</h1>
        <div className="w-56">{line('เลขที่', d.DocuNo)}{line('วันที่', shortDate(d.DocuDate))}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-8">
        <div>
          {line('รหัสลูกค้า', d.CustCode)}
          {line('นามผู้ซื้อ', d.CustName)}
          {line('ที่อยู่', d.CustAddr1)}
          {d.CustAddr2 && line('', d.CustAddr2)}
          <div className="flex gap-6">{line('โทร.', d.Tel)}{line('โทรสาร', d.Fax)}</div>
        </div>
        <div>
          {line('เลขที่ใบกำกับ', d.InvNo ? `${d.InvNo}   วันที่ใบกำกับ ${shortDate(d.InvDate)}` : null)}
          {line('สถานที่ส่งของ', d.ShipAddr1)}
          {d.ShipAddr2 && line('', d.ShipAddr2)}
          {line('ชื่อผู้ติดต่อ', d.ContactName)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-6">
        {cell('ใบสั่งซื้อเลขที่', d.CustPONo)}
        {cell('ใบสั่งขายเลขที่', soNo)}
        {cell('เครดิต', n(d.CreditDays) ? `${d.CreditDays} วัน` : '')}
        {cell('วันครบกำหนด', n(d.CreditDays) ? shortDate(d.DueDate) : '')}
        {cell('วันที่กำหนดส่ง', shortDate(d.SendDate))}
        {cell('พนักงานขาย', d.SalesName)}
      </div>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-gray-500 text-left">
            <th className="py-1 font-medium">รหัสสินค้า</th>
            <th className="py-1 font-medium">รายการ</th>
            <th className="py-1 text-right font-medium">จำนวน</th>
            <th className="py-1 pl-2 font-medium">หน่วย</th>
            <th className="py-1 text-right font-medium">ราคา/หน่วย</th>
            <th className="py-1 text-right font-medium">ส่วนลด</th>
            <th className="py-1 text-right font-medium">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map(i => (
            <tr key={i.ListNo} className="border-b border-gray-100 align-top">
              <td className="py-1 pr-2">{i.GoodCode}</td>
              <td className="py-1 pr-2">{i.GoodName}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodQty2, 3)}</td>
              <td className="py-1 pl-2">{i.UnitName || ''}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodPrice2)}</td>
              <td className="py-1 text-right">{i.GoodDiscFormula || ''}</td>
              <td className="py-1 text-right tabular-nums">{nf(i.GoodAmnt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 grid grid-cols-2 gap-x-8 border-t border-gray-500 pt-2">
        <div>
          {line('เลขทะเบียนรถ', d.plates.join(', '))}
          {line('เลขตั๋วปุ๋ย', d.coupons.join(', '))}
          {line('เลขใบเคลื่อนย้าย', d.slips.join(', '))}
          {line('หมายเหตุ', d.Remark1)}
          {d.Remark2 && line('', d.Remark2)}
          {d.Remark3 && line('', d.Remark3)}
        </div>
        <table className="self-start">
          <tbody>
            {sum('จำนวนเงิน', d.SumGoodAmnt)}
            {n(d.BillDiscAmnt) > 0 && sum('หักส่วนลด', d.BillDiscAmnt, d.BillDiscFormula)}
            {n(d.BillDiscAmnt) > 0 && sum('หลังหักส่วนลด', d.BillAftrDiscAmnt)}
            {n(d.AdvnAmnt) > 0 && sum('หักเงินมัดจำ', d.AdvnAmnt)}
            {sum('รวมเงิน', d.AftrAdvnAmnt ?? d.BillAftrDiscAmnt)}
            {sum('ภาษีมูลค่าเพิ่ม', d.VATAmnt, n(d.VATRate) ? `${nf(d.VATRate, 0)}%${Number(d.VATType) === 2 ? ' (รวมในราคา)' : ''}` : '')}
            <tr className="border-t border-gray-500 font-semibold"><td className="py-1">จำนวนเงินทั้งสิ้น</td><td /><td className="py-1 text-right tabular-nums">{nf(d.NetAmnt)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-1">({thaiBahtText(n(d.NetAmnt))})</div>
      {Number(d.VATType) === 3 && <div className="text-sm text-gray-600">สินค้ายกเว้นภาษีมูลค่าเพิ่ม</div>}

      <div className="mt-3">สินค้าตามใบส่งของนี้ แม้จะได้ส่งมอบแก่ผู้ซื้อแล้วยังคงเป็นทรัพย์สินของผู้ขาย จนกว่าผู้ซื้อได้ชำระเงินเสร็จเรียบร้อยแล้ว</div>
      <div className="mt-6 grid grid-cols-3 gap-6">
        <div>
          <div className="h-12">ได้รับสินค้าตามรายการข้างบนไว้ถูกต้อง ในสภาพเรียบร้อยแล้ว</div>
          <div className="mt-6 border-b border-dotted" />
          <div className="text-center">ลงนามและประทับตรา (ถ้ามี) ผู้รับของ</div>
          <div className="mt-2">วันที่ _____/_____/_______</div>
        </div>
        <div className="text-center">
          <div className="h-12">ในนาม {d.BrchName || c?.companyNameTh || ''}</div>
          <div className="mt-6 border-b border-dotted" />
          <div>ผู้มีอำนาจลงนาม</div>
          <div className="mt-2 text-sm">ผิด ตก ยกเว้น</div>
        </div>
        <div className="space-y-6 pt-2">
          {['ผู้จ่ายของ', 'ผู้ตรวจสอบ', 'ผู้ส่งของ'].map(t => (
            <div key={t} className="flex items-end gap-2"><span className="w-20 shrink-0">{t}</span><span className="flex-1 border-b border-dotted" /></div>
          ))}
        </div>
      </div>

      {(d.PostGL !== 'Y' || d.DocuStatus === 'C') && (
        <p className="report-no-print mt-4 flex items-center gap-1 text-sm text-amber-700">
          <AlertTriangle size={14} /> {d.DocuStatus === 'C' ? 'ใบนี้ถูกยกเลิกใน WinSpeed' : 'ใบนี้ยังไม่ Post GL ใน WinSpeed'}
        </p>
      )}
      <div className="report-no-print mt-6 border-t pt-2 text-xs text-gray-500">
        SOInvHD #{d.SOInvID} · แหล่งข้อมูล WINSpeed · อ่านอย่างเดียว · จัดหน้าตามฟอร์ม WinSpeed "ใบส่งของ"
      </div>
    </div>
  );
}

const TITLES: Record<NativeDocType, string> = {
  104: 'ใบสั่งจ่ายสินค้า (104) · กระดาษพิมพ์หัว',
  116: 'ใบขน / ใบตัดตั๋วปุ๋ย (116)',
  107: 'ใบส่งของ (107)',
};
const LOADERS = { 104: fetchNativeDeliveryOrderPrint, 116: fetchNativeSlipPrint, 107: fetchNativeInvoicePrint };

export function NativeDocPrint({ type, docuNo, onClose }: { type: NativeDocType; docuNo: string; onClose: () => void }) {
  const [data, setData] = useState<NativeSlipDoc | NativeInvoiceDoc | NativeDeliveryOrderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guides, setGuides] = useState(true);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    LOADERS[type](docuNo)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || 'โหลดเอกสารไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [type, docuNo]);

  // 104 พิมพ์ลงกระดาษพิมพ์หัวขนาด Letter ตามตำแหน่งของ WinSpeed · ใบอื่นเป็น A4
  const preprinted = type === 104;
  const width = preprinted ? 'max-w-[8.5in]' : 'max-w-[210mm]';
  const body = (
    <div className="report-modal-root fixed inset-0 z-[110] overflow-auto bg-black/50 p-4">
      <div className={`report-no-print mx-auto mb-3 flex ${width} items-center justify-between gap-3 rounded-lg bg-white px-4 py-2 shadow`}>
        <span className="font-medium">{TITLES[type]} · {docuNo}</span>
        <div className="flex items-center gap-2">
          {preprinted && (
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={guides} onChange={e => setGuides(e.target.checked)} /> แสดงกรอบตำแหน่ง (ไม่พิมพ์)
            </label>
          )}
          <button onClick={() => window.print()} disabled={!data}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">
            <Printer size={16} /> พิมพ์
          </button>
          <button onClick={onClose} className="rounded border px-3 py-1.5" aria-label="ปิด"><X size={16} /></button>
        </div>
      </div>
      {preprinted && data?.type === 104 ? (
        <div className="report-print-area mx-auto w-fit">
          <DeliveryOrderPages d={data} guides={guides} />
        </div>
      ) : (
        <div className={`report-print-area mx-auto ${width}`}>
          <div className="report-page bg-white p-10 shadow" style={{ fontFamily: '"Sarabun","TH Sarabun New",sans-serif' }}>
            {error && <p className="text-red-600">{error}</p>}
            {!data && !error && <p>กำลังโหลด...</p>}
            {data && data.type === 116 && <SlipBody d={data} />}
            {data && data.type === 107 && <InvoiceBody d={data} />}
          </div>
        </div>
      )}
      <style>{preprinted ? DELIVERY_ORDER_PRINT_CSS : PRINT_CSS}</style>
    </div>
  );
  return createPortal(body, document.body);
}

/** ปุ่มเปิดพิมพ์เอกสาร WinSpeed ด้วยเลขที่ — ใช้ได้ทั้งใบที่ Sale-App ออกและที่ทำใน WinSpeed */
export function NativeDocPrintLauncher() {
  const can = useCan();
  const types = ([104, 116, 107] as const).filter(t => can(`native.print-${t}`));
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<NativeDocType>(types[0] ?? 116);
  const [no, setNo] = useState('');
  const [show, setShow] = useState<{ type: NativeDocType; no: string } | null>(null);
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
              <select value={type} onChange={e => setType(Number(e.target.value) as NativeDocType)} className="mt-1 w-full rounded-lg border p-2">
                {types.includes(104) && <option value={104}>104 ใบสั่งจ่ายสินค้า (กระดาษพิมพ์หัว)</option>}
                {types.includes(116) && <option value={116}>116 ใบขน / ใบตัดตั๋ว</option>}
                {types.includes(107) && <option value={107}>107 ใบส่งของ</option>}
              </select>
            </label>
            <label className="mt-3 block text-sm">เลขที่เอกสาร
              <input autoFocus value={no} onChange={e => setNo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }}
                placeholder={type === 116 ? 'เลขใบขน 7 หลัก' : type === 104 ? 'เลขที่ใบสั่งขาย 104' : 'เช่น J69-00001'} maxLength={25} className="mt-1 w-full rounded-lg border p-2" />
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
