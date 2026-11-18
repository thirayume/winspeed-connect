import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { CreateSODialog } from '../src/components/sales/CreateSODialog';
import { useAuthStore } from '../src/store/auth-store';
import { useAppStore } from '../src/store/app-store';

// Test fixture only: the e2e spec answers every /api request; nothing reaches a server or database.
const user = { id: 999, username: 'fixture', displayName: 'Fixture', role: 'SALES', isActive: true,
  capabilities: { menus: ['sales'], actions: ['so.create', 'so.edit'] } } as const;
useAuthStore.setState({ user: user as any, isAuthenticated: true });
useAppStore.setState({ activePortal: 'sales' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CreateSODialog isOpen editSoId="123" onClose={() => undefined} />
  </StrictMode>,
);
