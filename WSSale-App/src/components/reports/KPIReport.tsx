import React, { useState, useEffect } from 'react';
import { BarChart3, AlertTriangle, TrendingUp, Users } from 'lucide-react';
import { Card, cn } from '../ui/Base';

interface KPIEntry {
  Sales: string;
  Orders: number;
  Cancellations: number;
  Changes: number;
  Rate: number;
}

export function KPIReport() {
  const [data, setData] = useState<KPIEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3000/api/reports/kpi')
      .then(res => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">
      Loading KPI Data...
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 space-y-8 animate-in fade-in duration-500">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
          KPI Report — ประวัติการยกเลิกและเปลี่ยนแปลง
        </h1>
        <p className="text-slate-500">
          รายงานข้อมูลการดำเนินงานของพนักงานขาย เพื่อระบุจุดที่ต้องปรับปรุงและพัฒนา
        </p>
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-xl bg-slate-900">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50">
                <th className="px-6 py-4 text-sm font-bold text-slate-400 uppercase tracking-wider">Sales</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-400 uppercase tracking-wider text-center">ออเดอร์</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-400 uppercase tracking-wider text-center">ยกเลิก</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-400 uppercase tracking-wider text-center">เปลี่ยนแปลง</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-400 uppercase tracking-wider text-right">อัตรา (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.map((row) => (
                <tr key={row.Sales} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-5 text-sm font-medium text-slate-200">
                    {row.Sales}
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-400 text-center font-mono">{row.Orders}</td>
                  <td className="px-6 py-5 text-sm text-slate-400 text-center font-mono">{row.Cancellations}</td>
                  <td className="px-6 py-5 text-sm text-slate-400 text-center font-mono">{row.Changes}</td>
                  <td className={cn(
                    "px-6 py-5 text-sm font-bold text-right font-mono",
                    row.Rate > 50 ? "text-red-500" : row.Rate > 30 ? "text-amber-500" : "text-emerald-500"
                  )}>
                    {row.Rate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="p-5 rounded-xl bg-amber-950/20 border border-amber-900/30 flex items-center gap-4 text-amber-200">
        <div className="h-10 w-10 rounded-full bg-amber-900/40 flex items-center justify-center shrink-0">
          <AlertTriangle size={20} className="text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-semibold">
            Sales ที่มีอัตราสูง &gt; 50% ต้องได้รับการอบรมหรือติดตามเพิ่มเติม
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-slate-200 shadow-sm flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <TrendingUp size={24} />
            </div>
            <div>
                <div className="text-xs font-bold text-muted-foreground uppercase">Average Rate</div>
                <div className="text-2xl font-bold">24.5%</div>
            </div>
        </Card>
        <Card className="p-6 border-slate-200 shadow-sm flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                <Users size={24} />
            </div>
            <div>
                <div className="text-xs font-bold text-muted-foreground uppercase">Top Performer</div>
                <div className="text-2xl font-bold">มานะ ส.</div>
            </div>
        </Card>
        <Card className="p-6 border-slate-200 shadow-sm flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                <BarChart3 size={24} />
            </div>
            <div>
                <div className="text-xs font-bold text-muted-foreground uppercase">Total Events</div>
                <div className="text-2xl font-bold">142</div>
            </div>
        </Card>
      </div>
    </div>
  );
}
