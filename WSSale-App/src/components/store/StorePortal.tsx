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
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Package className="w-5 h-5 sm:w-6 sm:h-6" /> คลัง / รับสินค้า
          </h1>
          <p className="hidden sm:block text-sm text-gray-500 mt-0.5">จัดการการโหลดสินค้าและชั่งออก</p>
        </div>
        <button onClick={loadData} className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-lg sm:rounded-xl border border-gray-200 bg-white shrink-0">
          <RefreshCw size={16} className={loading ? 'animate-spin text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      <div className="flex px-2 sm:px-4 pt-2 sm:pt-4 bg-white border-b border-gray-200 overflow-x-auto scrollbar-hide shrink-0">
        <button
          onClick={() => setActiveTab('LOADING')}
          className={`flex items-center gap-1.5 sm:gap-2 px-4 py-2.5 sm:px-6 sm:py-3 font-semibold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'LOADING' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Truck className="w-4 h-4 sm:w-[18px] sm:h-[18px]" /> โกดัง (โหลดสินค้า)
        </button>
        <button
          onClick={() => setActiveTab('SCALE')}
          className={`flex items-center gap-1.5 sm:gap-2 px-4 py-2.5 sm:px-6 sm:py-3 font-semibold text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'SCALE' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Scale className="w-4 h-4 sm:w-[18px] sm:h-[18px]" /> เครื่องชั่ง (ชั่งออก)
        </button>
      </div>

      <div className="p-3 sm:p-4 bg-white border-b border-gray-100 shrink-0">
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
          แสดง {filtered.length} รายการ ({activeTab === 'LOADING' ? 'รอจัดส่ง + รอรับสินค้า' : 'โหลดสินค้า'})
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
