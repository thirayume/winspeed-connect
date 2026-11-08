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
  ClipboardCheck,
} from 'lucide-react';
import { SystemSettingsModal, type TabKey } from './SystemSettingsModal';
import { ReadinessSignoffModal } from './ReadinessSignoffModal';

export type SettingsTabKey = TabKey | 'readiness';

const TABS: { key: SettingsTabKey; name: string; Icon: any }[] = [
  { key: 'pickup', name: 'กำหนดรับสินค้า', Icon: Calendar },
  { key: 'ticket', name: 'ตั๋วคุม & หมดอายุ', Icon: ShieldAlert },
  { key: 'rebate', name: 'สัดส่วนรีเบท', Icon: Percent },
  { key: 'weight', name: 'เที่ยวรถ & เครื่องชั่ง', Icon: Truck },
  { key: 'settle', name: 'ตัดตั๋ว & ของแถม', Icon: Ticket },
  { key: 'sales', name: 'ราคา & เอกสาร', Icon: Tag },
  { key: 'history', name: 'ประวัติ Version', Icon: History },
  { key: 'readiness', name: 'ผลตรวจรับงาน', Icon: ClipboardCheck },
];

export function AppSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('pickup');
  const [revision, setRevision] = useState<number | undefined>(undefined);

  return (
    <div className="h-full flex flex-col bg-[#F1EFE8] overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: '#0C447C' }}>
            <Settings className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" /> App Settings · ตั้งค่าแอปพลิเคชัน
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            นโยบายระบบและผลตรวจรับงาน (ควบคุมพารามิเตอร์หลักตามสิทธิ์ ADMIN พร้อมระบบ Versioning & Change Audit)
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
        {TABS.map(({ key, name, Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={'tabpanel-' + key}
            id={'tab-' + key}
            onClick={() => setActiveTab(key)}
            className={`py-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === key
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
        {/* Policy Tabs (pickup, ticket, rebate, weight, settle, sales, history) */}
        <div
          role="tabpanel"
          id="tabpanel-policy"
          aria-labelledby={'tab-' + activeTab}
          hidden={activeTab === 'readiness'}
          className="w-full"
        >
          <SystemSettingsModal
            isOpen={true}
            embedded={true}
            activeTab={activeTab === 'readiness' ? 'pickup' : (activeTab as TabKey)}
            onRevisionLoaded={setRevision}
            onClose={() => {}}
          />
        </div>

        {/* Readiness Signoff Tab */}
        <div
          role="tabpanel"
          id="tabpanel-readiness"
          aria-labelledby="tab-readiness"
          hidden={activeTab !== 'readiness'}
          className="w-full"
        >
          <ReadinessSignoffModal onClose={() => {}} embedded={true} />
        </div>
      </main>
    </div>
  );
}
