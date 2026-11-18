import { X, Printer } from 'lucide-react';
import type { ShippedRow } from '../../types';

interface Props {
  startDate: string;
  endDate: string;
  rows: ShippedRow[];
  onClose: () => void;
}

export function AccountingPrintModal({ startDate, endDate, rows, onClose }: Props) {
  const handlePrint = () => {
    window.print();
  };

  const totalTons = rows.reduce((s, r) => s + (Number(r.TotalTon) || 0), 0);
  const totalScaleKg = rows.reduce((s, r) => s + (Number(r.WeightNet) || 0), 0);
  const uniqueTrips = new Set(rows.map(r => r.TripCode || r.TripId).filter(Boolean)).size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-2 sm:p-6 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl w-[98vw] max-w-6xl h-[94vh] shadow-2xl flex flex-col overflow-hidden print:w-full print:h-auto print:shadow-none print:rounded-none">
        
        {/* Modal Controls (Hidden in Print) */}
        <div className="px-6 py-3 bg-gray-100 border-b border-gray-200 flex items-center justify-between shrink-0 print:hidden">
          <div className="text-xs font-semibold text-gray-700">
            พิมพ์รายงานสรุปบัญชีและการจ่ายสินค้า ({rows.length} รายการ)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-1.5 bg-[#0C447C] hover:bg-blue-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition"
            >
              <Printer size={15} /> สั่งพิมพ์ (Print)
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="flex-1 overflow-y-auto p-8 print:p-0 print:overflow-visible text-gray-900 font-sans">
          
          {/* Header */}
          <div className="text-center pb-4 mb-4 border-b-2 border-gray-800">
            <h1 className="text-lg font-bold">บริษัท เวิลด์เฟอร์ติไลเซอร์ จำกัด</h1>
            <h2 className="text-base font-semibold text-gray-800 mt-0.5">
              รายงานสรุปการจ่ายสินค้าและการออกเอกสารบัญชี (Accounting & Dispatch Summary)
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              ช่วงวันที่เอกสาร: <span className="font-semibold">{startDate}</span> ถึง <span className="font-semibold">{endDate}</span> · วันที่พิมพ์: {new Date().toLocaleString('th-TH')}
            </p>
          </div>

          {/* Summary Pills */}
          <div className="grid grid-cols-4 gap-3 text-xs mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg print:border-gray-400">
            <div>
              <span className="text-gray-500 block">จำนวนบิลทั้งหมด</span>
              <span className="font-bold text-gray-800 text-sm">{rows.length} บิล</span>
            </div>
            <div>
              <span className="text-gray-500 block">จำนวน Sale Trip</span>
              <span className="font-bold text-[#0C447C] text-sm">{uniqueTrips} เที่ยว</span>
            </div>
            <div>
              <span className="text-gray-500 block">ยอดรวมสั่งจอง (ตัน)</span>
              <span className="font-bold text-emerald-700 text-sm">{totalTons.toFixed(2)} ตัน</span>
            </div>
            <div>
              <span className="text-gray-500 block">น้ำหนักชั่งสุทธิโรงงาน</span>
              <span className="font-bold text-gray-800 text-sm">{(totalScaleKg / 1000).toFixed(2)} ตัน</span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-left border-collapse border border-gray-300">
              <thead className="bg-gray-100 text-gray-700 font-bold border-b border-gray-300 uppercase">
                <tr>
                  <th className="py-2 px-1.5 border border-gray-300 text-center w-8">#</th>
                  <th className="py-2 px-1.5 border border-gray-300">วันที่</th>
                  <th className="py-2 px-1.5 border border-gray-300">Sale Trip</th>
                  <th className="py-2 px-1.5 border border-gray-300">ทะเบียนรถ</th>
                  <th className="py-2 px-1.5 border border-gray-300">ลูกค้า</th>
                  <th className="py-2 px-1.5 border border-gray-300">เลขที่บิล (103)</th>
                  <th className="py-2 px-1.5 border border-gray-300 text-right">ตัน</th>
                  <th className="py-2 px-1.5 border border-gray-300 text-center">ใบชั่ง (WGHD)</th>
                  <th className="py-2 px-1.5 border border-gray-300 text-right">ชั่งสุทธิ (กก.)</th>
                  <th className="py-2 px-1.5 border border-gray-300">ใบสั่งขาย (104)</th>
                  <th className="py-2 px-1.5 border border-gray-300">ใบขน (116)</th>
                  <th className="py-2 px-1.5 border border-gray-300">ใบส่งของ (107)</th>
                  <th className="py-2 px-1.5 border border-gray-300 text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.Id || i} className="hover:bg-gray-50 print:hover:bg-white">
                    <td className="py-1 px-1.5 border border-gray-300 text-center text-gray-500">{i + 1}</td>
                    <td className="py-1 px-1.5 border border-gray-300 whitespace-nowrap">{r.DocuDate}</td>
                    <td className="py-1 px-1.5 border border-gray-300 font-mono font-semibold text-[#0C447C] whitespace-nowrap">{r.TripCode || '-'}</td>
                    <td className="py-1 px-1.5 border border-gray-300 whitespace-nowrap">{r.TruckPlate || r.TripPlate || '-'}</td>
                    <td className="py-1 px-1.5 border border-gray-300 max-w-[140px] truncate" title={r.CustName}>{r.CustName}</td>
                    <td className="py-1 px-1.5 border border-gray-300 font-mono font-semibold text-gray-800 whitespace-nowrap">{r.WfRef}</td>
                    <td className="py-1 px-1.5 border border-gray-300 text-right tabular-nums font-semibold">{Number(r.TotalTon).toFixed(2)}</td>
                    <td className="py-1 px-1.5 border border-gray-300 text-center font-mono">{r.MoveBill || '-'}</td>
                    <td className="py-1 px-1.5 border border-gray-300 text-right tabular-nums">{r.WeightNet ? Number(r.WeightNet).toLocaleString() : '-'}</td>
                    <td className="py-1 px-1.5 border border-gray-300 font-mono">{r.Delivery104No || '-'}</td>
                    <td className="py-1 px-1.5 border border-gray-300 font-mono">{r.Slip116No || '-'}</td>
                    <td className="py-1 px-1.5 border border-gray-300 font-mono">
                      {r.Invoice107No ? (
                        <span className={r.Invoice107No.startsWith('J') ? 'text-blue-800 font-semibold' : 'text-purple-800 font-semibold'}>
                          {r.Invoice107No}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-1 px-1.5 border border-gray-300 text-center whitespace-nowrap">
                      {r.DocuStatus === 'Y' ? 'ปิดงาน' : r.DocuStatus === 'C' ? 'ยกเลิก' : 'ส่งของ'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 font-bold border-t border-gray-400">
                <tr>
                  <td colSpan={6} className="py-1.5 px-2 border border-gray-300 text-right">ยอดรวมทั้งหมด</td>
                  <td className="py-1.5 px-1.5 border border-gray-300 text-right tabular-nums">{totalTons.toFixed(2)}</td>
                  <td className="py-1.5 px-1.5 border border-gray-300"></td>
                  <td className="py-1.5 px-1.5 border border-gray-300 text-right tabular-nums">{totalScaleKg ? totalScaleKg.toLocaleString() : '-'}</td>
                  <td colSpan={4} className="py-1.5 px-1.5 border border-gray-300"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Sign-off Blocks */}
          <div className="grid grid-cols-3 gap-6 mt-12 pt-6 text-xs text-center border-t border-gray-300 print:mt-10">
            <div>
              <p className="font-semibold text-gray-700 mb-8">ผู้จัดทำรายงาน</p>
              <div className="border-b border-gray-400 mx-6 mb-1"></div>
              <p className="text-gray-500">(........................................................)</p>
              <p className="text-gray-400 text-[10px] mt-0.5">วันที่ ......../......../............</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-8">ผู้ตรวจสอบฝ่ายบัญชี</p>
              <div className="border-b border-gray-400 mx-6 mb-1"></div>
              <p className="text-gray-500">(........................................................)</p>
              <p className="text-gray-400 text-[10px] mt-0.5">วันที่ ......../......../............</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-8">ผู้จัดการฝ่ายบัญชีและการเงิน</p>
              <div className="border-b border-gray-400 mx-6 mb-1"></div>
              <p className="text-gray-500">(........................................................)</p>
              <p className="text-gray-400 text-[10px] mt-0.5">วันที่ ......../......../............</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
