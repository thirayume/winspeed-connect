import { useEffect, useState, useCallback } from 'react';
import { refreshQueue } from '../../utils/refresh-queue';
import {
  Activity, RefreshCw, Database, Server, AlertTriangle, Bell, BellOff, Cpu,
  CheckCircle, XCircle, Trash2, Users, Clock, ArrowRightLeft, ShieldCheck, Calendar
} from 'lucide-react';
import {
  fetchOpsStatus, fetchOpsErrors, fetchOpsOutbox, testOpsAlert, clearOpsErrors,
  fetchUserActivity, syncDatabaseUsers,
  type OpsStatus, type OpsError, type OutboxRow, type UserActivityResponse
} from '../../services/api';
import { appConfirm } from '../ui/AppAlert';

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function dbBadge(s: string) {
  if (s === 'winspeed:WGHD') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">WINSpeed · WGHD</span>;
  if (s === 'up') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><CheckCircle size={12} />up</span>;
  if (s === 'not-configured') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">not configured</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600"><XCircle size={12} />down</span>;
}

const norm = (e: OpsError) => ({
  at: e.OccurredAt || e.at || '', level: e.Level || e.level || 'ERROR',
  source: e.Source || e.source || '', message: e.Message || e.message || '',
  method: e.ReqMethod || e.method || '', path: e.ReqPath || e.path || '',
  status: e.StatusCode ?? e.status ?? '', ver: e.AppVersion || '',
});

