/**
 * RebatePlanPrintModal.tsx — พิมพ์แผนงานส่งเสริมการขายและงบประมาณประจำปี (A4)
 * รองรับทั้งพิมพ์เฉพาะแผนที่เปิดดู (Single Plan) และพิมพ์พร้อมกันหลายรายการ (Batch Print)
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Building, CheckCircle2, FileText } from 'lucide-react';
import type { RebatePlan } from '../../types';
import { getDocHeaderConfig, type DocHeaderConfig } from '../../utils/docHeaderSettings';
import { formatThaiDate } from '../../utils/date';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm 12mm; }
  body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > :not(.plan-doc-root) { display: none !important; }
  .plan-doc-root { display: block !important; position: static !important; }
  .plan-no-print { display: none !important; }
  .plan-page {
    width: 100% !important; min-height: 270mm; box-sizing: border-box; margin: 0 auto !important;
    padding: 0 !important; border: none !important; box-shadow: none !important; background: white !important;
    page-break-after: always;
    font-family: "TH Sarabun PSK", "Sarabun", "Cordia New", sans-serif;
  }
  .plan-page:last-child {
    page-break-after: avoid;
  }
}
`;

const money = (n?: number | null) => (n != null ? `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-');

interface Props {
  plans: RebatePlan[];
  onClose: () => void;
}

export function RebatePlanPrintModal({ plans, onClose }: Props) {
  const [headerConfig] = useState<DocHeaderConfig>(() => getDocHeaderConfig('QUOTATION'));

  const handlePrint = () => {
    window.print();
  };

  const parseDetails = (p: RebatePlan) => {
    if (!p.DetailsJson) return { internalParticipants: [], externalParticipants: [], expenseItems: [] };
    try {
      return typeof p.DetailsJson === 'string' ? JSON.parse(p.DetailsJson) : p.DetailsJson;
    } catch {
      return { internalParticipants: [], externalParticipants: [], expenseItems: [] };
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 flex flex-col items-center overflow-y-auto p-4 sm:p-6 plan-doc-root backdrop-blur-sm">
      <style>{PRINT_CSS}</style>

      {/* Floating Toolbar (Hidden on print) */}
      <div className="plan-no-print sticky top-0 z-20 w-full max-w-4xl bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200 px-6 py-3 flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0C447C] flex items-center justify-center">
            <Printer size={20} />
          </div>
          <div>
            <h2 className="font-bold text-gray-800 text-sm sm:text-base">พิมพ์แบบขออนุมัติแผนงานส่งเสริมการขาย</h2>
            <p className="text-xs text-gray-500">พิมพ์รวม {plans.length} แผนงาน (A4 Portrait พร้อมช่องอนุมัติ 4 ระดับ)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="px-4 py-2 rounded-xl text-white font-bold text-sm flex items-center gap-2 hover:bg-[#093561] transition-all shadow-md"
            style={{ background: '#0C447C' }}
          >
            <Printer size={16} /> สั่งพิมพ์ (Print)
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Documents Container */}
      <div className="space-y-8 w-full max-w-4xl">
        {plans.map((plan, planIdx) => {
          const details = parseDetails(plan);
          const internalList: any[] = details.internalParticipants || [];
          const externalList: any[] = details.externalParticipants || [];
          const expenseList: any[] = details.expenseItems || [];

          return (
            <div
              key={plan.PlanId || planIdx}
              className="plan-page bg-white p-8 sm:p-12 rounded-2xl shadow-lg border border-gray-100 text-gray-900 text-sm flex flex-col justify-between"
            >
              <div>
                {/* Header */}
                <div className="border-b-2 border-[#0C447C] pb-4 mb-4 flex justify-between items-start">
                  <div>
                    <h1 className="text-xl font-black tracking-tight" style={{ color: '#0C447C' }}>
                      {headerConfig.companyNameTh || 'บริษัท เวิลด์เฟอร์ติไลเซอร์ จำกัด'}
                    </h1>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {headerConfig.companyNameEn || 'WORLD FERTILIZER CO., LTD.'}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 max-w-lg leading-relaxed">
                      {headerConfig.addressTh || '99 หมู่ 2 ถนนนครหลวง-ภาชี ตำบลนครหลวง อำเภอนครหลวง จังหวัดพระนครศรีอยุธยา 13260'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="inline-block bg-blue-50 border border-blue-200 text-[#0C447C] font-mono font-bold px-3 py-1 rounded-lg text-sm mb-1">
                      {plan.PlanNo}
                    </div>
                    <div className="text-xs text-gray-500">
                      วันที่จัดทำ: {plan.CreatedAt ? formatThaiDate(plan.CreatedAt) : '-'}
                    </div>
                    <div className="text-xs font-semibold text-gray-700">
                      สถานะ: {plan.Status || 'DRAFT'}
                    </div>
                  </div>
                </div>

                <div className="text-center my-4">
                  <h2 className="text-lg font-bold uppercase tracking-wide text-gray-800">
                    แบบขออนุมัติแผนงานส่งเสริมการขายและงบประมาณประจำปี
                  </h2>
                  <p className="text-xs text-gray-500">Annual Sales Promotion & Budget Proposal Form</p>
                </div>

                {/* Main Information */}
                <div className="bg-gray-50/80 rounded-xl p-4 border border-gray-200 mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <span className="font-semibold text-gray-600">ชื่อแผนงาน/โครงการ:</span>{' '}
                    <span className="font-bold text-gray-900 text-sm">{plan.Title || '-'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">หมวดหมู่งบประมาณ:</span>{' '}
                    <span className="font-bold text-[#0C447C]">{plan.PlanCategory || 'งบประมาณส่งเสริมการขายทั่วไป'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">เลขอ้างอิงโครงการ (Ref Doc):</span>{' '}
                    <span className="font-mono text-gray-800">{plan.RefDoc || '-'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">เขตการขาย / ภาค:</span>{' '}
                    <span className="font-semibold text-gray-800">{plan.Region || 'ALL (ทุกภาค)'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">ช่วงเวลาดำเนินการ:</span>{' '}
                    <span className="font-semibold text-gray-800">
                      {plan.ValidFrom ? formatThaiDate(plan.ValidFrom) : '-'} ถึง {plan.ValidTo ? formatThaiDate(plan.ValidTo) : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">วงเงินงบประมาณที่ขออนุมัติ:</span>{' '}
                    <span className="font-bold text-emerald-700 text-sm">{money(plan.AllocatedAmount)}</span>
                  </div>
                  {plan.GoodCodePattern && (
                    <div>
                      <span className="font-semibold text-gray-600">สูตร/สินค้าที่เกี่ยวข้อง:</span>{' '}
                      <span className="font-mono text-gray-800">{plan.GoodCodePattern}</span>
                    </div>
                  )}
                  {plan.NetPrice != null && (
                    <div>
                      <span className="font-semibold text-gray-600">ราคา NET อ้างอิง:</span>{' '}
                      <span className="font-semibold text-gray-800">{money(plan.NetPrice)}/ตัน</span>
                    </div>
                  )}
                </div>

                {/* Objective */}
                {plan.Objective && (
                  <div className="mb-4">
                    <h3 className="font-bold text-xs uppercase text-gray-700 mb-1 border-b border-gray-200 pb-1">
                      1. วัตถุประสงค์และรายละเอียดโครงการ (Objective & Scope)
                    </h3>
                    <p className="text-xs text-gray-800 leading-relaxed pl-2 whitespace-pre-line">{plan.Objective}</p>
                  </div>
                )}

                {/* Participants */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* Internal Participants */}
                  <div className="border border-gray-200 rounded-xl p-3 bg-white">
                    <h3 className="font-bold text-xs text-[#0C447C] mb-2 border-b border-gray-100 pb-1 flex items-center gap-1.5">
                      <Building size={14} /> ผู้มีส่วนร่วมฝ่าย Internal (พนักงาน/แผนก/เขต)
                    </h3>
                    {internalList.length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic">ไม่ระบุรายบุคคล (ใช้ร่วมกันตามเขตการขาย)</p>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left pb-1 font-semibold">ชื่อ-นามสกุล</th>
                            <th className="text-left pb-1 font-semibold">แผนก / เขต</th>
                            <th className="text-right pb-1 font-semibold">บทบาท</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {internalList.map((item, idx) => (
                            <tr key={idx}>
                              <td className="py-1 font-medium text-gray-800">{item.name || item.DisplayName || '-'}</td>
                              <td className="py-1 text-gray-600">{item.dept || item.region || item.Region || '-'}</td>
                              <td className="py-1 text-right text-gray-500">{item.role || item.PositionName || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* External Participants */}
                  <div className="border border-gray-200 rounded-xl p-3 bg-white">
                    <h3 className="font-bold text-xs text-[#0C447C] mb-2 border-b border-gray-100 pb-1 flex items-center gap-1.5">
                      <FileText size={14} /> ผู้มีส่วนร่วมฝ่าย External (ลูกค้า VIP / ตัวแทน)
                    </h3>
                    {externalList.length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic">ไม่มีผู้มีส่วนร่วมภายนอก</p>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left pb-1 font-semibold">รหัสลูกค้า</th>
                            <th className="text-left pb-1 font-semibold">ชื่อลูกค้า / ร้านค้า</th>
                            <th className="text-right pb-1 font-semibold">หมายเหตุ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {externalList.map((item, idx) => (
                            <tr key={idx}>
                              <td className="py-1 font-mono text-gray-700">{item.custCode || item.CustCode || '-'}</td>
                              <td className="py-1 font-medium text-gray-800">{item.custName || item.CustName || '-'}</td>
                              <td className="py-1 text-right text-gray-500">{item.note || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Expense Breakdown Items */}
                {expenseList.length > 0 && (
                  <div className="mb-4">
                    <h3 className="font-bold text-xs uppercase text-gray-700 mb-2 border-b border-gray-200 pb-1">
                      2. ประมาณการค่าใช้จ่ายย่อย (Budget Breakdown)
                    </h3>
                    <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                      <thead className="bg-gray-100/80 text-gray-600 text-[11px]">
                        <tr>
                          <th className="p-2 text-center w-12 border-b border-gray-200">ลำดับ</th>
                          <th className="p-2 text-left border-b border-gray-200">รายการค่าใช้จ่าย</th>
                          <th className="p-2 text-left border-b border-gray-200">รายละเอียด / หมายเหตุ</th>
                          <th className="p-2 text-right w-36 border-b border-gray-200">จำนวนเงิน (บาท)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-[11px]">
                        {expenseList.map((ex, idx) => (
                          <tr key={idx}>
                            <td className="p-2 text-center text-gray-400">{idx + 1}</td>
                            <td className="p-2 font-medium text-gray-800">{ex.item || '-'}</td>
                            <td className="p-2 text-gray-600">{ex.note || '-'}</td>
                            <td className="p-2 text-right font-bold text-gray-900">{money(ex.amount)}</td>
                          </tr>
                        ))}
                        <tr className="bg-blue-50/50 font-bold">
                          <td colSpan={3} className="p-2 text-right text-gray-700">
                            รวมประมาณการค่าใช้จ่ายทั้งสิ้น:
                          </td>
                          <td className="p-2 text-right text-[#0C447C] text-xs">
                            {money(expenseList.reduce((sum, item) => sum + Number(item.amount || 0), 0))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Additional Note */}
                {plan.Note && (
                  <div className="mb-4 text-xs text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                    <span className="font-semibold text-gray-700">หมายเหตุเพิ่มเติม:</span> {plan.Note}
                  </div>
                )}
              </div>

              {/* 4-Tier Approval Signatures */}
              <div className="pt-6 border-t-2 border-gray-200 mt-6">
                <div className="grid grid-cols-4 gap-4 text-center text-xs">
                  <div className="border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                    <div className="text-[11px] text-gray-500 font-semibold mb-8">1. ผู้เสนอแผนงาน</div>
                    <div className="border-b border-gray-400 w-3/4 mx-auto mb-1"></div>
                    <div className="font-medium text-gray-800">{plan.CreatedByName || '...........................................'}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">วันที่ ...../...../..........</div>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                    <div className="text-[11px] text-gray-500 font-semibold mb-8">2. ผู้จัดการภาค/เขต</div>
                    <div className="border-b border-gray-400 w-3/4 mx-auto mb-1"></div>
                    <div className="font-medium text-gray-800">...........................................</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">วันที่ ...../...../..........</div>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                    <div className="text-[11px] text-gray-500 font-semibold mb-8">3. ผู้จัดการฝ่ายขาย</div>
                    <div className="border-b border-gray-400 w-3/4 mx-auto mb-1"></div>
                    <div className="font-medium text-gray-800">...........................................</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">วันที่ ...../...../..........</div>
                  </div>

                  <div className="border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                    <div className="text-[11px] text-gray-500 font-semibold mb-8">4. กรรมการบริหาร / อนุมัติ</div>
                    <div className="border-b border-gray-400 w-3/4 mx-auto mb-1"></div>
                    <div className="font-medium text-gray-800">...........................................</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">วันที่ ...../...../..........</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
