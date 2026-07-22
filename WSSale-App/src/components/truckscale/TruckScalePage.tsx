import { useEffect, useState, useCallback } from 'react';
import { Scale, RefreshCw, Search, X, Wifi, WifiOff, Package } from 'lucide-react';
import { pingTruckScale, fetchTruckScaleWeigh, fetchTruckScaleDetail } from '../../services/api';
import type { TruckScaleWeigh, TruckScaleDetail } from '../../types';

const kg = (n: number) => `${Number(n).toLocaleString()} กก.`;
const ton = (n: number) => `${(Number(n) / 1000).toLocaleString('th-TH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ตัน`;
const fmtTon = (n: number) => (Number(n) / 1000).toLocaleString('th-TH', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function TruckScalePage() {
  const [status, setStatus] = useState<{ ok: boolean; total?: number; completed?: number } | null>(null);
  const [mode, setMode] = useState<'plate' | 'movebill'>('plate');
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<TruckScaleWeigh[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TruckScaleDetail | null>(null);

  useEffect(() => { pingTruckScale().then(p => setStatus({ ok: p.ok, total: p.totalWeighings, completed: p.completed })).catch(() => setStatus({ ok: false })); }, []);

  const search = useCallback(async () => {
    if (!term.trim()) { setRows([]); return; }
    setLoading(true);
    try { setRows(await fetchTruckScaleWeigh({ [mode]: term.trim(), limit: 100 })); }
    catch (e) { console.error(e); setRows([]); }
    setLoading(false);
  }, [term, mode]);

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}><Scale className="w-5 h-5 sm:w-[26px] sm:h-[26px]" /> TruckScale — เครื่องชั่ง</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate">ค้นน้ำหนักชั่งจริง (db_truckscale) ด้วยทะเบียนรถ / movebill</p>
        </div>
        {status && (
          <span data-testid="truckscale-status" className={`px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${status.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {status.ok ? <Wifi size={16} /> : <WifiOff size={16} />}
            {status.ok ? `เชื่อมต่อแล้ว · ${Number(status.total).toLocaleString()} ใบชั่ง` : 'เชื่อมต่อไม่ได้'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-0 sm:p-6 space-y-0 sm:space-y-4">
        <div className="bg-white rounded-none sm:rounded-lg sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm sm:shadow-sm shadow-none p-3 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
            {(['plate', 'movebill'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} className={`flex-1 sm:flex-none px-3 py-2 text-sm font-semibold ${mode === m ? 'bg-[#0C447C] text-white' : 'bg-white text-gray-600'}`}>
                {m === 'plate' ? 'ทะเบียนรถ' : 'Movebill'}
              </button>
            ))}
          </div>
          <div className="flex flex-1 gap-2">
            <div className="flex-1 flex items-center gap-2 border border-gray-200 rounded-lg px-3">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }}
                placeholder={mode === 'plate' ? 'เช่น สร82 หรือ สร82-0235' : 'เช่น 69050021'}
                className="flex-1 py-2 text-sm outline-none min-w-0" />
            </div>
            <button onClick={search} className="px-4 py-2 rounded-lg text-white text-sm font-semibold shrink-0" style={{ background: '#0C447C' }}>ค้นหา</button>
          </div>
        </div>

        <div className="bg-white rounded-none sm:rounded-lg sm:rounded-2xl border-y sm:border border-gray-100 shadow-sm sm:shadow-sm shadow-none overflow-hidden">
          {loading ? (
            <div className="py-16 flex justify-center"><RefreshCw size={26} className="animate-spin text-gray-300" /></div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">พิมพ์คำค้น แล้วกดค้นหา</p>
          ) : (
            <div className="overflow-x-auto w-full scrollbar-hide">
            <table className="w-full text-sm min-w-full">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase whitespace-nowrap">
                <tr>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Movebill</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">ทะเบียน</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">ลูกค้า</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">ชั่งเข้า</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">ชั่งออก</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">สุทธิ</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">วันที่ออก</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">ประเภท</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.Sequence} onClick={() => fetchTruckScaleDetail(r.Sequence).then(setDetail).catch(console.error)} className="hover:bg-blue-50/40 cursor-pointer">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#0C447C] whitespace-nowrap">{r.Movebill}</td>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{r.Plate}</td>
                    <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate" title={r.CustName}>{r.CustName}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 whitespace-nowrap">{fmtTon(r.WeightIn)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 whitespace-nowrap">{fmtTon(r.WeightOut)}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#0C447C] whitespace-nowrap">{fmtTon(r.WeightNet)}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">{r.DateOut && r.DateOut !== '0' ? r.DateOut : '—'}</td>
                    <td className="px-4 py-2.5 text-center text-xs whitespace-nowrap">{r.WeighType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-800 flex items-center gap-2"><Scale size={18} className="text-[#0C447C]" /> ใบชั่ง {detail.Movebill}</h2>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <div><span className="text-gray-400">ทะเบียน:</span> <b className="font-mono">{detail.Plate}</b></div>
              <div><span className="text-gray-400">ลูกค้า:</span> {detail.CustName}</div>
              <div><span className="text-gray-400">ชั่งเข้า:</span> {kg(detail.WeightIn)}</div>
              <div><span className="text-gray-400">ชั่งออก:</span> {kg(detail.WeightOut)}</div>
              <div className="col-span-2 text-base"><span className="text-gray-400">สุทธิ:</span> <b className="text-[#0C447C]">{kg(detail.WeightNet)} ({ton(detail.WeightNet)})</b></div>
            </div>
            <div className="border-t border-gray-100 pt-2">
              <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1"><Package size={12} /> สินค้า</div>
              {detail.products.length === 0 ? <p className="text-xs text-gray-400">—</p> : detail.products.map((p, i) => (
                <div key={i} className="flex justify-between text-sm py-0.5"><span>{p.GoodName} {p.Brand ? `· ${p.Brand}` : ''}</span><span className="text-gray-500">{p.WantWeightTon} ตัน · {p.Destination}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