export function OpsStatusPage() {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'activity' | 'dbsync'>('telemetry');
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [errors, setErrors] = useState<OpsError[]>([]);
  const [outbox, setOutbox] = useState<{ summary: { Status: string; n: number }[]; recent: OutboxRow[] }>({ summary: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  // User Activity state
  const [activityDate, setActivityDate] = useState(() => {
    const d = new Date();
    const bkk = new Date(d.getTime() + 7 * 3600 * 1000);
    return bkk.toISOString().slice(0, 10);
  });
  const [userActivity, setUserActivity] = useState<UserActivityResponse | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // DB Sync state
  const [targetDb, setTargetDb] = useState('dbwins_worldfert2');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string; synced?: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e, o] = await Promise.all([
        fetchOpsStatus(),
        fetchOpsErrors(50),
        fetchOpsOutbox().catch(() => ({ summary: [], recent: [] }))
      ]);
      setStatus(s);
      setErrors(Array.isArray(e.errors) ? e.errors : []);
      setOutbox(o);
      setForbidden(false);
    } catch (err: any) {
      if (err?.status === 403) { setForbidden(true); } else { console.error(err); }
    }
    setLoading(false);
  }, []);

  const loadActivity = useCallback(async (date: string) => {
    setActivityLoading(true);
    try {
      const data = await fetchUserActivity(date);
      setUserActivity(data);
    } catch (e) {
      console.error(e);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    const queue = refreshQueue(load, 0);
    const visible = () => { queue.pause(document.hidden); if (!document.hidden) queue.request(); };
    visible();
    const t = setInterval(() => queue.request(), 15000);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(t); queue.stop(); document.removeEventListener('visibilitychange', visible); };
  }, [load]);

  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivity(activityDate);
    }
  }, [activeTab, activityDate, loadActivity]);

  async function doTest() {
    setTesting(true);
    try { const r = await testOpsAlert(); alert(r.message); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setTesting(false); }
  }

  async function handleClearErrors() {
    if (!await appConfirm('ยืนยันล้างประวัติ Error ทั้งหมดหรือไม่? (รายการเก่าจะถูกเคลียร์ออกจากตาราง wf.ErrorLog)')) return;
    setClearing(true);
    try {
      await clearOpsErrors();
      await load();
      alert('ล้างประวัติ Error เรียบร้อย');
    } catch (e: any) {
      alert(e.message || 'เกิดข้อผิดพลาดในการล้างประวัติ');
    } finally {
      setClearing(false);
    }
  }

  async function handleSyncDb() {
    if (!await appConfirm(`ยืนยันซิงค์ผู้ใช้ บทบาท และสิทธิ์ จากฐานหลัก (dbwins_worldfert9) ไปยัง ${targetDb} หรือไม่?`)) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncDatabaseUsers(targetDb);
      setSyncResult(res);
    } catch (e: any) {
      setSyncResult({ ok: false, message: e.message || 'การซิงค์ล้มเหลว' });
    } finally {
      setSyncing(false);
    }
  }

  const card = (icon: React.ReactNode, label: string, value: React.ReactNode, tone: string) => (
    <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
      <div className="min-w-0"><div className="text-xs text-gray-400">{label}</div><div className="text-xl font-bold text-gray-800 truncate">{value}</div></div>
    </div>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      {status?.performance && (
        <details className="bg-white p-4 border-b text-sm">
          <summary className="cursor-pointer font-semibold text-[#0C447C]">
            ประสิทธิภาพ · กำลังประมวลผล {status.performance.activeRequests} คำขอ · สูงสุด {status.performance.peakRequests}
          </summary>
          <p className="my-2 text-xs text-gray-500">สะสมตั้งแต่เริ่มบริการ · P95 เป็นเพดานช่วงเวลา · เวลา DB query รวมการรอ connection · ไม่มีข้อความ SQL หรือข้อมูลในฟอร์ม</p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th>งาน</th><th>จำนวน</th><th>เฉลี่ย ms</th><th>P95 ≤ ms</th><th>สูงสุด ms</th><th>ช้า ≥ 3 วินาที</th>
                </tr>
              </thead>
              <tbody>
                {status.performance.timings.map(r => (
                  <tr key={r.operation} className="border-t">
                    <td>{r.operation}</td><td>{r.count}</td><td>{r.averageMs}</td><td>{r.p95UpperBoundMs}</td><td>{r.maxMs}</td><td>{r.slowCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Activity className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> สถานะระบบ (Observability)
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">
            มอนิเตอร์ออนไลน์ 15 นาที · ประสิทธิภาพเซิร์ฟเวอร์ · ประวัติ HR · จัดการ Error Log
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'telemetry' && (
            <button
              onClick={doTest}
              disabled={testing || !status?.alertConfigured}
              title={status?.alertConfigured ? 'ส่งการแจ้งเตือนทดสอบ' : 'ยังไม่ได้ตั้ง ALERT_WEBHOOK_URL'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >
              {status?.alertConfigured ? <Bell size={15} /> : <BellOff size={15} />} ทดสอบแจ้งเตือน
            </button>
          )}
          <button
            onClick={() => { if (activeTab === 'activity') loadActivity(activityDate); else load(); }}
            className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50"
          >
            <RefreshCw size={16} className={(loading || activityLoading) ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 flex gap-2">
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`py-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'telemetry'
              ? 'border-[#0C447C] text-[#0C447C]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Server size={16} /> ภาพรวม & Telemetry
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`py-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'activity'
              ? 'border-[#0C447C] text-[#0C447C]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users size={16} /> ผู้ใช้งาน & โหลดราย 15 นาที (HR Analytics)
        </button>
        <button
          onClick={() => setActiveTab('dbsync')}
          className={`py-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'dbsync'
              ? 'border-[#0C447C] text-[#0C447C]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ArrowRightLeft size={16} /> ซิงค์ฐานข้อมูล (Database Sync)
        </button>
      </div>

      {forbidden ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <AlertTriangle size={48} className="mx-auto mb-4 text-amber-400" />
            <h2 className="text-lg font-bold text-gray-700 mb-2">ไม่มีสิทธิ์ดู</h2>
            <p className="text-sm text-gray-500">บทบาทของคุณไม่มีสิทธิ์เข้าถึงหน้าสถานะระบบ กรุณาติดต่อ Admin</p>
          </div>
        </div>
      ) : activeTab === 'telemetry' ? (
        <div className="flex-1 overflow-y-auto p-0 sm:p-6 space-y-2 sm:space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {card(<Server size={20} />, 'เวอร์ชัน', status?.version ?? '–', 'bg-blue-50 text-blue-600')}
            {card(<Cpu size={20} />, 'Uptime', status ? fmtUptime(status.uptimeSec) : '–', 'bg-green-50 text-green-600')}
            {card(<Activity size={20} />, 'Requests', status?.requests ?? '–', 'bg-indigo-50 text-indigo-600')}
            {card(<AlertTriangle size={20} />, 'Errors', status?.errors ?? '–', (status?.errors ?? 0) > 0 ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400')}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
              <div className="text-xs text-gray-400 mb-2 flex items-center gap-1.5"><Database size={14} /> ฐานข้อมูล</div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">SQL Server (WINSpeed/wf)</span>{dbBadge(status?.db.sqlserver ?? 'unknown')}</div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">แหล่งข้อมูลการชั่ง</span>{dbBadge(status?.db.weighing ?? 'unknown')}</div>
            </div>
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
              <div className="text-xs text-gray-400 mb-2">สภาพแวดล้อม</div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">Env</span><span className="font-semibold text-gray-800">{status?.env ?? '–'}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">เริ่มทำงาน</span><span className="text-sm text-gray-700">{status ? new Date(status.startedAt).toLocaleString('th-TH') : '–'}</span></div>
              <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">Error ล่าสุด</span><span className="text-sm text-gray-700">{status?.lastErrorAt ? new Date(status.lastErrorAt).toLocaleString('th-TH') : '–'}</span></div>
            </div>
            <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm p-4">
              <div className="text-xs text-gray-400 mb-2">การแจ้งเตือน</div>
              <div className="flex items-center gap-2 py-1">
                {status?.alertConfigured
                  ? <><Bell size={16} className="text-green-600" /><span className="text-sm text-green-700 font-semibold">เปิดใช้งาน (webhook)</span></>
                  : <><BellOff size={16} className="text-gray-400" /><span className="text-sm text-gray-500">ยังไม่ตั้งค่า ALERT_WEBHOOK_URL</span></>}
              </div>
              <div className="text-xs text-gray-400 mt-1">รองรับ Slack / Discord / Teams / generic webhook</div>
            </div>
          </div>

          {/* Error Log Section */}
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-sm font-semibold text-gray-700">Error Log ล่าสุด ({errors.length})</span>
                <span className="ml-2 text-xs text-gray-400">บันทึกถาวรในตาราง wf.ErrorLog</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearErrors}
                  disabled={clearing || errors.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={13} /> {clearing ? 'กำลังล้าง...' : 'ล้างประวัติ Error (Clear / Archive)'}
                </button>
              </div>
            </div>

            {/* Note banner explaining previous 500s */}
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-600 shrink-0" />
              <span>
                <strong>หมายเหตุชี้แจง:</strong> รายการ HTTP 500 ในประวัติส่วนใหญ่เกิดจาก GET /api/master/customers ก่อนรัน Migration 172 เมื่อแก้ไขแล้วใน Production คำขอทั้งหมดตอบ 200 OK สามารถกด "ล้างประวัติ Error" เพื่อเคลียร์รายการเก่าได้
              </span>
            </div>

            <table className="w-full text-sm min-w-full">
              <thead className="whitespace-nowrap">
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="text-left px-4 py-2 whitespace-nowrap">เวลา</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">ที่มา</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">ข้อความ</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">Request</th>
                  <th className="text-center px-4 py-2 whitespace-nowrap">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {!loading && errors.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 whitespace-nowrap">ไม่มี error ในระบบ 🎉</td></tr>
                )}
                {errors.map(norm).map((e, i) => (
                  <tr key={i} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{e.at ? new Date(e.at).toLocaleString('th-TH') : '–'}</td>
                    <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{e.source}</td>
                    <td className="px-4 py-2 text-gray-700 max-w-md truncate" title={e.message}>{e.message}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{e.method} {e.path}</td>
                    <td className="px-4 py-2 text-center whitespace-nowrap"><span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-600">{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Integration outbox (FR-029) */}
          <div className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Integration Outbox</span>
              <div className="flex gap-1.5">
                {outbox.summary.map(s => (
                  <span key={s.Status} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    s.Status === 'DONE' ? 'bg-green-100 text-green-700' : s.Status === 'FAILED' ? 'bg-red-100 text-red-600' :
                    s.Status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{s.Status} {s.n}</span>
                ))}
              </div>
            </div>
            <table className="w-full text-sm min-w-full">
              <thead className="whitespace-nowrap">
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <th className="text-left px-4 py-2 whitespace-nowrap">Event</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">Aggregate</th>
                  <th className="text-center px-4 py-2 whitespace-nowrap">สถานะ</th>
                  <th className="text-center px-4 py-2 whitespace-nowrap">retry</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">เวลา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {outbox.recent.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 whitespace-nowrap">ยังไม่มี event</td></tr>}
                {outbox.recent.map(o => (
                  <tr key={o.Id}>
                    <td className="px-4 py-2 font-medium text-gray-700 whitespace-nowrap">{o.EventType}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{o.AggregateId}</td>
                    <td className="px-4 py-2 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        o.Status === 'DONE' ? 'bg-green-100 text-green-700' : o.Status === 'FAILED' ? 'bg-red-100 text-red-600' :
                        o.Status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                        {o.Status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-gray-500 whitespace-nowrap">{o.RetryCount || ''}</td>
                    <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{new Date(o.CreatedAt).toLocaleString('th-TH')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'activity' ? (
        /* User Activity & 15-Minute Slot Monitoring Tab */
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Calendar size={18} className="text-[#0C447C]" />
              <span className="text-sm font-bold text-gray-700">เลือกวันที่ตรวจสอบ:</span>
              <input
                type="date"
                value={activityDate}
                onChange={e => setActivityDate(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm font-semibold bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0C447C]"
              />
              <button
                onClick={() => {
                  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
                  setActivityDate(today);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                วันนี้
              </button>
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-1.5">
              <Clock size={14} /> ช่วงเวลาละ 15 นาที (96 ช่วง/วัน) · โหมดวิเคราะห์ HR & โหลดระบบ
            </div>
          </div>

          {/* Activity KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {card(<Users size={20} />, 'ผู้ใช้ออนไลน์ขณะนี้', userActivity?.activeNowCount ?? 0, 'bg-emerald-50 text-emerald-600')}
            {card(<CheckCircle size={20} />, 'ผู้ใช้งานทั้งหมดวันนี้', userActivity?.totalActiveUsersToday ?? 0, 'bg-blue-50 text-blue-600')}
            {card(<Activity size={20} />, 'พีคสูงสุดพร้อมกัน (Peak)', userActivity?.peakConcurrency ?? 0, 'bg-amber-50 text-amber-600')}
            {card(<Server size={20} />, 'คำขอรวมทั้งวัน (Requests)', userActivity?.totalRequestsToday?.toLocaleString() ?? 0, 'bg-purple-50 text-purple-600')}
          </div>

          {/* 15-Minute Timeline Heatmap / Bar Chart */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <Clock size={16} className="text-[#0C447C]" /> กราฟความหนาแน่นผู้ใช้งานราย 15 นาที (Concurrency Timeline)
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">แกนตั้งแสดงจำนวนผู้ใช้ออนไลน์พร้อมกันในแต่ละช่วง 15 นาที (00:00 - 23:45 น.)</p>
              </div>
            </div>

            {/* Timeline Bars */}
            <div className="pt-4 pb-2 overflow-x-auto">
              <div className="min-w-[800px]">
                <div className="h-36 flex items-end gap-1 px-2 border-b border-gray-200">
                  {(userActivity?.slots || []).map((s, idx) => {
                    const maxVal = Math.max(1, userActivity?.peakConcurrency || 1);
                    const heightPct = s.activeUsers > 0 ? Math.max(8, Math.round((s.activeUsers / maxVal) * 100)) : 0;
                    const isPeak = s.activeUsers === userActivity?.peakConcurrency && s.activeUsers > 0;
                    return (
                      <div
                        key={idx}
                        className="flex-1 flex flex-col items-center group relative h-full justify-end"
                      >
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                          <div className="bg-gray-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap">
                            <div className="font-bold text-amber-300">{s.time} น.</div>
                            <div>ออนไลน์: {s.activeUsers} คน</div>
                            <div>คำขอ: {s.totalRequests} reqs</div>
                          </div>
                          <div className="w-2 h-2 bg-gray-900 rotate-45 -mt-1"></div>
                        </div>

                        {/* Bar */}
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full rounded-t transition-all ${
                            isPeak
                              ? 'bg-amber-500 hover:bg-amber-600'
                              : s.activeUsers > 0
                              ? 'bg-[#0C447C] hover:bg-blue-800 opacity-80 hover:opacity-100'
                              : 'bg-transparent'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* X-axis Labels (every 2 hours) */}
                <div className="flex justify-between px-2 pt-2 text-[10px] text-gray-400 font-mono">
                  <span>00:00</span><span>02:00</span><span>04:00</span><span>06:00</span>
                  <span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span>
                  <span>16:00</span><span>18:00</span><span>20:00</span><span>22:00</span><span>23:45</span>
                </div>
              </div>
            </div>
          </div>

          {/* User Working Hours Breakdown (HR Analytics) */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">รายละเอียดการเข้าใช้และเวลาทำงานของแต่ละ User (HR Breakdown)</h3>
                <p className="text-xs text-gray-400 mt-0.5">คำนวณจากกิจกรรมที่บันทึกไว้ในระบบ ณ วันที่ {activityDate}</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-[#0C447C]">
                {userActivity?.users?.length || 0} ผู้ใช้งาน
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-100">
                    <th className="text-left px-5 py-3">ผู้ใช้งาน (Username)</th>
                    <th className="text-left px-4 py-3">ชื่อ-นามสกุล</th>
                    <th className="text-center px-4 py-3">บทบาท (Role)</th>
                    <th className="text-center px-4 py-3">เริ่มงาน (First Active)</th>
                    <th className="text-center px-4 py-3">ล่าสุด (Last Active)</th>
                    <th className="text-center px-4 py-3">ช่วงที่แอคทีฟ (15m Slots)</th>
                    <th className="text-right px-5 py-3">คำขอรวม (Requests)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(!userActivity?.users || userActivity.users.length === 0) ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-gray-400">
                        ไม่พบข้อมูลกิจกรรมของผู้ใช้ในวันที่เลือก
                      </td>
                    </tr>
                  ) : (
                    userActivity.users.map(u => (
                      <tr key={u.userId} className="hover:bg-gray-50/60">
                        <td className="px-5 py-3 font-semibold text-gray-800">
                          {u.username}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {u.displayName}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-[#0C447C]">
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-emerald-700 font-bold">
                          {u.firstActiveTime} น.
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-gray-600">
                          {u.lastActiveTime} น.
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-semibold text-gray-700">{u.activeSlotsCount}</span>
                          <span className="text-xs text-gray-400 ml-1">
                            (~{Math.round((u.activeSlotsCount * 15) / 60 * 10) / 10} ชม.)
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-bold text-gray-800">
                          {u.totalRequests.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Database Sync Tab */
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="max-w-2xl bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#0C447C] flex items-center justify-center shrink-0">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800">เครื่องมือซิงค์บัญชีและสิทธิ์ข้ามฐานข้อมูล (Cross-Database Sync)</h2>
                <p className="text-xs text-gray-500 mt-1">
                  คัดลอกโครงสร้างและข้อมูลบัญชีผู้ใช้, บทบาท (RoleProfile), สิทธิ์ (RolePermission) และการผูกบทบาท (UserRole) จากฐานหลัก <strong>(dbwins_worldfert9)</strong> ไปยังฐานข้อมูลปลายทางแบบ Idempotent
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1.5">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-600" /> ทำไมจึงต้องซิงค์?
              </div>
              <div>
                ระบบใช้ <strong>dbwins_worldfert9 เป็น Single Auth Authority</strong> แต่หากมีการสลับฐานข้อมูลระบบหลักในอนาคต หรือต้องการให้ผู้ใช้สามารถล็อกอินเข้าสู่ฐานข้อมูล UAT / RD ได้อย่างสมบูรณ์แบบ เครื่องมือนี้จะจำลองบัญชีผู้ใช้และรหัสผ่านทั้งหมดให้ตรงกันทันที
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <label className="block text-xs font-bold text-gray-700">เลือกฐานข้อมูลปลายทางที่ต้องการซิงค์:</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTargetDb('dbwins_worldfert2')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    targetDb === 'dbwins_worldfert2'
                      ? 'border-[#0C447C] bg-blue-50/50 ring-2 ring-[#0C447C]/20'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-bold text-sm text-gray-800">dbwins_worldfert2</div>
                  <div className="text-xs text-amber-700 font-semibold mt-0.5">PROD_DB_RD (บัญชี/สรรพากร)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetDb('dbwins_worldfert9_uat')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    targetDb === 'dbwins_worldfert9_uat'
                      ? 'border-[#0C447C] bg-blue-50/50 ring-2 ring-[#0C447C]/20'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-bold text-sm text-gray-800">dbwins_worldfert9_uat</div>
                  <div className="text-xs text-emerald-700 font-semibold mt-0.5">UAT_DB (ฐานทดสอบ)</div>
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleSyncDb}
                disabled={syncing}
                className="w-full py-3 px-4 rounded-xl font-bold text-white bg-[#0C447C] hover:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <ArrowRightLeft size={16} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'กำลังดำเนินการซิงค์...' : `เริ่มซิงค์ไปยัง ${targetDb}`}
              </button>
            </div>

            {syncResult && (
              <div className={`p-4 rounded-xl text-sm border ${
                syncResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <div className="font-bold flex items-center gap-1.5">
                  {syncResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                  {syncResult.message}
                </div>
                {syncResult.synced && (
                  <div className="mt-2 text-xs grid grid-cols-2 gap-2 text-emerald-700">
                    <div>• บัญชีผู้ใช้: {syncResult.synced.users} รายการ</div>
                    <div>• บทบาท: {syncResult.synced.roles} บทบาท</div>
                    <div>• สิทธิ์การใช้งาน: {syncResult.synced.permissions} สิทธิ์</div>
                    <div>• การผูกสิทธิ์: {syncResult.synced.memberships} รายการ</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
