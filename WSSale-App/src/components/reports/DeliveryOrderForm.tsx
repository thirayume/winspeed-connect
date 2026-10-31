/**
 * ใบสั่งจ่ายสินค้า (104) สำหรับกระดาษที่พิมพ์หัวไว้แล้ว — ตำแหน่งเดียวกับฟอร์ม WinSpeed
 * "worldfertdaotai.pbl@dr_so_delivery_order_pre" (Letter แนวตั้ง, พิมพ์เฉพาะข้อมูล ไม่พิมพ์หัวข้อช่อง)
 *
 * ฟอร์มใช้หน่วย PowerBuilder: แนวนอน 1 นิ้ว = 3072/7 หน่วย (1 พิกเซล = 32/7 หน่วยที่ 96 dpi), แนวตั้ง 1 นิ้ว = 384 หน่วย
 * ขอบกระดาษ ซ้าย 110 บน 110 ล่าง 300 · หัว 1,500 · ท้าย 1,148 ชิดล่างของหน้า (เริ่มที่ 4,224 − 300 − 1,148)
 * บรรทัดรายการ: แถบ detail สูง 96 แต่ตั้ง height.autosize และช่องหน่วยสูง 100 ที่ y 4 จึงขยายเป็น 104 ต่อบรรทัด
 * (เทียบ PDF จาก WinSpeed 31/10: ระยะบรรทัดจริง 19.45 pt = 104 หน่วย) จึงวางรายการได้หน้าละ 11 บรรทัด
 * ยอดเงินและตัวอักษรพิมพ์เฉพาะหน้าสุดท้าย เหมือนฟอร์มเดิม · กรอบประบนจอบอกตำแหน่งช่องบนกระดาษ และไม่ถูกพิมพ์
 */
import type { CSSProperties, ReactNode } from 'react';
import type { NativeDeliveryOrderDoc, NativeDeliveryOrderItem } from '../../services/api';
import { thaiBahtText } from '../../utils/thaiBahtText';

const H = 3072 / 7;            // หน่วยแนวนอนต่อนิ้ว
const V = 384;                 // หน่วยแนวตั้งต่อนิ้ว
const LEFT = 110;
const HEADER_TOP = 110;
const DETAIL_TOP = HEADER_TOP + 1500;
const ROW = 104;
const FOOTER_TOP = 11 * V - 300 - 1148;
const ROWS_PER_PAGE = Math.floor((FOOTER_TOP - DETAIL_TOP) / ROW);

export const DELIVERY_ORDER_PRINT_CSS = `
@media print {
  @page { size: 8.5in 11in; margin: 0; }
  body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > :not(.report-modal-root) { display: none !important; }
  .report-modal-root { display: block !important; position: static !important; padding: 0 !important; background: none !important; overflow: visible !important; }
  .report-print-area { margin: 0 !important; max-width: none !important; }
  .report-no-print, .do-guide { display: none !important; }
  .do-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
  .do-page:last-child { break-after: auto; }
}`;

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const beDate = (raw?: string | null) => {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : '';
};

// pre: keep spaces as typed (WinSpeed counts them when centring "D/O = " and the amount in words)
type Box = { x: number; y: number; w: number; h: number; align?: 0 | 1 | 2; size?: number; bold?: boolean; pre?: boolean; guide: string };

function Field({ top, box, guides, children }: { top: number; box: Box; guides: boolean; children: ReactNode }) {
  const style: CSSProperties = {
    position: 'absolute',
    left: `${(LEFT + box.x) / H}in`, top: `${(top + box.y) / V}in`,
    width: `${box.w / H}in`, height: `${box.h / V}in`,
    fontSize: `${box.size ?? 15}pt`, fontWeight: box.bold ? 700 : 400, lineHeight: `${box.h / V}in`,
    textAlign: box.align === 1 ? 'right' : box.align === 2 ? 'center' : 'left',
    whiteSpace: box.pre ? 'pre' : 'nowrap', overflow: 'hidden',
  };
  return (
    <div style={style}>
      {guides && <span className="do-guide pointer-events-none absolute inset-0 border border-dashed border-sky-300"><span className="absolute -top-2.5 left-0 bg-white px-0.5 text-[8px] leading-none text-sky-600">{box.guide}</span></span>}
      {children}
    </div>
  );
}

