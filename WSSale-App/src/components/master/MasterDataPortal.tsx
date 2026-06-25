import { useState } from 'react';
import { Database, Package, Users, Tag, Truck, Gift } from 'lucide-react';
import { GoodsManager } from './GoodsManager';
import { CustomersManager } from './CustomersManager';
import { TrucksManager } from './TrucksManager';
import { GiveawaysManager } from './GiveawaysManager';
import { PricesManager } from './PricesManager';
import { DbModeSwitch } from '../common/DbModeSwitch';

type Tab = 'goods' | 'prices' | 'customers' | 'trucks' | 'giveaways';

export const MasterDataPortal = () => {
  const [activeTab, setActiveTab] = useState<Tab>('goods');
  const [truckSearch, setTruckSearch] = useState('');
  const [priceSearch, setPriceSearch] = useState('');

  const handleViewTrucks = (custName: string) => {
    setTruckSearch(custName);
    setActiveTab('trucks');
  };

  const handleViewPrices = (goodName: string) => {
    setPriceSearch(goodName);
    setActiveTab('prices');
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#F1EFE8' }}>
      <div className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}>
            <Database size={26} /> จัดการข้อมูลหลัก (Master Data)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            ตั้งค่าข้อมูลสินค้า รูปภาพ หมายเหตุลูกค้า และราคาเบื้องต้น
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-1">
          <DbModeSwitch />
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 px-6 flex gap-6">
        <button
          onClick={() => setActiveTab('goods')}
          className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'goods' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package size={16} /> ข้อมูลสินค้า
        </button>
        <button
          onClick={() => setActiveTab('prices')}
          className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'prices' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tag size={16} /> ราคาขาย
        </button>
        <button
          onClick={() => setActiveTab('customers')}
          className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'customers' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users size={16} /> ข้อมูลลูกค้า
        </button>
        <button
          onClick={() => setActiveTab('trucks')}
          className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'trucks' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Truck size={16} /> รถบรรทุก
        </button>
        <button
          onClick={() => setActiveTab('giveaways')}
          className={`py-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'giveaways' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Gift size={16} /> ของแถม
        </button>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        {activeTab === 'goods' && <GoodsManager onViewPrices={handleViewPrices} />}
        {activeTab === 'prices' && <PricesManager initialSearch={priceSearch} />}
        {activeTab === 'customers' && <CustomersManager onViewTrucks={handleViewTrucks} />}
        {activeTab === 'trucks' && <TrucksManager initialSearch={truckSearch} />}
        {activeTab === 'giveaways' && <GiveawaysManager />}
      </div>
    </div>
  );
};
