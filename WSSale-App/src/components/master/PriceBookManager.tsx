import { useEffect, useState, useCallback } from 'react';
import { BookOpen, RefreshCw, Plus, CheckCircle2, Rocket, Archive, FileClock, Tag, Save, UserCheck, AlertTriangle, Layers, X, Check } from 'lucide-react';
import {
  fetchPriceBooks, fetchPriceBook, createPriceBook, priceBookAction, setPriceBookLines,
  fetchPriceBookSpecial, requestPriceBookSpecial, approvePriceBookSpecial,
  fetchWinSpeedPriceSets, syncWinSpeedPriceSets,
  type PriceBook, type PriceBookLine, type PriceBookAuditRow, type PriceBookSpecialPrice,
  type WinSpeedPriceSet,
} from '../../services/api';
import { useAuthStore } from '../../store/auth-store';
import { appConfirm } from '../ui/AppAlert';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', APPROVED: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700', ARCHIVED: 'bg-gray-100 text-gray-400',
};

const LINE_STATUS_BADGE: Record<string, { label: string; style: string }> = {
  ACTIVE: { label: 'ปกติ', style: 'bg-green-50 text-green-700 border-green-200' },
  DISCONTINUING: { label: 'กำลังยกเลิก (***)', style: 'bg-amber-50 text-amber-700 border-amber-200 font-bold' },
  SUSPENDED: { label: 'งดขาย', style: 'bg-red-50 text-red-700 border-red-200 font-bold' },
};

type Detail = PriceBook & { lines: PriceBookLine[]; audit: PriceBookAuditRow[] };

