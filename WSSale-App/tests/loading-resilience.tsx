import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { CreateSODialog } from '../src/components/sales/CreateSODialog';
import { GlobalLoader } from '../src/components/common/GlobalLoader';
import { StorePortal } from '../src/components/store/StorePortal';
import { useTripStore } from '../src/store/trip-store';
import { useAuthStore } from '../src/store/auth-store';
import { useAppStore } from '../src/store/app-store';
import { req, setToken } from '../src/services/api';
import { refreshQueue } from '../src/utils/refresh-queue';

// Test fixture only. No server credentials and no requests to a real database.
const user = { id: 999, username: 'fixture', displayName: 'Fixture', role: 'SALES', isActive: true,
  capabilities: { menus: ['sales', 'dashboard'], actions: ['so.create', 'so.edit'] } } as const;
useAuthStore.setState({ user: user as any, isAuthenticated: true });
useAppStore.setState({activePortal:'sales'});
useTripStore.getState().setTrip({tripId: 99, truckPlate:'ORIGINAL', deliveryDate:'2026-11-08'});
(window as any).regression = { req, setToken, refreshQueue, useAppStore, useTripStore };
function Harness() {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState('sales');
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <div>
      <button onClick={() => useTripStore.getState().updateTrip({truckPlate:'SERVER REFRESH'})}>Refresh trip</button>
      <button onClick={() => setMode('store')}>Warehouse</button>
      <button onClick={() => useAppStore.getState().navigate('dashboard')}>Navigate</button>
      <span>{useAppStore(s=>s.activePortal)}</span>
    </div>
    {mode === 'sales' ? open && <CreateSODialog isOpen onClose={()=>setOpen(false)} /> : <StorePortal/>}
    <GlobalLoader/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>);
