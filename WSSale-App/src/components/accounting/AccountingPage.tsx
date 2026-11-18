import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  FileCheck, RefreshCw, Coins, Package, Info, CheckCircle, X,
  Printer, Truck, Calendar, Eye, ChevronDown, ChevronRight, Search, FileText
} from 'lucide-react';
import {
  fetchRebateClaims, approveRebateClaim, fetchShippedToday,
} from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import { appAlert, appPrompt } from '../ui/AppAlert';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { bangkokDate } from '../../utils/date';
import { AccountingBillDetailModal } from './AccountingBillDetailModal';
import { AccountingPrintModal } from './AccountingPrintModal';
import type { RebateClaim, ShippedRow } from '../../types';

const STATUS_LABEL: Record<string, string> = {
  'Y': 'ชำระแล้ว',
  'N': 'ค้างชำระ',
  'P': 'บางส่วน',
  'C': 'ยกเลิก',
};
const STATUS_COLOR: Record<string, string> = {
  'Y': 'bg-green-100 text-green-700',
  'N': 'bg-blue-100 text-blue-700',
  'P': 'bg-yellow-100 text-yellow-700',
  'C': 'bg-red-100 text-red-500',
};

function today() {
  return bangkokDate(0);
}

function daysAgo(n: number) {
  return bangkokDate(n);
}

function startOfMonth() {
  const d = bangkokDate(0);
  return `${d.slice(0, 7)}-01`;
}

interface TripGroup {
  tripKey: string;
  tripId?: number | null;
  tripCode?: string | null;
  truckPlate?: string | null;
  driverName?: string | null;
  tripDate?: string | null;
  tripStatus?: string | null;
  bills: ShippedRow[];
  totalTon: number;
  totalWeightNet: number;
}

