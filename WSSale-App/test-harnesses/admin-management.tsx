import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminUsersPage } from '../src/components/admin/AdminUsersPage';
import { RoleManagementPage } from '../src/components/admin/RoleManagementPage';
import { AppSettingsPage } from '../src/components/admin/AppSettingsPage';
import { useAuthStore } from '../src/store/auth-store';
import '../src/index.css';

// Development-only fixture entry; not imported by the production application.
useAuthStore.setState({
  isAuthenticated: true,
  user: { id: 1, username: 'fixture-admin', displayName: 'ผู้ดูแลทดสอบ', role: 'ADMIN', isActive: true, capabilities:{menus:['admin','roles','app-settings'],actions:['users.manage','roles.manage','settings.manage']} },
});
function Harness() {
  const [tab, setTab] = useState('users');
  return (
    <div className="h-screen flex flex-col">
      <nav className="flex gap-4 p-3 bg-white border-b">
        {['users', 'roles', 'settings'].map((key) => (
          <button key={key} onClick={() => setTab(key)}>
            {key}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-h-0">
        {tab === 'users' ? (
          <AdminUsersPage />
        ) : tab === 'roles' ? (
          <RoleManagementPage />
        ) : (
          <AppSettingsPage />
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
