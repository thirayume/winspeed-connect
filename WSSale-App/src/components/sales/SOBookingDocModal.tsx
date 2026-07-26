import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Printer, X, Settings, RefreshCw, AlertTriangle, Layers, UserCheck, CheckSquare } from 'lucide-react';
import { getDocHeaderConfig, type DocHeaderConfig } from '../../utils/docHeaderSettings';
import { DocHeaderSettingsModal } from '../common/DocHeaderSettingsModal';
import { fetchSalesOrder, fetchCustomers, listUsers } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { canManageDocHeaderSettings } from '../../utils/permissions';
import type { SalesOrder, EMCust, AdminUser } from '../../types';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body > :not(.so-doc-root) { display: none !important; }
  .so-doc-root { display: block !important; position: static !important; }
  .so-print-area { width: 100%; margin: 0 !important; display: block !important; }
  .so-no-print { display: none !important; }
  .so-page {
    page-break-after: always !important;
    break-after: page !important;
    width: 210mm;
    min-height: 297mm;
    box-sizing: border-box;
    margin: 0 auto !important;
    padding: 12mm 15mm !important;
    border: none !important;
    background: white !important;
    font-family: "TH Sarabun PSK", "Sarabun", "Cordia New", sans-serif;
  }
  .so-page:last-child { page-break-after: auto !important; break-after: auto !important; }
}
`;

function WorldFertLogoSvg({ className = 'h-11 w-auto' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wfGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2B3A4E" />
          <stop offset="100%" stopColor="#121C2B" />
        </linearGradient>
        <linearGradient id="wfGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#415570" />
          <stop offset="100%" stopColor="#1E293B" />
        </linearGradient>
      </defs>
      <path d="M15 15 L48 15 L72 82 L96 25 L120 82 L144 15 L177 15 L140 98 L108 98 L96 68 L84 98 L52 98 Z" fill="url(#wfGrad1)" stroke="#0D141F" strokeWidth="2" />
      <path d="M22 22 L45 22 L67 78 L85 28 L96 62 L107 28 L125 78 L147 22 L170 22 L138 92 L110 92 L96 58 L82 92 L54 92 Z" fill="url(#wfGrad2)" />
    </svg>
  );
}

export type NormalizedSO = {
  id: string | number;
  wfRef: string;
  soPrefix: string;
  custId: string;
  custName: string;
  custAddress: string;
  custTel: string;
  custFax: string;
  truckPlate: string;
  transRegistration: string;
  docuDate?: string;
  quotationNo: string;
  quotationDate?: string;
  creditDays: number;
  remark: string;
  salesName: string;
  lines: Array<{
    lineNo: number;
    goodId: string;
    goodCode: string;
    goodName: string;
    qtyTon: number;
    qtyBag: number;
    masterQty: number | null;
    childQty: number | null;
  }>;
};

export function SOBookingDocModal({
  soId,
  soIds,
  onClose,
}: {
  soId?: string | number;
  soIds?: (string | number)[];
  onClose: () => void;
}) {
  const currentUser = useAuthStore(s => s.user);
  const canManageHeader = canManageDocHeaderSettings(currentUser);

  const [orders, setOrders] = useState<NormalizedSO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrCodeUrls, setQrCodeUrls] = useState<Record<string, string>>({});
  const [headerConfig, setHeaderConfig] = useState<DocHeaderConfig>(() => getDocHeaderConfig('SO_BOOKING'));
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Staff Signature Selections
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [selectedSalesName, setSelectedSalesName] = useState<string>('');
  const [selectedSalesSig, setSelectedSalesSig] = useState<string>('');
  const [selectedApproverName, setSelectedApproverName] = useState<string>('');
  const [selectedApproverSig, setSelectedApproverSig] = useState<string>('');
  const [selectedWarehouseName, setSelectedWarehouseName] = useState<string>('');
  const [selectedWarehouseSig, setSelectedWarehouseSig] = useState<string>('');
  const [showDigitalSig, setShowDigitalSig] = useState<boolean>(true);

  useEffect(() => {
    const handleSettingsUpdate = () => {
      setHeaderConfig(getDocHeaderConfig('SO_BOOKING'));
    };
    window.addEventListener('doc-header-settings-updated', handleSettingsUpdate);
    return () => window.removeEventListener('doc-header-settings-updated', handleSettingsUpdate);
  }, []);

  useEffect(() => {
    // Load Users list for signature assignment
    listUsers().then(users => {
      setUsersList(users);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const targetIds = soIds && soIds.length > 0 ? soIds : soId ? [soId] : [];
        if (targetIds.length === 0) {
          throw new Error('ไม่พบข้อมูลออเดอร์ที่ต้องการพิมพ์');
        }

        // Fetch customers for fallback address/tel details
        let custMap: Record<string, EMCust> = {};
        try {
          const custs = await fetchCustomers();
          custs.forEach(c => { custMap[c.CustID] = c; });
        } catch { /* ignore customer lookup error */ }

        const rawDocs = await Promise.all(
          targetIds.map(id => fetchSalesOrder(id).catch(err => {
            console.error(`Failed to fetch SO ${id}:`, err);
            return null;
          }))
        );

        const validDocs = rawDocs.filter(Boolean) as SalesOrder[];
        if (validDocs.length === 0) {
          throw new Error('ไม่สามารถโหลดข้อมูลเอกสาร Sales Order ได้');
        }

        const normalizedList: NormalizedSO[] = validDocs.map(doc => {
          const cId = (doc as any).custId || (doc as any).CustID || (doc as any).cust_id || '';
          const cMaster = custMap[cId];
          const rawLines = (doc as any).lines || (doc as any).Lines || (doc as any).details || [];

          return {
            id: doc.id || (doc as any).Id || (doc as any).SOID || '',
            wfRef: doc.wfRef || (doc as any).WfRef || (doc as any).SOID || String(doc.id || ''),
            soPrefix: doc.soPrefix || (doc as any).SoPrefix || 'I',
            custId: cId || '-',
            custName: doc.custName || (doc as any).CustName || cMaster?.CustName || '-',
            custAddress: (doc as any).custAddress || (doc as any).CustAddress || cMaster?.Remark || cMaster?.Tel || '933 อาคารรวมทุนไทย ถนนมหาไชย เขตพระนคร กรุงเทพฯ',
            custTel: (doc as any).custTel || (doc as any).CustTel || cMaster?.Tel || cMaster?.Mobile || '-',
            custFax: (doc as any).custFax || (doc as any).CustFax || '-',
            truckPlate: doc.truckPlate || (doc as any).TransRegistration || (doc as any).TruckPlate || '-',
            transRegistration: (doc as any).transRegistration || (doc as any).TransRegistration || doc.truckPlate || '-',
            docuDate: (doc as any).docuDate || (doc as any).DocuDate || doc.createdAt || (doc as any).CreatedAt,
            quotationNo: (doc as any).quotationNo || (doc as any).QuotationNo || doc.linkedQuoteNo || '-',
            quotationDate: (doc as any).quotationDate || (doc as any).QuotationDate || doc.linkedQuoteValidUntil || undefined,
            creditDays: (doc as any).creditDays ?? (doc as any).CreditDays ?? 30,
            remark: doc.remark || (doc as any).Remark || '',
            salesName: doc.salesName || (doc as any).SalesName || currentUser?.displayName || 'พนักงานขาย',
            lines: rawLines.map((l: any, idx: number) => ({
              lineNo: l.lineNo || l.LineNum || idx + 1,
              goodId: l.goodId || l.GoodID || l.GoodId || '',
              goodCode: l.goodCode || l.GoodCode || '-',
              goodName: l.goodName || l.GoodName || '-',
              qtyTon: Number(l.qtyTon ?? l.QtyTon ?? 0),
              qtyBag: Number(l.qtyBag ?? l.QtyBag ?? (Number(l.qtyTon ?? l.QtyTon ?? 0) * 20)),
              masterQty: l.masterQty ?? l.MotherLoadQty ?? l.MasterQty ?? null,
              childQty: l.childQty ?? l.ChildLoadQty ?? l.ChildQty ?? null,
            })),
          };
        });

        setOrders(normalizedList);
        if (normalizedList[0]?.salesName) {
          setSelectedSalesName(normalizedList[0].salesName);
        }

        // Generate QR Codes
        const baseUrl = headerConfig.verificationBaseUrl || `${window.location.origin}/verify`;
        const qrPromises = normalizedList.map(async doc => {
          const verifyUrl = `${baseUrl}?type=SO&id=${doc.id}&ref=${doc.wfRef}`;
          const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 140, margin: 1 });
          return [doc.wfRef, qrDataUrl] as const;
        });
        const qrResults = await Promise.all(qrPromises);
        setQrCodeUrls(Object.fromEntries(qrResults));
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      }
      setLoading(false);
    })();
  }, [soId, JSON.stringify(soIds), headerConfig.verificationBaseUrl, currentUser]);

  const fmtDate = (d?: string) => {
    if (!d) return '-';
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return d;
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear() + 543;
    return `${day}/${month}/${year}`;
  };

  // Consolidated Items for Summary Attachment Page
  const combinedItemsMap = new Map<string, { goodCode: string; goodName: string; totalTon: number; totalBag: number }>();
  orders.forEach(ord => {
    ord.lines.forEach(l => {
      const key = l.goodCode;
      const existing = combinedItemsMap.get(key) || { goodCode: l.goodCode, goodName: l.goodName, totalTon: 0, totalBag: 0 };
      existing.totalTon += l.qtyTon;
      existing.totalBag += l.qtyBag;
      combinedItemsMap.set(key, existing);
    });
  });
  const consolidatedItems = Array.from(combinedItemsMap.values());
  const grandTotalTon = consolidatedItems.reduce((s, i) => s + i.totalTon, 0);
  const grandTotalBag = consolidatedItems.reduce((s, i) => s + i.totalBag, 0);

  const mainTruckPlate = orders[0]?.truckPlate || orders[0]?.transRegistration || '-';
  const allRefNos = orders.map(o => o.wfRef).join(', ');

  const formatSignerName = (name?: string | null) => {
    if (!name) return '';
    const trimmed = name.trim();
    if (
      trimmed === '' ||
      trimmed === '-- ไม่ระบุ --' ||
      trimmed === 'ไม่ระบุ' ||
      trimmed === 'ผู้อนุมัติ' ||
      trimmed === 'พนักงานคลังสินค้า' ||
      trimmed === 'พนักงานขาย' ||
      trimmed === headerConfig.signatureSalesLabel ||
      trimmed === headerConfig.signatureApprovedLabel ||
      trimmed === headerConfig.signatureWarehouseLabel
    ) {
      return '';
    }
    return trimmed;
  };

  const handleSalesSelect = (empName: string) => {
    setSelectedSalesName(empName);
    const u = usersList.find(u => u.DisplayName === empName || u.EmpName === empName);
    setSelectedSalesSig(u?.SignatureFile || '');
  };

  const handleApproverSelect = (empName: string) => {
    setSelectedApproverName(empName);
    const u = usersList.find(u => u.DisplayName === empName || u.EmpName === empName);
    setSelectedApproverSig(u?.SignatureFile || '');
  };

  const handleWarehouseSelect = (empName: string) => {
    setSelectedWarehouseName(empName);
    const u = usersList.find(u => u.DisplayName === empName || u.EmpName === empName);
    setSelectedWarehouseSig(u?.SignatureFile || '');
  };

  const showSalesBox = Boolean(headerConfig.signatureSalesLabel && headerConfig.signatureSalesLabel.trim() !== '');
  const showApproverBox = Boolean(headerConfig.signatureApprovedLabel && headerConfig.signatureApprovedLabel.trim() !== '');
  const showWarehouseBox = Boolean(headerConfig.signatureWarehouseLabel && headerConfig.signatureWarehouseLabel.trim() !== '');
  const activeSigBoxesCount = (showSalesBox ? 1 : 0) + (showApproverBox ? 1 : 0) + (showWarehouseBox ? 1 : 0);
  const showSignaturesSection = Boolean(headerConfig.showSignatures && activeSigBoxesCount > 0);

  const getGridColsClass = (count: number) => {
    if (count === 3) return 'grid-cols-3';
    if (count === 2) return 'grid-cols-2';
    return 'grid-cols-1 max-w-xs mx-auto';
  };

  return createPortal(
    <div className="so-doc-root fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 print:static print:p-0 print:bg-transparent print:block" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:bg-transparent print:block" onClick={e => e.stopPropagation()}>
        {/* Toolbar (No Print) */}
        <div className="so-no-print px-6 py-3.5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-gray-800 text-base flex items-center gap-2">
              <Printer size={18} className="text-[#0C447C]" /> ใบสั่งจอง (Sales Order Booking Document)
              {orders.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-[#0C447C] font-mono text-xs font-semibold">
                  {orders.length > 1 ? `รวม ${orders.length} บิล (${mainTruckPlate})` : orders[0]?.wfRef}
                </span>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canManageHeader && (
              <button
                onClick={() => setShowSettingsModal(true)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="ปรับแก้ไขชื่อบริษัท, ที่อยู่, โลโก้ และตั้งค่าหัวกระดาษ"
              >
                <Settings size={14} className="text-[#0C447C]" /> ตั้งค่าหัวกระดาษ
              </button>
            )}

            <button
              onClick={() => {
                const prevTitle = document.title;
                document.title = `SO_Booking_${mainTruckPlate}_${orders[0]?.wfRef || 'doc'}`;
                window.print();
                document.title = prevTitle;
              }}
              disabled={loading || orders.length === 0}
              className="px-4 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 shadow transition-all hover:bg-[#1F3864]"
              style={{ background: '#0C447C' }}
            >
              <Printer size={14} /> พิมพ์ / Export PDF (A4)
            </button>

            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Signature Controls & Options Bar (No Print) */}
        {!loading && orders.length > 0 && showSignaturesSection && (
          <div className="so-no-print px-6 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs text-gray-700 gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-bold flex items-center gap-1 text-[#0C447C]">
                <UserCheck size={14} /> ระบุผู้ลงนาม:
              </span>

              {/* Sales Rep Selector */}
              {showSalesBox && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">ขาย:</span>
                  <select
                    value={selectedSalesName}
                    onChange={e => handleSalesSelect(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded bg-white text-xs font-medium"
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    {orders[0]?.salesName && (
                      <option value={orders[0].salesName}>{orders[0].salesName} (จาก SO)</option>
                    )}
                    {usersList.map(u => (
                      <option key={u.Id} value={u.DisplayName}>{u.DisplayName} ({u.EmpCode || u.Role})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Approver Selector */}
              {showApproverBox && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">อนุมัติ:</span>
                  <select
                    value={selectedApproverName}
                    onChange={e => handleApproverSelect(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded bg-white text-xs font-medium"
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    {usersList.map(u => (
                      <option key={u.Id} value={u.DisplayName}>{u.DisplayName} ({u.Role})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Warehouse Selector */}
              {showWarehouseBox && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">คลัง:</span>
                  <select
                    value={selectedWarehouseName}
                    onChange={e => handleWarehouseSelect(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded bg-white text-xs font-medium"
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    {usersList.map(u => (
                      <option key={u.Id} value={u.DisplayName}>{u.DisplayName} ({u.Role})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer select-none font-semibold text-blue-900">
              <input
                type="checkbox"
                checked={showDigitalSig}
                onChange={e => setShowDigitalSig(e.target.checked)}
                className="rounded border-gray-300 text-[#0C447C] focus:ring-[#0C447C]"
              />
              แสดงลายเซ็นดิจิทัลอัตโนมัติ
            </label>
          </div>
        )}

        {/* Document Body Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-200/70 print:overflow-visible print:p-0 print:bg-transparent print:block">
          {error ? (
            <div className="py-20 flex flex-col items-center justify-center text-center px-4 bg-white rounded-xl shadow-sm">
              <AlertTriangle size={36} className="text-red-500 mb-3" />
              <h3 className="text-lg font-bold text-gray-800">ไม่สามารถโหลดข้อมูลเอกสารได้</h3>
              <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>
            </div>
          ) : loading || orders.length === 0 ? (
            <div className="py-20 flex justify-center items-center bg-white rounded-xl shadow-sm">
              <RefreshCw size={28} className="animate-spin text-[#0C447C]" />
            </div>
          ) : (
            <div className="so-print-area space-y-6 print:space-y-0">

              {/* ────────────────────────────────────────────────────────── */}
              {/* PAGE 1: Summary Loading Attachment Sheet (ใบสรุปโหลดสินค้าประจำรถ) */}
              {/* Rendered when multiple SOs exist in trip or as Attachment Page */}
              {/* ────────────────────────────────────────────────────────── */}
              <div className="so-page bg-white shadow-xl rounded-sm p-8 mx-auto text-black border border-gray-300 print:shadow-none print:border-none print:p-0" style={{ maxWidth: '210mm' }}>
                {/* Header */}
                <div className="flex items-start justify-between border-b pb-3 border-black">
                  <div className="flex items-start gap-4">
                    {headerConfig.logoUrl ? (
                      <img src={headerConfig.logoUrl} alt="Logo" className="h-12 w-auto object-contain" />
                    ) : (
                      <WorldFertLogoSvg className="h-11 w-auto" />
                    )}
                    <div>
                      <h1 className="text-xl font-bold tracking-tight text-black leading-none">{headerConfig.companyNameTh}</h1>
                      <p className="text-xs font-semibold text-gray-700 mt-0.5">{headerConfig.companyNameEn}</p>
                      <p className="text-[11px] text-gray-800 leading-tight mt-1 max-w-lg">{headerConfig.addressTh}</p>
                      <p className="text-[11px] text-gray-800 mt-0.5">
                        โทร. {headerConfig.tel} โทรสาร {headerConfig.fax} เลขประจำตัวผู้เสียภาษี {headerConfig.taxId}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-gray-500 font-mono mb-1">หน้า 1 / {orders.length + 1}</div>
                    {qrCodeUrls[orders[0]?.wfRef] && (
                      <div className="inline-block p-1 bg-white border border-black rounded shadow-2xl">
                        <img src={qrCodeUrls[orders[0]?.wfRef]} alt="QR Code" width={68} height={68} className="block" />
                        <span className="block text-[8px] text-center font-mono font-bold mt-0.5 text-gray-700">สแกนตรวจสอบ</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title */}
                <div className="my-3 text-center">
                  <h2 className="text-xl font-bold tracking-tight text-center text-black font-sans border-b-2 border-black inline-block px-8 py-1">
                    <div>ใบสรุปรายการสินค้าที่ต้องโหลดขึ้นรถ</div>
                    <div className="text-lg font-semibold mt-0.5 text-gray-900">(Truck Load Summary Sheet)</div>
                  </h2>
                </div>

                {/* Trip Details Box */}
                <div className="grid grid-cols-12 gap-2 text-xs mb-3">
                  <div className="col-span-8 border border-black rounded p-2.5 space-y-1">
                    <div className="flex"><span className="font-bold w-24 shrink-0">ทะเบียนรถ:</span> <b className="text-base text-blue-900">{mainTruckPlate}</b></div>
                    <div className="flex"><span className="font-bold w-24 shrink-0">ลูกค้า/ปลายทาง:</span> <b className="text-sm">{orders[0]?.custName}</b></div>
                    <div className="flex"><span className="font-bold w-24 shrink-0">รายการบิลในทริป:</span> <span className="font-mono font-bold text-gray-800">{allRefNos}</span></div>
                  </div>
                  <div className="col-span-4 border border-black rounded p-2.5 space-y-1 bg-gray-50/50">
                    <div className="flex justify-between"><span className="font-bold">วันที่พิมพ์:</span> <span>{fmtDate(new Date().toISOString())}</span></div>
                    <div className="flex justify-between"><span className="font-bold">จำนวนบิลรวม:</span> <span className="font-bold">{orders.length} ใบ</span></div>
                    <div className="flex justify-between"><span className="font-bold">น้ำหนักรวมชั่ง:</span> <b className="text-sm">{grandTotalTon.toFixed(2)} ตัน</b></div>
                  </div>
                </div>

                {/* Consolidated Table */}
                <div className="border border-black rounded overflow-hidden mb-3">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b border-black text-black text-center font-bold">
                        <th className="py-2 px-2 border-r border-black w-12">ลำดับ</th>
                        <th className="py-2 px-2 border-r border-black w-36">รหัสสินค้า</th>
                        <th className="py-2 px-3 border-r border-black">รายการสินค้า</th>
                        <th className="py-2 px-2 border-r border-black w-24 text-right">รวม (ตัน)</th>
                        <th className="py-2 px-2 border-r border-black w-24 text-right">รวม (กระสอบ)</th>
                        <th className="py-2 px-2 w-28 text-center">ตรวจรับขึ้นรถ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-300 text-gray-900">
                      {consolidatedItems.map((item, idx) => (
                        <tr key={idx} className="min-h-[30px]">
                          <td className="py-2 px-2 border-r border-black text-center font-mono">{idx + 1}</td>
                          <td className="py-2 px-2 border-r border-black font-mono font-bold">{item.goodCode}</td>
                          <td className="py-2 px-3 border-r border-black font-medium">{item.goodName}</td>
                          <td className="py-2 px-2 border-r border-black text-right font-black text-sm">{item.totalTon.toFixed(2)}</td>
                          <td className="py-2 px-2 border-r border-black text-right font-bold">{item.totalBag.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center">
                            <div className="w-4 h-4 border border-black inline-block rounded-sm"></div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-black font-bold text-xs bg-gray-50">
                        <td colSpan={3} className="py-2 px-3 text-right border-r border-black font-black">รวมน้ำหนักสินค้าทั้งหมดประจำรถคันนี้</td>
                        <td className="py-2 px-2 text-right border-r border-black font-black text-sm text-blue-900">{grandTotalTon.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right border-r border-black font-black text-sm">{grandTotalBag.toLocaleString()}</td>
                        <td className="py-2 px-2 text-center font-bold text-[10px]">ครบถ้วน</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Signatures */}
                {showSignaturesSection && (
                  <div className={`grid ${getGridColsClass(activeSigBoxesCount)} gap-3 text-center text-xs mt-8 pt-2`}>
                    {showSalesBox && (
                      <div className="border border-black rounded p-2.5 flex flex-col justify-between min-h-[100px] bg-white">
                        <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[42px]">
                          {showDigitalSig && selectedSalesSig && (
                            <img src={selectedSalesSig} alt="Sig" className="max-h-11 object-contain" />
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                          <span className="font-bold shrink-0">(</span>
                          <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]">
                            {formatSignerName(selectedSalesName)}
                          </div>
                          <span className="font-bold shrink-0">)</span>
                        </div>
                        <div className="mt-1 text-center">
                          <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureSalesLabel}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                        </div>
                      </div>
                    )}

                    {showApproverBox && (
                      <div className="border border-black rounded p-2.5 flex flex-col justify-between min-h-[100px] bg-white">
                        <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[42px]">
                          {showDigitalSig && selectedApproverSig && (
                            <img src={selectedApproverSig} alt="Sig" className="max-h-11 object-contain" />
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                          <span className="font-bold shrink-0">(</span>
                          <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]">
                            {formatSignerName(selectedApproverName)}
                          </div>
                          <span className="font-bold shrink-0">)</span>
                        </div>
                        <div className="mt-1 text-center">
                          <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureApprovedLabel}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                        </div>
                      </div>
                    )}

                    {showWarehouseBox && (
                      <div className="border border-black rounded p-2.5 flex flex-col justify-between min-h-[100px] bg-white">
                        <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[42px]">
                          {showDigitalSig && selectedWarehouseSig && (
                            <img src={selectedWarehouseSig} alt="Sig" className="max-h-11 object-contain" />
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                          <span className="font-bold shrink-0">(</span>
                          <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]">
                            {formatSignerName(selectedWarehouseName)}
                          </div>
                          <span className="font-bold shrink-0">)</span>
                        </div>
                        <div className="mt-1 text-center">
                          <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureWarehouseLabel}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ────────────────────────────────────────────────────────── */}
              {/* PAGE 2..N: Individual Sales Order Booking Documents (A4) */}
              {/* ────────────────────────────────────────────────────────── */}
              {orders.map((so, pageIdx) => {
                const totalTon = so.lines.reduce((sum, l) => sum + (Number(l.qtyTon) || 0), 0);
                const qrUrl = qrCodeUrls[so.wfRef];

                return (
                  <div key={so.wfRef || pageIdx} className="so-page bg-white shadow-xl rounded-sm p-8 mx-auto text-black border border-gray-300 print:shadow-none print:border-none print:p-0" style={{ maxWidth: '210mm' }}>
                    {/* Header Section */}
                    <div className="flex items-start justify-between border-b pb-3 border-black">
                      <div className="flex items-start gap-4">
                        {headerConfig.logoUrl ? (
                          <img src={headerConfig.logoUrl} alt="Logo" className="h-12 w-auto object-contain" />
                        ) : (
                          <WorldFertLogoSvg className="h-11 w-auto" />
                        )}
                        <div>
                          <h1 className="text-xl font-bold tracking-tight text-black leading-none">{headerConfig.companyNameTh}</h1>
                          <p className="text-xs font-semibold text-gray-700 mt-0.5">{headerConfig.companyNameEn}</p>
                          <p className="text-[11px] text-gray-800 leading-tight mt-1 max-w-lg">{headerConfig.addressTh}</p>
                          <p className="text-[11px] text-gray-800 mt-0.5">
                            โทร. {headerConfig.tel} โทรสาร {headerConfig.fax} เลขประจำตัวผู้เสียภาษี {headerConfig.taxId}
                          </p>
                        </div>
                      </div>

                      {/* Header QR Code & Page No */}
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-gray-500 font-mono mb-1">หน้า {pageIdx + 2} / {orders.length + 1}</div>
                        {qrUrl && (
                          <div className="inline-block p-1 bg-white border border-black rounded shadow-2xl">
                            <img src={qrUrl} alt="QR Code" width={68} height={68} className="block" />
                            <span className="block text-[8px] text-center font-mono font-bold mt-0.5 text-gray-700">สแกนตรวจสอบ</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Document Title & Header Box */}
                    <div className="my-3 relative flex items-center justify-between">
                      <div className="w-1/3"></div>
                      <h2 className="text-xl font-bold tracking-tight text-center text-black font-sans border-b-2 border-black px-6 py-0.5">
                        ใบสั่งจอง
                      </h2>
                      <div className="w-1/3 text-right">
                        <div className="inline-block border border-black rounded px-3 py-1.5 text-xs text-left bg-gray-50/50">
                          <div className="flex gap-2"><span className="font-bold">เลขที่:</span> <span className="font-mono font-bold text-sm">{so.wfRef || so.id}</span></div>
                          <div className="flex gap-2 mt-0.5"><span className="font-bold">วันที่:</span> <span>{fmtDate(so.docuDate)}</span></div>
                        </div>
                      </div>
                    </div>

                    {/* Customer Info Box & Quotation Info Box */}
                    <div className="grid grid-cols-12 gap-2 text-xs mb-3">
                      {/* Left: Customer Info */}
                      <div className="col-span-7 border border-black rounded p-2.5 space-y-1">
                        <div className="flex"><span className="font-bold w-20 shrink-0">รหัสลูกค้า:</span> <span>{so.custId}</span></div>
                        <div className="flex"><span className="font-bold w-20 shrink-0">ชื่อลูกค้า:</span> <b className="text-sm">{so.custName}</b></div>
                        <div className="flex"><span className="font-bold w-20 shrink-0">ที่อยู่:</span> <span className="leading-tight">{so.custAddress}</span></div>
                        <div className="flex gap-4 pt-0.5">
                          <div><span className="font-bold">โทร:</span> {so.custTel}</div>
                          <div><span className="font-bold">โทรสาร:</span> {so.custFax}</div>
                        </div>
                      </div>

                      {/* Right: Quotation & Credit Info */}
                      <div className="col-span-5 border border-black rounded p-2.5 space-y-1">
                        <div className="flex justify-between">
                          <div><span className="font-bold">ใบอนุมัติเสนอราคา:</span> {so.quotationNo}</div>
                          <div><span className="font-bold">ลงวันที่:</span> {fmtDate(so.quotationDate)}</div>
                        </div>
                        <div className="flex"><span className="font-bold w-24 shrink-0">ขนพร้อมทะเบียน:</span> <b className="text-xs">{so.truckPlate || so.transRegistration}</b></div>
                        <div className="flex gap-4">
                          <div><span className="font-bold">จำนวนวันเครดิต:</span> <span>{so.creditDays} วัน</span></div>
                        </div>
                      </div>
                    </div>

                    {/* Items Table */}
                    <div className="border border-black rounded overflow-hidden mb-3">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-100 border-b border-black text-black text-center font-bold">
                            <th className="py-2 px-2 border-r border-black w-36">รหัสสินค้า</th>
                            <th className="py-2 px-3 border-r border-black">รายการ</th>
                            <th className="py-2 px-2 border-r border-black w-20">จำนวน</th>
                            <th className="py-2 px-2 border-r border-black w-16">หน่วย</th>
                            <th className="py-2 px-2 border-r border-black w-24">จำนวนแม่</th>
                            <th className="py-2 px-2 w-24">จำนวนลูก</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-300 text-gray-900">
                          {so.lines && so.lines.length > 0 ? (
                            so.lines.map((l, idx) => (
                              <tr key={idx} className="min-h-[28px]">
                                <td className="py-2 px-2 border-r border-black font-mono font-medium">{l.goodCode}</td>
                                <td className="py-2 px-3 border-r border-black font-medium">{l.goodName}</td>
                                <td className="py-2 px-2 border-r border-black text-right font-bold">{l.qtyTon.toFixed(2)}</td>
                                <td className="py-2 px-2 border-r border-black text-center">ตัน</td>
                                <td className="py-2 px-2 border-r border-black text-right">{l.masterQty ? Number(l.masterQty).toFixed(2) : '-'}</td>
                                <td className="py-2 px-2 text-right">{l.childQty ? Number(l.childQty).toFixed(2) : '-'}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="py-8 text-center text-gray-400">ไม่มีรายการสินค้า</td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-black font-bold text-xs bg-gray-50">
                            <td colSpan={2} className="py-2 px-3 text-right border-r border-black">ยอดรวมจำนวน</td>
                            <td className="py-2 px-2 text-right border-r border-black font-black text-sm">{totalTon.toFixed(2)}</td>
                            <td className="py-2 px-2 text-center border-r border-black">ตัน</td>
                            <td colSpan={2} className="py-2 px-2"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Remarks Section */}
                    <div className="border border-black rounded p-2.5 text-xs mb-4 min-h-[50px]">
                      <div className="font-bold text-gray-900 mb-1">หมายเหตุ:</div>
                      <div className="text-gray-800 leading-relaxed pl-2 whitespace-pre-wrap">
                        {so.remark ? so.remark : `ขนพร้อมทะเบียน: ${so.truckPlate || '-'}`}
                      </div>
                    </div>

                    {/* Signatures Approval & Footer Section */}
                    {(showSignaturesSection || headerConfig.showFooterNote || headerConfig.showPageNumber) && (
                      <div className="mt-6 pt-3 border-t border-gray-300 space-y-3">
                        {showSignaturesSection && (
                          <div className={`grid ${getGridColsClass(activeSigBoxesCount)} gap-3 text-center text-xs`}>
                            {showSalesBox && (
                              <div className="border border-black rounded p-2.5 flex flex-col justify-between min-h-[95px] bg-white">
                                <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[40px]">
                                  {showDigitalSig && selectedSalesSig && (
                                    <img src={selectedSalesSig} alt="Sig" className="max-h-11 object-contain" />
                                  )}
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                                  <span className="font-bold shrink-0">(</span>
                                  <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]">
                                    {formatSignerName(selectedSalesName || so.salesName)}
                                  </div>
                                  <span className="font-bold shrink-0">)</span>
                                </div>
                                <div className="mt-1 text-center">
                                  <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureSalesLabel}</div>
                                  <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                                </div>
                              </div>
                            )}

                            {showApproverBox && (
                              <div className="border border-black rounded p-2.5 flex flex-col justify-between min-h-[95px] bg-white">
                                <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[40px]">
                                  {showDigitalSig && selectedApproverSig && (
                                    <img src={selectedApproverSig} alt="Sig" className="max-h-11 object-contain" />
                                  )}
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                                  <span className="font-bold shrink-0">(</span>
                                  <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]">
                                    {formatSignerName(selectedApproverName)}
                                  </div>
                                  <span className="font-bold shrink-0">)</span>
                                </div>
                                <div className="mt-1 text-center">
                                  <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureApprovedLabel}</div>
                                  <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                                </div>
                              </div>
                            )}

                            {showWarehouseBox && (
                              <div className="border border-black rounded p-2.5 flex flex-col justify-between min-h-[95px] bg-white">
                                <div className="border-b border-dotted border-gray-400 pb-1 flex items-end justify-center min-h-[40px]">
                                  {showDigitalSig && selectedWarehouseSig && (
                                    <img src={selectedWarehouseSig} alt="Sig" className="max-h-11 object-contain" />
                                  )}
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs font-semibold px-0.5 w-full text-gray-900">
                                  <span className="font-bold shrink-0">(</span>
                                  <div className="flex-1 text-center truncate font-bold px-1 mx-0.5 border-b border-dotted border-gray-400 min-h-[16px]">
                                    {formatSignerName(selectedWarehouseName)}
                                  </div>
                                  <span className="font-bold shrink-0">)</span>
                                </div>
                                <div className="mt-1 text-center">
                                  <div className="text-[11px] font-semibold text-gray-700">{headerConfig.signatureWarehouseLabel}</div>
                                  <div className="text-[10px] text-gray-500 mt-0.5">วันที่ ____/____/____</div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {(headerConfig.showFooterNote || headerConfig.showPageNumber) && (
                          <div className="flex items-center justify-between text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-1.5 font-medium">
                            <div>{headerConfig.showFooterNote ? (headerConfig.footerNote || 'เอกสารนี้ออกโดยระบบอัตโนมัติ WINSpeed-Connect · บริษัท เวิลด์ เฟอท จำกัด') : ''}</div>
                            <div>{headerConfig.showPageNumber ? `หน้า ${pageIdx + (orders.length > 1 ? 2 : 1)} / ${orders.length + (orders.length > 1 ? 1 : 0)}` : ''}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <DocHeaderSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        reportId="SO_BOOKING"
        reportTitle="ใบสั่งจอง (Sales Order Booking)"
      />
    </div>,
    document.body
  );
}
