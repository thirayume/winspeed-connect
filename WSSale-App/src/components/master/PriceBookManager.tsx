import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BookOpen, RefreshCw, Plus, CheckCircle2, Rocket, Archive, FileClock,
  Tag, Save, UserCheck, AlertTriangle, Search, Edit3,
} from 'lucide-react';
import {
  fetchPriceBooks, fetchPriceBook, createPriceBook, updatePriceBookHeader,
  priceBookAction, setPriceBookLines, upsertPriceBookItem,
  fetchPriceBookSpecial, requestPriceBookSpecial, approvePriceBookSpecial,
  fetchGoods, fetchActiveCostMap,
  type PriceBook, type PriceBookLine, type PriceBookAuditRow, type PriceBookSpecialPrice,
} from '../../services/api';
import { socketService } from '../../services/socket';
import type { EMGood } from '../../types';
import { useAuthStore } from '../../store/auth-store';
import { appAlert, appConfirm } from '../ui/AppAlert';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { SearchableSelect } from '../ui/SearchableSelect';
import { CustomerAutocomplete } from '../ui/CustomerAutocomplete';
import { bangkokDate, formatThaiDate } from '../../utils/date';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  APPROVED: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-gray-100 text-gray-400',
};

const LINE_STATUS_BADGE: Record<string, { label: string; style: string }> = {
  ACTIVE: { label: 'ปกติ', style: 'bg-green-50 text-green-700 border-green-200' },
  DISCONTINUING: { label: 'กำลังยกเลิก (***)', style: 'bg-amber-50 text-amber-700 border-amber-200 font-bold' },
  SUSPENDED: { label: 'งดขาย', style: 'bg-red-50 text-red-700 border-red-200 font-bold' },
};

const LINE_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'ปกติ', badge: 'ขายปกติ' },
  { value: 'DISCONTINUING', label: 'กำลังยกเลิก (***)', badge: '***' },
  { value: 'SUSPENDED', label: 'งดขาย', badge: 'ระงับ' },
];

type Detail = PriceBook & { lines: PriceBookLine[]; audit: PriceBookAuditRow[] };