export function AccountingPage() {
  const [shipped, setShipped] = useState<ShippedRow[]>([]);
  const [claims, setClaims]   = useState<RebateClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);

  // Date Range (เริ่ม - ถึง)
  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate, setEndDate]     = useState(today());

  // View Mode: 'trips' | 'bills'
  const [viewMode, setViewMode]   = useState<'trips' | 'bills'>('trips');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTrips, setExpandedTrips] = useState<Record<string, boolean>>({});

  // Modals
  const [selectedBillId, setSelectedBillId] = useState<number | string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(async (sDate = startDate, eDate = endDate) => {
    setLoading(true);
    try {
      const [shippedRes, claimsRes] = await Promise.all([
        fetchShippedToday({ startDate: sDate, endDate: eDate }),
        fetchRebateClaims('PENDING'),
      ]);
      const rows = Array.isArray(shippedRes) ? shippedRes : [];
      setShipped(rows);
      setClaims(Array.isArray(claimsRes) ? claimsRes : []);

      // Default expand all trips
      const exp: Record<string, boolean> = {};
      rows.forEach(r => {
        const k = r.TripCode || (r.TripId ? String(r.TripId) : (r.TruckPlate || 'NO_TRIP'));
        exp[k] = true;
      });
      setExpandedTrips(exp);
    } catch (e) {
      console.error(e);
      setShipped([]);
    }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    load(startDate, endDate);
  }, []);

  useSocketEvent('so_updated', () => load(startDate, endDate));

  async function doApprove(claim: RebateClaim) {
    const cn = await appPrompt(`กรอกเลขอ้างอิงเอกสาร WINSpeed สำหรับเคลม ฿${Number(claim.ClaimAmt).toLocaleString()}:\n(เว้นว่างได้ ถ้ายังไม่มีเลขเอกสาร)`);
    if (cn === null) return;
    setBusyId(claim.Id);
    try {
      await approveRebateClaim(claim.Id, cn || undefined);
      await load(startDate, endDate);
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const setPreset = (preset: 'today' | 'yesterday' | '7days' | '30days' | 'month') => {
    let s = today();
    let e = today();
    if (preset === 'yesterday') {
      s = daysAgo(1);
      e = daysAgo(1);
    } else if (preset === '7days') {
      s = daysAgo(7);
      e = today();
    } else if (preset === '30days') {
      s = daysAgo(30);
      e = today();
    } else if (preset === 'month') {
      s = startOfMonth();
      e = today();
    }
    setStartDate(s);
    setEndDate(e);
    load(s, e);
  };

  // Filtered rows
  const filteredShipped = useMemo(() => {
    if (!searchQuery.trim()) return shipped;
    const q = searchQuery.toLowerCase().trim();
    return shipped.filter(r =>
      (r.WfRef && r.WfRef.toLowerCase().includes(q)) ||
      (r.CustName && r.CustName.toLowerCase().includes(q)) ||
      (r.CustCode && r.CustCode.toLowerCase().includes(q)) ||
      (r.TruckPlate && r.TruckPlate.toLowerCase().includes(q)) ||
      (r.TripCode && r.TripCode.toLowerCase().includes(q)) ||
      (r.MoveBill && r.MoveBill.toLowerCase().includes(q)) ||
      (r.Invoice107No && r.Invoice107No.toLowerCase().includes(q))
    );
  }, [shipped, searchQuery]);

  // Group by Sale Trip
  const tripGroups: TripGroup[] = useMemo(() => {
    const map = new Map<string, TripGroup>();
    filteredShipped.forEach(row => {
      const key = row.TripCode || (row.TripId ? `ID_${row.TripId}` : (row.TruckPlate ? `TRUCK_${row.TruckPlate}` : 'NO_TRIP'));
      let grp = map.get(key);
      if (!grp) {
        grp = {
          tripKey: key,
          tripId: row.TripId,
          tripCode: row.TripCode,
          truckPlate: row.TripPlate || row.TruckPlate,
          driverName: row.DriverName,
          tripDate: row.TripDate || row.DocuDate,
          tripStatus: row.TripStatus,
          bills: [],
          totalTon: 0,
          totalWeightNet: 0,
        };
        map.set(key, grp);
      }
      grp.bills.push(row);
      grp.totalTon += Number(row.TotalTon) || 0;
      grp.totalWeightNet += Number(row.WeightNet) || 0;
    });

    const arr = Array.from(map.values());
    // Sort trips descending by date or code
    arr.sort((a, b) => {
      const dateA = a.tripDate || '';
      const dateB = b.tripDate || '';
      return dateB.localeCompare(dateA);
    });
    return arr;
  }, [filteredShipped]);

  const toggleTrip = (key: string) => {
    setExpandedTrips(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const totalTon = filteredShipped.reduce((s, r) => s + (Number(r.TotalTon) || 0), 0);
  const totalScaleKg = filteredShipped.reduce((s, r) => s + (Number(r.WeightNet) || 0), 0);
  const uniqueTripCount = new Set(filteredShipped.map(r => r.TripCode || r.TripId).filter(Boolean)).size;

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <FileCheck className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> บัญชี / Winspeed
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
            ตรวจสอบการออกของตาม Sale Trip · เอกสาร WinSpeed (103/104/116/107) · การชั่งโรงงาน (WGHD)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Date Presets */}
          <div className="hidden lg:flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold text-gray-600">
            <button
              onClick={() => setPreset('today')}
              className={`px-2.5 py-1 rounded-lg transition ${startDate === today() && endDate === today() ? 'bg-white text-[#0C447C] shadow-xs' : 'hover:text-gray-900'}`}
            >
              วันนี้
            </button>
            <button
              onClick={() => setPreset('yesterday')}
              className={`px-2.5 py-1 rounded-lg transition ${startDate === daysAgo(1) && endDate === daysAgo(1) ? 'bg-white text-[#0C447C] shadow-xs' : 'hover:text-gray-900'}`}
            >
              เมื่อวาน
            </button>
            <button
              onClick={() => setPreset('7days')}
              className={`px-2.5 py-1 rounded-lg transition ${startDate === daysAgo(7) && endDate === today() ? 'bg-white text-[#0C447C] shadow-xs' : 'hover:text-gray-900'}`}
            >
              7 วันล่าสุด
            </button>
            <button
              onClick={() => setPreset('month')}
              className={`px-2.5 py-1 rounded-lg transition ${startDate === startOfMonth() && endDate === today() ? 'bg-white text-[#0C447C] shadow-xs' : 'hover:text-gray-900'}`}
            >
              เดือนนี้
            </button>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-2 py-1 shadow-xs">
            <Calendar size={14} className="text-gray-400 shrink-0" />
            <div className="w-28 sm:w-32">
              <ThaiDatePicker
                value={startDate}
                onChange={v => { setStartDate(v); load(v, endDate); }}
                className="w-full border-0 p-0 text-xs focus:ring-0 text-gray-800 font-semibold"
              />
            </div>
            <span className="text-gray-400 text-xs">ถึง</span>
            <div className="w-28 sm:w-32">
              <ThaiDatePicker
                value={endDate}
                onChange={v => { setEndDate(v); load(startDate, v); }}
                className="w-full border-0 p-0 text-xs focus:ring-0 text-gray-800 font-semibold"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <button
            onClick={() => setShowPrintModal(true)}
            disabled={filteredShipped.length === 0}
            className="h-9 px-3 flex items-center gap-1.5 rounded-xl bg-[#0C447C] hover:bg-blue-900 text-white text-xs font-semibold shadow-xs transition disabled:opacity-40"
            title="พิมพ์รายงานสรุปบัญชี"
          >
            <Printer size={15} /> <span className="hidden sm:inline">พิมพ์รายงาน</span>
          </button>

          <button
            onClick={() => setShowInfo(true)}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
            title="ข้อมูลการซิงค์"
          >
            <Info size={16} />
          </button>

          <button
            onClick={() => load(startDate, endDate)}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition"
            title="โหลดข้อมูลใหม่"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-[#0C447C]' : ''} />
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        
        {/* Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 shrink-0">
          <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center shrink-0">
              <CheckCircle size={20} />
            </div>
            <div>
              <div className="text-[11px] text-gray-400">บิลที่ออกในช่วงนี้</div>
              <div className="text-xl sm:text-2xl font-black text-gray-800 tabular-nums">{filteredShipped.length}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0C447C] flex items-center justify-center shrink-0">
              <Truck size={20} />
            </div>
            <div>
              <div className="text-[11px] text-gray-400">เที่ยววิ่ง (Sale Trips)</div>
              <div className="text-xl sm:text-2xl font-black text-gray-800 tabular-nums">{uniqueTripCount}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Package size={20} />
            </div>
            <div>
              <div className="text-[11px] text-gray-400">ยอดรวมสั่งจอง (ตัน)</div>
              <div className="text-xl sm:text-2xl font-black text-emerald-700 tabular-nums">{totalTon.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
              <Coins size={20} />
            </div>
            <div>
              <div className="text-[11px] text-gray-400">เคลมรีเบทรออนุมัติ</div>
              <div className="text-xl sm:text-2xl font-black text-orange-600 tabular-nums">{claims.length}</div>
            </div>
          </div>
        </div>

        {/* View Mode Toggle & Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl sm:rounded-2xl border border-gray-100 shadow-xs">
          
          {/* Segmented View Mode */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold text-gray-600 self-start sm:self-auto">
            <button
              onClick={() => setViewMode('trips')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                viewMode === 'trips'
                  ? 'bg-white text-[#0C447C] shadow-xs'
                  : 'hover:text-gray-900'
              }`}
            >
              <Truck size={14} /> <span>จัดกลุ่มตาม Sale Trip</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${viewMode === 'trips' ? 'bg-blue-50 text-[#0C447C]' : 'bg-gray-200 text-gray-600'}`}>
                {tripGroups.length}
              </span>
            </button>
            <button
              onClick={() => setViewMode('bills')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                viewMode === 'bills'
                  ? 'bg-white text-[#0C447C] shadow-xs'
                  : 'hover:text-gray-900'
              }`}
            >
              <FileText size={14} /> <span>แสดงรายบิล</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${viewMode === 'bills' ? 'bg-blue-50 text-[#0C447C]' : 'bg-gray-200 text-gray-600'}`}>
                {filteredShipped.length}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="ค้นหาเลขที่บิล, ลูกค้า, รถ, Trip, ใบชั่ง..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Content Section: By Sale Trip or By Bill */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-2 bg-white rounded-2xl border border-gray-100">
            <RefreshCw size={26} className="animate-spin text-[#0C447C]" />
            <span className="text-xs text-gray-400">กำลังดึงข้อมูลบัญชีและการจ่ายสินค้า...</span>
          </div>
        ) : filteredShipped.length === 0 ? (
          <div className="py-16 text-center bg-white rounded-2xl border border-gray-100 shadow-xs">
            <FileText size={36} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm font-semibold text-gray-700">ไม่พบเอกสารออกของในช่วงวันที่เลือก</p>
            <p className="text-xs text-gray-400 mt-1">ลองเปลี่ยนช่วงวันที่ หรือคำค้นหา</p>
          </div>
        ) : viewMode === 'trips' ? (
          /* ── View 1: Grouped by Sale Trip ── */
          <div className="space-y-4">
            {tripGroups.map(grp => {
              const isExpanded = expandedTrips[grp.tripKey] !== false;
              return (
                <div
                  key={grp.tripKey}
                  className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden transition"
                >
                  {/* Trip Card Header */}
                  <div
                    onClick={() => toggleTrip(grp.tripKey)}
                    className="p-4 bg-gray-50/80 hover:bg-gray-100/60 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3">
                      <button className="text-gray-400 hover:text-gray-600">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                      <div className="w-9 h-9 rounded-xl bg-blue-100 text-[#0C447C] flex items-center justify-center shrink-0">
                        <Truck size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-900 text-sm">
                            {grp.tripCode || (grp.tripId ? `Sale Trip #${grp.tripId}` : 'บิลที่ไม่ได้ผูก Sale Trip')}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-[#0C447C] border border-blue-200">
                            {grp.truckPlate || 'ไม่ระบุทะเบียน'}
                          </span>
                          {grp.driverName && (
                            <span className="text-xs text-gray-500">
                              (คนขับ: {grp.driverName})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          วันที่เที่ยว: {grp.tripDate || '-'} · สถานะ: {grp.tripStatus || 'สำเร็จ'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-semibold shrink-0">
                      <div className="text-right">
                        <span className="text-gray-400 block text-[10px]">จำนวนบิล</span>
                        <span className="text-gray-800 font-bold">{grp.bills.length} ใบ</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-400 block text-[10px]">ยอดรวมตัน</span>
                        <span className="text-[#0C447C] font-bold tabular-nums">{grp.totalTon.toFixed(2)} ตัน</span>
                      </div>
                      {grp.totalWeightNet > 0 && (
                        <div className="text-right hidden sm:block">
                          <span className="text-gray-400 block text-[10px]">ชั่งสุทธิ (กก.)</span>
                          <span className="text-emerald-700 font-bold tabular-nums">{grp.totalWeightNet.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Trip Bills Table */}
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left min-w-[750px]">
                        <thead className="bg-gray-50/50 text-gray-500 font-semibold border-b border-gray-100">
                          <tr>
                            <th className="py-2.5 px-4 w-12 text-center">#</th>
                            <th className="py-2.5 px-4">เลขที่บิล (103)</th>
                            <th className="py-2.5 px-4">ลูกค้า</th>
                            <th className="py-2.5 px-4 text-right">ตัน</th>
                            <th className="py-2.5 px-4 text-center">ใบชั่ง (WGHD)</th>
                            <th className="py-2.5 px-4">ใบสั่งขาย (104)</th>
                            <th className="py-2.5 px-4">ใบขน (116)</th>
                            <th className="py-2.5 px-4">ใบส่งของ (107)</th>
                            <th className="py-2.5 px-4 text-center">สถานะ</th>
                            <th className="py-2.5 px-4 text-right">ดูบิล</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {grp.bills.map((b, idx) => (
                            <tr key={b.Id || idx} className="hover:bg-blue-50/30 transition">
                              <td className="py-2.5 px-4 text-center text-gray-400">{idx + 1}</td>
                              <td className="py-2.5 px-4">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBillId(b.SOID || b.Id || b.WfRef)}
                                  className="font-mono font-bold text-[#0C447C] hover:underline flex items-center gap-1 cursor-pointer"
                                  title="กดดูรายละเอียดบิลฉบับสมบูรณ์"
                                >
                                  {b.WfRef}
                                </button>
                                <span className="text-[10px] text-gray-400 block">{b.DocuDate}</span>
                              </td>
                              <td className="py-2.5 px-4 max-w-[180px] truncate" title={b.CustName}>
                                <span className="font-semibold text-gray-800">{b.CustName}</span>
                                {b.CustCode && <span className="text-[10px] text-gray-400 block">[{b.CustCode}]</span>}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums font-bold text-gray-800">
                                {Number(b.TotalTon).toFixed(2)}
                              </td>
                              <td className="py-2.5 px-4 text-center font-mono">
                                {b.MoveBill ? (
                                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">
                                    {b.MoveBill}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-mono text-gray-700">
                                {b.Delivery104No || '-'}
                              </td>
                              <td className="py-2.5 px-4 font-mono text-gray-700">
                                {b.Slip116No || '-'}
                              </td>
                              <td className="py-2.5 px-4 font-mono">
                                {b.Invoice107No ? (
                                  <span className={`font-semibold ${b.Invoice107No.startsWith('J') ? 'text-blue-800' : 'text-purple-800'}`}>
                                    {b.Invoice107No}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLOR[b.DocuStatus] || 'bg-gray-100 text-gray-600'}`}>
                                  {STATUS_LABEL[b.DocuStatus] || b.DocuStatus}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBillId(b.SOID || b.Id || b.WfRef)}
                                  className="p-1.5 text-gray-500 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition"
                                  title="ดูรายละเอียดบิล"
                                >
                                  <Eye size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── View 2: List of all bills ── */
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left min-w-[900px]">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-200 uppercase">
                  <tr>
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4">เลขที่บิล (103)</th>
                    <th className="py-3 px-4">วันที่</th>
                    <th className="py-3 px-4">Sale Trip</th>
                    <th className="py-3 px-4">ทะเบียนรถ</th>
                    <th className="py-3 px-4">ลูกค้า</th>
                    <th className="py-3 px-4 text-right">ตัน</th>
                    <th className="py-3 px-4 text-center">ใบชั่ง (WGHD)</th>
                    <th className="py-3 px-4">ใบสั่งขาย (104)</th>
                    <th className="py-3 px-4">ใบขน (116)</th>
                    <th className="py-3 px-4">ใบส่งของ (107)</th>
                    <th className="py-3 px-4 text-center">สถานะ</th>
                    <th className="py-3 px-4 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredShipped.map((b, idx) => (
                    <tr key={b.Id || idx} className="hover:bg-blue-50/30 transition">
                      <td className="py-2.5 px-4 text-center text-gray-400">{idx + 1}</td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => setSelectedBillId(b.SOID || b.Id || b.WfRef)}
                          className="font-mono font-bold text-[#0C447C] hover:underline"
                        >
                          {b.WfRef}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-gray-600 whitespace-nowrap">{b.DocuDate}</td>
                      <td className="py-2.5 px-4 font-mono text-[#0C447C] font-semibold">{b.TripCode || '-'}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">{b.TruckPlate || b.TripPlate || '-'}</td>
                      <td className="py-2.5 px-4 max-w-[180px] truncate" title={b.CustName}>
                        <span className="font-semibold text-gray-800">{b.CustName}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-bold text-gray-800">
                        {Number(b.TotalTon).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono">{b.MoveBill || '-'}</td>
                      <td className="py-2.5 px-4 font-mono">{b.Delivery104No || '-'}</td>
                      <td className="py-2.5 px-4 font-mono">{b.Slip116No || '-'}</td>
                      <td className="py-2.5 px-4 font-mono">
                        {b.Invoice107No ? (
                          <span className={b.Invoice107No.startsWith('J') ? 'text-blue-800 font-semibold' : 'text-purple-800 font-semibold'}>
                            {b.Invoice107No}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLOR[b.DocuStatus] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[b.DocuStatus] || b.DocuStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedBillId(b.SOID || b.Id || b.WfRef)}
                          className="p-1.5 text-gray-500 hover:text-[#0C447C] hover:bg-blue-50 rounded-lg transition"
                          title="ดูรายละเอียดบิล"
                        >
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rebate Claims Section */}
        <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-100 shadow-xs p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <Coins size={16} className="text-orange-500" /> เคลมรีเบทรออนุมัติ (CN Rebate Clearance)
          </h2>
          {claims.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">ไม่มีเคลมรออนุมัติ</p>
          ) : (
            <div className="space-y-2">
              {claims.map(c => (
                <div key={c.Id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <div className="flex-1">
                    <span className="text-sm font-bold text-gray-700">
                      ฿{Number(c.ClaimAmt).toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">{c.SalesName}</span>
                    {c.Note && <span className="ml-2 text-[10px] text-gray-400">{c.Note}</span>}
                  </div>
                  <button
                    disabled={busyId === c.Id}
                    onClick={() => doApprove(c)}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#0C447C' }}
                  >
                    {busyId === c.Id ? <RefreshCw size={14} className="animate-spin" /> : 'อนุมัติ + Ref'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bill Detail Modal */}
      {selectedBillId !== null && (
        <AccountingBillDetailModal
          billId={selectedBillId}
          onClose={() => setSelectedBillId(null)}
        />
      )}

      {/* Print Report Modal */}
      {showPrintModal && (
        <AccountingPrintModal
          startDate={startDate}
          endDate={endDate}
          rows={filteredShipped}
          onClose={() => setShowPrintModal(false)}
        />
      )}

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2 text-blue-800">
                <Info size={20} /> ระบบซิงค์ข้อมูล
              </h2>
              <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="text-sm text-gray-600 space-y-3">
              <p><strong>Real-time Sync:</strong> เอกสารทั้งหมดที่สร้างจาก App จะถูก Sync เข้า Winspeed โดยอัตโนมัติเมื่อกด "ยืนยัน" (Confirm)</p>
              <p>ระบบเชื่อมโยงข้อมูลครบวงจรทั้ง ใบสั่งจอง (103), ใบสั่งขาย (104), ใบตัดตั๋ว/ขนย้าย (116), ใบส่งของ/ใบกำกับภาษี (107 เล่ม J/N) และการชั่งน้ำหนักโรงงาน (WGHD)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
