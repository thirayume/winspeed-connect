import {useEffect,useState} from 'react';
import {Plus,Save,Printer,RefreshCw,Trash2} from 'lucide-react';
import {req,type ReportData,type ResolvedReportTemplateDto} from '../../services/api';
import {useAuthStore} from '../../store/auth-store';
import {useUnsavedChanges} from '../../hooks/useUnsavedChanges';
import {appConfirm} from '../ui/AppAlert';
import {LegacyReportPdfModal} from './LegacyReportPdfModal';
import {bangkokDate} from '../../utils/date';
type Line={region:string;category:string;itemName:string;quantity:string;unitPrice:string;amount:string;note:string};
type Form={periodYear:number;channel:string;title:string;note:string;assignedReviewerId:string;assignedApproverId:string;lines:Line[];allocations:{region:string;amount:string}[]};
const line=():Line=>({region:'',category:'',itemName:'',quantity:'',unitPrice:'',amount:'',note:''});
const beYear=(value:number)=>value<2400?value+543:value;
const fresh=():Form=>({periodYear:beYear(Number(bangkokDate().slice(0,4))),channel:'ทั่วไป',title:'แผนงบส่งเสริมการขายรายปี',note:'',assignedReviewerId:'',assignedApproverId:'',lines:[line()],allocations:[]});
export function BudgetPlanPage(){
 const user=useAuthStore(s=>s.user),actions=user?.capabilities?.actions||[];
 const [plans,setPlans]=useState<any[]>([]),[approvers,setApprovers]=useState<any[]>([]),[current,setCurrent]=useState<any>(null);
 const [form,setForm]=useState<Form>(fresh),[baseline,setBaseline]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[year,setYear]=useState(fresh().periodYear);
 const [print,setPrint]=useState<{data:ReportData;template:ResolvedReportTemplateDto}|null>(null);
 const dirty=!!baseline&&JSON.stringify(form)!==baseline;useUnsavedChanges(dirty);
 const editable=(!current||['DRAFT','REJECTED'].includes(current.Status)) && (!current||[current.PreparedBy,current.PreparedActorId].map(Number).includes(Number(user?.id))||actions.includes('settings.manage'));
 const total=form.lines.reduce((s,l)=>s+(Number(l.amount)||0),0);
 async function list(){const r=await req<{data:any[]}>('/budget/plans');setPlans(r.data||[]);}
 useEffect(()=>{Promise.all([list(),req<{data:any[]}>('/budget/approvers').then(r=>setApprovers(r.data||[]))]).catch(e=>setError(e.message));setBaseline(JSON.stringify(fresh()));},[]);
 async function choose(id:number){
  if(dirty&&!await appConfirm('มีข้อมูลยังไม่บันทึก ต้องการเปลี่ยนแผนหรือไม่?'))return;
  setBusy(true);setError('');try{const p=await req<any>(`/budget/plans/${id}`),f:Form={periodYear:beYear(Number(p.PeriodYear)),channel:p.Channel,title:p.Title||'',note:p.Note||'',assignedReviewerId:String(p.AssignedReviewerId||''),assignedApproverId:String(p.AssignedApproverId||''),allocations:(p.allocations||[]).map((a:any)=>({region:a.Region,amount:String(a.Amount)})),lines:(p.lines||[]).map((l:any)=>({region:l.Region,category:l.Category,itemName:l.ItemName,quantity:l.Quantity==null?'':String(l.Quantity),unitPrice:l.UnitPrice==null?'':String(l.UnitPrice),amount:String(l.Amount),note:l.Note||''}))};setCurrent(p);setYear(f.periodYear);setForm(f);setBaseline(JSON.stringify(f));setReason('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function execute(action:string){
  if(busy)return;if(!reason.trim()){setError('กรุณาระบุเหตุผล');return;}if(action!=='save'&&dirty){setError('บันทึกร่างก่อนดำเนินการต่อ');return;}
  setBusy(true);setError('');try{
   const path=action==='save'?`/budget/plans${current?'/'+current.PlanId:''}`:`/budget/plans/${current.PlanId}/${action}`;
   const body=action==='save'?{...form,expectedVersion:current?.EditVersion,reason}:{expectedVersion:current?.EditVersion,reason};
   const p=await req<any>(path,{method:action==='save'&&current?'PUT':'POST',body:JSON.stringify(body)});setCurrent(p);setYear(beYear(Number(p.PeriodYear)));setBaseline(JSON.stringify(form));setReason('');await list();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const set=(k:keyof Form,v:any)=>setForm(f=>({...f,[k]:v}));
 function edit(i:number,k:keyof Line,v:string){setForm(f=>({...f,lines:f.lines.map((l,j)=>{if(i!==j)return l;const n={...l,[k]:v};if((k==='quantity'||k==='unitPrice')&&n.quantity!==''&&n.unitPrice!=='')n.amount=(Number(n.quantity)*Number(n.unitPrice)).toFixed(2);return n;})}));}
 return <div className="h-full flex flex-col bg-slate-50 p-4 gap-4 overflow-auto">
  <div className="flex flex-wrap gap-3 justify-between items-center"><div><h1 className="text-2xl font-bold text-[#0C447C]">Budget Plan · งบส่งเสริมการขาย</h1><p className="text-sm text-slate-600">แผนรายปี 1 มกราคม – 31 ธันวาคม · ผู้จัดทำ → ผู้ตรวจสอบ → ผู้อนุมัติ</p></div><button className="border bg-white rounded-lg p-2" disabled={busy} onClick={()=>list().catch(e=>setError(e.message))}><RefreshCw size={18}/></button></div>
  {error&&<div role="alert" className="p-3 border border-red-200 bg-red-50 text-red-800 rounded-lg">{error}</div>}
  <div className="flex gap-3 items-center flex-wrap"><label>ปี พ.ศ. <input aria-label="เลือกปีงบประมาณ" disabled={busy} type="number" value={year} onChange={e=>setYear(Number(e.target.value))} className="border p-2 w-28 rounded-lg"/></label>
   <select aria-label="เลือกแผน" disabled={busy} className="border p-2 rounded-lg min-w-64" value={current?.PlanId||''} onChange={e=>{if(e.target.value)choose(Number(e.target.value));}}><option value="">เลือกแผนปี {year}</option>{plans.filter(p=>p.periodYear===year||p.periodYear===year-543).map(p=><option key={p.planId} value={p.planId}>{p.title} · {p.channel} · {p.status}</option>)}</select>
   {actions.includes('budget.plan.create')&&<button className="bg-[#0C447C] text-white rounded-lg px-3 py-2 flex gap-1" disabled={busy} onClick={async()=>{if(dirty&&!await appConfirm('ทิ้งร่างที่ยังไม่บันทึกหรือไม่?'))return;const f={...fresh(),periodYear:year};setCurrent(null);setForm(f);setBaseline(JSON.stringify(f));setReason('');}}><Plus size={18}/>แผนใหม่</button>}
   {current&&<span className="text-sm rounded-full bg-blue-100 px-3 py-1">{current.Status} · รุ่น {current.EditVersion}</span>}
  </div>
  <fieldset disabled={busy||!editable||!actions.includes('budget.plan.create')} className="bg-white rounded-xl border p-4 space-y-3">
   <div className="grid md:grid-cols-3 gap-3"><label className="text-sm">ชื่อแผน<input aria-label="ชื่อแผน" className="w-full border rounded p-2" value={form.title} maxLength={200} onChange={e=>set('title',e.target.value)}/></label><label className="text-sm">ปี พ.ศ.<input aria-label="ปีแผน" className="w-full border rounded p-2" type="number" value={form.periodYear} onChange={e=>set('periodYear',Number(e.target.value))}/></label><label className="text-sm">ช่องทาง<select aria-label="ช่องทาง" className="w-full border rounded p-2" value={form.channel} onChange={e=>set('channel',e.target.value)}><option>ทั่วไป</option><option>โรงงานน้ำตาล</option></select></label></div>
   <div className="grid md:grid-cols-2 gap-3">{[['assignedReviewerId','ผู้ตรวจสอบ (Manager)','CanReview'],['assignedApproverId','ผู้อนุมัติ (C_Level)','CanApprove']].map(([k,label,cap])=><label key={k} className="text-sm">{label}<select aria-label={label} className="w-full border rounded p-2" value={form[k as keyof Form] as string} onChange={e=>set(k as keyof Form,e.target.value)}><option value="">เลือกผู้มีสิทธิ์</option>{approvers.filter(a=>a[cap]).map(a=><option key={a.Id} value={a.Id}>{a.DisplayName}</option>)}</select></label>)}</div>
   <div className="rounded-lg bg-blue-50 p-3 space-y-2"><h2 className="font-bold">วงเงินรายปีแยกภาค / หน่วยงาน</h2>{form.allocations.map((a,i)=><div key={i} className="flex gap-2"><input aria-label={`ภาควงเงิน ${i+1}`} placeholder="ภาค / หน่วยงาน" value={a.region} className="border rounded p-2" onChange={e=>set('allocations',form.allocations.map((v,j)=>j===i?{...v,region:e.target.value}:v))}/><input aria-label={`วงเงิน ${i+1}`} type="number" min="0" step="0.01" placeholder="วงเงินบาท" value={a.amount} className="border rounded p-2" onChange={e=>set('allocations',form.allocations.map((v,j)=>j===i?{...v,amount:e.target.value}:v))}/><button title="ลบวงเงินภาค" onClick={()=>set('allocations',form.allocations.filter((_,j)=>j!==i))}><Trash2 size={16}/></button></div>)}<button onClick={()=>set('allocations',[...form.allocations,{region:'',amount:''}])} className="border rounded p-2 bg-white">+ เพิ่มวงเงินภาค</button></div>
   <div className="overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-100"><tr>{['ภาค / หน่วยงาน','หมวด','รายการ','จำนวน','ราคา/หน่วย','จำนวนเงิน (บาท)','หมายเหตุ',''].map((s,i)=><th key={i} className="p-2">{s}</th>)}</tr></thead><tbody>{form.lines.map((l,i)=><tr key={i}>{(['region','category','itemName','quantity','unitPrice','amount','note'] as const).map(k=><td key={k} className="p-1"><input aria-label={`${k} บรรทัด ${i+1}`} className={`border rounded p-2 w-full ${['quantity','unitPrice','amount'].includes(k)?'min-w-24 text-right':'min-w-32'}`} type={['quantity','unitPrice','amount'].includes(k)?'number':'text'} min="0" step={k==='quantity'?'0.0001':'0.01'} value={l[k]} onChange={e=>edit(i,k,e.target.value)}/></td>)}<td><button title="ลบบรรทัด" onClick={()=>set('lines',form.lines.filter((_,j)=>j!==i))}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
   <div className="flex justify-between"><button className="border rounded px-3 py-2" onClick={()=>set('lines',[...form.lines,line()])}>+ เพิ่มรายการ</button><strong>รวม {total.toLocaleString('th-TH',{minimumFractionDigits:2})} บาท</strong></div>
   <textarea aria-label="หมายเหตุแผน" className="border p-2 rounded w-full" maxLength={500} placeholder="หมายเหตุ / วัตถุประสงค์" value={form.note} onChange={e=>set('note',e.target.value)}/>
  </fieldset>
  <div className="border bg-white p-4 rounded-xl space-y-3"><input aria-label="เหตุผลการดำเนินการ" disabled={busy} className="border p-2 rounded w-full" maxLength={500} placeholder="เหตุผลการบันทึก / พิจารณา" value={reason} onChange={e=>setReason(e.target.value)}/><div className="flex gap-2 flex-wrap">
   {editable&&actions.includes('budget.plan.create')&&<button disabled={busy} className="bg-[#0C447C] text-white rounded px-3 py-2 flex gap-1" onClick={()=>execute('save')}><Save size={18}/>บันทึกร่าง</button>}
   {current&&editable&&Number(current.PreparedBy)===Number(user?.id)&&actions.includes('budget.plan.create')&&<button disabled={busy||dirty} className="border rounded px-3 py-2" onClick={()=>execute('submit')}>ยื่นตรวจสอบ</button>}
   {current?.Status==='PENDING'&&<>{!current.ReviewedAt&&Number(current.AssignedReviewerId)===Number(user?.id)&&actions.includes('budget.plan.review')&&<button disabled={busy||dirty} className="bg-blue-700 text-white rounded px-3 py-2" onClick={()=>execute('review')}>ตรวจสอบและส่งอนุมัติ</button>}{current.ReviewedAt&&Number(current.AssignedApproverId)===Number(user?.id)&&actions.includes('budget.plan.approve')&&<button disabled={busy||dirty} className="bg-green-700 text-white rounded px-3 py-2" onClick={()=>execute('approve')}>อนุมัติแผน</button>}{Number(current.ReviewedAt?current.AssignedApproverId:current.AssignedReviewerId)===Number(user?.id)&&actions.includes(current.ReviewedAt?'budget.plan.approve':'budget.plan.review')&&<button disabled={busy} className="border rounded px-3 py-2" onClick={()=>execute('reject')}>ไม่อนุมัติ / ส่งคืน</button>}</>}
   {current&&Number(current.PreparedBy)===Number(user?.id)&&['DRAFT','PENDING','REJECTED'].includes(current.Status)&&actions.includes('budget.plan.create')&&<button disabled={busy} className="border rounded px-3 py-2" onClick={async()=>{if(await appConfirm('ยกเลิกแผนนี้หรือไม่? ประวัติจะยังคงอยู่'))execute('cancel');}}>ยกเลิกแผน</button>}
   {current&&<button disabled={busy||dirty} className="border rounded px-3 py-2 flex gap-1" onClick={async()=>{try{setPrint(await req<any>(`/budget/plans/${current.PlanId}/report`));}catch(e){setError((e as Error).message);}}}><Printer size={18}/>พิมพ์คำขอ</button>}
  </div></div><p className="text-xs text-slate-500">ประมาณการรายปีในศูนย์รายงานรวมเฉพาะแผนที่อนุมัติแล้ว งบส่วนนี้ไม่เปลี่ยน Rebate หรือโควต้าของแถมโดยอัตโนมัติ</p>
  {print&&<LegacyReportPdfModal data={print.data} template={print.template} onClose={()=>setPrint(null)}/>}
 </div>;
}
