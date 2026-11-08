import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { CreateSODialog } from '../src/components/sales/CreateSODialog';
import { GlobalLoader } from '../src/components/common/GlobalLoader';
import { StorePortal } from '../src/components/store/StorePortal';
import ProfilePage from '../src/components/profile/ProfilePage';
import { CreateQuoteDialog } from '../src/components/quotation/QuotationPage';
import { useTripStore } from '../src/store/trip-store';
import { useAuthStore } from '../src/store/auth-store';
import { useAppStore } from '../src/store/app-store';
import { req, setToken } from '../src/services/api';
import { refreshQueue } from '../src/utils/refresh-queue';
import { TripSetupModal, type TripSetupData } from '../src/components/sales/TripSetupModal';

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
  const [tripData, setTripData] = useState<TripSetupData>({tripId:99, expectedRevision:3, deliveryDate:'2026-11-08', remark:'ORIGINAL'});
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <div style={{position:'relative',zIndex:1000}}>
      <button onClick={() => useTripStore.getState().updateTrip({truckPlate:'SERVER REFRESH'})}>Refresh trip</button>
      <button onClick={() => setMode('store')}>Warehouse</button>
      <button onClick={() => setMode('profile')}>Profile</button>
      <button onClick={() => setMode('quote')}>Quotation</button>
      <button onClick={() => {setOpen(true);setMode('trip');}}>Trip setup</button>
      <button onClick={() => setTripData({...tripData, expectedRevision:4, remark:'SERVER REFRESH'})}>Refresh trip setup</button>
      <button onClick={() => useAppStore.getState().navigate('dashboard')}>Navigate</button>
      <span>{useAppStore(s=>s.activePortal)}</span>
    </div>
    {mode === 'sales' ? open && <CreateSODialog isOpen onClose={()=>setOpen(false)} /> : mode === 'profile' ? <ProfilePage/> : mode === 'quote' ? <CreateQuoteDialog onClose={()=>setMode('sales')} onDone={()=>setMode('sales')}/> : mode === 'trip' ? <TripSetupModal isOpen={open} initialData={tripData} onClose={()=>setOpen(false)} onConfirm={()=>setOpen(false)}/> : <StorePortal/>}
    <GlobalLoader/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>);
