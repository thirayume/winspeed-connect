import {useEffect,useState} from 'react';
import {Server,Save,PlugZap,RotateCw} from 'lucide-react';
import {getDatabaseConnections,saveDatabaseConnection,testDatabaseConnection,type DatabaseConnectionsInfo,type DatabaseConnectionProfile,type DatabaseConnectionItem} from '../../services/api';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges';
import {confirmLeaveEditors} from '../../utils/unsaved-changes';
import {formatThaiDate} from '../../utils/date';
type Form=DatabaseConnectionProfile & {password:string};
const makeForm=(p:DatabaseConnectionItem):Form=>({...p.draft,password:''});
export function DatabaseConnectionsSetting(){
  const [info,setInfo]=useState<DatabaseConnectionsInfo|null>(null),[selected,setSelected]=useState('');
  const [form,setForm]=useState<Form|null>(null),[baseline,setBaseline]=useState(''),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState(''),[error,setError]=useState('');
  const dirty=form!==null&&JSON.stringify(form)!==baseline;
  useUnsavedChanges(dirty||busy);
  function choose(p:DatabaseConnectionItem){const next=makeForm(p);setSelected(p.name);setForm(next);setBaseline(JSON.stringify(next));setError('');setMessage('');}
  useEffect(()=>{let live=true;getDatabaseConnections().then(d=>{if(!live)return;setInfo(d);if(d.profiles[0])choose(d.profiles[0]);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
  const current=info?.profiles.find(p=>p.name===selected);
  const input='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100';
  function field<K extends keyof Form>(key:K,value:Form[K]){setForm(prev=>prev?{...prev,[key]:value}:prev);setMessage('');}
  async function save(){
    if(!form||!current||busy)return;setBusy(true);setError('');setMessage('');
    try{const result=await saveDatabaseConnection(selected,form,current.revision);const next={...form,password:'',passwordSet:true};setForm(next);setBaseline(JSON.stringify(next));setInfo(prev=>prev?{...prev,profiles:prev.profiles.map(p=>p.name===selected?{...p,revision:result.revision,draft:(({password,...publicFields})=>publicFields)(next),testedAt:null}:p)}:prev);setMessage('บันทึกร่างแล้ว ค่าที่ระบบใช้งานยังไม่เปลี่ยน ขั้นต่อไปกดทดสอบการเชื่อมต่อ');}
    catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');}finally{setBusy(false);}
  }
  async function test(){
    if(!current||busy||dirty)return;setBusy(true);setError('');setMessage('');
    try{const result=await testDatabaseConnection(selected,current.revision);setInfo(prev=>prev?{...prev,profiles:prev.profiles.map(p=>p.name===selected?{...p,testedAt:result.testedAt}:p)}:prev);setMessage(`ทดสอบผ่าน Revision ${result.revision} ส่งให้ IT ตรวจแผน migration/สิทธิ์ และเปิดใช้ช่วงบำรุงรักษา`);}
    catch(e){setError(e instanceof Error?e.message:'ทดสอบไม่สำเร็จ');}finally{setBusy(false);}
  }
  async function reload(){if(busy||!(await confirmLeaveEditors()))return;setBusy(true);try{const d=await getDatabaseConnections();setInfo(d);const p=d.profiles.find(v=>v.name===selected)||d.profiles[0];if(p)choose(p);}catch(e){setError(e instanceof Error?e.message:'โหลดไม่สำเร็จ');}finally{setBusy(false);}}
  return <section data-testid="database-connections" className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold text-[#0C447C]"><Server size={18}/>การเชื่อมต่อแต่ละฐานข้อมูล</h3><p className="mt-1 text-xs text-gray-600">1. บันทึกร่าง → 2. ทดสอบ → 3. IT เปิดใช้ช่วงบำรุงรักษา</p></div><button type="button" title="โหลด connection ล่าสุด" aria-label="โหลด connection ล่าสุด" disabled={busy} onClick={reload} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"><RotateCw size={17}/></button></div>
    {error&&<p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="my-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {info&&!info.configured&&<p className="my-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">IT ต้องเตรียมที่เก็บรหัสผ่านแบบเข้ารหัสบนเซิร์ฟเวอร์ก่อนใช้งานส่วนนี้</p>}
    {!info&&!error&&<p className="mt-3 text-sm text-gray-500">กำลังโหลดการตั้งค่า...</p>}
    {info&&form&&current&&<fieldset disabled={busy} className="mt-4 space-y-4 disabled:opacity-70">
      <label className="block text-sm font-semibold">ฐานในระบบ (สิทธิ์และป้ายกำกับ)<select aria-label="เลือก connection" className={`${input} mt-1`} value={selected} onChange={async e=>{const val=e.target.value;if(!(await confirmLeaveEditors()))return;const p=info.profiles.find(v=>v.name===val);if(p)choose(p);}}>{info.profiles.map(p=><option key={p.name}>{p.name}</option>)}</select></label>
      <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">ร่าง Revision {current.revision} · {current.testedAt?`ทดสอบผ่าน ${formatThaiDate(current.testedAt, true)}`:'ยังไม่ผ่านการทดสอบร่างนี้'} · {current.activeRevision?`IT เตรียมเปิดใช้ Revision ${current.activeRevision} (มีผลหลัง restart)`:'ยังใช้ connection จาก deployment เดิม'}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Server / Host<input aria-label="Connection server" className={`${input} mt-1`} value={form.server} onChange={e=>field('server',e.target.value)} autoComplete="off" placeholder="sql.internal.example"/></label>
        <label className="text-sm font-semibold">TCP Port<input aria-label="Connection port" className={`${input} mt-1`} type="number" min={1} max={65535} value={form.port} onChange={e=>field('port',Number(e.target.value))}/></label>
        <label className="text-sm font-semibold">ชื่อฐานข้อมูลปลายทาง (DB name)<input aria-label="Connection database" className={`${input} mt-1`} value={form.database} onChange={e=>field('database',e.target.value)} autoComplete="off"/></label>
        <label className="text-sm font-semibold">SQL Username<input aria-label="Connection username" className={`${input} mt-1`} value={form.username} onChange={e=>field('username',e.target.value)} autoComplete="off"/></label>
        <label className="text-sm font-semibold sm:col-span-2">SQL Password<input aria-label="Connection password" type="password" className={`${input} mt-1`} value={form.password} onChange={e=>field('password',e.target.value)} autoComplete="new-password" placeholder={form.passwordSet?'เว้นว่างเพื่อใช้รหัสที่บันทึกในร่างเดิม':'กรอกรหัสผ่าน connection นี้'}/><span className="mt-1 block text-xs font-normal text-gray-500">{form.passwordSet?'มีรหัสในร่างแล้ว ระบบไม่แสดงรหัสเดิม':'ยังไม่มีรหัสในร่าง ไม่คัดลอกรหัส deployment มาแสดง'}</span></label>
      </div>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">ค่าตรวจยืนยันปลายทาง / TLS (ให้ IT ตรวจ)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Expected @@SERVERNAME<input aria-label="Expected SQL server name" className={input} value={form.expectedServerName} onChange={e=>field('expectedServerName',e.target.value)}/></label>
        <label className="text-sm">SQL version prefix<input aria-label="SQL version prefix" className={input} value={form.versionPrefix} onChange={e=>field('versionPrefix',e.target.value)}/></label>
        <label className="text-sm">TDS version<select aria-label="TDS version" className={input} value={form.tdsVersion} onChange={e=>field('tdsVersion',e.target.value)}><option>7_3_B</option><option>7_4</option></select></label>
        <div className="space-y-2 text-sm"><label className="flex gap-2"><input type="checkbox" checked={form.encrypt} onChange={e=>field('encrypt',e.target.checked)}/>เข้ารหัส SQL connection</label><label className="flex gap-2"><input type="checkbox" checked={form.legacyTls} onChange={e=>field('legacyTls',e.target.checked)}/>Legacy TLS ตามค่าที่ IT อนุมัติ</label></div>
      </div></details>
      <p className="text-xs leading-relaxed text-gray-600">ฐานหลักใช้ยืนยันตัวผู้ใช้และควบคุม migration ด้วย หากย้ายฐานหลัก IT ต้องปรับ deployment และ migrator ให้ตรงกันก่อนเปิดใช้ ส่วนฐานอื่นแยก server/port/login ได้ตามรายการปลายทางที่ IT อนุญาต การทดสอบนี้อ่าน identity และ schema เท่านั้น ไม่รัน migration</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!info.configured||!dirty} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-[#0C447C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><Save size={16}/>บันทึกร่าง connection</button><button type="button" disabled={!info.configured||dirty||!current.revision} onClick={test} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-40"><PlugZap size={16}/>ทดสอบการเชื่อมต่อ</button></div>
    </fieldset>}
  </section>;
}
