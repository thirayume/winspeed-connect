import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReconciliationPage } from '../src/components/recon/ReconciliationPage';
import { useAuthStore } from '../src/store/auth-store';
import '../src/index.css';
useAuthStore.setState({ user: { id: 1, username: 'fixture', displayName: 'Fixture', role: 'ADMIN', isActive: true }, isAuthenticated: true });
createRoot(document.getElementById('root')!).render(<ReconciliationPage />);
