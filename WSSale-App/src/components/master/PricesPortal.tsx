import { useState } from 'react';
import { Tag, BookOpen } from 'lucide-react';
import { PricesManager } from './PricesManager';
import { PriceBookManager } from './PriceBookManager';

type PriceTab = 'individual' | 'pricebook';

export const PricesPortal = ({ initialSearch = '' }: { initialSearch?: string }) => {
  const [activeTab, setActiveTab] = useState<PriceTab>('individual');

  return (
    <div className="h-full flex flex-col relative w-full bg-slate-50">
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-4 shrink-0">
        <button
          onClick={() => setActiveTab('individual')}
          className={`py-2 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'individual' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Tag size={16} /> รายการราคารายตัว
        </button>
        <button
          onClick={() => setActiveTab('pricebook')}
          className={`py-2 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'pricebook' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <BookOpen size={16} /> Price Book (รายการเหมา)
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'individual' && <PricesManager initialSearch={initialSearch} />}
        {activeTab === 'pricebook' && <PriceBookManager />}
      </div>
    </div>
  );
};
