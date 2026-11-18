import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { AppSettingsPage } from '../src/components/admin/AppSettingsPage';
import { useAuthStore } from '../src/store/auth-store';

// Test fixture only: the e2e spec answers every /api request; nothing reaches a server or database.
const user = (features: string[]) => ({ id: 999, username: 'fixture', displayName: 'Fixture', role: 'ADMIN', isActive: true,
  capabilities: { menus: ['app-settings'], actions: [], features } });
useAuthStore.setState({ user: user([]) as any, isAuthenticated: true });

function Harness() {
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div>
      <button onClick={() => useAuthStore.setState({ user: user(['rebate-pool-103']) as any })}>Pool on</button>
      <button onClick={() => useAuthStore.setState({ user: user([]) as any })}>Pool off</button>
    </div>
    <div style={{ flex: 1, minHeight: 0 }}><AppSettingsPage /></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
