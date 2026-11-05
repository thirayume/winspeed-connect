import { useEffect, useState } from 'react';
import { ClipboardCheck, History, Save, X } from 'lucide-react';
import { req } from '../../services/api';

const API = '/readiness-signoff';
const statusNames = {
  PENDING: 'รอข้อมูล',
  IN_REVIEW: 'อยู่ระหว่างตรวจ',
  CONFIRMED: 'ยืนยันแล้ว',
};
type Status = keyof typeof statusNames;

type Revision = {
  Revision: number;
  Status: Status;
  ProcedureText: string;
  EvidenceReference: string;
  Reviewer: string;
  ReviewDate: string | null;
  SavedByUsername: string;
  SavedAt: string;
};

type Topic = {
  code: string;
  title: string;
  team: string;
  hint: string;
  current: Revision | null;
};

function toForm(record: Revision | null) {
  return {
    status: record?.Status ?? 'PENDING',
    procedureText: record?.ProcedureText ?? '',
    evidenceReference: record?.EvidenceReference ?? '',
    reviewer: record?.Reviewer ?? '',
    reviewDate: record?.ReviewDate?.slice(0, 10) ?? '',
  };
}

const bangkokTime = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
});

export function ReadinessSignoffModal({ onClose }: { onClose: () => void }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [database, setDatabase] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState(toForm(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);

  const topic = topics.find(item => item.code === selected);
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(topic?.current ?? null));
  const busy = loading || saving || historyLoading;

  async function load(keepCode = '') {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await req<{ database: string | null; topics: Topic[] }>(API);
      setDatabase(data.database);
      const initial = data.topics.find(item => item.code === keepCode) ?? data.topics[0];
      setTopics(data.topics);
      setSelected(initial?.code ?? '');
      setForm(toForm(initial?.current ?? null));
      setHistory(null);
      setNextBefore(null);
    } catch (err: unknown) {
      setError((err as Error).message || 'เปิดผลตรวจรับไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function canDiscard() {
    return !dirty || window.confirm('ละทิ้งข้อมูลที่ยังไม่ได้บันทึกหรือไม่');
  }

  function choose(next: Topic) {
    if (next.code === selected || !canDiscard()) return;
    setSelected(next.code);
    setForm(toForm(next.current));
    setError('');
    setNotice('');
    setHistory(null);
    setNextBefore(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topic || !database || busy || !dirty) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await req<Revision>(API + '/' + topic.code, {
        method: 'PUT',
        body: JSON.stringify({ ...form, expectedRevision: topic.current?.Revision ?? 0, expectedDatabase: database }),
      });
      setTopics(previous => previous.map(item => item.code === topic.code ? { ...item, current: saved } : item));
      setForm(toForm(saved));
      setHistory(null);
      setNextBefore(null);
      setNotice('บันทึกผลตรวจรับแล้ว ฉบับที่ ' + saved.Revision);
    } catch (err: unknown) {
      setError((err as Error).message || 'บันทึกผลตรวจรับไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory(cursor: number | null) {
    setHistoryLoading(true);
    setError('');
    try {
      const query = cursor ? '?before=' + cursor : '';
      const result = await req<{ items: Revision[]; nextBefore: number | null }>(API + '/' + selected + '/history' + query);
      setHistory(previous => cursor ? [...(previous ?? []), ...result.items] : result.items);
      setNextBefore(result.nextBefore);
    } catch (err: unknown) {
      setError((err as Error).message || 'อ่านประวัติไม่สำเร็จ');
    } finally {
      setHistoryLoading(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  const required = form.status === 'CONFIRMED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="readiness-title"
        className="max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="readiness-title" className="flex items-center gap-2 text-lg font-bold text-[#0C447C]">
              <ClipboardCheck size={20} /> ผลตรวจรับงาน
            </h2>
            <p className="mt-1 text-sm text-gray-600">เก็บขั้นตอนและหลักฐานที่ทีมรับรองสำหรับฐานข้อมูลที่กำลังใช้งาน</p>
            {database && <p className="mt-1 break-all text-xs text-gray-600">ฐานข้อมูล {database}</p>}
          </div>
          <button type="button" aria-label="ปิดผลตรวจรับ" disabled={saving} onClick={() => { if (canDiscard()) onClose(); }}>
            <X size={20} />
          </button>
        </header>
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {loading ? <p className="text-sm text-gray-600">กำลังโหลดผลตรวจรับ...</p> : (
          <div className="grid gap-4 md:grid-cols-[minmax(13rem,1fr)_2fr]">
            <nav aria-label="หัวข้อตรวจรับ" className="space-y-2">
              {topics.map(item => (
                <button key={item.code} type="button" disabled={busy} aria-pressed={item.code === selected}
                  onClick={() => choose(item)}
                  className={'w-full rounded-lg border p-2 text-left text-sm ' + (item.code === selected ? 'border-blue-400 bg-blue-50' : 'border-gray-200')}>
                  <span className="block font-semibold">{item.title}</span>
                  <span className="block text-xs text-gray-600">{item.team} · {statusNames[item.current?.Status ?? 'PENDING']}</span>
                </button>
              ))}
            </nav>
            {topic && (
              <div>
                <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-gray-600">{topic.hint}</p>
                <form onSubmit={save}>
                  <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium">สถานะ
                      <select className={inputClass} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status })}>
                        {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-medium">วันที่ทีมตรวจรับ
                      <input className={inputClass} type="date" required={required} value={form.reviewDate}
                        onChange={e => setForm({ ...form, reviewDate: e.target.value })} />
                    </label>
                    <label className="text-sm font-medium sm:col-span-2">ผู้รับรอง
                      <input className={inputClass} maxLength={100} required={required} value={form.reviewer}
                        onChange={e => setForm({ ...form, reviewer: e.target.value })} />
                    </label>
                    <label className="text-sm font-medium sm:col-span-2">ขั้นตอนที่ทีมยืนยัน
                      <textarea className={inputClass} rows={4} maxLength={1500} required={required} value={form.procedureText}
                        onChange={e => setForm({ ...form, procedureText: e.target.value })} />
                    </label>
                    <label className="text-sm font-medium sm:col-span-2">เลขเอกสารหรือที่เก็บหลักฐาน
                      <textarea className={inputClass} rows={2} maxLength={500} required={required} value={form.evidenceReference}
                        onChange={e => setForm({ ...form, evidenceReference: e.target.value })} />
                    </label>
                  </fieldset>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="submit" disabled={busy || !dirty || !database}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#0C447C] px-3 py-2 text-sm text-white disabled:opacity-50">
                      <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกผลตรวจรับ'}
                    </button>
                    {topic.current && <p className="text-xs text-gray-600">ฉบับที่ {topic.current.Revision} บันทึกโดย {topic.current.SavedByUsername}</p>}
                  </div>
                </form>
                <div className="mt-4 border-t border-gray-200 pt-3">
                  <button type="button" disabled={busy} className="inline-flex items-center gap-1 text-sm font-semibold text-[#0C447C]"
                    onClick={() => void loadHistory(null)}><History size={16} /> ดูประวัติ</button>
                  {historyLoading && <p className="text-sm text-gray-600">กำลังโหลดประวัติ...</p>}
                  {history && history.length === 0 && <p className="mt-2 text-sm text-gray-600">ยังไม่มีการบันทึก</p>}
                  {history?.map(record => (
                    <details key={record.Revision} className="mt-2 rounded-lg border border-gray-200 p-2 text-sm">
                      <summary className="cursor-pointer">
                        ฉบับที่ {record.Revision} · {statusNames[record.Status]} · {record.SavedByUsername} · {bangkokTime.format(new Date(record.SavedAt))}
                      </summary>
                      {record.Reviewer && <p className="mt-2">ผู้รับรอง {record.Reviewer} · {record.ReviewDate?.slice(0, 10)}</p>}
                      <p className="mt-2 whitespace-pre-wrap break-words">{record.ProcedureText}</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-gray-600">{record.EvidenceReference}</p>
                    </details>
                  ))}
                  {nextBefore && <button type="button" disabled={busy} className="mt-2 text-sm text-[#0C447C]"
                    onClick={() => void loadHistory(nextBefore)}>โหลดรายการก่อนหน้า</button>}
                </div>
              </div>
            )}
          </div>
        )}
        <button type="button" disabled={busy} className="mt-3 text-xs text-gray-600 underline"
          onClick={() => { if (canDiscard()) void load(selected); }}>โหลดข้อมูลล่าสุด</button>
      </section>
    </div>
  );
}
