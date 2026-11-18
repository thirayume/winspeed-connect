import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { ClaimDialog } from '../src/components/rebate/RebateClaimForm';
import { useAuthStore } from '../src/store/auth-store';
useAuthStore.setState({ user: { id: 1, username: 'fixture', displayName: 'Fixture', role: 'ACCOUNTING', isActive: true }, isAuthenticated: true });
createRoot(document.getElementById('root')!).render(<ClaimDialog pool={{ Id: 1, SalesUserId: 1, PeriodYear: 2026, PeriodMonth: 11,
  AccruedAmt: 100, ClaimedAmt: 0, AllocatedAmt: 100, AvailableAmt: 100 }} onClose={() => {}} onDone={() => {}} />);