// ตำแหน่งจากฟอร์ม WinSpeed (x, y, กว้าง, สูง เป็นหน่วย PowerBuilder · align 0 ซ้าย 1 ขวา 2 กลาง)
const HEAD: Record<string, Box> = {
  docuNo: { x: 2546, y: 456, w: 526, h: 100, guide: 'เลขที่' },
  docuDate: { x: 2546, y: 584, w: 526, h: 104, guide: 'วันที่' },
  custName: { x: 375, y: 764, w: 1376, h: 100, guide: 'ลูกค้า' },
  address1: { x: 375, y: 860, w: 1376, h: 92, guide: 'ที่อยู่' },
  address2: { x: 375, y: 944, w: 1376, h: 96, guide: 'ที่อยู่ (ต่อ)' },
  contTel: { x: 375, y: 1040, w: 1376, h: 92, guide: 'โทร' },
  shipTo1: { x: 2002, y: 880, w: 1422, h: 92, size: 13, guide: 'สถานที่ส่ง' },
  shipTo2: { x: 2002, y: 976, w: 1422, h: 92, size: 13, guide: 'สถานที่ส่ง (ต่อ)' },
  custCode: { x: 279, y: 1264, w: 357, h: 100, align: 2, guide: 'รหัสลูกค้า' },
  custPoNo: { x: 1079, y: 1264, w: 361, h: 100, align: 2, guide: 'ใบสั่งซื้อ' },
  empName: { x: 1449, y: 1264, w: 398, h: 96, align: 2, guide: 'พนักงานขาย' },
  creditDays: { x: 1915, y: 1264, w: 334, h: 96, align: 2, guide: 'เครดิต' },
  shipDate: { x: 2350, y: 1264, w: 325, h: 96, align: 2, guide: 'กำหนดส่ง' },
  refNo: { x: 2752, y: 1264, w: 361, h: 96, align: 2, guide: 'ใบเสนอราคา' },
  refDate: { x: 3131, y: 1264, w: 304, h: 96, align: 2, guide: 'ลงวันที่' },
};
const LINE: Record<string, Box> = {
  qty: { x: 23, y: 4, w: 283, h: 92, align: 1, guide: 'จำนวน' },
  unit: { x: 315, y: 4, w: 187, h: 100, guide: 'หน่วย' },
  code: { x: 512, y: 4, w: 567, h: 92, guide: 'รหัสสินค้า' },
  name: { x: 1097, y: 4, w: 1431, h: 92, guide: 'รายการ' },
  price: { x: 2531, y: 4, w: 430, h: 92, align: 1, guide: 'ราคา/หน่วย' },
  amount: { x: 2996, y: 4, w: 428, h: 89, align: 1, guide: 'จำนวนเงิน' },
  plateLabel: { x: 1339, y: 100, w: 283, h: 92, size: 13, guide: '' },
  plate: { x: 1637, y: 100, w: 827, h: 92, size: 13, guide: 'ทะเบียนรถ' },
};
const FOOT: Record<string, Box> = {
  remark1: { x: 64, y: 0, w: 2066, h: 88, size: 14, guide: 'หมายเหตุ 1' },
  remark2: { x: 64, y: 80, w: 2085, h: 92, size: 13, guide: 'หมายเหตุ 2' },
  remark3: { x: 59, y: 156, w: 2085, h: 88, size: 13, guide: 'หมายเหตุ 3' },
  doLabel: { x: 55, y: 252, w: 160, h: 100, align: 2, pre: true, guide: '' },
  couponNo: { x: 229, y: 252, w: 1120, h: 100, guide: 'เลขตั๋ว (D/O)' },
  define1: { x: 229, y: 380, w: 1120, h: 100, guide: 'ข้อความเพิ่มเติม' },
  sum: { x: 2949, y: 420, w: 485, h: 92, align: 1, guide: 'รวมเงิน' },
  words: { x: 55, y: 636, w: 2053, h: 104, align: 2, bold: true, pre: true, guide: 'จำนวนเงินตัวอักษร' },
  net: { x: 2949, y: 644, w: 485, h: 92, align: 1, guide: 'จำนวนเงินสุทธิ' },
};