function addDaysIso(isoDate: string, days: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return bangkokDate(0);
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function suggestNextCycleDates(books: PriceBook[]): { effectiveFrom: string; effectiveTo: string } {
  const nonArchived = books.filter(b => b.Status !== 'ARCHIVED' && (b.EffectiveTo || b.EffectiveFrom));
  if (nonArchived.length === 0) {
    const start = bangkokDate(0);
    return { effectiveFrom: start, effectiveTo: addDaysIso(start, 7) };
  }
  const latestEnd = nonArchived
    .map(b => (b.EffectiveTo || b.EffectiveFrom || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop();
  const nextStart = latestEnd ? addDaysIso(latestEnd, 1) : bangkokDate(0);
  return { effectiveFrom: nextStart, effectiveTo: addDaysIso(nextStart, 7) };
}

export function PriceBookManager({
  targetGood = null,
  onClearTarget,
}: {
  targetGood?: { goodId: string; goodCode?: string; goodName?: string } | null;
  onClearTarget?: () => void;
}) {
  const user = useAuthStore(s => s.user);
  const actions = user?.capabilities?.actions;
  const role = user?.role || '';
  const canManagePricing = actions ? actions.includes('pricing.manage') : ['MANAGER', 'ADMIN', 'C_LEVEL', 'ACCOUNTING'].includes(role);
  const canViewCost = actions ? (actions.includes('cost.view') || actions.includes('cost.manage')) : ['MANAGER', 'ADMIN', 'C_LEVEL', 'ACCOUNTING'].includes(role);

  const [books, setBooks] = useState<PriceBook[]>([]);
  const [sel, setSel] = useState<Detail | null>(null);
  const [editableLines, setEditableLines] = useState<PriceBookLine[]>([]);
  const [specials, setSpecials] = useState<PriceBookSpecialPrice[]>([]);
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [costMap, setCostMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    effectiveFrom: bangkokDate(0),
    effectiveTo: bangkokDate(-7),
    seedFromCurrent: true,
  });

  const [editingHeader, setEditingHeader] = useState(false);
  const [headerDraft, setHeaderDraft] = useState({
    name: '',
    effectiveFrom: '',
    effectiveTo: '',
    note: '',
  });

  const [lineSearch, setLineSearch] = useState('');
  const [addForm, setAddForm] = useState({
    goodId: '',
    price: '',
    lineStatus: 'ACTIVE' as 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED',
    note: '',
  });

  // Special Price Form
  const [spForm, setSpForm] = useState({ custId: '', custName: '', goodId: '', requestedPrice: '', note: '' });
  const [spApprovedInput, setSpApprovedInput] = useState<Record<number, string>>({});

  const open = useCallback(async (id: number) => {
    try {
      const b = await fetchPriceBook(id);
      setSel(b);
      setEditableLines(b.lines ? b.lines.map(l => ({ ...l, LineStatus: l.LineStatus || 'ACTIVE' })) : []);
      setHeaderDraft({
        name: b.Name || '',
        effectiveFrom: b.EffectiveFrom ? b.EffectiveFrom.slice(0, 10) : '',
        effectiveTo: b.EffectiveTo ? b.EffectiveTo.slice(0, 10) : '',
        note: b.Note || '',
      });
      setEditingHeader(false);
      const sps = await fetchPriceBookSpecial(id).catch(() => []);
      setSpecials(sps);
      const initInputs: Record<number, string> = {};
      sps.forEach(s => { initInputs[s.Id] = s.ApprovedPrice != null ? String(s.ApprovedPrice) : String(s.RequestedPrice || ''); });
      setSpApprovedInput(initInputs);
      if (canViewCost) {
        fetchActiveCostMap(b.EffectiveFrom ? b.EffectiveFrom.slice(0, 10) : undefined)
          .then(cm => setCostMap(cm.items || {}))
          .catch(() => setCostMap({}));
      }
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    }
  }, [canViewCost]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookList, goodsList] = await Promise.all([
        fetchPriceBooks(),
        fetchGoods({ forSale: true }).catch(() => [] as EMGood[]),
      ]);
      setBooks(bookList);
      setGoods(goodsList);
      if (bookList.length > 0 && !sel) {
        const activeBook = bookList.find(b => b.Status === 'ACTIVE') || bookList[0];
        if (activeBook) await open(activeBook.Id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [sel, open]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sock = socketService.connect();
    const handleRemoteUpdate = () => {
      void fetchPriceBooks().then(setBooks).catch(() => {});
      if (sel?.Id) {
        void open(sel.Id);
      }
    };
    sock.on('pricebook_updated', handleRemoteUpdate);
    return () => {
      sock.off('pricebook_updated', handleRemoteUpdate);
    };
  }, [sel?.Id, open]);

  useEffect(() => {
    if (targetGood) {
      setLineSearch(targetGood.goodName || targetGood.goodCode || targetGood.goodId || '');
      if (books.length > 0 && !sel) {
        const activeBook = books.find(b => b.Status === 'ACTIVE') || books[0];
        if (activeBook) void open(activeBook.Id);
      }
    }
  }, [targetGood, books, sel, open]);

  function openCreatePanel() {
    if (creating) {
      setCreating(false);
      return;
    }
    const next = suggestNextCycleDates(books);
    setForm({
      name: '',
      effectiveFrom: next.effectiveFrom,
      effectiveTo: next.effectiveTo,
      seedFromCurrent: true,
    });
    setCreating(true);
  }

  async function doCreate(targetStatus: 'ACTIVE' | 'DRAFT' = 'ACTIVE') {
    if (!form.name.trim()) {
      await appAlert('กรุณาระบุชื่อ Price Book', 'error');
      return;
    }
    if (!form.effectiveFrom || !form.effectiveTo) {
      await appAlert('กรุณาระบุวันที่เริ่มต้นและวันที่สิ้นสุด', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await createPriceBook({
        name: form.name.trim(),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo,
        effectiveMonth: form.effectiveFrom.slice(0, 7),
        seedFromCurrent: form.seedFromCurrent,
        status: targetStatus,
      });
      setCreating(false);
      await load();
      await open(r.id);
      if (r.winSpeedSynced) {
        await appAlert(
          r.docuNo
            ? `สร้างชุดราคาและบันทึกไปยัง WinSpeed (${r.docuNo}) เรียบร้อย`
            : 'สร้างชุดราคาและบันทึกไปยัง WinSpeed เรียบร้อย',
          'success'
        );
      }
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveHeader() {
    if (!sel) return;
    if (!headerDraft.name.trim()) {
      await appAlert('กรุณาระบุชื่อ Price Book', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await updatePriceBookHeader(sel.Id, {
        name: headerDraft.name.trim(),
        effectiveFrom: headerDraft.effectiveFrom || undefined,
        effectiveTo: headerDraft.effectiveTo || undefined,
        note: headerDraft.note.trim() || undefined,
      });
      setEditingHeader(false);
      await load();
      await open(sel.Id);
      await appAlert(
        res.winSpeedSynced
          ? 'บันทึกหัวตารางและอัปเดตไปยัง WinSpeed เรียบร้อย'
          : 'บันทึกหัวตารางเรียบร้อย',
        'success'
      );
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveLines() {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await setPriceBookLines(sel.Id, editableLines);
      await appAlert(
        res.winSpeedSynced
          ? 'บันทึกรายการราคาและอัปเดตไปยัง WinSpeed เรียบร้อย'
          : 'บันทึกรายการราคาเรียบร้อย',
        'success'
      );
      await load();
      await open(sel.Id);
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddFormula() {
    if (!sel || !addForm.goodId) return;
    const g = goods.find(x => String(x.GoodID) === String(addForm.goodId));
    const nextPrice = addForm.lineStatus === 'SUSPENDED' ? null : Number(addForm.price);
    if (addForm.lineStatus !== 'SUSPENDED' && (!Number.isFinite(nextPrice) || (nextPrice ?? 0) <= 0)) {
      await appAlert('กรุณาระบุราคาขายต่อตันมากกว่า 0', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await upsertPriceBookItem(sel.Id, {
        goodId: String(addForm.goodId),
        goodCode: g?.GoodCode || null,
        goodName: g?.GoodName || undefined,
        unit: 'ตัน',
        price: nextPrice,
        lineStatus: addForm.lineStatus,
        note: addForm.note.trim() || null,
      });
      setAddForm({ goodId: '', price: '', lineStatus: 'ACTIVE', note: '' });
      await open(sel.Id);
      await load();
      await appAlert(
        res.winSpeedSynced
          ? 'เพิ่ม/อัปเดตสูตรและบันทึกไปยัง WinSpeed เรียบร้อย'
          : 'เพิ่ม/อัปเดตสูตรเรียบร้อย',
        'success'
      );
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'approve' | 'activate' | 'archive') {
    if (!sel) return;
    const label = { approve: 'อนุมัติ', activate: 'เปิดใช้งาน (ACTIVE)', archive: 'เก็บเข้าคลัง' }[action];
    if (!await appConfirm(`ยืนยัน${label} Price Book "${sel.Name}"?`)) return;
    setBusy(true);
    try {
      const res = await priceBookAction(sel.Id, action);
      await load();
      await open(sel.Id);
      if (action === 'activate' && res.winSpeedSynced) {
        await appAlert('เปิดใช้งานและบันทึกไปยัง WinSpeed เรียบร้อย', 'success');
      }
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitSpecialReq() {
    if (!sel || !spForm.custId) {
      await appAlert('กรุณาเลือกร้านค้า/ลูกค้า', 'error');
      return;
    }
    setBusy(true);
    try {
      const matchedLine = editableLines.find(l => l.GoodId === spForm.goodId);
      const matchedGood = goods.find(g => String(g.GoodID) === String(spForm.goodId));
      await requestPriceBookSpecial(sel.Id, {
        custId: spForm.custId,
        custName: spForm.custName || undefined,
        goodId: spForm.goodId || undefined,
        goodName: matchedLine?.GoodName || matchedGood?.GoodName,
        requestedPrice: spForm.requestedPrice ? Number(spForm.requestedPrice) : undefined,
        note: spForm.note || undefined,
      });
      await appAlert('ยื่นคำขอราคาพิเศษเรียบร้อย', 'success');
      setSpForm({ custId: '', custName: '', goodId: '', requestedPrice: '', note: '' });
      const sps = await fetchPriceBookSpecial(sel.Id);
      setSpecials(sps);
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveSpecial(spId: number) {
    const val = spApprovedInput[spId];
    if (!val || isNaN(Number(val)) || Number(val) <= 0) {
      await appAlert('กรุณาระบุราคาอนุมัติเป็นตัวเลขมากกว่า 0', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await approvePriceBookSpecial(spId, Number(val));
      await appAlert(
        res.winSpeedSynced
          ? 'อนุมัติราคาพิเศษและ Sync กลับ WinSpeed เรียบร้อย'
          : 'อนุมัติราคาพิเศษเรียบร้อย',
        'success'
      );
      if (sel) {
        const sps = await fetchPriceBookSpecial(sel.Id);
        setSpecials(sps);
      }
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const isManagerOrAbove = ['MANAGER', 'ADMIN', 'C_LEVEL', 'ACCOUNTING'].includes(role);
  const canEditBook = Boolean(sel && canManagePricing && sel.Status !== 'ARCHIVED');

  const lineFormulaOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; sublabel?: string; keywords?: string }>();
    editableLines.forEach(l => {
      map.set(String(l.GoodId), {
        value: String(l.GoodId),
        label: l.GoodName || l.GoodId,
        sublabel: l.GoodCode ? `รหัส: ${l.GoodCode}` : `ID: ${l.GoodId}`,
        keywords: `${l.GoodId} ${l.GoodCode || ''} ${l.GoodName || ''}`,
      });
    });
    goods.forEach(g => {
      const key = String(g.GoodID);
      if (!map.has(key)) {
        map.set(key, {
          value: key,
          label: g.GoodName,
          sublabel: g.GoodCode ? `รหัส: ${g.GoodCode}` : undefined,
          keywords: `${g.GoodID} ${g.GoodCode} ${g.GoodName} ${g.GoodGroupName || ''}`,
        });
      }
    });
    return [...map.values()];
  }, [editableLines, goods]);

  const goodAddOptions = useMemo(() => (
    goods.map(g => ({
      value: String(g.GoodID),
      label: g.GoodName,
      sublabel: `${g.GoodCode}${g.GoodGroupName ? ` · ${g.GoodGroupName}` : ''}`,
      keywords: `${g.GoodID} ${g.GoodCode} ${g.GoodName} ${g.GoodGroupName || ''}`,
    }))
  ), [goods]);

  const filteredLines = useMemo(() => {
    const q = lineSearch.trim().toLowerCase();
    if (!q) return editableLines;
    return editableLines.filter(l =>
      String(l.GoodName || '').toLowerCase().includes(q) ||
      String(l.GoodCode || '').toLowerCase().includes(q) ||
      String(l.GoodId || '').toLowerCase().includes(q) ||
      String(l.GoodGroupName || '').toLowerCase().includes(q)
    );
  }, [editableLines, lineSearch]);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-[#0C447C]">
            <BookOpen size={18} /> Price Book (ตารางราคาขาย)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            แก้ไขราคาได้ทั้งแบบร่างและ ACTIVE · เชื่อมต่อสองทางกับ WinSpeed อัตโนมัติ · ห้ามตั้งราคาทับซ้อนวันและสินค้าเดียวกัน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManagePricing && (
            <button
              onClick={openCreatePanel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90"
            >
              <Plus size={15} /> สร้างใหม่
            </button>
          )}
          <button
            onClick={load}
            className="p-1.5 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      {targetGood && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between text-xs text-[#0C447C]">
          <span>
            กำลังกรองจากสินค้า: <strong>{targetGood.goodName || targetGood.goodCode || targetGood.goodId}</strong>
          </span>
          <button
            type="button"
            onClick={() => { setLineSearch(''); onClearTarget?.(); }}
            className="underline hover:text-red-600 font-semibold"
          >
            ล้างตัวกรอง
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-5 gap-0">
        {/* list */}
        <div className="md:col-span-2 border-r border-gray-200 overflow-y-auto p-4 space-y-2">
          {creating && canManagePricing && (
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-3 space-y-2">
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="ชื่อ Price Book เช่น ราคาประจำสัปดาห์ที่ 46 (11-17 พ.ย. 69)"
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>
                  <label className="block mb-1 font-medium">วันเริ่มต้น:</label>
                  <ThaiDatePicker
                    value={form.effectiveFrom}
                    onChange={val => setForm({ ...form, effectiveFrom: val })}
                    className="w-full border border-gray-200 rounded-lg py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">วันสิ้นสุด:</label>
                  <ThaiDatePicker
                    value={form.effectiveTo}
                    onChange={val => setForm({ ...form, effectiveTo: val })}
                    className="w-full border border-gray-200 rounded-lg py-1.5 text-xs"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                รองรับช่วงวงรอบถัดไป ล่วงหน้า หรือย้อนหลัง โดยต้องไม่ทับซ้อนวันและสินค้าเดียวกัน
              </p>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 pt-1">
                <input
                  type="checkbox"
                  checked={form.seedFromCurrent}
                  onChange={e => setForm({ ...form, seedFromCurrent: e.target.checked })}
                />
                ดึงราคาปัจจุบันเป็นค่าตั้งต้น
              </label>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => doCreate('DRAFT')}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  บันทึกแบบร่าง
                </button>
                <button
                  type="button"
                  onClick={() => doCreate('ACTIVE')}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"
                >
                  สร้างชุดราคา (ACTIVE)
                </button>
              </div>
            </div>
          )}

          {books.map(b => (
            <button
              key={b.Id}
              onClick={() => open(b.Id)}
              className={`w-full text-left bg-white rounded-xl border shadow-sm p-3 hover:border-[#0C447C] transition ${
                sel?.Id === b.Id ? 'border-[#0C447C] ring-1 ring-[#0C447C]' : 'border-gray-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-800 text-sm">{b.Name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${STATUS_COLOR[b.Status]}`}>{b.Status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {b.EffectiveFrom && b.EffectiveTo
                  ? `${formatThaiDate(b.EffectiveFrom)} ถึง ${formatThaiDate(b.EffectiveTo)}`
                  : b.EffectiveFrom
                    ? `ตั้งแต่ ${formatThaiDate(b.EffectiveFrom)}`
                    : `เดือน ${b.EffectiveMonth}`} · {b.LineCount ?? 0} รายการ
              </div>
            </button>
          ))}

          {!loading && books.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center space-y-3 bg-gray-50/50">
              <BookOpen size={32} className="mx-auto text-gray-400 opacity-60" />
              <div className="text-gray-600 text-sm font-semibold">ยังไม่มี Price Book ใน Sale-App</div>
              <p className="text-xs text-gray-400">ระบบจะซิงค์ข้อมูลจาก WinSpeed อัตโนมัติ หรือสร้างชุดราคาใหม่ได้ทันที</p>
              {canManagePricing && (
                <button
                  onClick={openCreatePanel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#0C447C] text-white hover:opacity-90 shadow-xs transition"
                >
                  <Plus size={14} /> สร้างชุดราคาใหม่
                </button>
              )}
            </div>
          )}
        </div>

        {/* detail */}
        <div className="md:col-span-3 overflow-y-auto p-4 space-y-4">
          {!sel ? (
            <div className="text-center text-gray-400 text-sm py-16">เลือก Price Book เพื่อดูรายละเอียด</div>
          ) : (
            <>
              {/* Header Info */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {!editingHeader ? (
                      <>
                        <div className="text-lg font-bold text-gray-800 flex items-center gap-2">
                          <span className="truncate">{sel.Name}</span>
                          {canEditBook && (
                            <button
                              type="button"
                              onClick={() => setEditingHeader(true)}
                              className="p-1 text-gray-400 hover:text-[#0C447C] rounded shrink-0"
                              title="แก้ไขชื่อและช่วงวันที่"
                            >
                              <Edit3 size={15} />
                            </button>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {sel.EffectiveFrom && sel.EffectiveTo
                            ? `ช่วงเวลา: ${formatThaiDate(sel.EffectiveFrom)} ถึง ${formatThaiDate(sel.EffectiveTo)}`
                            : `เดือน ${sel.EffectiveMonth}`} · {editableLines.length} รายการสินค้า
                        </div>
                        {sel.WinSpeedSyncAt && (
                          <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Sync WinSpeed ล่าสุด: {formatThaiDate(sel.WinSpeedSyncAt, true)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2 bg-blue-50/40 p-3 rounded-xl border border-blue-100">
                        <input
                          value={headerDraft.name}
                          onChange={e => setHeaderDraft({ ...headerDraft, name: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold bg-white"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <ThaiDatePicker
                            value={headerDraft.effectiveFrom}
                            onChange={v => setHeaderDraft({ ...headerDraft, effectiveFrom: v })}
                            className="w-full border border-gray-300 rounded-lg py-1 text-xs bg-white"
                          />
                          <ThaiDatePicker
                            value={headerDraft.effectiveTo}
                            onChange={v => setHeaderDraft({ ...headerDraft, effectiveTo: v })}
                            className="w-full border border-gray-300 rounded-lg py-1 text-xs bg-white"
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setEditingHeader(false)}
                            className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 bg-white text-gray-600"
                          >
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={saveHeader}
                            className="px-3 py-1 text-xs rounded-lg bg-[#0C447C] text-white font-semibold"
                          >
                            บันทึก
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 ${STATUS_COLOR[sel.Status]}`}>{sel.Status}</span>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {canManagePricing && sel.Status === 'DRAFT' && (
                    <button onClick={() => act('approve')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:opacity-90 disabled:opacity-40">
                      <CheckCircle2 size={15} /> อนุมัติ
                    </button>
                  )}
                  {canManagePricing && (sel.Status === 'APPROVED' || sel.Status === 'DRAFT') && (
                    <button onClick={() => act('activate')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-600 text-white hover:opacity-90 disabled:opacity-40">
                      <Rocket size={15} /> เปิดใช้งาน
                    </button>
                  )}
                  {canManagePricing && sel.Status === 'ACTIVE' && (
                    <button onClick={() => act('archive')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      <Archive size={15} /> เก็บเข้าคลัง
                    </button>
                  )}
                </div>
              </div>

              {/* Price Book Lines Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Tag size={16} /> รายการราคาขาย ({filteredLines.length}/{editableLines.length})
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={lineSearch}
                        onChange={e => setLineSearch(e.target.value)}
                        placeholder="กรองสูตร / รหัส..."
                        className="border border-gray-200 rounded-lg pl-8 pr-3 py-1 text-xs w-44"
                      />
                    </div>
                    {canEditBook && (
                      <button
                        onClick={saveLines}
                        disabled={busy}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        <Save size={14} /> บันทึกรายการ
                      </button>
                    )}
                  </div>
                </div>

                {canEditBook && (
                  <div className="px-4 py-2.5 bg-gray-50/70 border-b border-gray-100 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-5">
                      <SearchableSelect
                        options={goodAddOptions}
                        value={addForm.goodId}
                        onChange={val => setAddForm(prev => ({ ...prev, goodId: val }))}
                        placeholder="+ เพิ่มหรืออัปเดตสูตรสินค้า..."
                        searchPlaceholder="พิมพ์ค้นหาสูตร หรือรหัสสินค้า..."
                        allowClear
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <SearchableSelect
                        options={LINE_STATUS_OPTIONS}
                        value={addForm.lineStatus}
                        onChange={val => setAddForm(prev => ({ ...prev, lineStatus: (val || 'ACTIVE') as 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED' }))}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="number"
                        disabled={addForm.lineStatus === 'SUSPENDED'}
                        placeholder="ราคา (฿/ตัน)"
                        value={addForm.lineStatus === 'SUSPENDED' ? '' : addForm.price}
                        onChange={e => setAddForm(prev => ({ ...prev, price: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white disabled:bg-gray-100"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        disabled={busy || !addForm.goodId}
                        onClick={handleAddFormula}
                        className="w-full px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#0C447C] text-white disabled:opacity-40"
                      >
                        เพิ่มรายการ
                      </button>
                    </div>
                  </div>
                )}

                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm min-w-full">
                    <thead className="sticky top-0 z-10 whitespace-nowrap bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">สูตรสินค้า</th>
                        <th className="text-left px-3 py-2">สถานะบรรทัด</th>
                        {canViewCost && <th className="text-right px-3 py-2 text-rose-700">ราคาทุน (฿)</th>}
                        <th className="text-right px-3 py-2">ราคาขาย/ตัน (฿)</th>
                        <th className="text-left px-3 py-2">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredLines.map(l => {
                        const actualIdx = editableLines.findIndex(x => x.GoodId === l.GoodId);
                        const statusKey = l.LineStatus || 'ACTIVE';
                        const badge = LINE_STATUS_BADGE[statusKey] || LINE_STATUS_BADGE.ACTIVE;
                        const refCost = costMap[String(l.GoodId)];

                        return (
                          <tr key={`${l.Id || l.GoodId}`} className={statusKey === 'SUSPENDED' ? 'bg-red-50/30' : statusKey === 'DISCONTINUING' ? 'bg-amber-50/20' : ''}>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-gray-800">{l.GoodName || l.GoodId}</div>
                              <div className="text-[11px] text-gray-400">{l.GoodCode || l.GoodId}</div>
                            </td>
                            <td className="px-3 py-2 w-44">
                              {canEditBook ? (
                                <SearchableSelect
                                  options={LINE_STATUS_OPTIONS}
                                  value={statusKey}
                                  onChange={val => {
                                    const nextStatus = (val || 'ACTIVE') as 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED';
                                    const updated = [...editableLines];
                                    if (actualIdx >= 0) {
                                      updated[actualIdx] = {
                                        ...updated[actualIdx],
                                        LineStatus: nextStatus,
                                        Price: nextStatus === 'SUSPENDED' ? null : (updated[actualIdx].Price ?? 0),
                                      };
                                      setEditableLines(updated);
                                    }
                                  }}
                                />
                              ) : (
                                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${badge.style}`}>
                                  {badge.label}
                                </span>
                              )}
                            </td>
                            {canViewCost && (
                              <td className="px-3 py-2 text-right text-xs font-mono text-rose-700">
                                {refCost != null ? `฿${Number(refCost).toLocaleString()}` : '—'}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right">
                              {canEditBook ? (
                                statusKey === 'SUSPENDED' ? (
                                  <span className="text-xs text-red-500 font-semibold italic">งดขาย</span>
                                ) : (
                                  <input
                                    type="number"
                                    value={l.Price ?? ''}
                                    onChange={e => {
                                      const updated = [...editableLines];
                                      if (actualIdx >= 0) {
                                        updated[actualIdx] = { ...updated[actualIdx], Price: e.target.value ? Number(e.target.value) : 0 };
                                        setEditableLines(updated);
                                      }
                                    }}
                                    className="w-28 text-right border border-gray-200 rounded px-2 py-1 text-xs font-semibold bg-white"
                                  />
                                )
                              ) : (
                                statusKey === 'SUSPENDED' ? (
                                  <span className="text-xs text-red-500 font-semibold">งดขาย</span>
                                ) : (
                                  <span className="font-semibold text-gray-800">฿{l.Price != null ? Number(l.Price).toLocaleString() : '—'}</span>
                                )
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {canEditBook ? (
                                <input
                                  type="text"
                                  value={l.Note || ''}
                                  placeholder="หมายเหตุ..."
                                  onChange={e => {
                                    const updated = [...editableLines];
                                    if (actualIdx >= 0) {
                                      updated[actualIdx] = { ...updated[actualIdx], Note: e.target.value };
                                      setEditableLines(updated);
                                    }
                                  }}
                                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-gray-600"
                                />
                              ) : (
                                <span className="text-xs text-gray-500">{l.Note || '—'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Special Prices Section (ราคาพิเศษรายร้านค้า) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <div className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                    <UserCheck size={16} className="text-blue-600" /> ร้านค้าที่ขอราคาเป็นกรณีพิเศษสำหรับรอบนี้ ({specials.length})
                  </div>
                </div>

                {/* Submit Special Price Request Form with CustomerAutocomplete & SearchableSelect */}
                <div className="bg-blue-50/40 rounded-xl p-3 border border-blue-100 space-y-2">
                  <div className="text-xs font-semibold text-blue-900">ยื่นคำขอราคาพิเศษรายร้านค้า:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-4">
                      <CustomerAutocomplete
                        value={spForm.custId}
                        custName={spForm.custName}
                        onChange={c => setSpForm(prev => ({
                          ...prev,
                          custId: c ? c.custId : '',
                          custName: c ? c.custName : '',
                        }))}
                        placeholder="ค้นหารหัสหรือชื่อร้านค้า..."
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <SearchableSelect
                        options={lineFormulaOptions}
                        value={spForm.goodId}
                        onChange={val => setSpForm(prev => ({ ...prev, goodId: val }))}
                        placeholder="-- เลือกสูตร (พิมพ์ค้นหา) --"
                        searchPlaceholder="พิมพ์ค้นหาสูตรหรือรหัสสินค้า..."
                        allowClear
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="number"
                        placeholder="ราคาที่ขอ (฿/ตัน)"
                        value={spForm.requestedPrice}
                        onChange={e => setSpForm({ ...spForm, requestedPrice: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        onClick={submitSpecialReq}
                        disabled={busy || !spForm.custId}
                        className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"
                      >
                        ส่งคำขอ
                      </button>
                    </div>
                  </div>
                </div>

                {/* Special Price Request List */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase font-semibold">
                      <tr>
                        <th className="text-left px-3 py-2">ร้านค้า</th>
                        <th className="text-left px-3 py-2">สูตรปุ๋ย</th>
                        <th className="text-right px-3 py-2">ราคาขอ</th>
                        <th className="text-right px-3 py-2">ราคาอนุมัติ</th>
                        <th className="text-left px-3 py-2">ผู้ยื่น / ผู้อนุมัติ</th>
                        <th className="text-center px-3 py-2">การดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {specials.map(s => {
                        const isApproved = s.ApprovedPrice != null;
                        const isRequester = user?.id === s.RequestedBy;

                        return (
                          <tr key={s.Id} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2">
                              <div className="font-semibold text-gray-800">{s.CustName || s.CustId}</div>
                              <div className="text-[10px] text-gray-400">{s.CustId}</div>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{s.GoodName || s.GoodId || 'ทุกสูตร'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-amber-600">
                              {s.RequestedPrice != null ? `฿${Number(s.RequestedPrice).toLocaleString()}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {isManagerOrAbove && !isApproved ? (
                                <input
                                  type="number"
                                  value={spApprovedInput[s.Id] || ''}
                                  onChange={e => setSpApprovedInput({ ...spApprovedInput, [s.Id]: e.target.value })}
                                  className="w-24 text-right border border-gray-200 rounded px-1.5 py-1 text-xs font-bold text-green-700 bg-white"
                                />
                              ) : (
                                <span className={`font-bold ${isApproved ? 'text-green-600' : 'text-gray-400'}`}>
                                  {isApproved ? `฿${Number(s.ApprovedPrice).toLocaleString()}` : 'รออนุมัติ'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-500">
                              <div>ยื่นโดย: {s.RequestedByName || '—'}</div>
                              {isApproved && <div className="text-[10px] text-green-600">อนุมัติโดย: {s.ApprovedByName}</div>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {isManagerOrAbove ? (
                                isRequester && role !== 'ADMIN' ? (
                                  <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 flex items-center justify-center gap-1">
                                    <AlertTriangle size={11} /> ห้ามอนุมัติตัวเอง
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleApproveSpecial(s.Id)}
                                    disabled={busy}
                                    className="px-2 py-1 rounded text-[11px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                                  >
                                    {isApproved ? 'ปรับปรุงราคา' : 'อนุมัติ'}
                                  </button>
                                )
                              ) : (
                                <span className="text-[10px] text-gray-400">{isApproved ? 'อนุมัติแล้ว' : 'รอ Manager'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {specials.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-gray-400">ยังไม่มีรายการขอราคาพิเศษ</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit Log */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                  <FileClock size={15} /> ประวัติ (Audit)
                </div>
                <div className="space-y-1.5">
                  {sel.audit.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700">{a.Action}</span>
                      {a.FromStatus && <span>{a.FromStatus}→{a.ToStatus}</span>}
                      <span>· {a.ByName || '—'}</span>
                      <span>· {formatThaiDate(a.At, true)}</span>
                      {a.Note && <span className="text-gray-400">· {a.Note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
