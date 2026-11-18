import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { SaleTripManager } from '../src/components/sales/SaleTripManager';
import type { SalesOrder } from '../src/types';
const oldOrder = { id: 1, status: 'DRAFT', wfRef: 'FIXTURE-OLD', lines: [],
  quotationLockReason: 'มีใบเสนอราคาค้างก่อนวันเริ่มข้อมูล กรุณาติดต่อผู้ดูแล' } as unknown as SalesOrder;
const currentOrder = { id: 2, status: 'DRAFT', wfRef: 'FIXTURE-NEW', lines: [], linkedQuoteId: 55,
  linkedQuoteNo: 'Q-NEW', linkedQuoteStatus: 'DRAFT', quotationLockReason: 'รอใบเสนอราคายืนยัน' } as unknown as SalesOrder;
const group = (order: SalesOrder, truck: string) => ({ dateDisplay: 'ทดสอบ', cust: 'ลูกค้าทดสอบ', custCount: 1, truck,
  orders: [order], totalAmt: 0, totalTon: 0 });
createRoot(document.getElementById('root')!).render(<SaleTripManager groupedOrders={[group(oldOrder, 'รถเก่า'), group(currentOrder, 'รถใหม่')]}
  loading={false} unlockRequests={[]} customersMap={{}} onViewTrip={() => {}} onOpenQuote={() => {}} onLoadData={() => {}} />);
