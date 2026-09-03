/**
 * Master Settings — รายการเหตุผลการขอแก้ไขหลังยืนยัน (`wf.EditReason`)
 *
 * ทำไมต้องมีหน้านี้
 *   รายการนี้ไม่ใช่ค่าคงที่ของระบบ แต่เป็น **กติกาทางธุรกิจ** สองข้อพร้อมกัน
 *     1. เหตุผลนี้ใช้ขอแก้ในขั้นไหนได้บ้าง
 *     2. เหตุผลนี้ต้องสั่ง Hold รถหรือไม่
 *   ทั้งสองข้อเป็นเรื่องที่เจ้าของกระบวนการต้องปรับเองได้ ไม่ควรต้องรอคนแก้ SQL
 *
 * สิ่งที่หน้านี้จงใจไม่ให้ทำ
 *   - **ลบเหตุผลที่เคยถูกใช้** — `wf.EditRequest` อ้างถึงรหัสนี้ ถ้าลบทิ้ง
 *     ประวัติคำขอเดิมจะอ่านไม่ออกว่าเคยขอด้วยเหตุผลอะไร ให้ปิดใช้งานแทน
 *   - **ปิดใช้งานเหตุผลที่ยังมีคำขอค้าง** — คำขอนั้นจะลอยอยู่โดยไม่มีนิยาม
 *     ที่ใช้งานอยู่รองรับ ผู้อนุมัติจะตัดสินใจโดยไม่รู้ว่ากติกายังใช้อยู่ไหม
 *   - **แก้รหัส** — รหัสคือกุญแจที่ประวัติอ้างถึง เปลี่ยนแล้วประวัติขาด
 *     ถ้าต้องการรหัสใหม่ ให้สร้างใหม่แล้วปิดตัวเก่า
 *
 * backend บังคับกฎทั้งหมดนี้อีกชั้นหนึ่ง หน้าจอแค่ทำให้เห็นก่อนกด
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListChecks, RefreshCw, Plus, Save, Trash2, X, AlertTriangle,
  PauseOctagon, Check, Lock,
} from 'lucide-react';
import {
  fetchEditReasonsAdmin, createEditReason, updateEditReason, deleteEditReason,
  type EditReasonAdmin, type EditStage,
} from '../../services/api';

const NAVY = '#0C447C';

const STAGE_LABEL: Record<string, string> = {
  CONFIRMED:  'ยืนยันแล้ว',
  REGISTERED: 'รถลงทะเบียนแล้ว',
  LOADING:    'กำลังโหลดสินค้า',
};
const STAGE_STYLE: Record<string, string> = {
  CONFIRMED:  'bg-blue-50 text-blue-800 border-blue-200',
  REGISTERED: 'bg-sky-50 text-sky-800 border-sky-200',
  LOADING:    'bg-amber-50 text-amber-900 border-amber-200',
};

type Draft = {
  reasonCode: string;
  reasonText: string;
  appliesTo: string[];
  requiresHold: boolean;
  sortOrder: number;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  reasonCode: '', reasonText: '', appliesTo: ['CONFIRMED'],
  requiresHold: false, sortOrder: 100, isActive: true,
});

const toDraft = (r: EditReasonAdmin): Draft => ({
  reasonCode: r.reasonCode,
  reasonText: r.reasonText,
  appliesTo: String(r.appliesTo || '').split(',').map(s => s.trim()).filter(Boolean),
  requiresHold: !!r.requiresHold,
  sortOrder: Number(r.sortOrder ?? 100),
  isActive: !!r.isActive,
});

function StagePicker({ value, onChange, stages }: {
  value: string[]; onChange: (v: string[]) => void; stages: EditStage[];
}) {
  const toggle = (s: string) =>
    onChange(value.includes(s) ? value.filter(x => x !== s) : [...value, s]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {stages.map(s => {
        const on = value.includes(s);
        return (
          <button
            key={s} type="button" onClick={() => toggle(s)}
            className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
              on ? STAGE_STYLE[s] : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'}`}
          >
            {on && <Check size={10} className="mr-0.5 inline" />}
            {STAGE_LABEL[s] || s}
          </button>
        );
      })}
    </div>
  );
}

function ReasonForm({ draft, setDraft, stages, isNew, onSave, onCancel, busy, err }: {
  draft: Draft; setDraft: (d: Draft) => void; stages: EditStage[]; isNew: boolean;
  onSave: () => void; onCancel: () => void; busy: boolean; err: string | null;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-gray-500">รหัส</span>
          <input
            value={draft.reasonCode}
            onChange={e => setDraft({ ...draft, reasonCode: e.target.value.toUpperCase() })}
            disabled={!isNew}
            placeholder="เช่น ROUTE_CHANGE"
            className="w-44 rounded border border-gray-300 px-2 py-1 font-mono text-xs disabled:bg-gray-100 disabled:text-gray-500"
          />
        </label>
        <label className="block min-w-[240px] flex-1">
          <span className="mb-0.5 block text-[11px] text-gray-500">ข้อความที่ผู้ขอจะเห็น</span>
          <input
            value={draft.reasonText}
            onChange={e => setDraft({ ...draft, reasonText: e.target.value })}
            placeholder="เช่น เปลี่ยนเส้นทางจัดส่ง"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-gray-500">ลำดับแสดง</span>
          <input
            type="number" value={draft.sortOrder}
            onChange={e => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
            className="w-20 rounded border border-gray-300 px-2 py-1 text-xs"
          />
        </label>
      </div>

      <div>
        <span className="mb-1 block text-[11px] text-gray-500">ใช้ขอแก้ได้ในขั้น</span>
        <StagePicker value={draft.appliesTo} onChange={v => setDraft({ ...draft, appliesTo: v })} stages={stages} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
          <input type="checkbox" checked={draft.requiresHold}
            onChange={e => setDraft({ ...draft, requiresHold: e.target.checked })} />
          <PauseOctagon size={13} className="text-red-600" />
          ต้อง Hold รถ
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
          <input type="checkbox" checked={draft.isActive}
            onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />
          เปิดใช้งาน
        </label>
        <span className="text-[11px] text-gray-500">
          Hold มีผลเฉพาะขั้นที่มีรถแล้ว — ขั้น &ldquo;ยืนยันแล้ว&rdquo; ไม่มีรถให้หยุด ระบบจะไม่ Hold
        </span>
      </div>

      {err && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle size={12} /> {err}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" disabled={busy} onClick={onSave}
          className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: NAVY }}>
          <Save size={13} /> {isNew ? 'เพิ่ม' : 'บันทึก'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

export function EditReasonsManager() {
  const [rows, setRows] = useState<EditReasonAdmin[]>([]);
  const [stages, setStages] = useState<EditStage[]>(['CONFIRMED', 'REGISTERED', 'LOADING']);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetchEditReasonsAdmin();
      setRows(r.data || []);
      if (r.validStages?.length) setStages(r.validStages);
    } catch (e: any) {
      setErr(e?.message || 'โหลดรายการเหตุผลไม่สำเร็จ');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setFormErr(null);
    try {
      if (adding) {
        await createEditReason(draft);
      } else if (editing) {
        const { reasonCode: _drop, ...rest } = draft;
        void _drop;
        await updateEditReason(editing, rest);
      }
      setAdding(false); setEditing(null); setDraft(emptyDraft());
      await load();
    } catch (e: any) {
      setFormErr(e?.message || 'บันทึกไม่สำเร็จ');
    }
    setBusy(false);
  };

  const remove = async (code: string) => {
    setBusy(true); setErr(null);
    try {
      await deleteEditReason(code);
      setConfirmDelete(null);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'ลบไม่สำเร็จ');
      setConfirmDelete(null);
    }
    setBusy(false);
  };

  const tally = useMemo(() => ({
    total: rows.length,
    active: rows.filter(r => r.isActive).length,
    hold: rows.filter(r => r.requiresHold && r.isActive).length,
  }), [rows]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold" style={{ color: NAVY }}>
          <ListChecks size={18} /> เหตุผลการขอแก้ไขหลังยืนยัน
        </h3>
        <span className="text-xs text-gray-500">
          ทั้งหมด {tally.total} · เปิดใช้งาน {tally.active} · สั่ง Hold รถ {tally.hold}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => { setAdding(true); setEditing(null); setDraft(emptyDraft()); setFormErr(null); }}
            disabled={adding}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            style={{ background: NAVY }}
          >
            <Plus size={13} /> เพิ่มเหตุผล
          </button>
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
        </div>
      </div>

      <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
        รายการนี้กำหนดสองอย่าง — เหตุผลนี้ใช้ขอแก้ใน<b>ขั้นไหน</b>ได้บ้าง และเหตุผลนี้
        <b>ต้อง Hold รถ</b>หรือไม่ · เหตุผลที่เคยถูกใช้แล้วจะลบไม่ได้ เพราะประวัติคำขอเดิมอ้างถึงอยู่ ให้ปิดใช้งานแทน
      </p>

      {err && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {adding && (
        <ReasonForm draft={draft} setDraft={setDraft} stages={stages} isNew
          onSave={save} onCancel={() => { setAdding(false); setFormErr(null); }} busy={busy} err={formErr} />
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 text-left font-medium">ลำดับ</th>
              <th className="px-3 py-2 text-left font-medium">รหัส</th>
              <th className="px-3 py-2 text-left font-medium">ข้อความ</th>
              <th className="px-3 py-2 text-left font-medium">ใช้ได้ในขั้น</th>
              <th className="px-3 py-2 text-center font-medium">Hold รถ</th>
              <th className="px-3 py-2 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2 text-center font-medium">ถูกใช้</th>
              <th className="px-3 py-2 text-right font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isEditing = editing === r.reasonCode;
              const used = Number(r.usageCount || 0);
              const pending = Number(r.pendingCount || 0);
              return (
                <tr key={r.reasonCode} className={`border-b border-gray-100 ${r.isActive ? '' : 'bg-gray-50/60 text-gray-400'}`}>
                  {isEditing ? (
                    <td colSpan={8} className="p-3">
                      <ReasonForm draft={draft} setDraft={setDraft} stages={stages} isNew={false}
                        onSave={save} onCancel={() => { setEditing(null); setFormErr(null); }} busy={busy} err={formErr} />
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 tabular-nums text-gray-500">{r.sortOrder}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.reasonCode}</td>
                      <td className="px-3 py-2 text-gray-800">{r.reasonText}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {String(r.appliesTo || '').split(',').map(s => s.trim()).filter(Boolean).map(s => (
                            <span key={s} className={`rounded border px-1.5 py-px text-[10px] ${STAGE_STYLE[s] || 'border-gray-200'}`}>
                              {STAGE_LABEL[s] || s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.requiresHold ? (
                          <span className="inline-flex items-center gap-0.5 rounded border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-700">
                            <PauseOctagon size={9} /> Hold
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded border px-1.5 py-px text-[10px] ${
                          r.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                     : 'border-gray-300 bg-gray-100 text-gray-500'}`}>
                          {r.isActive ? 'เปิดใช้งาน' : 'ปิดแล้ว'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {used === 0 ? <span className="text-gray-300">—</span> : (
                          <span className="text-gray-600">
                            {used}
                            {pending > 0 && <span className="ml-1 text-amber-700">(ค้าง {pending})</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1.5">
                          <button type="button"
                            onClick={() => { setEditing(r.reasonCode); setAdding(false); setDraft(toDraft(r)); setFormErr(null); }}
                            className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50">
                            แก้ไข
                          </button>
                          {confirmDelete === r.reasonCode ? (
                            <>
                              <button type="button" disabled={busy} onClick={() => remove(r.reasonCode)}
                                className="rounded bg-red-600 px-2 py-0.5 text-[11px] text-white hover:bg-red-700 disabled:opacity-50">
                                ยืนยันลบ
                              </button>
                              <button type="button" onClick={() => setConfirmDelete(null)}
                                className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600">
                                <X size={11} />
                              </button>
                            </>
                          ) : used > 0 ? (
                            <span
                              title="เคยถูกใช้แล้ว ลบไม่ได้ — ให้ปิดใช้งานแทน"
                              className="inline-flex items-center gap-0.5 rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-300"
                            >
                              <Lock size={10} /> ลบไม่ได้
                            </span>
                          ) : (
                            <button type="button" onClick={() => setConfirmDelete(r.reasonCode)}
                              className="inline-flex items-center gap-0.5 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50">
                              <Trash2 size={11} /> ลบ
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">ยังไม่มีเหตุผลในระบบ</p>
        )}
      </div>
    </div>
  );
}

export default EditReasonsManager;
