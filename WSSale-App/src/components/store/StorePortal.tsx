import { useState, useEffect } from 'react';
import { Package, RefreshCw, Search, X, Scale, Truck } from 'lucide-react';
import { fetchSalesOrders } from '../../services/api';
import { useSocketEvent } from '../../hooks/useSocket';
import { PickingQueue } from './PickingQueue';
import type { SalesOrder } from '../../types';

export const StorePortal = () => {
  const [activeTab, setActiveTab] = useState<'LOADING' | 'SCALE'>('LOADING');
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'LOADING') {
        const [confirmed, picking] = await Promise.all([
          fetchSalesOrders({ status: 'CONFIRMED', limit: 100 }),
          fetchSalesOrders({ status: 'PICKING', limit: 100 }),
        ]);
        setOrders([...(picking.data || []), ...(confirmed.data || [])]);
      } else {
        const loaded = await fetchSalesOrders({ status: 'LOADED', limit: 100 });
        setOrders(loaded.data || []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [activeTab]);

  // Listen for real-time updates
  useSocketEvent('so_updated', () => {
    console.log('[Socket] so_updated event received. Refreshing StorePortal...');
    loadData();
  });

  const filtered = orders.filter(o =>
    !search ||
    o.custName.toLowerCase().includes(search.toLowerCase()) ||
    (o.wfRef || '').toLowerCase().includes(search.toLowerCase()) ||
    (o.truckPlate || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Package size={26} /> คลัง / รับสินค้า
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">จัดการการโหลดสินค้าและชั่งออก</p>
        </div>
        <button onClick={loadData} className="h-10 w-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex px-4 pt-4 bg-white border-b border-gray-200">
        <button
          onClick={() => setActiveTab('LOADING')}
          className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${
            activeTab === 'LOADING' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Truck size={18} /> โกดัง (โหลดสินค้า)
        </button>
        <button
          onClick={() => setActiveTab('SCALE')}
          className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${
            activeTab === 'SCALE' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Scale size={18} /> เครื่องชั่ง (ชั่งออก)
        </button>
      </div>

      <div className="p-4 bg-white border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา ลูกค้า / WfRef / ทะเบียนรถ..."
            className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-8 text-sm focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          แสดง {filtered.length} รายการ ({activeTab === 'LOADING' ? 'CONFIRMED + PICKING' : 'LOADED'})
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-20 text-gray-300">
            <RefreshCw className="animate-spin" size={32} />
          </div>
        ) : (
          <PickingQueue orders={filtered} onUpdate={loadData} mode={activeTab} />
        )}
      </div>
    </div>
  );
};
