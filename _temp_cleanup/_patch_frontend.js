const fs = require('fs');
let code = fs.readFileSync('WSSale-App/src/components/sales/CreateSODialog.tsx', 'utf8');

// 1. Update DraftBill type
code = code.replace(
  'type DraftBill = { id: string; soPrefix: SOPrefix; lines: DraftLine[]; remark: string; rebateDiscountAmt?: number };',
  'type DraftBill = { id: string; soPrefix: SOPrefix; lines: DraftLine[]; remark: string; rebateDiscountAmt?: number; creditDays?: number; truckRemark?: string; billRemark?: string; };'
);

// 2. Add creditDays to customer select logic
code = code.replace(
  'setCustId(c.CustID); setCustSearch(c.CustName); setIsCustOpen(false);',
  'setCustId(c.CustID); setCustSearch(c.CustName); setIsCustOpen(false); setBills(prev => prev.map(b => ({...b, creditDays: c.CreditDays || 0})));'
);

// 3. Update activeBill config to show inputs for creditDays, truckRemark, billRemark
// We will insert them right after `remark` input for the active bill
code = code.replace(
  '<input type="text" placeholder="หมายเหตุบิลนี้..." value={activeBill?.remark} onChange={e => updateBillInfo(activeBillId, { remark: e.target.value })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mt-1" />',
  `<input type="text" placeholder="หมายเหตุบิลนี้..." value={activeBill?.remark} onChange={e => updateBillInfo(activeBillId, { remark: e.target.value })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mt-1" />
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 block mb-0.5">เครดิต (วัน)</label>
                      <input type="number" placeholder="0" value={activeBill?.creditDays || ''} onChange={e => updateBillInfo(activeBillId, { creditDays: Number(e.target.value) })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 block mb-0.5">หมายเหตุท้ายบิล (รถ)</label>
                      <input type="text" placeholder="Desc1" value={activeBill?.truckRemark || ''} onChange={e => updateBillInfo(activeBillId, { truckRemark: e.target.value })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 block mb-0.5">หมายเหตุท้ายบิล (บัญชี)</label>
                      <input type="text" placeholder="Desc2" value={activeBill?.billRemark || ''} onChange={e => updateBillInfo(activeBillId, { billRemark: e.target.value })} className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
                    </div>
                  </div>`
);

// 4. Update the `createSO` and `updateSO` payload mapping in `handleSubmit`
code = code.replace(
  `remark: b.remark || undefined,
          rebateDiscountAmt: canSeeRebate ? b.rebateDiscountAmt || 0 : 0,
          salesUserId: salesUserId || undefined,`,
  `remark: b.remark || undefined,
          rebateDiscountAmt: canSeeRebate ? b.rebateDiscountAmt || 0 : 0,
          salesUserId: salesUserId || undefined,
          creditDays: b.creditDays,
          truckRemark: b.truckRemark,
          billRemark: b.billRemark,`
);
code = code.replace(
  `remark: b.remark || undefined,
          rebateDiscountAmt: canSeeRebate ? b.rebateDiscountAmt || 0 : 0,
          salesUserId: salesUserId || undefined,`,
  `remark: b.remark || undefined,
          rebateDiscountAmt: canSeeRebate ? b.rebateDiscountAmt || 0 : 0,
          salesUserId: salesUserId || undefined,
          creditDays: b.creditDays,
          truckRemark: b.truckRemark,
          billRemark: b.billRemark,`
);

// 5. If `soPrefix` is 'I' or 'K', we need to pass a property or auto-set `truckPlate`?
// The user requirement says: "หากกำหนดว่าเป็นตั๋วคุมสำหรับบิลนั้น (I, K) แสดงว่า "TransRegistration=ตั๋วคุม" ทันที"
// But wait, it's about "ตั๋วคุมสำหรับบิลนั้น (I, K)", this logic should be in backend. Oh I already handled this in backend SP (`sp_ConfirmSalesOrder` sets TransRegistration='ตั๋วคุม' if Prefix is I or K).
// Let me verify if I need to update the UI. The user said:
// "1.หากกำหนดว่าเป็นตั๋วคุมสำหรับบิลนั้น (I, K) แสดงว่า "TransRegistration=ตั๋วคุม" ทันที แต่เราก็สามารถนำมาหักใช้ในการนำส่งบนรถคันที่เลือกไว้ได้ทันที"

// 6. "ลำดับขึ้นรถ (แทน Zone เดิม)"
// Let's add loadSequence to DraftLine type.
code = code.replace(
  'type DraftLine = SalesOrderLine & { tempId: string; refControlTicketNo?: string; isControlTicketDrawn?: boolean; maxQtyTon?: number };',
  'type DraftLine = SalesOrderLine & { tempId: string; refControlTicketNo?: string; isControlTicketDrawn?: boolean; maxQtyTon?: number; loadSequence?: number; };'
);

// We need to add loadSequence input in the line items.
code = code.replace(
  '<span className="text-[10px] text-gray-500 font-medium">{l.isGiveaway ? \'ชิ้น\' : \'ตัน\'}</span>',
  `<span className="text-[10px] text-gray-500 font-medium">{l.isGiveaway ? 'ชิ้น' : 'ตัน'}</span>
                              <div className="flex items-center ml-2 border border-gray-200 rounded px-1">
                                <span className="text-[10px] text-gray-400 mr-1">ลำดับ</span>
                                <input type="number" min="1" max="99" value={l.loadSequence || ''} onChange={e => updateActiveLine(l.tempId, { loadSequence: e.target.value ? Number(e.target.value) : undefined })} className="w-8 text-center text-xs font-mono py-1 focus:outline-none bg-transparent" />
                              </div>`
);

// payload mapping for loadSequence
code = code.replace(
  `isControlTicketDrawn: l.isControlTicketDrawn,
            refControlTicketNo: l.refControlTicketNo`,
  `isControlTicketDrawn: l.isControlTicketDrawn,
            refControlTicketNo: l.refControlTicketNo,
            loadSequence: l.loadSequence`
);
code = code.replace(
  `isControlTicketDrawn: l.isControlTicketDrawn,
            refControlTicketNo: l.refControlTicketNo`,
  `isControlTicketDrawn: l.isControlTicketDrawn,
            refControlTicketNo: l.refControlTicketNo,
            loadSequence: l.loadSequence`
);

fs.writeFileSync('WSSale-App/src/components/sales/CreateSODialog.tsx', code, 'utf8');
console.log('patched CreateSODialog.tsx');
