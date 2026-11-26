'use strict';
// Organization approvals go upward, never sideways or to the requester.
async function isSuperior(query,supervisor,employee){
 const a=Number(supervisor),b=Number(employee);
 if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<=0||b<=0||a===b)return false;
 const {sql}=require('../db');
 const rows=(await query(`SELECT wf.fn_IsOrganizationSuperior(@supervisor,@employee) AS Allowed`,{
  supervisor:{type:sql.Int,value:a},employee:{type:sql.Int,value:b}
 })).recordset||[];
 return Number(rows[0]?.Allowed)===1;
}
async function requireChain(query,preparers,reviewer,approver,branch=null){
 const makers=[...new Set(preparers.map(Number).filter(n=>n>0))];
 if(branch){
  const {sql}=require('../db');
  const r=await query('SELECT wf.fn_IsUserAbovePosition(@supervisor,@branch) AS Allowed',{supervisor:{type:sql.Int,value:Number(reviewer)},branch:{type:sql.VarChar(30),value:branch}});
  if(Number(r.recordset?.[0]?.Allowed)!==1)throw Object.assign(Error('ผู้ตรวจต้องอยู่เหนือสายงานเจ้าของแผน'),{status:403,code:'BUDGET_REVIEWER_OUTSIDE_CHAIN'});
 }else for(const maker of makers)if(!await isSuperior(query,reviewer,maker))throw Object.assign(Error('ผู้ตรวจต้องอยู่เหนือผู้จัดทำในสายบังคับบัญชา'),{status:403,code:'BUDGET_REVIEWER_OUTSIDE_CHAIN'});
 if(!await isSuperior(query,approver,reviewer))throw Object.assign(Error('ผู้อนุมัติต้องอยู่เหนือผู้ตรวจในสายบังคับบัญชา'),{status:403,code:'BUDGET_APPROVER_OUTSIDE_CHAIN'});
}
module.exports={isSuperior,requireChain};
