import React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeCutReviewQueue } from '../src/components/recon/NativeCutReviewQueue';
import { useAuthStore } from '../src/store/auth-store';
useAuthStore.setState({ token: 'first-fixture', user: { id: 1, username: 'fixture', displayName: 'Fixture', role: 'ADMIN', isActive: true }, isAuthenticated: true });
createRoot(document.getElementById('root')!).render(<><button onClick={() => useAuthStore.setState({token:'second-fixture'})}>Change session</button><NativeCutReviewQueue canReview /></>);
