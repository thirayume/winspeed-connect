import { useEffect, useState } from 'react';
import { BookOpen, Lock } from 'lucide-react';
import { PriceBookManager } from './PriceBookManager';
import { CostBookManager } from './CostBookManager';
import { useAuthStore } from '../../store/auth-store';

type PriceTab = 'pricebook' | 'costlist';

export const PricesPortal = ({
  priceTarget = null,
  onClearTarget,
}: {
  priceTarget?: { goodId: string; goodCode?: string; goodName?: string } | null;
  onClearTarget?: () => void;
}) => {
  const user = useAuthStore(s => s.user);
  const actions = user?.capabilities?.actions;
  const role = user?.role || '';

  const canAccessPricing = actions
    ? (actions.includes('pricing.view') || actions.includes('pricing.manage'))
    : ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'].includes(role);
  const canAccessCost = actions
    ? (actions.includes('cost.view') || actions.includes('cost.manage'))
    : ['ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'].includes(role);

  const [activeTab, setActiveTab] = useState<PriceTab>(canAccessPricing ? 'pricebook' : 'costlist');

  useEffect(() => {
    if (activeTab === 'pricebook' && !canAccessPricing && canAccessCost) {
      setActiveTab('costlist');
    } else if (activeTab === 'costlist' && !canAccessCost && canAccessPricing) {
      setActiveTab('pricebook');
    }
  }, [activeTab, canAccessPricing, canAccessCost]);

  return (
    <div className="h-full flex flex-col relative w-full bg-slate-50">
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-4 shrink-0">
        {canAccessPricing && (
          <button
            onClick={() => setActiveTab('pricebook')}
            className={`py-2 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'pricebook' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BookOpen size={16} /> ตารางราคาขาย (Pricelist / WinSpeed)
          </button>
        )}
        {canAccessCost && (
          <button
            onClick={() => setActiveTab('costlist')}
            className={`py-2 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'costlist' ? 'border-rose-600 text-rose-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Lock size={16} /> ตารางราคาทุน (Costlist)
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        {canAccessPricing && activeTab === 'pricebook' && (
          <PriceBookManager targetGood={priceTarget} onClearTarget={onClearTarget} />
        )}
        {canAccessCost && activeTab === 'costlist' && <CostBookManager />}
      </div>
    </div>
  );
};
