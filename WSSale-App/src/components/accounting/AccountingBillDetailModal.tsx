import { useEffect, useState } from 'react';
import { X, FileText, Truck, Scale, ShieldCheck, Clock, User, Package, Gift, RefreshCw, Printer } from 'lucide-react';
import { fetchAccountingBillDetail } from '../../services/api';
import type { AccountingBillDetail } from '../../types';

interface Props {
  billId: number | string;
  onClose: () => void;
}

export function AccountingBillDetailModal({ billId, onClose }: Props) {
  const [data, setData] = useState<AccountingBillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'items' | 'scale' | 'trace' | 'audit'>('items');

  useEffect(() => {
    let unmounted = false;
    setLoading(true);
    fetchAccountingBillDetail(billId)
      .then(res => {
        if (!unmounted) setData(res);
      })
      .catch(err => {
        console.error('Error fetching bill detail:', err);
      })
      .finally(() => {
        if (!unmounted) setLoading(false);
      });
    return () => { unmounted = true; };
  }, [billId]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div className="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-3">
          <RefreshCw size={28} className="animate-spin text-[#0C447C]" />
          <span className="text-sm font-semibold text-gray-700">กำลังโหลดรายละเอียดบิล...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full text-center">
          <p className="text-sm text-gray-700 mb-4">ไม่พบข้อมูลรายละเอียดบิลนี้</p>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-semibold">ปิด</button>
        </div>
      </div>
    );
  }

  const { header, items, giveaways, scale, trace, audit } = data;
  const totalTons = items.reduce((sum, it) => sum + (Number(it.TonQty) || 0), 0);
  const totalAmount = items.reduce((sum, it) => sum + (Number(it.NetAmnt || it.Amount) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-3 sm:p-5">
      <div className="bg-white rounded-2xl w-[96vw] max-w-4xl h-[90vh] shadow-2xl border border-gray-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 bg-linear-to-r from-[#0C447C] to-[#155ca2] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
              <FileText size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold">บิลใบสั่งจอง: {header.BookingNo}</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-white font-medium">
                  {header.DocuStatus === 'C' ? 'ยกเลิก' : header.DocuStatus === 'Y' ? 'ปิดงานขายแล้ว' : 'กำลังดำเนินการ'}
                </span>
                {header.TripCode && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-100 border border-emerald-400/30 font-mono">
                    Trip: {header.TripCode}
                  </span>
                )}
              </div>
              <p className="text-xs text-blue-100 mt-0.5">
                วันที่: {header.BookingDate} · ลูกค้า: {header.CustCode ? `[${header.CustCode}] ` : ''}{header.CustName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 text-xs font-semibold"
              title="พิมพ์เอกสารนี้"
            >
              <Printer size={16} /> <span className="hidden sm:inline">พิมพ์</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Overview Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-gray-50 border-b border-gray-100 text-xs shrink-0">
          <div>
            <span className="text-gray-400 block mb-0.5">รถบรรทุก</span>
            <span className="font-semibold text-gray-800 flex items-center gap-1">
              <Truck size={14} className="text-[#0C447C]" />
              {header.TruckPlate || header.TripPlate || '-'}
            </span>
            {header.DriverName && <span className="text-[11px] text-gray-500 block truncate">คนขับ: {header.DriverName}</span>}
          </div>
          <div>
            <span className="text-gray-400 block mb-0.5">ผู้แทนขาย</span>
            <span className="font-semibold text-gray-800 flex items-center gap-1">
              <User size={14} className="text-[#0C447C]" />
              {header.SalesUserName || header.SalesEmpName || '-'}
            </span>
            {header.SalesEmpCode && <span className="text-[11px] text-gray-500 block">({header.SalesEmpCode})</span>}
          </div>
          <div>
            <span className="text-gray-400 block mb-0.5">ยอดสั่งจอง</span>
            <span className="font-bold text-[#0C447C] text-sm tabular-nums">
              {totalTons.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ตัน
            </span>
            <span className="text-[11px] text-gray-500 block">{items.length} รายการสินค้า</span>
          </div>
          <div>
            <span className="text-gray-400 block mb-0.5">มูลค่ารวม</span>
            <span className="font-bold text-gray-800 text-sm tabular-nums">
              ฿{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="px-6 border-b border-gray-200 flex items-center gap-4 bg-white shrink-0">
          <button
            onClick={() => setActiveTab('items')}
            className={`py-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'items'
                ? 'border-[#0C447C] text-[#0C447C]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Package size={14} /> รายการสินค้า & ของแถม ({items.length + giveaways.length})
          </button>
          <button
            onClick={() => setActiveTab('scale')}
            className={`py-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'scale'
                ? 'border-[#0C447C] text-[#0C447C]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Scale size={14} /> บันทึกการชั่ง (WGHD) {scale ? '✓' : ''}
          </button>
          <button
            onClick={() => setActiveTab('trace')}
            className={`py-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'trace'
                ? 'border-[#0C447C] text-[#0C447C]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText size={14} /> เอกสารเชื่อมโยง (104 / 116 / 107)
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`py-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'audit'
                ? 'border-[#0C447C] text-[#0C447C]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Clock size={14} /> Audit Trail & ไทม์ไลน์ ({audit.length})
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* TAB 1: Items & Giveaways */}
          {activeTab === 'items' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold text-gray-700 mb-2.5 flex items-center gap-1.5">
                  <Package size={15} className="text-[#0C447C]" /> รายการสินค้าสั่งจอง
                </h3>
                <div className="overflow-x-auto border border-gray-100 rounded-xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-600 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3">รหัสสินค้า</th>
                        <th className="py-2.5 px-3">ชื่อสินค้า / สูตรปุ๋ย</th>
                        <th className="py-2.5 px-3 text-right">กระสอบ</th>
                        <th className="py-2.5 px-3 text-right">ตัน</th>
                        <th className="py-2.5 px-3 text-right">ราคา/ตัน</th>
                        <th className="py-2.5 px-3 text-right">ยอดรวม (บาท)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((it, idx) => (
                        <tr key={it.ListNo || idx} className="hover:bg-gray-50/50">
                          <td className="py-2 px-3 text-center text-gray-400">{it.ListNo || idx + 1}</td>
                          <td className="py-2 px-3 font-mono font-semibold text-[#0C447C]">{it.GoodCode}</td>
                          <td className="py-2 px-3 font-medium text-gray-800">{it.GoodName}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-600">{Number(it.BagQty || 0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-800">{Number(it.TonQty || 0).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-600">฿{Number(it.PricePerTon || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-bold text-gray-800">฿{Number(it.NetAmnt || it.Amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-bold border-t border-gray-200">
                      <tr>
                        <td colSpan={4} className="py-2.5 px-3 text-right">รวมทั้งหมด</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#0C447C]">{totalTons.toFixed(2)} ตัน</td>
                        <td className="py-2.5 px-3"></td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#0C447C]">฿{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Giveaways */}
              <div>
                <h3 className="text-xs font-bold text-gray-700 mb-2.5 flex items-center gap-1.5">
                  <Gift size={15} className="text-orange-500" /> รายการของแถมโปรโมชั่น
                </h3>
                {giveaways.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 bg-gray-50 rounded-xl text-center border border-dashed border-gray-200">
                    ไม่มีรายการของแถมในบิลนี้
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-50 text-gray-600 font-semibold">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">#</th>
                          <th className="py-2.5 px-3">รหัสของแถม</th>
                          <th className="py-2.5 px-3">รายการของแถม</th>
                          <th className="py-2.5 px-3">ตรา / แบรนด์</th>
                          <th className="py-2.5 px-3 text-right">จำนวน</th>
                          <th className="py-2.5 px-3 text-center">หน่วย</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {giveaways.map((gw, idx) => (
                          <tr key={gw.Id || idx} className="hover:bg-gray-50/50">
                            <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>
                            <td className="py-2 px-3 font-mono text-[#0C447C] font-semibold">{gw.GoodCode || '-'}</td>
                            <td className="py-2 px-3 font-medium text-gray-800">{gw.GoodName}</td>
                            <td className="py-2 px-3 text-gray-600">{gw.Brand || 'ส่วนกลาง'}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-bold text-orange-600">{Number(gw.Qty).toLocaleString()}</td>
                            <td className="py-2 px-3 text-center text-gray-500">{gw.Unit || 'ชิ้น'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Scale Weighing */}
          {activeTab === 'scale' && (
            <div>
              {!scale ? (
                <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Scale size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm font-semibold text-gray-700">ยังไม่มีบันทึกการชั่งในระบบ (dbo.WGHD)</p>
                  <p className="text-xs text-gray-400 mt-1">รถยังไม่ได้เข้าชั่งน้ำหนักโรงงาน หรือยังไม่ได้ผูกเลขใบชั่ง</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-blue-50/60 rounded-xl border border-blue-100">
                    <div>
                      <span className="text-[11px] text-gray-500 block mb-0.5">เลขที่ใบชั่ง (MoveBill)</span>
                      <span className="font-mono font-bold text-[#0C447C] text-sm">{scale.MoveBill}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-gray-500 block mb-0.5">เครื่องชั่ง (ScaleNo)</span>
                      <span className="font-semibold text-gray-800">{scale.ScaleNo || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-gray-500 block mb-0.5">ทะเบียนรถที่ชั่ง</span>
                      <span className="font-semibold text-gray-800">{scale.TruckPlate}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-gray-500 block mb-0.5">สถานะการชั่ง</span>
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">
                        {scale.Status === '3' ? 'ชั่งออกแล้ว (สำเร็จ)' : scale.Status === '2' ? 'กำลังโหลด' : 'ลงทะเบียนเข้า'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 p-5 bg-white rounded-xl border border-gray-200 text-center">
                    <div className="border-r border-gray-100 pr-4">
                      <span className="text-xs text-gray-400 block mb-1">น้ำหนักชั่งเข้า (Tare)</span>
                      <span className="text-xl font-bold text-gray-700 tabular-nums">
                        {Number(scale.WeightIn || 0).toLocaleString()} <span className="text-xs font-normal">กก.</span>
                      </span>
                      <span className="text-[11px] text-gray-400 block mt-1">เวลาเข้า: {scale.DateIn} {scale.TimeIn}</span>
                    </div>
                    <div className="border-r border-gray-100 pr-4">
                      <span className="text-xs text-gray-400 block mb-1">น้ำหนักชั่งออก (Gross)</span>
                      <span className="text-xl font-bold text-gray-700 tabular-nums">
                        {Number(scale.WeightOut || 0).toLocaleString()} <span className="text-xs font-normal">กก.</span>
                      </span>
                      <span className="text-[11px] text-gray-400 block mt-1">เวลาออก: {scale.DateOut} {scale.TimeOut}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block mb-1">น้ำหนักสุทธิ (Net)</span>
                      <span className="text-2xl font-black text-emerald-700 tabular-nums">
                        {Number(scale.WeightNet || 0).toLocaleString()} <span className="text-xs font-normal">กก.</span>
                      </span>
                      <span className="text-xs font-bold text-[#0C447C] block mt-1">
                        = {(Number(scale.WeightNet || 0) / 1000).toFixed(2)} ตัน
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Downstream Documents Trace */}
          {activeTab === 'trace' && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-[#0C447C] font-bold text-xs flex items-center justify-center">103</span>
                    <span className="text-xs font-bold text-gray-700">ใบสั่งจอง (SOHD Booking)</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#0C447C]">{header.BookingNo}</span>
                </div>

                <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center justify-center">104</span>
                    <span className="text-xs font-bold text-gray-700">ใบสั่งขาย (SOHD Delivery)</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-gray-800">
                    {trace.Doc104 || <span className="text-gray-400 font-normal">ยังไม่ได้ออก</span>}
                  </span>
                </div>

                <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-800 font-bold text-xs flex items-center justify-center">116</span>
                    <span className="text-xs font-bold text-gray-700">ใบขนย้าย / ตัดตั๋วปุ๋ย (WFRedemtionHD)</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-gray-800">
                    {trace.Doc116 || <span className="text-gray-400 font-normal">ยังไม่ได้ออก</span>}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center">107</span>
                    <span className="text-xs font-bold text-gray-700">ใบส่งของ / ใบกำกับภาษี (SOInvHD Book J / N)</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-gray-800">
                    {trace.Doc107 || <span className="text-gray-400 font-normal">ยังไม่ได้ออก</span>}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Audit Trail */}
          {activeTab === 'audit' && (
            <div>
              {audit.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center bg-gray-50 rounded-xl">ไม่มีบันทึก Audit Trail สำหรับบิลนี้</p>
              ) : (
                <div className="overflow-x-auto border border-gray-100 rounded-xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-50 text-gray-600 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">เวลาที่เกิด</th>
                        <th className="py-2.5 px-3">การกระทำ (Action)</th>
                        <th className="py-2.5 px-3">รายละเอียด (Detail)</th>
                        <th className="py-2.5 px-3">ผู้บันทึก</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {audit.map((a, idx) => (
                        <tr key={a.Id || idx} className="hover:bg-gray-50/50">
                          <td className="py-2 px-3 whitespace-nowrap text-gray-500 font-mono">{a.CreatedAt}</td>
                          <td className="py-2 px-3 font-semibold text-[#0C447C] whitespace-nowrap">{a.Action}</td>
                          <td className="py-2 px-3 text-gray-700">{a.Detail}</td>
                          <td className="py-2 px-3 whitespace-nowrap text-gray-600 font-medium">{a.ActorName || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-semibold transition"
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>
    </div>
  );
}
