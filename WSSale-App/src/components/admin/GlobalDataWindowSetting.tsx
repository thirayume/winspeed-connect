import {useEffect,useState} from 'react';
import {req} from '../../services/api';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges';

/** This setting is not ready for release until every relevant workflow is integrated and verified. */
export function GlobalDataWindowSetting(){
  const [value,setValue]=useState('');
  const [saved,setSaved]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const dirty=Boolean(saved)&&value!==saved;
  useUnsavedChanges(dirty||busy);
  useEffect(()=>{let live=true;req<{startDate:string}>('/master/global-data-window',{silent:true})
    .then(r=>{if(live){setValue(r.startDate);setSaved(r.startDate);}})
    .catch(()=>{if(live)setError('อ่านวันเริ่มข้อมูลไม่สำเร็จ');});return()=>{live=false;};},[]);
  async function save(){
    if(!dirty||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const r=await req<{startDate:string}>('/master/global-data-window',{method:'PUT',body:JSON.stringify({startDate:value,expectedStartDate:saved}),silent:true});
      setValue(r.startDate);setSaved(r.startDate);setMessage('บันทึกวันเริ่มข้อมูลแล้ว');
    }catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');}finally{setBusy(false);}
  }
  return <section className="rounded-2xl border border-blue-200 bg-white p-5 space-y-4">
    <h2 className="font-bold text-[#0C447C]">วันเริ่มข้อมูลของระบบ</h2>
    <p className="text-sm text-amber-800">กำลังพัฒนา: ยังเชื่อมไม่ครบทุกหน้าหรือ API ห้ามนำชุดนี้ไป deploy จนกว่าจะตรวจรับครบ</p>
    <p className="text-sm text-gray-600">ค่ากลางสำหรับทุกฐานที่สลับใช้ในระบบนี้ เวลาเริ่มต้น 00:00 น. ตามเวลาประเทศไทย รายการก่อนวันเริ่มถูกซ่อน โดยคงข้อมูลตั้งต้นและยอดยกมาสำหรับการคำนวณ</p>
    <label className="block text-sm font-semibold">วันเริ่มข้อมูล<input aria-label="วันเริ่มข้อมูล" type="date" className="mt-1 block rounded-lg border px-3 py-2" value={value} disabled={!saved||busy} onChange={e=>{setValue(e.target.value);setMessage('');}} /></label>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="text-sm text-green-700">{message}</p>}
    <button type="button" onClick={save} disabled={!dirty||busy||!value} className="rounded-lg bg-[#0C447C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">บันทึกวันเริ่มข้อมูล</button>
  </section>;
}
