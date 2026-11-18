import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { GiveawayPage } from '../src/components/giveaway/GiveawayPage';
import { useAuthStore } from '../src/store/auth-store';
useAuthStore.setState({ user: { id: 1, username: 'fixture', displayName: 'Fixture', role: 'ADMIN', isActive: true }, isAuthenticated: true });
createRoot(document.getElementById('root')!).render(<GiveawayPage />);
