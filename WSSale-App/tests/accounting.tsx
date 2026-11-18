import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { AccountingPage } from '../src/components/accounting/AccountingPage';
import { useAuthStore } from '../src/store/auth-store';
import { useAppStore } from '../src/store/app-store';

// Test fixture only: the e2e spec answers every /api request; nothing reaches a server or database.
const user = { id: 999, username: 'fixture', displayName: 'Fixture', role: 'ACCOUNTING', isActive: true,
  capabilities: { menus: ['accounting'], actions: [] } } as const;
useAuthStore.setState({ user: user as any, isAuthenticated: true });
useAppStore.setState({ activePortal: 'accounting' });

createRoot(document.getElementById('root')!).render(<StrictMode><div style={{ height: '100vh' }}><AccountingPage /></div></StrictMode>);
