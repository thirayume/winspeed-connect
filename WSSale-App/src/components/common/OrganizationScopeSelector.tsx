import {useEffect,useState} from 'react';
import {req,cancelPendingReads} from '../../services/api';
import {useOrgScopeStore} from '../../store/org-scope-store';
import {confirmLeaveEditors} from '../../utils/unsaved-changes';
type Group={PositionCode:string;PositionName:string;Tier:number};
export function OrganizationScopeSelector(){
 const branch=useOrgScopeStore(s=>s.branch),setBranch=useOrgScopeStore(s=>s.setBranch);
 const [groups,setGroups]=useState<Group[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;req<{groups:Group[]}>('/auth/scope-groups',{silent:true}).then(r=>{if(active){setGroups(Array.isArray(r.groups)?r.groups:[]);setError('');}}).catch(()=>{if(active)setError('ตรวจขอบเขตสายงานไม่สำเร็จ');});return()=>{active=false;};},[]);
 if(!groups.length&&!error)return null;
 return <label className="flex min-w-0 max-w-56 flex-col text-[10px] text-slate-500">ขอบเขตข้อมูลตามสายงาน
  <select aria-label="เลือกสายงานข้อมูล" value={branch} disabled={Boolean(error)} title={error||'ทุกหน้าจะแสดงเฉพาะสายงานที่มีสิทธิ์'} className="max-w-full rounded border bg-white px-2 py-1 text-xs text-[#0C447C]" onChange={async e=>{const next=e.target.value;if(!await confirmLeaveEditors())return;cancelPendingReads();setBranch(next);}}>
   <option value="">{error||'ทุกสายงานที่มีสิทธิ์'}</option>{groups.map(g=><option key={g.PositionCode} value={g.PositionCode}>{'· '.repeat(Math.max(0,g.Tier-1))}{g.PositionName}</option>)}
  </select>
 </label>;
}
