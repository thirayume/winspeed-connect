import { useEffect, useState } from 'react';
import { Database, Package, Users, Tag, Truck, Gift, ListChecks } from 'lucide-react';
import { GoodsManager } from './GoodsManager';
import { CustomersManager } from './CustomersManager';
import { TrucksManager } from './TrucksManager';
import { TruckTypesManager } from './TruckTypesManager';
import { GiveawaysManager } from './GiveawaysManager';
import { PricesPortal } from './PricesPortal';
import { EditReasonsManager } from './EditReasonsManager';
import { useAuthStore } from '../../store/auth-store';

type Tab = 'goods' | 'prices' | 'customers' | 'truck-types' | 'trucks' | 'giveaways' | 'edit-reasons';

export const MasterDataPortal = () => {
  const user = useAuthStore(s => s.user);
  const actions = user?.capabilities?.actions;
  const role = user?.role || '';
  const canAccessGeneralMaster = actions
    ? actions.includes('master.manage')
    : ['ADMIN', 'C_LEVEL'].includes(role);
  const canAccessPricingOrCost = actions
    ? ['pricing.view', 'pricing.manage', 'cost.view', 'cost.manage'].some(a => actions.includes(a))
    : ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'].includes(role);

  const [activeTab, setActiveTab] = useState<Tab>(canAccessGeneralMaster ? 'goods' : 'prices');
  const [truckSearch, setTruckSearch] = useState('');
  const [priceTarget, setPriceTarget] = useState<{ goodId: string; goodCode?: string; goodName?: string } | null>(null);

  useEffect(() => {
    if (!canAccessGeneralMaster && canAccessPricingOrCost && activeTab !== 'prices') {
      setActiveTab('prices');
    } else if (canAccessGeneralMaster && !canAccessPricingOrCost && activeTab === 'prices') {
      setActiveTab('goods');
    }
  }, [canAccessGeneralMaster, canAccessPricingOrCost, activeTab]);

  const handleViewTrucks = (custName: string) => {
    setTruckSearch(custName);
    setActiveTab('trucks');
  };

  const handleViewPrices = (target: { goodId: string; goodCode?: string; goodName?: string }) => {
    setPriceTarget(target);
    setActiveTab('prices');
  };

  return (
    <div className="h-full flex flex-col w-full overflow-hidden max-w-full" style={{ background: '#F1EFE8' }}>
      <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Database className="w-5 h-5 sm:w-[26px] sm:h-[26px]" />
            {canAccessGeneralMaster ? 'จัดการข้อมูลหลัก' : 'ต้นทุน & ราคาขาย'}
          </h1>
          <p className="hidden sm:block text-sm text-gray-500 mt-0.5">
            {canAccessGeneralMaster
              ? 'ตั้งค่าข้อมูลสินค้า รูปภาพ หมายเหตุลูกค้า ตารางราคาขาย (Pricelist) และราคาทุน (Costlist)'
              : 'จัดการตารางราคาขาย (Pricelist / WinSpeed Sync) และตารางราคาทุน (Costlist)'}
          </p>
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 flex gap-4 sm:gap-6 overflow-x-auto scrollbar-hide shrink-0">
        {canAccessGeneralMaster && (
          <button
            onClick={() => setActiveTab('goods')}
            className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'goods' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Package size={16} /> ข้อมูลสินค้า
          </button>
        )}
        {canAccessPricingOrCost && (
          <button
            onClick={() => setActiveTab('prices')}
            className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'prices' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Tag size={16} /> ต้นทุน & ราคาขาย
          </button>
        )}
        {canAccessGeneralMaster && (
          <>
            <button
              onClick={() => setActiveTab('customers')}
              className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'customers' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users size={16} /> ข้อมูลลูกค้า
            </button>
            <button
              onClick={() => setActiveTab('truck-types')}
              className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'truck-types' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Truck size={16} /> ประเภทรถ/ลิมิต
            </button>
            <button
              onClick={() => setActiveTab('trucks')}
              className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'trucks' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Truck size={16} /> ประวัติรถบรรทุก
            </button>
            <button
              onClick={() => setActiveTab('giveaways')}
              className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'giveaways' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Gift size={16} /> ของแถม
            </button>
            <button
              onClick={() => setActiveTab('edit-reasons')}
              className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
                activeTab === 'edit-reasons' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <ListChecks size={16} /> เหตุผลขอแก้ไข
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-hidden p-2 sm:p-4 bg-white/50">
        {canAccessGeneralMaster && activeTab === 'goods' && <GoodsManager onViewPrices={handleViewPrices} />}
        {canAccessPricingOrCost && activeTab === 'prices' && (
          <div className="h-full rounded-none sm:rounded-2xl border-y sm:border border-gray-200 overflow-hidden shadow-sm">
            <PricesPortal priceTarget={priceTarget} onClearTarget={() => setPriceTarget(null)} />
          </div>
        )}
        {canAccessGeneralMaster && activeTab === 'customers' && <CustomersManager onViewTrucks={handleViewTrucks} />}
        {canAccessGeneralMaster && activeTab === 'truck-types' && <TruckTypesManager />}
        {canAccessGeneralMaster && activeTab === 'trucks' && <TrucksManager initialSearch={truckSearch} />}
        {canAccessGeneralMaster && activeTab === 'giveaways' && <GiveawaysManager />}
        {canAccessGeneralMaster && activeTab === 'edit-reasons' && (
          <div className="h-full overflow-auto rounded-none sm:rounded-2xl border-y sm:border border-gray-200 shadow-sm bg-white">
            <EditReasonsManager />
          </div>
        )}
      </div>
    </div>
  );
};
