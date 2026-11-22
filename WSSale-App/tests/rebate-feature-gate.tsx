import React from 'react';
import { createRoot } from 'react-dom/client';
import { RebatePoolPanel } from '../src/components/rebate/RebatePoolPanel';
import { ResetRebateSetting } from '../src/components/admin/ResetRebateSetting';
import { useAuthStore } from '../src/store/auth-store';
import '../src/index.css';
const base = { id: 1, username: 'fixture', displayName: 'Fixture', role: 'ADMIN' as const, isActive: true };
function setFeatures(features?: string[], actions: string[] = []) {
  useAuthStore.setState({ user: { ...base, capabilities: { menus: [], actions, ...(features ? { features } : {}) } }, isAuthenticated: true });
}
setFeatures();
function Fixture() {
  return <><button onClick={() => setFeatures(['rebate-pool-103'])}>เปิดสำหรับทดสอบ</button>
    <button onClick={() => setFeatures([])}>ปิดสำหรับทดสอบ</button>
    <button onClick={() => setFeatures(['rebate-pool-103'], ['rebate.evidence.verify', 'rebate.conversion.approve'])}>เปิดพร้อมสิทธิ์ทดสอบ</button>
    <RebatePoolPanel /><ResetRebateSetting /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
