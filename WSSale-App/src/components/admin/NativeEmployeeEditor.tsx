import {useState} from 'react';
import {req} from '../../services/api';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges';
type Profile={EmpID:number;EmpCode:string;EmpName:string;EmpTitle:string|null;HeadCode:string|null;ExpectedSnapshot:string};
export function NativeEmployeeEditor({onSaved}:{onSaved:()=>Promise<void>}){
 const [code,setCode]=useState(''),[loaded,setLoaded]=useState<{code:string;database:string;data:Profile|null}|null>(null);
 const [name,setName]=useState(''),[title,setTitle]=useState(''),[headCode,setHeadCode]=useState(''),[sync,setSync]=useState(true),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const dirty=!!loaded&&(name!==(loaded.data?.EmpName||'')||title!==(loaded.data?.EmpTitle||'')||headCode!==(loaded.data?.HeadCode||'')||!!reason);
 useUnsavedChanges(dirty);
 const field='rounded border px-3 py-2 w-full';
 return <details className="shrink-0 rounded-xl border bg-white p-3 text-sm"><summary className="font-semibold text-[#0C447C] cursor-pointer">ข้อมูล Employee ต้นทาง WinSpeed</summary>
 <p className="text-xs text-slate-500 my-2">ชื่อและหัวหน้าพนักงานอ่านจาก WinSpeed โดยตรง · การมอบหมายตำแหน่งและสิทธิ์ดูข้อมูลกำหนดในผังองค์กร · การสร้าง Employee ยังไม่สร้างบัญชีเข้าสู่ระบบ</p>
 <form className="flex gap-2" onSubmit={async e=>{e.preventDefault();if(busy||dirty)return;setBusy(true);setError('');setNotice('');try{const normalized=code.trim().toUpperCase();const r=await req<{data:Profile|null;database:string}>('/auth/native-employees/'+encodeURIComponent(normalized));setLoaded({...r,code:normalized});setName(r.data?.EmpName||'');setTitle(r.data?.EmpTitle||'');setHeadCode(r.data?.HeadCode||'');setReason('');}catch(e){setError((e as Error).message);setLoaded(null);}finally{setBusy(false);}}}>
 <input aria-label="ค้นรหัส Employee ต้นทาง" maxLength={25} placeholder="EMP-00000" className={field} value={code} disabled={busy||dirty} onChange={e=>setCode(e.target.value)}/><button className="border rounded px-3 whitespace-nowrap" disabled={busy||dirty||!code.trim()}>อ่านข้อมูล</button></form>
 {loaded&&<form className="grid sm:grid-cols-2 gap-3 mt-3" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');try{const r=await req<{data:Profile;database:string}>('/auth/native-employees/'+encodeURIComponent(loaded.code),{method:'PUT',body:JSON.stringify({name,title,headCode:headCode||null,create:!loaded.data,expectedSnapshot:loaded.data?.ExpectedSnapshot||'',expectedDatabase:loaded.database,syncLinkedName:sync,reason})});setLoaded({...r,code:loaded.code});setName(r.data.EmpName);setTitle(r.data.EmpTitle||'');setHeadCode(r.data.HeadCode||'');setReason('');setNotice('บันทึก Employee พร้อมประวัติแล้ว');await onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
 <p className="sm:col-span-2">{loaded.data?'แก้ไข':'สร้าง'} Employee <strong>{loaded.code}</strong> · {loaded.database}</p>
 <label>ชื่อพนักงาน<input aria-label="ชื่อ Employee ต้นทาง" required maxLength={100} className={field} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
 <label>คำนำหน้า / ตำแหน่งใน WinSpeed<input aria-label="คำนำหน้า Employee ต้นทาง" maxLength={50} className={field} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
 <label>รหัสหัวหน้าใน WinSpeed<input aria-label="รหัสหัวหน้า Employee ต้นทาง" maxLength={25} className={field} placeholder="EMP-00000 หรือเว้นว่าง" value={headCode} disabled={busy} onChange={e=>setHeadCode(e.target.value)}/></label>
 <label className="flex items-center gap-2"><input type="checkbox" checked={sync} disabled={busy} onChange={e=>setSync(e.target.checked)}/>อัปเดตชื่อแสดงผลบัญชีที่ผูก Employee นี้ด้วย</label>
 <label className="sm:col-span-2">เหตุผล<input aria-label="เหตุผลแก้ Employee" required minLength={10} maxLength={500} className={field} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
 <div className="sm:col-span-2 flex gap-2"><button className="rounded bg-[#0C447C] text-white px-3 py-2" disabled={busy||reason.trim().length<10}>บันทึก Employee</button><button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={()=>{setLoaded(null);setReason('');}}>ยกเลิก</button></div>
 </form>}
 {error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}{notice&&<p role="status" className="mt-2 text-green-700">{notice}</p>}
 </details>;
}