export function PriceBookManager() {
  const user = useAuthStore(s => s.user);
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [sel, setSel] = useState<Detail | null>(null);
  const [editableLines, setEditableLines] = useState<PriceBookLine[]>([]);
  const [specials, setSpecials] = useState<PriceBookSpecialPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    seedFromCurrent: true
  });

  // Special Price Form
  const [spForm, setSpForm] = useState({ custId: '', custName: '', goodId: '', requestedPrice: '', note: '' });
  const [spApprovedInput, setSpApprovedInput] = useState<Record<number, string>>({});

  // WinSpeed Sync State
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [winSpeedSets, setWinSpeedSets] = useState<WinSpeedPriceSet[]>([]);
  const [winSpeedLoading, setWinSpeedLoading] = useState(false);
  const [selectedSetIds, setSelectedSetIds] = useState<number[]>([]);
  const [syncForm, setSyncForm] = useState({
    name: '',
    effectiveFrom: '2026-11-09',
    effectiveTo: '2026-11-30',
  });

  const loadWinSpeedSets = useCallback(async () => {
    setWinSpeedLoading(true);
    try {
      const sets = await fetchWinSpeedPriceSets();
      setWinSpeedSets(sets);
      // Auto-select active general sets (CustID is null)
      const activeGeneral = sets.filter(s => !s.CustID && s.IsActivePeriod === 1).map(s => s.SetPriceID);
      setSelectedSetIds(activeGeneral.length > 0 ? activeGeneral : sets.slice(0, 2).map(s => s.SetPriceID));
      if (sets.length > 0) {
        const first = sets[0];
        setSyncForm(prev => ({
          ...prev,
          effectiveFrom: first.BeginDate ? first.BeginDate.slice(0, 10) : prev.effectiveFrom,
          effectiveTo: first.EndDate ? first.EndDate.slice(0, 10) : prev.effectiveTo,
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setWinSpeedLoading(false);
    }
  }, []);

  async function handleSyncWinSpeed(targetStatus: 'ACTIVE' | 'DRAFT' = 'ACTIVE') {
    if (selectedSetIds.length === 0) {
      alert('กรุณาเลือกชุดราคา WinSpeed อย่างน้อย 1 ชุด');
      return;
    }
    setBusy(true);
    try {
      const res = await syncWinSpeedPriceSets({
        setPriceIds: selectedSetIds,
        name: syncForm.name.trim() || undefined,
        status: targetStatus,
        effectiveFrom: syncForm.effectiveFrom,
        effectiveTo: syncForm.effectiveTo,
      });
      alert(`ซิงค์ตารางราคา WinSpeed สำเร็จ (${res.lineCount} รายการ, สถานะ ${res.status})`);
      setSyncModalOpen(false);
      await load();
      await open(res.priceBookId);
    } catch (e: unknown) {
      alert((e as Error).message || 'ซิงค์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try { setBooks(await fetchPriceBooks()); } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function open(id: number) {
    try {
      const b = await fetchPriceBook(id);
      setSel(b);
      setEditableLines(b.lines ? b.lines.map(l => ({ ...l, lineStatus: l.LineStatus || 'ACTIVE' })) : []);
      const sps = await fetchPriceBookSpecial(id).catch(() => []);
      setSpecials(sps);
      const initInputs: Record<number, string> = {};
      sps.forEach(s => { initInputs[s.Id] = s.ApprovedPrice != null ? String(s.ApprovedPrice) : String(s.RequestedPrice || ''); });
      setSpApprovedInput(initInputs);
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  }

  async function doCreate() {
    if (!form.name) { alert('ใส่ชื่อ Price Book'); return; }
    setBusy(true);
    try {
      const r = await createPriceBook({
        name: form.name,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo,
        effectiveMonth: form.effectiveFrom.slice(0, 7),
        seedFromCurrent: form.seedFromCurrent,
      });
      setCreating(false);
      setForm({
        name: '',
        effectiveFrom: new Date().toISOString().slice(0, 10),
        effectiveTo: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        seedFromCurrent: true,
      });
      await load();
      await open(r.id);
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function saveLines() {
    if (!sel) return;
    setBusy(true);
    try {
      await setPriceBookLines(sel.Id, editableLines);
      alert('บันทึกรายการราคาเรียบร้อย');
      await open(sel.Id);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'approve' | 'activate' | 'archive') {
    if (!sel) return;
    const label = { approve: 'อนุมัติ', activate: 'เปิดใช้งาน (ACTIVE)', archive: 'เก็บเข้าคลัง' }[action];
    if (!await appConfirm(`ยืนยัน${label} Price Book "${sel.Name}"?`)) return;
    setBusy(true);
    try { await priceBookAction(sel.Id, action); await load(); await open(sel.Id); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function submitSpecialReq() {
    if (!sel || !spForm.custId) { alert('กรุณาระบุรหัสลูกค้า'); return; }
    setBusy(true);
    try {
      await requestPriceBookSpecial(sel.Id, {
        custId: spForm.custId,
        custName: spForm.custName || undefined,
        goodId: spForm.goodId || undefined,
        goodName: editableLines.find(l => l.GoodId === spForm.goodId)?.GoodName,
        requestedPrice: spForm.requestedPrice ? Number(spForm.requestedPrice) : undefined,
        note: spForm.note || undefined,
      });
      alert('ยื่นคำขอราคาพิเศษเรียบร้อย');
      setSpForm({ custId: '', custName: '', goodId: '', requestedPrice: '', note: '' });
      const sps = await fetchPriceBookSpecial(sel.Id);
      setSpecials(sps);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveSpecial(spId: number) {
    const val = spApprovedInput[spId];
    if (!val || isNaN(Number(val)) || Number(val) <= 0) {
      alert('กรุณาระบุราคาอนุมัติเป็นตัวเลขมากกว่า 0');
      return;
    }
    setBusy(true);
    try {
      await approvePriceBookSpecial(spId, Number(val));
      alert('อนุมัติราคาพิเศษเรียบร้อย');
      if (sel) {
        const sps = await fetchPriceBookSpecial(sel.Id);
        setSpecials(sps);
      }
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isManagerOrAbove = ['MANAGER', 'ADMIN', 'C_LEVEL'].includes(user?.role || '');

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 bg-gray-50/50">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-[#0C447C]"><BookOpen size={18} /> Price Book (ตารางราคา)</h2>
          <p className="text-xs text-gray-500 mt-0.5">ร่าง → อนุมัติ → เปิดใช้งาน · สถานะบรรทัด (ปกติ/กำลังยกเลิก ***/งดขาย) และราคาพิเศษรายร้านค้า</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setSyncModalOpen(true); loadWinSpeedSets(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition"
          >
            <Rocket size={15} /> ซิงค์จาก WinSpeed
          </button>
          <button onClick={() => setCreating(!creating)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90"><Plus size={15} /> สร้างใหม่</button>
          <button onClick={load} className="p-1.5 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50"><RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-5 gap-0">
        {/* list */}
        <div className="md:col-span-2 border-r border-gray-200 overflow-y-auto p-4 space-y-2">
          {creating && (
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-3 space-y-2">
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="ชื่อ Price Book เช่น ราคาประจำสัปดาห์ที่ 45 (10-16 พ.ย. 69)"
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>
                  <label className="block mb-1 font-medium">วันเริ่มต้น:</label>
                  <input
                    type="date"
                    value={form.effectiveFrom}
                    onChange={e => setForm({ ...form, effectiveFrom: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium">วันสิ้นสุด:</label>
                  <input
                    type="date"
                    value={form.effectiveTo}
                    onChange={e => setForm({ ...form, effectiveTo: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 pt-1">
                <input
                  type="checkbox"
                  checked={form.seedFromCurrent}
                  onChange={e => setForm({ ...form, seedFromCurrent: e.target.checked })}
                />
                ดึงราคาปัจจุบันเป็นค่าตั้งต้น
              </label>
              <button
                onClick={doCreate}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"
              >
                สร้าง (DRAFT)
              </button>
            </div>
          )}
          {books.map(b => (
            <button key={b.Id} onClick={() => open(b.Id)} className={`w-full text-left bg-white rounded-xl border shadow-sm p-3 hover:border-[#0C447C] transition ${sel?.Id === b.Id ? 'border-[#0C447C] ring-1 ring-[#0C447C]' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-800">{b.Name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLOR[b.Status]}`}>{b.Status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {b.EffectiveFrom && b.EffectiveTo
                  ? `${b.EffectiveFrom} ถึง ${b.EffectiveTo}`
                  : b.EffectiveFrom
                  ? `ตั้งแต่ ${b.EffectiveFrom}`
                  : `เดือน ${b.EffectiveMonth}`} · {b.LineCount ?? 0} รายการ
              </div>
            </button>
          ))}
          {!loading && books.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center space-y-3 bg-gray-50/50">
              <BookOpen size={32} className="mx-auto text-gray-400 opacity-60" />
              <div className="text-gray-600 text-sm font-semibold">ยังไม่มี Price Book ใน Sale-App</div>
              <p className="text-xs text-gray-400">คุณสามารถดึงชุดราคาประกาศจาก WinSpeed (SPL6911-00005, SPL6911-00006) เข้ามาได้ทันที</p>
              <button
                onClick={() => { setSyncModalOpen(true); loadWinSpeedSets(); }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition"
              >
                <Rocket size={14} /> ซิงค์ชุดราคา WinSpeed ทันที
              </button>
            </div>
          )}
        </div>

        {/* detail */}
        <div className="md:col-span-3 overflow-y-auto p-4 space-y-4">
          {!sel ? <div className="text-center text-gray-400 text-sm py-16">เลือก Price Book เพื่อดูรายละเอียด</div> : (
            <>
              {/* Header Info */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold text-gray-800">{sel.Name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {sel.EffectiveFrom && sel.EffectiveTo
                        ? `ช่วงเวลา: ${sel.EffectiveFrom} ถึง ${sel.EffectiveTo}`
                        : `เดือน ${sel.EffectiveMonth}`} · {editableLines.length} รายการสินค้า
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLOR[sel.Status]}`}>{sel.Status}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  {sel.Status === 'DRAFT' && isManagerOrAbove && (
                    <button onClick={() => act('approve')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:opacity-90 disabled:opacity-40"><CheckCircle2 size={15} /> อนุมัติ</button>
                  )}
                  {sel.Status === 'APPROVED' && isManagerOrAbove && (
                    <button onClick={() => act('activate')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-600 text-white hover:opacity-90 disabled:opacity-40"><Rocket size={15} /> เปิดใช้งาน</button>
                  )}
                  {sel.Status === 'ACTIVE' && isManagerOrAbove && (
                    <button onClick={() => act('archive')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"><Archive size={15} /> เก็บเข้าคลัง</button>
                  )}
                </div>
              </div>

              {/* Price Book Lines Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Tag size={16} /> รายการราคาประจำเดือน ({editableLines.length})
                  </div>
                  {sel.Status === 'DRAFT' && (
                    <button onClick={saveLines} disabled={busy} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                      <Save size={14} /> บันทึกรายการราคา
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm min-w-full">
                    <thead className="sticky top-0 whitespace-nowrap bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">สูตรสินค้า</th>
                        <th className="text-left px-3 py-2">สถานะบรรทัด</th>
                        <th className="text-right px-3 py-2">ราคา/ตัน (฿)</th>
                        <th className="text-left px-3 py-2">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {editableLines.map((l, idx) => {
                        const statusKey = l.LineStatus || 'ACTIVE';
                        const badge = LINE_STATUS_BADGE[statusKey] || LINE_STATUS_BADGE.ACTIVE;
                        const isDraft = sel.Status === 'DRAFT';

                        return (
                          <tr key={idx} className={statusKey === 'SUSPENDED' ? 'bg-red-50/30' : statusKey === 'DISCONTINUING' ? 'bg-amber-50/20' : ''}>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-gray-800">{l.GoodName || l.GoodId}</div>
                              <div className="text-[11px] text-gray-400">{l.GoodId}</div>
                            </td>
                            <td className="px-3 py-2">
                              {isDraft ? (
                                <select
                                  value={statusKey}
                                  onChange={e => {
                                    const nextStatus = e.target.value as 'ACTIVE' | 'DISCONTINUING' | 'SUSPENDED';
                                    const updated = [...editableLines];
                                    updated[idx] = {
                                      ...updated[idx],
                                      LineStatus: nextStatus,
                                      Price: nextStatus === 'SUSPENDED' ? null : (updated[idx].Price ?? 0),
                                    };
                                    setEditableLines(updated);
                                  }}
                                  className="border border-gray-200 rounded px-2 py-1 text-xs bg-white font-medium"
                                >
                                  <option value="ACTIVE">ปกติ</option>
                                  <option value="DISCONTINUING">กำลังยกเลิก (***)</option>
                                  <option value="SUSPENDED">งดขาย</option>
                                </select>
                              ) : (
                                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${badge.style}`}>
                                  {badge.label}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {isDraft ? (
                                statusKey === 'SUSPENDED' ? (
                                  <span className="text-xs text-red-500 font-semibold italic">งดตั้งราคา</span>
                                ) : (
                                  <input
                                    type="number"
                                    value={l.Price ?? ''}
                                    onChange={e => {
                                      const updated = [...editableLines];
                                      updated[idx] = { ...updated[idx], Price: e.target.value ? Number(e.target.value) : 0 };
                                      setEditableLines(updated);
                                    }}
                                    className="w-28 text-right border border-gray-200 rounded px-2 py-1 text-xs font-semibold"
                                  />
                                )
                              ) : (
                                statusKey === 'SUSPENDED' ? (
                                  <span className="text-xs text-gray-400">—</span>
                                ) : (
                                  <span className="font-semibold text-gray-800">฿{l.Price != null ? Number(l.Price).toLocaleString() : '—'}</span>
                                )
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isDraft ? (
                                <input
                                  type="text"
                                  value={l.Note || ''}
                                  placeholder="หมายเหตุ..."
                                  onChange={e => {
                                    const updated = [...editableLines];
                                    updated[idx] = { ...updated[idx], Note: e.target.value };
                                    setEditableLines(updated);
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
                    <UserCheck size={16} className="text-blue-600" /> ร้านค้าที่ขอราคาเป็นกรณีพิเศษสำหรับเดือนนี้ ({specials.length})
                  </div>
                </div>

                {/* Submit Special Price Request Form */}
                <div className="bg-blue-50/40 rounded-xl p-3 border border-blue-100 space-y-2">
                  <div className="text-xs font-semibold text-blue-900">ยื่นคำขอราคาพิเศษรายร้านค้า:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                    <input
                      placeholder="รหัสลูกค้า (CustID)"
                      value={spForm.custId}
                      onChange={e => setSpForm({ ...spForm, custId: e.target.value })}
                      className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                    />
                    <input
                      placeholder="ชื่อร้านค้า"
                      value={spForm.custName}
                      onChange={e => setSpForm({ ...spForm, custName: e.target.value })}
                      className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                    />
                    <select
                      value={spForm.goodId}
                      onChange={e => setSpForm({ ...spForm, goodId: e.target.value })}
                      className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                    >
                      <option value="">-- เลือกสูตร (ถ้ามี) --</option>
                      {editableLines.map(l => (
                        <option key={l.GoodId} value={l.GoodId}>{l.GoodName || l.GoodId}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="ราคาที่ขอ (฿/ตัน)"
                      value={spForm.requestedPrice}
                      onChange={e => setSpForm({ ...spForm, requestedPrice: e.target.value })}
                      className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                    />
                    <button
                      onClick={submitSpecialReq}
                      disabled={busy || !spForm.custId}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0C447C] text-white hover:opacity-90 disabled:opacity-40"
                    >
                      ส่งคำขอ
                    </button>
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
                                isRequester ? (
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
                <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FileClock size={15} /> ประวัติ (Audit)</div>
                <div className="space-y-1.5">
                  {sel.audit.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700">{a.Action}</span>
                      {a.FromStatus && <span>{a.FromStatus}→{a.ToStatus}</span>}
                      <span>· {a.ByName || '—'}</span><span>· {new Date(a.At).toLocaleString('th-TH')}</span>
                      {a.Note && <span className="text-gray-400">· {a.Note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* WinSpeed Pricelist Sync Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                  <Rocket size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">ซิงค์ตารางราคาจาก WinSpeed (Pricelist Sync)</h3>
                  <p className="text-xs text-gray-500">ดึงชุดราคาประกาศจาก dbo.EMSetPriceHD / DT เข้าสู่ Price Book พร้อมตรวจสอบช่วงเวลา</p>
                </div>
              </div>
              <button
                onClick={() => setSyncModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {/* Form Options */}
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
                <h4 className="font-bold text-emerald-900 flex items-center gap-1.5">
                  <Layers size={14} /> ข้อมูล Price Book ปลายทาง
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      วันเริ่มต้นมีผล (Effective From):
                    </label>
                    <input
                      type="date"
                      value={syncForm.effectiveFrom}
                      onChange={e => setSyncForm({ ...syncForm, effectiveFrom: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      วันสิ้นสุดมีผล (Effective To):
                    </label>
                    <input
                      type="date"
                      value={syncForm.effectiveTo}
                      onChange={e => setSyncForm({ ...syncForm, effectiveTo: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ชื่อ Price Book (เว้นว่างเพื่อให้ระบบตั้งชื่ออัตโนมัติตามเลขที่ชุด):
                  </label>
                  <input
                    type="text"
                    value={syncForm.name}
                    onChange={e => setSyncForm({ ...syncForm, name: e.target.value })}
                    placeholder="เช่น ตารางราคา WinSpeed ประจำสัปดาห์ 9-30 พ.ย. 69..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>

              {/* Sets Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-gray-700 flex items-center gap-1.5">
                    เลือกชุดราคา WinSpeed ที่ต้องการนำเข้า (dbo.EMSetPriceHD)
                  </h4>
                  <button
                    onClick={loadWinSpeedSets}
                    className="text-xs text-gray-500 hover:text-emerald-700 flex items-center gap-1"
                  >
                    <RefreshCw size={12} className={winSpeedLoading ? 'animate-spin' : ''} /> รีเฟรช WinSpeed
                  </button>
                </div>

                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-100">
                      <tr>
                        <th className="px-3 py-2.5 w-10 text-center">เลือก</th>
                        <th className="px-3 py-2.5">เลขที่ชุด (DocuNo)</th>
                        <th className="px-3 py-2.5">วันเริ่มต้น - สิ้นสุด</th>
                        <th className="px-3 py-2.5 text-center">จำนวนรายการ</th>
                        <th className="px-3 py-2.5">ลูกค้า</th>
                        <th className="px-3 py-2.5 text-center">สถานะช่วงเวลา</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {winSpeedLoading && winSpeedSets.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                            กำลังโหลดชุดราคาจาก WinSpeed...
                          </td>
                        </tr>
                      ) : winSpeedSets.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                            ไม่พบชุดราคาใน WinSpeed
                          </td>
                        </tr>
                      ) : (
                        winSpeedSets.map(s => {
                          const isChecked = selectedSetIds.includes(s.SetPriceID);
                          return (
                            <tr
                              key={s.SetPriceID}
                              className={`hover:bg-gray-50 transition cursor-pointer ${isChecked ? 'bg-emerald-50/40' : ''}`}
                              onClick={() => {
                                if (isChecked) {
                                  setSelectedSetIds(selectedSetIds.filter(id => id !== s.SetPriceID));
                                } else {
                                  setSelectedSetIds([...selectedSetIds, s.SetPriceID]);
                                }
                              }}
                            >
                              <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setSelectedSetIds([...selectedSetIds, s.SetPriceID]);
                                    } else {
                                      setSelectedSetIds(selectedSetIds.filter(id => id !== s.SetPriceID));
                                    }
                                  }}
                                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                              </td>
                              <td className="px-3 py-2 font-mono font-bold text-gray-800">
                                {s.DocuNo}
                              </td>
                              <td className="px-3 py-2 text-gray-600">
                                {s.BeginDate ? s.BeginDate.slice(0, 10) : '-'} ถึง {s.EndDate ? s.EndDate.slice(0, 10) : '-'}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700">
                                  {s.LineCount} รายการ
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-500">
                                {s.CustName || (s.CustID ? `ลูกค้า: ${s.CustID}` : 'ประกาศทั่วไป')}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.IsActivePeriod === 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
                                  {s.IsActivePeriod === 1 ? 'อยู่ในช่วงใช้งาน' : 'พ้นกำหนด'}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/70">
              <span className="text-xs text-gray-500">
                เลือกแล้ว <strong className="text-emerald-700 font-bold">{selectedSetIds.length} ชุดราคา</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSyncModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => handleSyncWinSpeed('DRAFT')}
                  disabled={busy || selectedSetIds.length === 0}
                  className="px-3.5 py-2 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-100 transition disabled:opacity-40"
                >
                  ซิงค์เป็นแบบร่าง (DRAFT)
                </button>
                <button
                  type="button"
                  onClick={() => handleSyncWinSpeed('ACTIVE')}
                  disabled={busy || selectedSetIds.length === 0}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-xs disabled:opacity-40 flex items-center gap-1.5"
                >
                  {busy ? <RefreshCw size={14} className="animate-spin" /> : <Rocket size={14} />}
                  <span>ซิงค์และเปิดใช้งานทันที (ACTIVE)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
