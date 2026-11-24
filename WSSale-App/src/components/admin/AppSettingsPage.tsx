import { useState } from 'react';
import {
  Settings,
  Calendar,
  ShieldAlert,
  Percent,
  Truck,
  Ticket,
  Tag,
  History,
  FileSpreadsheet,
  CreditCard,
  RotateCcw,
  ToggleLeft,
  Gift,
} from 'lucide-react';
import { SystemSettingsModal, type TabKey } from './SystemSettingsModal';
import { AdminReportTemplateModal } from './AdminReportTemplateModal';
import { GlobalDataWindowSetting } from './GlobalDataWindowSetting';
import { ResetRebateSetting } from './ResetRebateSetting';
import { useFeature } from '../../utils/capabilities';
import { MenuSwitchesSetting } from './MenuSwitchesSetting';
import { GiveawaySetZeroSetting } from './GiveawaySetZeroSetting';
import { useAuthStore } from '../../store/auth-store';
import { confirmLeaveEditors } from '../../utils/unsaved-changes';

export type SettingsTabKey = TabKey | 'reports' | 'data-window' | 'rebate-reset' | 'menus' | 'giveaway-zero';

const TABS: { key: SettingsTabKey; name: string; Icon: any }[] = [
  { key: 'pickup', name: 'กำหนดรับสินค้า', Icon: Calendar },
  { key: 'ticket', name: 'ตั๋วคุม & หมดอายุ', Icon: ShieldAlert },
  { key: 'rebate', name: 'สัดส่วนรีเบท', Icon: Percent },
  { key: 'weight', name: 'เที่ยวรถ & เครื่องชั่ง', Icon: Truck },
  { key: 'settle', name: 'ตัดตั๋ว & ของแถม', Icon: Ticket },
  { key: 'sales', name: 'ราคา & เอกสาร', Icon: Tag },
  { key: 'credit', name: 'เครดิต & Aging', Icon: CreditCard },
  { key: 'data-window', name: 'วันเริ่มข้อมูล', Icon: Calendar },
  { key: 'rebate-reset', name: 'เริ่มยอด Rebate ใหม่', Icon: RotateCcw },
  { key: 'giveaway-zero', name: 'Set Zero ของแถม', Icon: Gift },
  { key: 'history', name: 'ประวัติ Version', Icon: History },
  { key: 'reports', name: 'แม่แบบ & หัวกระดาษรายงาน', Icon: FileSpreadsheet },
  { key: 'menus', name: 'เปิด/ปิดเมนูและรายงาน', Icon: ToggleLeft },
];

export function AppSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('pickup');
  const [revision, setRevision] = useState<number | undefined>(undefined);
  // UAT feedback 18 Nov 2026 (picture 6): show "start Rebate again" only while the Rebate Pool switch is on.
  // The tab stays in the code: the owner's Rebate reset on Production still needs it.
  const rebatePoolOn = useFeature()('rebate-pool-103');
  // Owner closed handover acceptance on 31 October 2026; retain audit history outside the settings UI.
  const authUser = useAuthStore(s => s.user);
  const isAdmin = authUser?.role === 'ADMIN' || Boolean(authUser?.roles?.includes('ADMIN'));
  const tabs = TABS.filter(t => (t.key !== 'rebate-reset' || rebatePoolOn) && (!['menus', 'giveaway-zero'].includes(t.key) || isAdmin));
  const shownTab: SettingsTabKey = tabs.some(t => t.key === activeTab) ? activeTab : 'pickup';

  return (
    <div className="h-full flex flex-col bg-[#F1EFE8] overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Settings className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> App Settings · ตั้งค่าแอปพลิเคชัน
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            นโยบายระบบและแม่แบบรายงาน (ควบคุมพารามิเตอร์หลักตามสิทธิ์ ADMIN พร้อมระบบ Versioning & Change Audit)
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {revision !== undefined && (
            <span className="text-xs font-mono font-bold px-2.5 py-1 bg-blue-50 text-[#0C447C] border border-blue-200 rounded-lg">
              Revision #{revision}
            </span>
          )}
        </div>
      </div>

      {/* Primary Top Tab Navigation (Platform Standard) */}
      <nav
        role="tablist"
        aria-label="หัวข้อการตั้งค่า"
        className="bg-white border-b border-gray-200 px-4 sm:px-6 flex gap-4 sm:gap-6 overflow-x-auto scrollbar-hide shrink-0"
      >
        {tabs.map(({ key, name, Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={shownTab === key}
            aria-controls={'tabpanel-' + key}
            id={'tab-' + key}
            onClick={async () => { if (key === shownTab || await confirmLeaveEditors()) setActiveTab(key); }}
            className={`py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              shownTab === key
                ? 'border-[#0C447C] text-[#0C447C] font-bold'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon size={16} />
            <span>{name}</span>
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        {/* Policy Tabs (pickup, ticket, rebate, weight, settle, sales, credit, history) */}
        <div
          role="tabpanel"
          id="tabpanel-policy"
          aria-labelledby={'tab-' + shownTab}
          hidden={['reports', 'data-window', 'rebate-reset', 'menus', 'giveaway-zero'].includes(shownTab)}
          className="w-full"
        >
          <SystemSettingsModal
            isOpen={true}
            embedded={true}
            activeTab={['reports', 'data-window', 'rebate-reset', 'menus', 'giveaway-zero'].includes(shownTab) ? 'pickup' : (shownTab as TabKey)}
            onRevisionLoaded={setRevision}
            onClose={() => {}}
          />
        </div>

        {shownTab === 'data-window' && <div role="tabpanel" id="tabpanel-data-window" aria-labelledby="tab-data-window"><GlobalDataWindowSetting /></div>}
        {shownTab === 'rebate-reset' && <div role="tabpanel" id="tabpanel-rebate-reset" aria-labelledby="tab-rebate-reset"><ResetRebateSetting /></div>}
        {shownTab === 'menus' && <div role="tabpanel" id="tabpanel-menus" aria-labelledby="tab-menus"><MenuSwitchesSetting /></div>}
        {shownTab === 'giveaway-zero' && <div role="tabpanel" id="tabpanel-giveaway-zero" aria-labelledby="tab-giveaway-zero"><GiveawaySetZeroSetting /></div>}

        {/* Reports Template & Header Management Tab */}
        <div
          role="tabpanel"
          id="tabpanel-reports"
          aria-labelledby="tab-reports"
          hidden={shownTab !== 'reports'}
          className="w-full"
        >
          <AdminReportTemplateModal isOpen={true} embedded={true} onClose={() => {}} />
        </div>
      </main>
    </div>
  );
}
