import { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, Database, Server, AlertTriangle, Bell, BellOff, Cpu, CheckCircle, XCircle } from 'lucide-react';
import { fetchOpsStatus, fetchOpsErrors, testOpsAlert, type OpsStatus, type OpsError } from '../../services/api';

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}
function dbBadge(s: string) {
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
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [errors, setErrors] = useState<OpsError[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e] = await Promise.all([fetchOpsStatus(), fetchOpsErrors(50)]);
      setStatus(s); setErrors(Array.isArray(e.errors) ? e.errors : []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  async function doTest() {
    setTesting(true);
    try { const r = await testOpsAlert(); alert(r.message); }
    catch (e: unknown) { alert((e as Error).message); }
    finally { setTesting(false); }
  }

  const card = (icon: React.ReactNode, label: string, value: React.ReactNode, tone: string) => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
      <div className="min-w-0"><div className="text-xs text-gray-400">{label}</div><div className="text-xl font-bold text-gray-800 truncate">{value}</div></div>
    </div>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Activity size={26} /> สถานะระบบ (Observability)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">เวอร์ชัน · uptime · DB · error log · แจ้งเตือน · FR-030</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={doTest} disabled={testing || !status?.alertConfigured}
            title={status?.alertConfigured ? 'ส่งการแจ้งเตือนทดสอบ' : 'ยังไม่ได้ตั้ง ALERT_WEBHOOK_URL'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40">
            {status?.alertConfigured ? <Bell size={15} /> : <BellOff size={15} />} ทดสอบแจ้งเตือน
          </button>
          <button onClick={load} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {card(<Server size={20} />, 'เวอร์ชัน', status?.version ?? '–', 'bg-blue-50 text-blue-600')}
          {card(<Cpu size={20} />, 'Uptime', status ? fmtUptime(status.uptimeSec) : '–', 'bg-green-50 text-green-600')}
          {card(<Activity size={20} />, 'Requests', status?.requests ?? '–', 'bg-indigo-50 text-indigo-600')}
          {card(<AlertTriangle size={20} />, 'Errors', status?.errors ?? '–', (status?.errors ?? 0) > 0 ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400')}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-2 flex items-center gap-1.5"><Database size={14} /> ฐานข้อมูล</div>
            <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">SQL Server (WINSpeed/wf)</span>{dbBadge(status?.db.sqlserver ?? 'unknown')}</div>
            <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">MySQL (TruckScale)</span>{dbBadge(status?.db.mysql ?? 'unknown')}</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-2">สภาพแวดล้อม</div>
            <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">Env</span><span className="font-semibold text-gray-800">{status?.env ?? '–'}</span></div>
            <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">เริ่มทำงาน</span><span className="text-sm text-gray-700">{status ? new Date(status.startedAt).toLocaleString('th-TH') : '–'}</span></div>
            <div className="flex items-center justify-between py-1"><span className="text-sm text-gray-600">Error ล่าสุด</span><span className="text-sm text-gray-700">{status?.lastErrorAt ? new Date(status.lastErrorAt).toLocaleString('th-TH') : '–'}</span></div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-2">การแจ้งเตือน</div>
            <div className="flex items-center gap-2 py-1">
              {status?.alertConfigured
                ? <><Bell size={16} className="text-green-600" /><span className="text-sm text-green-700 font-semibold">เปิดใช้งาน (webhook)</span></>
                : <><BellOff size={16} className="text-gray-400" /><span className="text-sm text-gray-500">ยังไม่ตั้งค่า ALERT_WEBHOOK_URL</span></>}
            </div>
            <div className="text-xs text-gray-400 mt-1">รองรับ Slack / Discord / Teams / generic webhook</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">Error Log ล่าสุด ({errors.length})</div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase">
              <th className="text-left px-4 py-2">เวลา</th><th className="text-left px-4 py-2">ที่มา</th>
              <th className="text-left px-4 py-2">ข้อความ</th><th className="text-left px-4 py-2">Request</th><th className="text-center px-4 py-2">สถานะ</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {!loading && errors.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">ไม่มี error 🎉</td></tr>}
              {errors.map(norm).map((e, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{e.at ? new Date(e.at).toLocaleString('th-TH') : '–'}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{e.source}</td>
                  <td className="px-4 py-2 text-gray-700 max-w-md truncate" title={e.message}>{e.message}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{e.method} {e.path}</td>
                  <td className="px-4 py-2 text-center"><span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-600">{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
