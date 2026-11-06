import { useState } from 'react';
import { Settings, ClipboardCheck } from 'lucide-react';
import { SystemSettingsModal } from './SystemSettingsModal';
import { ReadinessSignoffModal } from './ReadinessSignoffModal';
const tabs = [
  { key: 'policy', name: 'ตั้งค่านโยบายระบบ', Icon: Settings },
  { key: 'readiness', name: 'ผลตรวจรับงาน', Icon: ClipboardCheck },
];

export function AppSettingsPage() {
  const [tab, setTab] = useState('policy');
  return (
    <div className="h-full flex flex-col bg-[#F1EFE8]">
      <header className="bg-white p-5 border-b">
        <h1 className="text-2xl font-bold text-[#0C447C]">App Settings · ตั้งค่าแอปพลิเคชัน</h1>
        <p>นโยบายระบบและผลตรวจรับงาน</p>
      </header>
      <nav
        role="tablist"
        aria-label="หัวข้อการตั้งค่า"
        className="bg-white border-b px-5 flex gap-6 overflow-x-auto shrink-0"
      >
        {tabs.map(({ key, name, Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            aria-controls={'settings-' + key}
            id={'tab-' + key}
            className={
              'flex items-center gap-2 py-3 border-b-2 whitespace-nowrap ' +
              (tab === key ? 'border-blue-700 text-blue-700' : 'border-transparent')
            }
            onClick={() => setTab(key)}
          >
            <Icon size={18} />
            {name}
          </button>
        ))}
      </nav>
      <main className="flex-1 min-h-0 overflow-auto p-4">
        {/* Preserve unsaved inputs when switching settings tabs. */}
        <div role="tabpanel" id="settings-policy" aria-labelledby="tab-policy" hidden={tab !== 'policy'}>
          <SystemSettingsModal isOpen onClose={() => {}} embedded />
        </div>
        <div
          role="tabpanel"
          id="settings-readiness"
          aria-labelledby="tab-readiness"
          hidden={tab !== 'readiness'}
        >
          <ReadinessSignoffModal onClose={() => {}} embedded />
        </div>
      </main>
    </div>
  );
}
