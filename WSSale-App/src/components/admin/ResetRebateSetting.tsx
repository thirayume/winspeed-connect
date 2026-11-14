import {useCallback,useEffect,useState} from 'react';
import {req} from '../../services/api';
import {useAuthStore} from '../../store/auth-store';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges';

type ResetStatus={enabled:boolean;environment?:string;primaryDatabase?:string;manifestDigest?:string;
  databases?:{database:string;server:string}[];coordinatorPhase?:string|null;bootstrapPhase?:string|null;
  activeRequestId?:string|null;recoveryOwnedByAnotherAdmin?:boolean};
type ResetResult={requestId:string;complete:boolean;replayed:boolean;generation:number};

export function ResetRebateSetting(){
  const user=useAuthStore(s=>s.user);
  const [status,setStatus]=useState<ResetStatus|null>(null),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useUnsavedChanges(busy);
  const load=useCallback(async()=>{
    try{const data=await req<ResetStatus>('/rebate-pool/admin/reset',{silent:true});setStatus(data);setError('');}
    catch{setStatus(null);setError('ตรวจความพร้อม Reset ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ');}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function execute(){
    if(busy||!status?.enabled||confirmation!=='RESET'||status.recoveryOwnedByAnotherAdmin||!user?.id||
      !status.environment||!status.primaryDatabase||!status.manifestDigest)return;
    setBusy(true);setError('');setMessage('');
    const key=`rebate-reset:${user.id}:${status.environment}:${status.manifestDigest}`;
    try{
      let id=localStorage.getItem(key);
      if(status.activeRequestId&&id&&id!==status.activeRequestId)throw new Error('มีคำขอ Reset อื่นกำลังทำงาน กรุณาตรวจสอบกับผู้ดูแลระบบ');
      id=status.activeRequestId||id||crypto.randomUUID();
      localStorage.setItem(key,id);
      const result=await req<ResetResult>('/rebate-pool/admin/reset',{method:'POST',silent:true,body:JSON.stringify({
        confirmation:'RESET',requestId:id,expectedEnvironment:status.environment,
        expectedPrimaryDatabase:status.primaryDatabase,expectedManifestDigest:status.manifestDigest,
      })});
      if(!result.complete)throw new Error('ยังยืนยันผลไม่ได้ กรุณาตรวจสถานะก่อนลองคำขอเดิม');
      localStorage.removeItem(key);setConfirmation('');
      setMessage(`เริ่มรอบ Rebate ใหม่เรียบร้อย (รอบ ${result.generation})`);
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Reset ไม่สำเร็จ กรุณาลองคำขอเดิมอีกครั้ง');}
    finally{setBusy(false);}
  }
  return <section className="rounded-2xl border border-amber-200 bg-white p-5 space-y-4">
    <h2 className="font-bold text-[#0C447C]">เริ่มยอด Rebate ใหม่ทุกฐานในระบบนี้</h2>
    <p className="text-sm text-gray-700">เมื่อยืนยัน ยอดสะสมของลูกค้าเริ่มที่ศูนย์จากเวลายืนยัน คำขอที่ยังรอจะถูกยกเลิก และตั๋วที่ออกสำเร็จแล้วจะคงอยู่ ระบบ UAT และ Production ทำงานแยกกัน</p>
    {!status&& !error && <p role="status">กำลังตรวจความพร้อม...</p>}
    {status&&!status.enabled&&<p role="status" className="text-amber-800">ยังไม่เปิดใช้ Reset ระหว่างตรวจความปลอดภัยและทดสอบ UAT</p>}
    {status?.enabled&&<>
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm">
        <p>ระบบ: <strong>{status.environment==='production'?'Production':'UAT'}</strong> · ฐานหลัก: {status.primaryDatabase}</p>
        <p className="mt-1">ฐานที่จะได้รับผล:</p>
        <ul className="list-disc pl-5">{status.databases?.map(d=><li key={`${d.server}/${d.database}`}>{d.server} / {d.database}</li>)}</ul>
      </div>
      {status.recoveryOwnedByAnotherAdmin&&<p role="alert" className="text-red-700 text-sm">มีคำขอค้างของผู้ดูแลรายอื่น กรุณาให้ผู้เริ่มรายการเข้าสู่ระบบเพื่อดำเนินการต่อ</p>}
      {status.activeRequestId&&<p className="text-amber-800 text-sm">พบคำขอของคุณที่ยังไม่เสร็จ ระบบจะดำเนินคำขอเดิมต่อ</p>}
      <label className="block text-sm font-semibold">พิมพ์ RESET เพื่อยืนยัน<input value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2" /></label>
      <button type="button" onClick={()=>void execute()} disabled={busy||confirmation!=='RESET'||status.recoveryOwnedByAnotherAdmin}
        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'กำลังดำเนินการ...':status.activeRequestId?'ดำเนินคำขอเดิมต่อ':'ยืนยันเริ่มยอด Rebate ใหม่'}</button>
    </>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="text-sm text-green-700">{message}</p>}
    <button type="button" onClick={()=>void load()} disabled={busy} className="text-sm text-blue-700 underline">ตรวจสถานะอีกครั้ง</button>
  </section>;
}
