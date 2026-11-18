import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { AgingDetailModal } from '../src/components/dashboard/AgingDetailModal';
import { useAuthStore } from '../src/store/auth-store';

// Test fixture only: the e2e spec answers every /api request; nothing reaches a server or database.
const user = { id: 999, username: 'fixture', displayName: 'Fixture', role: 'ADMIN', isActive: true,
  capabilities: { menus: ['dashboard'], actions: [] } } as const;
useAuthStore.setState({ user: user as any, isAuthenticated: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgingDetailModal isOpen onClose={() => undefined} />
  </StrictMode>,
);
