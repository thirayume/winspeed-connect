import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, Plus, History, Edit2, Trash2, X, Link2, Users } from 'lucide-react';
import {
  fetchGiveawayItems,
  fetchGiveawayOrgRoster,
  setGiveawayBudgetLine,
  updateGiveawayBudgetLine,
  deleteGiveawayBudgetLine,
  fetchGiveawayBudgetHistory,
  type GiveawayBudgetHistory,
} from '../../services/api';
import type { GiveawayBudgetLine, GiveawayItem, GiveawayOrgRoster } from '../../types';
import { formatThaiDate } from '../../utils/date';
import { SearchableSelect, type SearchableSelectOption } from '../ui/SearchableSelect';
import { appConfirm } from '../ui/AppAlert';

// "ตั้งค่าโควต้าของแถม" — เชื่อมรายการของแถมหลัก (98 รายการ) + ผังองค์กร/พนักงาน + CRUD ครบถ้วน
export function GiveawayQuotaSettings({
  region,
  regionCode,
  selectedSalesUserId,
  selectedSalesName,
  empId,
  empCode,
  lines,
  onSaved,
}: {
  region: string;
  regionCode?: string | null;
  selectedSalesUserId?: number | null;
  selectedSalesName?: string | null;
  empId?: string | null;
  empCode?: string | null;
  lines: GiveawayBudgetLine[];
  onSaved: () => void;
}) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [masterItems, setMasterItems] = useState<GiveawayItem[]>([]);
  const [roster, setRoster] = useState<GiveawayOrgRoster>({ regions: [], staff: [] });
  const [newGoodId, setNewGoodId] = useState('');
  const [newSalesUserId, setNewSalesUserId] = useState<string>(
    selectedSalesUserId ? String(selectedSalesUserId) : ''
  );
  const [newQty, setNewQty] = useState('');
  const [editingRow, setEditingRow] = useState<GiveawayBudgetLine | null>(null);
  const [editGoodId, setEditGoodId] = useState('');
  const [editSalesUserId, setEditSalesUserId] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editReason, setEditReason] = useState('');
  const [history, setHistory] = useState<GiveawayBudgetHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await fetchGiveawayBudgetHistory(region));
    } catch {
      setHistory(null);
    }
  }, [region]);

  useEffect(() => {
    fetchGiveawayItems()
      .then(items => setMasterItems(Array.isArray(items) ? items : []))
      .catch(() => setMasterItems([]));
    fetchGiveawayOrgRoster()
      .then(data => setRoster(data || { regions: [], staff: [] }))
      .catch(() => setRoster({ regions: [], staff: [] }));
  }, []);

  useEffect(() => {
    setEdits({});
    setMsg(null);
    setNewSalesUserId(selectedSalesUserId ? String(selectedSalesUserId) : '');
    setNewGoodId('');
    setNewQty('');
    loadHistory();
  }, [region, selectedSalesUserId, loadHistory]);

  const masterByGoodId = useMemo(() => {
    const m = new Map<string, GiveawayItem>();
    for (const item of masterItems) {
      const gid = String(item.GoodID || item.Id);
      m.set(gid, item);
    }
    return m;
  }, [masterItems]);

  const masterOptions: SearchableSelectOption[] = useMemo(() => {
    return masterItems.map(item => {
      const gid = String(item.GoodID || item.Id);
      const name = item.GoodName || item.ItemName;
      return {
        value: gid,
        label: item.GoodCode ? `[${item.GoodCode}] ${name}` : name,
        sublabel: `ตรา: ${item.Brand} · หน่วย: ${item.Unit || 'ชิ้น'}`,
        badge: item.Brand,
        keywords: `${item.GoodCode || ''} ${name} ${item.ItemName || ''} ${item.Brand}`,
      };
    });
  }, [masterItems]);

  const regionStaffOptions: SearchableSelectOption[] = useMemo(() => {
    const matching = roster.staff.filter(s => {
      if (regionCode && s.RegionCode) return String(s.RegionCode) === String(regionCode);
      return s.RegionName === region;
    });
    const list = matching.length > 0 ? matching : roster.staff;
    const opts: SearchableSelectOption[] = [
      {
        value: '',
        label: `งบส่วนกลางประจำ${region}`,
        sublabel: 'ใช้ร่วมกันทั้งเขตการขาย (ไม่เจาะจงรายคน)',
      },
      ...list.map(s => ({
        value: String(s.UserId),
        label: `${s.DisplayName}${s.EmpCode ? ` (${s.EmpCode})` : ''}`,
        sublabel: [s.PositionName, s.RegionName].filter(Boolean).join(' · '),
        badge: s.PositionCode || undefined,
        keywords: `${s.DisplayName} ${s.EmpCode || ''} ${s.PositionName || ''} ${s.RegionName}`,
      })),
    ];
    return opts;
  }, [roster.staff, region, regionCode]);

  const selectedMasterNew = newGoodId ? masterByGoodId.get(newGoodId) : undefined;

  async function handleQuickSave(line: GiveawayBudgetLine, budgetQtyStr: string) {
    const qty = Number(budgetQtyStr);
    if (!Number.isFinite(qty) || qty < 0) {
      setMsg({ ok: false, text: 'จำนวนงบต้องเป็นตัวเลขไม่ติดลบ' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await updateGiveawayBudgetLine(line.Id, {
        budgetQty: qty,
        reason: reason.trim() || undefined,
      });
      setMsg({
        ok: true,
        text: r.warning || `อัปเดตโควต้า ${line.GoodName || line.ItemName} = ${qty.toLocaleString()} ชิ้นแล้ว`,
      });
      onSaved();
      loadHistory();
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error).message || 'บันทึกไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!selectedMasterNew) {
      setMsg({ ok: false, text: 'กรุณาค้นหาและเลือกรายการของแถมจากข้อมูลหลัก' });
      return;
    }
    const qty = Number(newQty);
    if (!Number.isFinite(qty) || qty < 0 || newQty === '') {
      setMsg({ ok: false, text: 'กรุณาระบุจำนวนโควต้า (ชิ้น) เป็นตัวเลขไม่ติดลบ' });
      return;
    }
    const chosenStaff = newSalesUserId
      ? roster.staff.find(s => String(s.UserId) === newSalesUserId)
      : undefined;

    setBusy(true);
    setMsg(null);
    try {
      const r = await setGiveawayBudgetLine({
        region,
        regionCode: regionCode || chosenStaff?.RegionCode || undefined,
        salesUserId: newSalesUserId ? Number(newSalesUserId) : null,
        empId: chosenStaff?.EmpId ?? (newSalesUserId === String(selectedSalesUserId || '') ? empId : undefined),
        empCode: chosenStaff?.EmpCode ?? (newSalesUserId === String(selectedSalesUserId || '') ? empCode : undefined),
        goodId: String(selectedMasterNew.GoodID || selectedMasterNew.Id),
        goodCode: selectedMasterNew.GoodCode || undefined,
        goodName: selectedMasterNew.GoodName || selectedMasterNew.ItemName,
        brand: selectedMasterNew.Brand,
        itemName: selectedMasterNew.ItemName || selectedMasterNew.GoodName,
        budgetQty: qty,
        reason: reason.trim() || undefined,
      });
      setMsg({
        ok: true,
        text:
          r.warning ||
          `เพิ่ม/อัปเดตโควต้า ${selectedMasterNew.GoodCode ? `[${selectedMasterNew.GoodCode}] ` : ''}${
            selectedMasterNew.GoodName || selectedMasterNew.ItemName
          } = ${qty.toLocaleString()} ชิ้นแล้ว`,
      });
      setNewGoodId('');
      setNewQty('');
      onSaved();
      loadHistory();
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error).message || 'เพิ่มโควต้าไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  }

  function openEditModal(line: GiveawayBudgetLine) {
    setEditingRow(line);
    setEditGoodId(line.GoodId ? String(line.GoodId) : '');
    setEditSalesUserId(line.SalesUserId ? String(line.SalesUserId) : '');
    setEditQty(String(Number(line.BudgetQty)));
    setEditReason(reason || '');
  }

  async function handleSaveModal() {
    if (!editingRow) return;
    const qty = Number(editQty);
    if (!Number.isFinite(qty) || qty < 0) {
      setMsg({ ok: false, text: 'จำนวนงบต้องเป็นตัวเลขไม่ติดลบ' });
      return;
    }
    const chosenItem = editGoodId ? masterByGoodId.get(editGoodId) : undefined;
    const chosenStaff = editSalesUserId
      ? roster.staff.find(s => String(s.UserId) === editSalesUserId)
      : undefined;

    setBusy(true);
    setMsg(null);
    try {
      const r = await updateGiveawayBudgetLine(editingRow.Id, {
        budgetQty: qty,
        salesUserId: editSalesUserId ? Number(editSalesUserId) : null,
        empId: chosenStaff?.EmpId ?? null,
        empCode: chosenStaff?.EmpCode ?? null,
        ...(chosenItem
          ? {
              goodId: String(chosenItem.GoodID || chosenItem.Id),
              goodCode: chosenItem.GoodCode || undefined,
              goodName: chosenItem.GoodName || chosenItem.ItemName,
              brand: chosenItem.Brand,
              itemName: chosenItem.ItemName || chosenItem.GoodName,
            }
          : {}),
        reason: editReason.trim() || reason.trim() || undefined,
      });
      setMsg({
        ok: true,
        text:
          r.warning ||
          `แก้ไขโควต้า ${chosenItem?.GoodName || editingRow.GoodName || editingRow.ItemName} เรียบร้อยแล้ว`,
      });
      setEditingRow(null);
      onSaved();
      loadHistory();
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error).message || 'แก้ไขไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(line: GiveawayBudgetLine) {
    const label = line.GoodName || line.ItemName;
    if (!(await appConfirm(`ยืนยันลบรายการโควต้า "${label}" (${Number(line.BudgetQty).toLocaleString()} ชิ้น)?`))) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await deleteGiveawayBudgetLine(line.Id, { reason: reason.trim() || undefined });
      setMsg({ ok: true, text: `ลบรายการโควต้า "${label}" ออกจากเขต ${region} แล้ว` });
      onSaved();
      loadHistory();
    } catch (e: any) {
      if (e?.status === 409 || e?.requiresConfirm || String(e?.message || '').includes('มียอดเบิกแล้ว')) {
        const confirmedForce = await appConfirm(
          `${e.message || `รายการ "${label}" มียอดเบิกแล้ว`}\n\nต้องการยืนยันลบรายการโควต้านี้อย่างถาวรหรือไม่?`
        );
        if (confirmedForce) {
          try {
            await deleteGiveawayBudgetLine(line.Id, { force: true, reason: reason.trim() || undefined });
            setMsg({ ok: true, text: `ลบรายการโควต้า "${label}" เรียบร้อยแล้ว` });
            onSaved();
            loadHistory();
          } catch (err2: any) {
            setMsg({ ok: false, text: err2?.message || 'ลบไม่สำเร็จ' });
          }
        }
      } else {
        setMsg({ ok: false, text: e?.message || 'ลบไม่สำเร็จ' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {msg && (
        <div
          className={`p-2.5 rounded-lg border ${
            msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Header Info & Master Sync Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50/70 border border-blue-100 rounded-xl px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[#0C447C]">
          <Link2 size={14} />
          <span className="font-bold">
            เขต: {regionCode ? `[${regionCode}] ` : ''}
            {region}
          </span>
          {selectedSalesName && (
            <span className="px-2 py-0.5 rounded-full bg-white border border-blue-200 font-semibold text-[11px] flex items-center gap-1">
              <Users size={11} /> {selectedSalesName}
              {empCode ? ` (${empCode})` : ''}
            </span>
          )}
        </div>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
          ข้อมูลหลักของแถมในระบบ: {masterItems.length} รายการ
        </span>
      </div>

      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="เหตุผลการปรับ/เพิ่ม/ลบโควต้า (บันทึกในประวัติ Audit Trail)"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
      />

      {/* Add Quota Form using 98-Item Autocomplete + Salesperson Selector */}
      <div className="p-3.5 rounded-xl border border-dashed border-blue-300 bg-blue-50/30 space-y-3">
        <div className="font-bold text-[#0C447C] text-xs flex items-center gap-1.5">
          <Plus size={14} /> เพิ่ม / กำหนดโควต้าของแถม (เลือกจากรายการของแถมหลัก {masterItems.length} รายการ)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
          <div className="md:col-span-6">
            <label className="text-gray-600 font-semibold mb-1 block">ค้นหารายการของแถม (รหัส / ชื่อสินค้า / ตรา) *</label>
            <SearchableSelect
              options={masterOptions}
              value={newGoodId}
              onChange={val => setNewGoodId(val)}
              placeholder="-- พิมพ์ค้นหาจาก 98 รายการของแถม --"
              searchPlaceholder="พิมพ์รหัสสินค้า, ชื่อสูตร, เสื้อ, กระเป๋า, ตรา..."
              allowClear
            />
          </div>
          <div className="md:col-span-4">
            <label className="text-gray-600 font-semibold mb-1 block">ผู้รับโควต้า (ผังองค์กร / เขต)</label>
            <SearchableSelect
              options={regionStaffOptions}
              value={newSalesUserId}
              onChange={val => setNewSalesUserId(val)}
              placeholder="เลือกพนักงานขายหรือทั้งภาค..."
              searchPlaceholder="ค้นหาชื่อพนักงานหรือตำแหน่ง..."
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-gray-600 font-semibold mb-1 block">งบ (ชิ้น) *</label>
            <input
              type="number"
              min={0}
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              placeholder="0"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-right font-semibold bg-white"
            />
          </div>
        </div>
        {selectedMasterNew && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-gray-600">
            <div>
              สินค้าที่เลือก: <span className="font-bold text-[#0C447C]">{selectedMasterNew.GoodCode}</span> ·{' '}
              {selectedMasterNew.GoodName || selectedMasterNew.ItemName}{' '}
              <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">
                ตรา: {selectedMasterNew.Brand}
              </span>
            </div>
            <button
              type="button"
              disabled={busy || !newGoodId || newQty === ''}
              onClick={handleCreate}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40 inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus size={13} /> เพิ่มบรรทัดโควต้า
            </button>
          </div>
        )}
        {!selectedMasterNew && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={true}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold opacity-40 inline-flex items-center gap-1.5"
            >
              <Plus size={13} /> เพิ่มบรรทัดโควต้า
            </button>
          </div>
        )}
      </div>

      {/* Existing Quota Lines Table */}
      <div className="overflow-x-auto border border-gray-100 rounded-xl">
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-gray-200 bg-gray-50/80">
              <th className="text-left py-2.5 px-3">ตรา</th>
              <th className="text-left py-2.5 px-3">รายการ / สินค้าหลัก</th>
              <th className="text-left py-2.5 px-3">ผู้รับผิดชอบ</th>
              <th className="text-right py-2.5 px-3">เบิกแล้ว</th>
              <th className="text-right py-2.5 px-3">งบ (ชิ้น)</th>
              <th className="text-right py-2.5 px-3">คงเหลือ</th>
              <th className="text-right py-2.5 px-3">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map(l => {
              const value = edits[l.Id] ?? String(Number(l.BudgetQty));
              const dirty = edits[l.Id] !== undefined && Number(edits[l.Id]) !== Number(l.BudgetQty);
              const linkedMaster = l.GoodId ? masterByGoodId.get(String(l.GoodId)) : undefined;
              const displayGoodName = l.GoodName || linkedMaster?.GoodName || l.ItemName;
              const displayGoodCode = l.GoodCode || linkedMaster?.GoodCode;
              const remaining = Number(l.RemainingQty || 0);
              return (
                <tr key={l.Id} className="hover:bg-gray-50/60">
                  <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{l.Brand}</td>
                  <td className="py-2 px-3">
                    <div className="font-semibold text-gray-800 flex items-center gap-1.5 flex-wrap">
                      {displayGoodCode && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-[#0C447C] border border-blue-100">
                          {displayGoodCode}
                        </span>
                      )}
                      <span>{displayGoodName}</span>
                    </div>
                    {displayGoodName !== l.ItemName && (
                      <div className="text-[10px] text-gray-400">ชื่อเทียบงบ: {l.ItemName}</div>
                    )}
                    {!l.GoodId && (
                      <span className="inline-block mt-0.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        ยังไม่เชื่อมรหัสสินค้าหลัก — กดแก้ไขเพื่อเชื่อมกับ 98 รายการ
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {l.SalesUserName ? (
                      <span className="text-[11px] font-medium text-gray-700">{l.SalesUserName}</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold">
                        งบส่วนกลางประจำภาค
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-500">
                    {Number(l.WithdrawnQty).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      min={0}
                      value={value}
                      onChange={e => setEdits(p => ({ ...p, [l.Id]: e.target.value }))}
                      className="w-24 border border-gray-300 rounded px-2 py-1 text-right tabular-nums font-semibold"
                    />
                  </td>
                  <td
                    className={`py-2 px-3 text-right tabular-nums font-bold ${
                      remaining < 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {remaining.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!dirty || busy}
                        onClick={() => handleQuickSave(l, value)}
                        className="px-2 py-1 rounded bg-[#0C447C] text-white disabled:opacity-30 inline-flex items-center gap-1 cursor-pointer"
                        title="บันทึกจำนวนใหม่"
                      >
                        <Save size={12} /> บันทึก
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEditModal(l)}
                        className="p-1.5 rounded border border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-[#0C447C] cursor-pointer"
                        title="แก้ไขรายการสินค้า / ผู้รับโควต้า / จำนวน"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDelete(l)}
                        className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                        title="ลบรายการโควต้า"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  ยังไม่มีรายการโควต้าในขอบเขตนี้ — ใช้ฟอร์มด้านบนเพื่อเพิ่มจาก 98 รายการของแถม
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Audit History */}
      <div>
        <div className="font-bold text-gray-700 flex items-center gap-1.5 mb-2">
          <History size={13} /> ประวัติการตั้งงบ แก้ไข ลบ และการยืม
        </div>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {(history?.changes || []).map(c => {
            const after = c.AfterJson ? JSON.parse(c.AfterJson) : {};
            const before = c.BeforeJson ? JSON.parse(c.BeforeJson) : null;
            const item = String(c.EntityId).split('|').slice(2, 4).join(' ');
            return (
              <div key={c.Id} className="flex flex-wrap gap-x-3 text-gray-600 border-b border-gray-50 py-1">
                <span className="text-gray-400">{formatThaiDate(c.CreatedAt, true)}</span>
                <span
                  className={`font-semibold ${
                    c.Action === 'DELETE' ? 'text-red-600' : c.Action === 'CREATE' ? 'text-emerald-700' : 'text-blue-700'
                  }`}
                >
                  {c.Action}
                </span>
                <span>{after.goodName || item}</span>
                {after.budgetQty !== undefined && (
                  <span>
                    {before ? `${before.budgetQty} → ` : ''}
                    {after.budgetQty} ชิ้น
                  </span>
                )}
                {c.Action === 'DELETE' && before?.budgetQty !== undefined && (
                  <span className="text-red-600">ลบงบเดิม {before.budgetQty} ชิ้น</span>
                )}
                {after.qty !== undefined && (
                  <span>
                    {after.qty} ชิ้น {after.toRegion ? `→ ${after.toRegion}` : `← ${after.fromRegion}`}
                  </span>
                )}
                <span className="text-gray-400">{c.UserName || c.UserId}</span>
                {c.ReasonText && <span className="italic text-gray-400">{c.ReasonText}</span>}
              </div>
            );
          })}
          {(history?.borrows || []).map(b => (
            <div key={`b-${b.Id}`} className="flex flex-wrap gap-x-3 text-gray-600 border-b border-gray-50 py-1">
              <span className="text-gray-400">{formatThaiDate(b.RequestedAt, true)}</span>
              <span className="font-semibold">
                ยืม #{b.Id} · {b.Status}
              </span>
              <span>
                {b.Brand} {b.ItemName} {Number(b.Qty)} ชิ้น
              </span>
              <span>
                {b.RequesterName} ← {b.LenderName}
              </span>
            </div>
          ))}
          {!history?.changes?.length && !history?.borrows?.length && (
            <div className="text-gray-300 py-4 text-center">ยังไม่มีประวัติ</div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setEditingRow(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="font-bold text-sm text-[#0C447C]">
                แก้ไขรายการโควต้า — {editingRow.GoodName || editingRow.ItemName}
              </h3>
              <button type="button" onClick={() => setEditingRow(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-gray-600 font-semibold block mb-1">
                  เชื่อมโยง / เปลี่ยนสินค้าของแถมจากข้อมูลหลัก ({masterItems.length} รายการ)
                </label>
                <SearchableSelect
                  options={masterOptions}
                  value={editGoodId}
                  onChange={val => setEditGoodId(val)}
                  placeholder="เลือกรายการของแถม..."
                  searchPlaceholder="ค้นหารหัสหรือชื่อสินค้า..."
                />
              </div>

              <div>
                <label className="text-gray-600 font-semibold block mb-1">ผู้รับผิดชอบโควต้า (ผังองค์กร)</label>
                <SearchableSelect
                  options={regionStaffOptions}
                  value={editSalesUserId}
                  onChange={val => setEditSalesUserId(val)}
                  placeholder="เลือกพนักงานขายหรือส่วนกลางประจำภาค..."
                  searchPlaceholder="ค้นหาพนักงาน..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-600 font-semibold block mb-1">งบโควต้า (ชิ้น) *</label>
                  <input
                    type="number"
                    min={0}
                    value={editQty}
                    onChange={e => setEditQty(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-right font-bold"
                  />
                </div>
                <div>
                  <label className="text-gray-600 font-semibold block mb-1">เบิกไปแล้ว</label>
                  <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-right text-gray-500 font-semibold">
                    {Number(editingRow.WithdrawnQty || 0).toLocaleString()} ชิ้น
                  </div>
                </div>
              </div>

              <div>
                <label className="text-gray-600 font-semibold block mb-1">เหตุผลการแก้ไข</label>
                <input
                  type="text"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="ระบุหมายเหตุ (บันทึกใน Audit Log)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditingRow(null)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveModal}
                className="px-4 py-2 rounded-lg bg-[#0C447C] text-white font-bold hover:bg-blue-900 disabled:opacity-40"
              >
                {busy ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