function Page({ d, lines, first, last, guides }: { d: NativeDeliveryOrderDoc; lines: NativeDeliveryOrderItem[]; first: number; last: boolean; guides: boolean }) {
  const f = (top: number, box: Box, value: ReactNode) => <Field top={top} box={box} guides={guides}>{value}</Field>;
  const num = (v: unknown) => Number(v ?? 0);
  return (
    <div className="do-page relative mx-auto mb-4 bg-white text-black shadow" style={{ width: '8.5in', height: '11in', fontFamily: '"AngsanaUPC","Angsana New","TH Sarabun New",sans-serif' }}>
      {f(HEADER_TOP, HEAD.docuNo, d.DocuNo)}
      {f(HEADER_TOP, HEAD.docuDate, beDate(d.DocuDate))}
      {f(HEADER_TOP, HEAD.custName, d.CustName)}
      {f(HEADER_TOP, HEAD.address1, d.Address1)}
      {f(HEADER_TOP, HEAD.address2, d.Address2)}
      {f(HEADER_TOP, HEAD.contTel, d.ContTel)}
      {f(HEADER_TOP, HEAD.shipTo1, d.ShipToAddress1)}
      {f(HEADER_TOP, HEAD.shipTo2, d.ShipToAddress2)}
      {f(HEADER_TOP, HEAD.custCode, d.CustCode)}
      {f(HEADER_TOP, HEAD.custPoNo, d.CustPONo)}
      {f(HEADER_TOP, HEAD.empName, d.EmpName)}
      {f(HEADER_TOP, HEAD.creditDays, d.CreditDays ?? '')}
      {f(HEADER_TOP, HEAD.shipDate, beDate(d.ShipDate))}
      {f(HEADER_TOP, HEAD.refNo, d.RefNo)}
      {f(HEADER_TOP, HEAD.refDate, beDate(d.RefDate))}

      {lines.map((l, i) => {
        const top = DETAIL_TOP + ROW * i;
        const isLast = last && first + i === d.items.length - 1;
        return (
          <div key={l.ListNo}>
            {f(top, LINE.qty, num(l.GoodQty2) ? money(l.GoodQty2) : '')}
            {f(top, LINE.unit, l.UnitName)}
            {f(top, LINE.code, l.GoodCode)}
            {f(top, LINE.name, l.GoodName)}
            {f(top, LINE.price, num(l.GoodPrice2) ? money(l.GoodPrice2) : '')}
            {f(top, LINE.amount, num(l.GoodAmnt) ? money(l.GoodAmnt) : '')}
            {isLast && d.CarLicense && <>{f(top, LINE.plateLabel, 'ทะเบียนรถ : ')}{f(top, LINE.plate, d.CarLicense)}</>}
          </div>
        );
      })}

      {f(FOOTER_TOP, FOOT.remark1, d.Remark1)}
      {f(FOOTER_TOP, FOOT.remark2, d.Remark2)}
      {f(FOOTER_TOP, FOOT.remark3, d.Remark3)}
      {f(FOOTER_TOP, FOOT.doLabel, 'D/O = ')}
      {f(FOOTER_TOP, FOOT.couponNo, d.CouponNo)}
      {f(FOOTER_TOP, FOOT.define1, d.Define1)}
      {last && <>
        {f(FOOTER_TOP, FOOT.sum, num(d.SumGoodAmnt) ? money(d.SumGoodAmnt) : '')}
        {f(FOOTER_TOP, FOOT.words, `(    ${thaiBahtText(num(d.NetAmnt))}    )`)}
        {f(FOOTER_TOP, FOOT.net, num(d.NetAmnt) ? money(d.NetAmnt) : '')}
      </>}
    </div>
  );
}

export function DeliveryOrderPages({ d, guides }: { d: NativeDeliveryOrderDoc; guides: boolean }) {
  const pages: NativeDeliveryOrderItem[][] = [];
  for (let i = 0; i < Math.max(d.items.length, 1); i += ROWS_PER_PAGE) pages.push(d.items.slice(i, i + ROWS_PER_PAGE));
  return <>{pages.map((lines, p) => <Page key={p} d={d} lines={lines} first={p * ROWS_PER_PAGE} last={p === pages.length - 1} guides={guides} />)}</>;
}
