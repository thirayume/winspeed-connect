import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShieldAlert, RefreshCw, Plus, CheckCircle2, Rocket, Archive,
  FileClock, Save, Search, Edit3, Lock, FileSpreadsheet,
} from 'lucide-react';
import {
  fetchCostBooks, fetchCostBook, createCostBook, updateCostBookHeader,
  setCostBookLines, upsertCostBookItem, costBookAction, fetchGoods,
  type CostBook, type CostBookLine, type CostBookAuditRow,
} from '../../services/api';
import type { EMGood } from '../../types';
import { useAuthStore } from '../../store/auth-store';
import { useAppStore } from '../../store/app-store';
import { appAlert, appConfirm } from '../ui/AppAlert';
import { ThaiDatePicker } from '../ui/ThaiDatePicker';
import { SearchableSelect } from '../ui/SearchableSelect';
import { bangkokDate, formatThaiDate } from '../../utils/date';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  APPROVED: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-gray-100 text-gray-400',
};

type CostDetail = CostBook & { lines: CostBookLine[]; audit: CostBookAuditRow[] };

export function CostBookManager() {
  const user = useAuthStore(s => s.user);
  const navigate = useAppStore(s => s.navigate);
  const actions = user?.capabilities?.actions;
  const role = user?.role || '';
  const canManageCost = actions ? actions.includes('cost.manage') : ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'].includes(role);

  const [books, setBooks] = useState<CostBook[]>([]);
  const [sel, setSel] = useState<CostDetail | null>(null);
  const [editableLines, setEditableLines] = useState<CostBookLine[]>([]);
  const [goods, setGoods] = useState<EMGood[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    effectiveFrom: bangkokDate(0),
    effectiveTo: bangkokDate(-7),
    seedFromCurrent: true,
    seedAllGoods: true,
    note: '',
  });

  const [editingHeader, setEditingHeader] = useState(false);
  const [headerDraft, setHeaderDraft] = useState({
    name: '',
    effectiveFrom: '',
    effectiveTo: '',
    note: '',
  });

  const [lineSearch, setLineSearch] = useState('');
  const [addForm, setAddForm] = useState({ goodId: '', costPrice: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookList, goodsList] = await Promise.all([
        fetchCostBooks(),
        fetchGoods({ forSale: true }).catch(() => [] as EMGood[]),
      ]);
      setBooks(bookList);
      setGoods(goodsList);
    } catch (e: unknown) {
      await appAlert((e as Error).message || 'โหลด Costlist ไม่สำเร็จ', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id: number) => {
    try {
      const b = await fetchCostBook(id);
      setSel(b);
      setEditableLines(b.lines || []);
      setHeaderDraft({
        name: b.Name || '',
        effectiveFrom: b.EffectiveFrom ? b.EffectiveFrom.slice(0, 10) : '',
        effectiveTo: b.EffectiveTo ? b.EffectiveTo.slice(0, 10) : '',
        note: b.Note || '',
      });
      setEditingHeader(false);
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    }
  }, []);

  async function doCreate() {
    if (!form.name.trim()) {
      await appAlert('กรุณาระบุชื่อ Costlist', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await createCostBook({
        name: form.name.trim(),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo,
        effectiveMonth: form.effectiveFrom.slice(0, 7),
        seedFromCurrent: form.seedFromCurrent,
        seedAllGoods: form.seedAllGoods,
        note: form.note.trim() || undefined,
      });
      setCreating(false);
      setForm({
        name: '',
        effectiveFrom: bangkokDate(0),
        effectiveTo: bangkokDate(-7),
        seedFromCurrent: true,
        seedAllGoods: true,
        note: '',
      });
      await load();
      await open(r.id);
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveHeader() {
    if (!sel) return;
    if (!headerDraft.name.trim()) {
      await appAlert('กรุณาระบุชื่อ Costlist', 'error');
      return;
    }
    setBusy(true);
    try {
      await updateCostBookHeader(sel.Id, {
        name: headerDraft.name.trim(),
        effectiveFrom: headerDraft.effectiveFrom || undefined,
        effectiveTo: headerDraft.effectiveTo || undefined,
        note: headerDraft.note.trim() || undefined,
      });
      setEditingHeader(false);
      await load();
      await open(sel.Id);
      await appAlert('บันทึกข้อมูลรอบ Costlist เรียบร้อย', 'success');
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveAllLines() {
    if (!sel) return;
    setBusy(true);
    try {
      await setCostBookLines(sel.Id, editableLines);
      await appAlert('บันทึกรายการราคาทุนเรียบร้อย', 'success');
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
    const cp = addForm.costPrice.trim() ? Number(addForm.costPrice) : null;
    if (cp !== null && (!Number.isFinite(cp) || cp <= 0)) {
      await appAlert('ราคาทุนต้องมากกว่า 0', 'error');
      return;
    }
    setBusy(true);
    try {
      await upsertCostBookItem(sel.Id, {
        goodId: String(addForm.goodId),
        goodCode: g?.GoodCode || null,
        goodName: g?.GoodName || undefined,
        unit: 'ตัน',
        costPrice: cp,
        note: addForm.note.trim() || null,
      });
      setAddForm({ goodId: '', costPrice: '', note: '' });
      await open(sel.Id);
      await load();
      await appAlert('เพิ่ม/อัปเดตรายการราคาทุนเรียบร้อย', 'success');
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'approve' | 'activate' | 'archive') {
    if (!sel) return;
    const label = { approve: 'อนุมัติ', activate: 'เปิดใช้งานเป็นเกณฑ์ควบคุม (ACTIVE)', archive: 'เก็บเข้าคลัง' }[action];
    if (!await appConfirm(`ยืนยัน${label} Costlist "${sel.Name}"?`)) return;
    setBusy(true);
    try {
      await costBookAction(sel.Id, action);
      await load();
      await open(sel.Id);
    } catch (e: unknown) {
      await appAlert((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const goodOptions = useMemo(() => (
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

  const canEditSelected = Boolean(sel && canManageCost && sel.Status !== 'ARCHIVED');

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header Banner */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-rose-50/40">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-rose-900">
            <Lock size={18} className="text-rose-700" /> Cost Book (ตารางราคาทุน)
          </h2>
          <p className="text-xs text-rose-700/80 mt-0.5 flex items-center gap-1.5">
            <ShieldAlert size={13} />
            ข้อมูลลับ: ใช้เป็นเส้นกำกับห้ามจำหน่ายต่ำกว่าราคาทุนทุกกรณี โดยไม่แสดงคำว่า "ราคาทุน" ให้ฝ่ายขายเห็น
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('reports')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-200 bg-white text-rose-800 hover:bg-rose-50"
          >
            <FileSpreadsheet size={14} /> รายงาน Costlist
          </button>
          {canManageCost && (
            <button
              onClick={() => setCreating(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-rose-700 text-white hover:bg-rose-800"
            >
              <Plus size={15} /> สร้างรอบราคาทุน
            </button>
          )}
          <button
            onClick={load}
            className="p-1.5 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            title="รีเฟรช"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-5 gap-0">
        {/* CostBook List */}
        <div className="md:col-span-2 border-r border-gray-200 overflow-y-auto p-4 space-y-2">
          {creating && canManageCost && (
            <div className="bg-white rounded-xl border border-rose-200 shadow-sm p-3 space-y-2.5">
              <div className="text-xs font-bold text-rose-900">สร้างรอบราคาทุนใหม่ (DRAFT)</div>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น ต้นทุนประจำสัปดาห์ที่ 46 (11-17 พ.ย. 69)"
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>
                  <label className="block mb-1 font-medium">วันเริ่มต้น:</label>
                  <ThaiDatePicker
                    value={form.effectiveFrom}
                    onChange={v => setForm({ ...form, effectiveFrom: v })}
                    className="w-full border border-gray-200 rounded-lg py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">วันสิ้นสุด:</label>
                  <ThaiDatePicker
                    value={form.effectiveTo}
                    onChange={v => setForm({ ...form, effectiveTo: v })}
                    className="w-full border border-gray-200 rounded-lg py-1.5 text-xs"
                  />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={form.seedFromCurrent}
                  onChange={e => setForm({ ...form, seedFromCurrent: e.target.checked })}
                />
                คัดลอกรายการจาก Costlist ล่าสุด
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={form.seedAllGoods}
                  onChange={e => setForm({ ...form, seedAllGoods: e.target.checked })}
                />
                ดึงรายการปุ๋ยที่ใช้งานทั้งหมด (หากยังไม่มีรอบก่อนหน้า)
              </label>
              <button
                onClick={doCreate}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-40"
              >
                สร้าง Costlist (DRAFT)
              </button>
            </div>
          )}

          {books.map(b => (
            <button
              key={b.Id}
              onClick={() => open(b.Id)}
              className={`w-full text-left bg-white rounded-xl border shadow-sm p-3 hover:border-rose-700 transition ${
                sel?.Id === b.Id ? 'border-rose-700 ring-1 ring-rose-700' : 'border-gray-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-800 text-sm">{b.Name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${STATUS_COLOR[b.Status]}`}>
                  {b.Status}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {b.EffectiveFrom && b.EffectiveTo
                  ? `${formatThaiDate(b.EffectiveFrom)} ถึง ${formatThaiDate(b.EffectiveTo)}`
                  : b.EffectiveFrom
                    ? `ตั้งแต่ ${formatThaiDate(b.EffectiveFrom)}`
                    : `เดือน ${b.EffectiveMonth}`}
                {' · '}
                {b.PricedCount ?? 0}/{b.LineCount ?? 0} รายการมีราคาทุน
              </div>
            </button>
          ))}

          {!loading && books.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center space-y-2 bg-gray-50/50 text-sm text-gray-500">
              ยังไม่มีตารางราคาทุนในระบบ กด "สร้างรอบราคาทุน" เพื่อเริ่มต้นกำหนดเกณฑ์ราคา
            </div>
          )}
        </div>

        {/* CostBook Detail */}
        <div className="md:col-span-3 overflow-y-auto p-4 space-y-4">
          {!sel ? (
            <div className="text-center text-gray-400 text-sm py-16">เลือก Costlist เพื่อดูหรือแก้ไขราคาทุน</div>
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    {!editingHeader ? (
                      <>
                        <div className="text-lg font-bold text-gray-800 flex items-center gap-2">
                          <span>{sel.Name}</span>
                          {canEditSelected && (
                            <button
                              type="button"
                              onClick={() => setEditingHeader(true)}
                              className="p-1 text-gray-400 hover:text-rose-700 rounded"
                              title="แก้ไขชื่อและช่วงวันที่"
                            >
                              <Edit3 size={14} />
                            </button>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {sel.EffectiveFrom && sel.EffectiveTo
                            ? `ช่วงเวลา: ${formatThaiDate(sel.EffectiveFrom)} ถึง ${formatThaiDate(sel.EffectiveTo)}`
                            : `เดือน ${sel.EffectiveMonth}`}
                          {' · '}
                          {editableLines.length} รายการสินค้า
                        </div>
                      </>
                    ) : (
                      <div className="space-y-2 bg-rose-50/40 p-3 rounded-xl border border-rose-100">
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
                            className="px-3 py-1 text-xs rounded-lg bg-rose-700 text-white font-semibold"
                          >
                            บันทึกหัวตาราง
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLOR[sel.Status]}`}>
                    {sel.Status}
                  </span>
                </div>

                {canManageCost && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {sel.Status === 'DRAFT' && (
                      <button
                        onClick={() => act('approve')}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:opacity-90 disabled:opacity-40"
                      >
                        <CheckCircle2 size={15} /> อนุมัติ
                      </button>
                    )}
                    {(sel.Status === 'APPROVED' || sel.Status === 'DRAFT') && (
                      <button
                        onClick={() => act('activate')}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-600 text-white hover:opacity-90 disabled:opacity-40"
                      >
                        <Rocket size={15} /> เปิดใช้งาน (ACTIVE)
                      </button>
                    )}
                    {sel.Status === 'ACTIVE' && (
                      <button
                        onClick={() => act('archive')}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                      >
                        <Archive size={15} /> เก็บเข้าคลัง
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Add Formula Row + Filter */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-700">
                    รายการราคาทุนต่อตัน ({filteredLines.length}/{editableLines.length})
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={lineSearch}
                        onChange={e => setLineSearch(e.target.value)}
                        placeholder="กรองสูตร / รหัส..."
                        className="border border-gray-200 rounded-lg pl-8 pr-3 py-1 text-xs w-48"
                      />
                    </div>
                    {canEditSelected && (
                      <button
                        onClick={saveAllLines}
                        disabled={busy}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-40"
                      >
                        <Save size={14} /> บันทึกทั้งหมด
                      </button>
                    )}
                  </div>
                </div>

                {canEditSelected && (
                  <div className="px-4 py-2.5 bg-gray-50/70 border-b border-gray-100 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-5">
                      <SearchableSelect
                        options={goodOptions}
                        value={addForm.goodId}
                        onChange={val => setAddForm(prev => ({ ...prev, goodId: val }))}
                        placeholder="+ เพิ่มหรืออัปเดตสูตรปุ๋ย..."
                        searchPlaceholder="พิมพ์ชื่อสูตรหรือรหัสสินค้า..."
                        allowClear
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        type="number"
                        placeholder="ราคาทุน (บาท/ตัน)"
                        value={addForm.costPrice}
                        onChange={e => setAddForm(prev => ({ ...prev, costPrice: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        placeholder="หมายเหตุ"
                        value={addForm.note}
                        onChange={e => setAddForm(prev => ({ ...prev, note: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
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
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">รหัส / สูตรสินค้า</th>
                        <th className="text-left px-3 py-2">หมวด</th>
                        <th className="text-right px-3 py-2">ราคาทุน/ตัน (฿)</th>
                        <th className="text-left px-3 py-2">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredLines.map(l => {
                        const actualIdx = editableLines.findIndex(x => x.GoodId === l.GoodId);
                        return (
                          <tr key={`${l.Id || l.GoodId}`}>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-gray-800">{l.GoodName || l.GoodId}</div>
                              <div className="text-[11px] text-gray-400">{l.GoodCode || l.GoodId}</div>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500">{l.GoodGroupName || 'ปุ๋ย'}</td>
                            <td className="px-3 py-2 text-right">
                              {canEditSelected ? (
                                <input
                                  type="number"
                                  value={l.CostPrice ?? ''}
                                  placeholder="ยังไม่ระบุ"
                                  onChange={e => {
                                    const val = e.target.value ? Number(e.target.value) : null;
                                    const next = [...editableLines];
                                    if (actualIdx >= 0) {
                                      next[actualIdx] = { ...next[actualIdx], CostPrice: val };
                                      setEditableLines(next);
                                    }
                                  }}
                                  className="w-28 text-right border border-gray-200 rounded px-2 py-1 text-xs font-semibold text-rose-900 bg-white"
                                />
                              ) : (
                                <span className="font-semibold text-rose-900">
                                  {l.CostPrice != null ? `฿${Number(l.CostPrice).toLocaleString()}` : '—'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {canEditSelected ? (
                                <input
                                  type="text"
                                  value={l.Note || ''}
                                  placeholder="หมายเหตุ..."
                                  onChange={e => {
                                    const next = [...editableLines];
                                    if (actualIdx >= 0) {
                                      next[actualIdx] = { ...next[actualIdx], Note: e.target.value };
                                      setEditableLines(next);
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
                      {filteredLines.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-400">
                            ไม่พบรายการสินค้า
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit Trail */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                  <FileClock size={15} /> ประวัติการแก้ไข (Audit)
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

