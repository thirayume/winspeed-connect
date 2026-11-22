import {useCallback,useEffect,useRef,useState} from 'react';
import {fetchGiveawayLoanOptions,fetchGiveawayQuotaLoans,createGiveawayQuotaLoan,decideGiveawayQuotaLoan,
  repayGiveawayQuotaLoan,type GiveawayLoanOption,type GiveawayQuotaLoan} from '../../services/api';
import {useAuthStore} from '../../store/auth-store';
import {appConfirm,appPrompt} from '../ui/AppAlert';
const labels:Record<string,string>={PENDING:'รอผู้ให้ยืมอนุมัติ',APPROVED:'มีโควต้าค้างคืน',REJECTED:'ไม่อนุมัติ',CANCELLED:'ยกเลิก',RETURNED:'คืนครบแล้ว'};
export function GiveawayQuotaLoansPanel({onChanged,initialYear}:{onChanged?:()=>void;initialYear?:number}){
 const user=useAuthStore(s=>s.user);
 const [year,setYear]=useState(initialYear||new Date().getFullYear()+543),[items,setItems]=useState<GiveawayQuotaLoan[]>([]);
 const [own,setOwn]=useState<GiveawayLoanOption[]>([]),[lenders,setLenders]=useState<GiveawayLoanOption[]>([]);
 const [database,setDatabase]=useState(''),[borrower,setBorrower]=useState(''),[lender,setLender]=useState('');
 const [quantity,setQuantity]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[notice,setNotice]=useState('');
 const [nextCursor,setNextCursor]=useState<number|null>(null);
 const sequence=useRef(0),lenderSequence=useRef(0);
 const refresh=useCallback(async()=>{
  const seq=++sequence.current;setLoading(true);setError('');
  try{const [list,options]=await Promise.all([fetchGiveawayQuotaLoans(),fetchGiveawayLoanOptions(year)]);
   if(seq!==sequence.current)return;
   if(!list.database||list.database!==options.database)throw Error('ฐานข้อมูลเปลี่ยน กรุณาโหลดใหม่');
   setDatabase(list.database);setItems(list.items);setOwn(options.items);setNextCursor(list.nextCursor??null);
  }catch(e){if(seq===sequence.current){setDatabase('');setItems([]);setOwn([]);setNextCursor(null);setError((e as Error).message);}}
  finally{if(seq===sequence.current)setLoading(false);}
 },[year]);
 useEffect(()=>{setBorrower('');setLender('');setLenders([]);setQuantity('');setReason('');void refresh();
  return()=>{sequence.current++;lenderSequence.current++;};
 },[refresh,user?.id,user?.actorId]);
 useEffect(()=>{
  const seq=++lenderSequence.current;setLender('');setLenders([]);
  if(!borrower)return;
  fetchGiveawayLoanOptions(year,Number(borrower)).then(res=>{
   if(seq!==lenderSequence.current)return;
   if(res.database!==database)throw Error('ฐานข้อมูลเปลี่ยน กรุณาโหลดใหม่');
   const current=own.find(r=>String(r.Id)===borrower);
   setLenders(res.items.filter(r=>r.SalesUserId!==current?.SalesUserId));
  }).catch(e=>{if(seq===lenderSequence.current)setError((e as Error).message);});
  return()=>{lenderSequence.current++;};
 },[borrower,year,database,own]);
 const more=async()=>{
  if(!nextCursor||loading||busy)return;
  const seq=sequence.current;setLoading(true);setError('');
  try{const page=await fetchGiveawayQuotaLoans(nextCursor);if(seq!==sequence.current)return;
   if(page.database!==database)throw Error('ฐานข้อมูลเปลี่ยน กรุณาโหลดใหม่');
   setItems(current=>[...current,...page.items.filter(row=>!current.some(old=>old.id===row.id))]);setNextCursor(page.nextCursor??null);
  }catch(e){if(seq===sequence.current)setError((e as Error).message);}
  finally{if(seq===sequence.current)setLoading(false);}
 };
 const requestKey=async(kind:string,payload:unknown)=>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind,database,user:user?.id,actor:user?.actorId||user?.id,payload})));
  const key=`wf-quota-loan:${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`;
  let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id);}return {key,id};
 };
 const complete=async()=>{onChanged?.();await refresh();};
 const submit=async()=>{
  if(!borrower||!lender||!/^\d+(?:\.\d{1,2})?$/.test(quantity)||!Number.isFinite(Number(quantity))||Number(quantity)<=0||Number(quantity)>9999999999.99||!reason.trim()){
   setError('กรุณาเลือกงบของผู้ยืม ผู้ให้ยืม จำนวน และเหตุผลให้ครบ');return;
  }
  if(!await appConfirm('ยื่นคำขอยืมโควต้า ผู้ให้ยืมต้องอนุมัติก่อนจึงจะนำมาใช้ได้ ใช่หรือไม่?'))return;
  setBusy(true);setError('');setNotice('');
  try{const payload={expectedDatabase:database,borrowerBudgetId:Number(borrower),lenderBudgetId:Number(lender),quantity:Number(quantity).toFixed(2),reason:reason.trim()};
   const token=await requestKey('request',payload);
   await createGiveawayQuotaLoan({...payload,requestId:token.id});sessionStorage.removeItem(token.key);
   setQuantity('');setReason('');setNotice('ยื่นคำขอแล้ว รอผู้ให้ยืมหรือผู้มีสิทธิ์อนุมัติ');await complete();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const decide=async(row:GiveawayQuotaLoan,action:'approve'|'reject'|'cancel')=>{
  const note=await appPrompt('ระบุเหตุผลการพิจารณาคำขอยืมโควต้า');if(!note?.trim())return;
  if(!await appConfirm(`ยืนยัน${action==='approve'?'อนุมัติ':action==='reject'?'ไม่อนุมัติ':'ยกเลิก'}คำขอ #${row.id}?`))return;
  setBusy(true);setError('');setNotice('');
  try{await decideGiveawayQuotaLoan(row.id,{expectedDatabase:database,revision:row.revision,action,reason:note.trim()});
   await complete();setNotice('บันทึกผลพิจารณาแล้ว');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const repay=async(row:GiveawayQuotaLoan)=>{
  const qty=await appPrompt(`จำนวนโควต้าที่คืน (ค้าง ${row.outstanding} ชิ้น)`,String(row.outstanding));
  if(!qty||!/^\d+(?:\.\d{1,2})?$/.test(qty)||Number(qty)<=0||Number(qty)>row.outstanding)return;
  const note=await appPrompt('ระบุเหตุผลการคืนโควต้า');if(!note?.trim())return;
  if(!await appConfirm(`คืนโควต้า ${qty} ชิ้นให้ผู้ให้ยืม? ระบบจะตรวจว่าผู้ยืมมีโควต้าเหลือพอคืน`))return;
  setBusy(true);setError('');setNotice('');
  try{const payload={expectedDatabase:database,quantity:Number(qty).toFixed(2),reason:note.trim()},token=await requestKey(`return:${row.id}`,payload);
   await repayGiveawayQuotaLoan(row.id,{...payload,requestId:token.id});sessionStorage.removeItem(token.key);
   await complete();setNotice('คืนโควต้าแล้ว');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 return <section className="space-y-4 p-4">
  <h2 className="font-bold text-[#0C447C]">ยืม/คืนโควต้าของแถมระหว่างเซลล์</h2>
  <p className="text-sm text-gray-600">ยืมได้ทั้งในภาคเดียวกันและต่างภาค สำหรับสินค้าและปีงบเดียวกัน อนุมัติแล้วจึงโอนยอด คืนได้เฉพาะโควต้าที่มีเหลือ และเก็บประวัติทุกครั้ง</p>
  <label className="text-sm">ปีงบ (พ.ศ.) <input type="number" value={year} disabled={busy||loading}
   onChange={e=>setYear(Number(e.target.value))} className="rounded border p-2"/></label>
  <button disabled={busy||loading} onClick={refresh} className="ml-3 rounded border p-2 text-sm">รีเฟรชโควต้า</button>
  {loading&&<p role="status">กำลังตรวจโควต้า...</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}
  {notice&&<p role="status" className="text-green-700">{notice}</p>}
  <fieldset disabled={busy||loading||!database} className="grid gap-3 rounded border p-3 md:grid-cols-2 disabled:opacity-50">
   <label className="text-sm">งบของผู้ยืม<select className="block w-full rounded border p-2" value={borrower} onChange={e=>setBorrower(e.target.value)}>
    <option value="">เลือกงบ</option>{own.map(r=><option key={r.Id} value={r.Id}>{r.DisplayName} · {r.GoodName||r.ItemName} · {r.Region}</option>)}
   </select></label>
   <label className="text-sm">ผู้ให้ยืม<select className="block w-full rounded border p-2" value={lender} onChange={e=>setLender(e.target.value)}>
    <option value="">เลือกผู้ให้ยืม</option>{lenders.map(r=><option key={r.Id} value={r.Id}>{r.DisplayName} · {r.Region} · เหลือ {r.RemainingQty}</option>)}
   </select></label>
   <label className="text-sm">จำนวนที่ขอยืม<input type="number" min="0.01" step="0.01" className="block w-full rounded border p-2" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
   <label className="text-sm">เหตุผลการยืม<input maxLength={500} className="block w-full rounded border p-2" value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button onClick={submit} className="rounded bg-[#0C447C] p-2 text-white">ยื่นขอยืมโควต้า</button>
  </fieldset>
  {!loading&&!error&&!items.length&&<p className="text-sm text-gray-500">ไม่มีคำขอที่แสดงได้</p>}
  {items.map(row=><article key={row.id} className="space-y-2 rounded border p-3 text-sm">
   <p className="font-semibold">#{row.id} · {row.borrowerName} ยืมจาก {row.lenderName} · {row.goodName}</p>
   <p>{labels[row.status]||row.status} · ยืม {row.quantity} · คืนแล้ว {row.returnedQty} · ค้าง {row.status==='APPROVED'?row.outstanding:0} ชิ้น</p>
   <p>{row.isOpening?'ยอดยืมยกมาจากก่อนวันเริ่มข้อมูล':row.reason}</p>
   <div className="flex gap-3">
    {row.canDecide&&<><button disabled={busy} onClick={()=>decide(row,'approve')} className="text-green-700 underline">อนุมัติยืม</button>
     <button disabled={busy} onClick={()=>decide(row,'reject')} className="text-red-700 underline">ไม่อนุมัติ</button></>}
    {row.canCancel&&<button disabled={busy} onClick={()=>decide(row,'cancel')} className="underline">ยกเลิกคำขอ</button>}
    {row.canRepay&&<button disabled={busy} onClick={()=>repay(row)} className="text-blue-700 underline">คืนโควต้า</button>}
   </div>
  </article>)}
  {nextCursor&&<button disabled={loading||busy} onClick={more} className="rounded border p-2">ดูรายการก่อนหน้า</button>}
 </section>;
}
