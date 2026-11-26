import {useEffect,useState} from 'react';
import {req} from '../../services/api';
import {useAuthStore} from '../../store/auth-store';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges';
type Territory={TerritoryCode:string;TerritoryName:string;TerritoryType:'SALE'|'PROMOTION';OwnerUserId:number;OwnerName:string;EmpCode:string;IsActive:boolean;Revision:number;provinces:string[]};
type Form={code:string;name:string;type:'SALE'|'PROMOTION';ownerUserId:number;active:boolean;expectedRevision:number;provincesText:string;reason:string;database:string};
export function SalesTerritoriesPage(){
 const user=useAuthStore(s=>s.user),editable=Boolean(user?.roles?.includes('ADMIN')||user?.role==='ADMIN')&&!user?.isImpersonating;
 const [items,setItems]=useState<Territory[]>([]),[owners,setOwners]=useState<{Id:number;DisplayName:string;EmpCode:string}[]>([]),[database,setDatabase]=useState(''),[form,setForm]=useState<Form|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useUnsavedChanges(Boolean(form));
 const load=async()=>{const r=await req<{data:Territory[];database:string}>('/auth/sales-territories');setItems(r.data);setDatabase(r.database);};
 useEffect(()=>{load().catch(e=>setError(e.message));if(editable)req<typeof owners>('/auth/users').then(setOwners).catch(e=>setError(e.message));},[]);
 const open=(item?:Territory)=>{setError('');setForm({code:item?.TerritoryCode||'',name:item?.TerritoryName||'',type:item?.TerritoryType||'SALE',ownerUserId:item?.OwnerUserId||0,active:item?.IsActive??true,expectedRevision:item?.Revision||0,provincesText:item?.provinces.join('\n')||'',reason:'',database});};
 return <section className="space-y-4 p-5 overflow-auto"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-[#0C447C]">เขตขายและเขตส่งเสริมการขาย</h2><p className="text-sm text-slate-500">จังหวัดแยกตามประเภท · สายอนุมัติตามผังองค์กร · การแก้ไขเก็บประวัติ</p></div>{editable&&<button onClick={()=>open()} className="rounded bg-[#0C447C] px-3 py-2 text-white">เพิ่มเขตพื้นที่</button>}</div>
  {error&&<p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
  {['SALE','PROMOTION'].map(type=><div key={type}><h3 className="mb-2 font-bold">{type==='SALE'?'เขตการขาย':'เขตส่งเสริมการขาย'}</h3><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.filter(i=>i.TerritoryType===type).map(i=><article key={i.TerritoryCode} className="rounded-xl border bg-white p-4"><strong>{i.TerritoryName}</strong><p className="text-sm">{i.OwnerName} · {i.EmpCode}</p><p className="my-2 text-sm text-slate-600">{i.provinces.join(', ')}</p><p className="text-xs">{i.IsActive?'เปิดใช้งาน':'พักใช้งาน'} · Revision {i.Revision}</p>{editable&&<button className="mt-2 text-sm text-blue-800 underline" onClick={()=>open(i)}>แก้ไข / พักใช้งาน</button>}</article>)}</div></div>)}
  {form&&<form aria-label="แก้ไขเขตพื้นที่" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await req('/auth/sales-territories/'+encodeURIComponent(form.code),{method:'PUT',body:JSON.stringify({...form,expectedDatabase:form.database,provinces:form.provincesText.split(/[,\n]/).map(s=>s.trim()).filter(Boolean)})});setForm(null);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}} className="space-y-3 rounded-xl border bg-white p-5">
   <label className="block">รหัสเขต<input aria-label="รหัสเขต" required disabled={form.expectedRevision>0||busy} value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} className="ml-2 rounded border p-2"/></label>
   <label className="block">ชื่อเขต<input aria-label="ชื่อเขต" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="ml-2 rounded border p-2"/></label>
   <label className="block">ประเภท<select aria-label="ประเภทเขต" value={form.type} onChange={e=>setForm({...form,type:e.target.value as Form['type']})} className="ml-2 rounded border p-2"><option value="SALE">เขตขาย</option><option value="PROMOTION">เขตส่งเสริมการขาย</option></select></label>
   <label className="block">ผู้รับผิดชอบ<select aria-label="ผู้รับผิดชอบเขต" required value={form.ownerUserId||''} onChange={e=>setForm({...form,ownerUserId:Number(e.target.value)})} className="ml-2 rounded border p-2"><option value="">เลือกบัญชีที่ผูกพนักงาน</option>{owners.filter(o=>o.EmpCode).map(o=><option key={o.Id} value={o.Id}>{o.EmpCode} · {o.DisplayName}</option>)}</select></label>
   <label className="block">จังหวัด (แยกด้วยบรรทัดใหม่)<textarea aria-label="จังหวัดรับผิดชอบ" value={form.provincesText} onChange={e=>setForm({...form,provincesText:e.target.value})} className="mt-1 block min-h-32 w-full rounded border p-2"/></label>
   <label><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> เปิดใช้งานเขต</label>
   <input aria-label="เหตุผลแก้ไขเขต" required minLength={10} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="เหตุผลแก้ไขอย่างน้อย 10 ตัวอักษร" className="block w-full rounded border p-2"/>
   <div className="flex gap-2"><button disabled={busy} className="rounded bg-[#0C447C] px-3 py-2 text-white">บันทึกพื้นที่</button><button disabled={busy} type="button" onClick={()=>setForm(null)}>ยกเลิก</button></div>
  </form>}
 </section>;
}
