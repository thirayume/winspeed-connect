import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { GoodsManager } from '../src/components/master/GoodsManager';
import { GiveawaysManager } from '../src/components/master/GiveawaysManager';
import { useAuthStore } from '../src/store/auth-store';

// Test fixture only: the e2e spec answers every /api request; nothing reaches a server or database.
const user = { id: 1, username: 'fixture', displayName: 'Fixture', role: 'ADMIN', isActive: true,
  capabilities: { menus: ['master'], actions: [] } } as const;
useAuthStore.setState({ user: user as any, isAuthenticated: true });

function Harness() {
  const [tab, setTab] = useState<'goods' | 'giveaways'>('goods');
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div><button onClick={() => setTab('goods')}>Goods tab</button><button onClick={() => setTab('giveaways')}>Giveaways tab</button></div>
    <div style={{ flex: 1, minHeight: 0 }}>{tab === 'goods' ? <GoodsManager /> : <GiveawaysManager />}</div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
