'use strict';

const {sql,wfQuery}=require('../db');
const {getVisibleScope,scopeFilter}=require('./visible-scope');
const {actorPerspective}=require('./business-identity');

// Customer search is open; coupon documents belong to the salesperson on the
// issuing SO. Access As must be inside both users' document scopes.
async function couponScope(user,queryFn=wfQuery) {
  if (!user) throw Object.assign(Error('COUPON_IDENTITY_REQUIRED'),{status:401});
  const actor=actorPerspective(user);
  const scopes=[await getVisibleScope(user,queryFn),...(actor===user?[]:[await getVisibleScope(actor,queryFn)])];
  const clauses=[],inputs={};
  for (const [i,scope] of scopes.entries()) {
    const f=scopeFilter(scope,{userCol:'couponOwnerExt.SalesUserId',empCol:'s.EmpID',prefix:`couponScope${i}`});
    clauses.push(`(${f.sql})`);Object.assign(inputs,f.inputs);
  }
  return {sql:clauses.join(' AND '),inputs};
}

// A granted beneficiary may be managed by a different salesperson. Customer
// visibility follows the existing assignment / in-window booking rule, for
// both identities. This proves scope only; callers must also verify a live,
// product-specific beneficiary grant against the ticket's actual owner.
async function beneficiaryCustomerVisible(user,id,window,queryFn=wfQuery) {
  const n=Number(id);
  if (!/^\d+$/.test(String(id)) || !Number.isSafeInteger(n) || n<=0 || n>2147483647) return false;
  if (!window?.businessDate) throw Object.assign(Error('DATA_WINDOW_UNAVAILABLE'),{status:503});
  const actor=actorPerspective(user);
  const scopes=[await getVisibleScope(user,queryFn),...(actor===user?[]:[await getVisibleScope(actor,queryFn)])];
  const inputs={beneficiaryScopeId:{type:sql.Int,value:n},beneficiaryStartDate:{type:sql.Date,value:window.businessDate}};
  const conditions=[];
  for(const [i,scope] of scopes.entries()) {
    if(scope.all)continue;
    const assigned=scopeFilter(scope,{userCol:'beneficiaryExt.SalespersonUserId',empCol:'beneficiary.BillEmp',prefix:`beneficiaryAssigned${i}`});
    const booked=scopeFilter(scope,{userCol:'beneficiarySalesExt.SalesUserId',empCol:'beneficiaryBooking.EmpID',prefix:`beneficiaryBooked${i}`});
    Object.assign(inputs,assigned.inputs,booked.inputs);
    // The owner's customer policy permits unassigned customers to be selected.
    // This is scope only: a valid product-specific beneficiary grant remains mandatory.
    conditions.push(`((ISNULL(beneficiary.BillEmp,0)=0 AND ISNULL(beneficiaryExt.SalespersonUserId,0)=0) OR ${assigned.sql} OR EXISTS (SELECT 1 FROM dbo.SOHD beneficiaryBooking
      LEFT JOIN wf.SalesOrderExt beneficiarySalesExt ON beneficiarySalesExt.SOID=CONVERT(VARCHAR(50),beneficiaryBooking.SOID)
      WHERE beneficiaryBooking.CustID=beneficiary.CustID AND beneficiaryBooking.DocuType=103
        AND beneficiaryBooking.DocuDate>=@beneficiaryStartDate AND ${booked.sql}))`);
  }
  const result=await queryFn(`SELECT TOP 1 1 AS ok FROM dbo.EMCust beneficiary
    LEFT JOIN wf.CustomerExt beneficiaryExt ON beneficiaryExt.CustId=beneficiary.CustID
    WHERE beneficiary.CustID=@beneficiaryScopeId AND ${conditions.length?conditions.join(' AND '):'1=1'}`,inputs);
  return Boolean(result.recordset?.length);
}

async function couponVisible(user,id,queryFn=wfQuery) {
  const n=Number(id);
  if (!/^\d+$/.test(String(id)) || !Number.isSafeInteger(n) || n<=0 || n>2147483647) return false;
  const filter=await couponScope(user,queryFn);
  const result=await queryFn(`SELECT TOP 1 1 AS ok FROM dbo.WFCoupon c
    JOIN dbo.SOHD s ON s.SOID=c.DocuID
    LEFT JOIN wf.SalesOrderExt couponOwnerExt ON couponOwnerExt.SOID=CONVERT(VARCHAR(50),s.SOID)
    WHERE c.CouponID=@scopeCouponId AND ${filter.sql}`,
  {...filter.inputs,scopeCouponId:{type:sql.Int,value:n}});
  return Boolean(result.recordset?.length);
}

// A ticket can have reservations made for other sales teams. Never infer
// authority over every reservation merely from authority over its issuer.
async function reservationsVisible(user,ids,queryFn=wfQuery) {
  if(ids.some(n=>typeof n==='number'&&!Number.isSafeInteger(n)))return false;
  const numbers=[...new Set(ids.map(String))];
  if(numbers.some(n=>!/^[1-9]\d{0,18}$/.test(n)||BigInt(n)>9223372036854775807n))return false;
  if(!numbers.length)return true;
  const actor=actorPerspective(user);
  const scopes=[await getVisibleScope(user,queryFn),...(actor===user?[]:[await getVisibleScope(actor,queryFn)])];
  for(let offset=0;offset<numbers.length;offset+=400){
    const part=numbers.slice(offset,offset+400),inputs={},conditions=[];
    const keys=part.map((value,i)=>{const k=`reservationScopeId${i}`;inputs[k]={type:sql.BigInt,value};return `@${k}`;});
    for(const [i,scope] of scopes.entries()) {
      if(scope.all)continue;
      const draft=scopeFilter(scope,{userCol:'so.SalesUserId',prefix:`reservationDraft${i}`});
      const native=scopeFilter(scope,{userCol:'nativeExt.SalesUserId',empCol:'hd.EmpID',prefix:`reservationNative${i}`});
      const creator=scopeFilter(scope,{userCol:'cr.CreatedBy',prefix:`reservationCreator${i}`});
      Object.assign(inputs,draft.inputs,native.inputs,creator.inputs);
      // If numeric IDs collide across namespaces, both records must be visible.
      conditions.push(`((so.Id IS NULL OR ${draft.sql}) AND (hd.SOID IS NULL OR ${native.sql})
        AND (so.Id IS NOT NULL OR hd.SOID IS NOT NULL OR ${creator.sql}))`);
    }
    const rows=(await queryFn(`SELECT cr.Id FROM wf.CouponReservation cr
      LEFT JOIN wf.SalesOrder so ON CONVERT(VARCHAR(50),so.Id)=cr.CarrierSoId
      LEFT JOIN dbo.SOHD hd ON CONVERT(VARCHAR(50),hd.SOID)=cr.CarrierSoId
      LEFT JOIN wf.SalesOrderExt nativeExt ON nativeExt.SOID=CONVERT(VARCHAR(50),hd.SOID)
      WHERE cr.Id IN (${keys.join(',')}) AND ${conditions.length?conditions.join(' AND '):'1=1'}`,inputs)).recordset || [];
    const seen=new Set(rows.map(r=>String(r.Id)));
    if(part.some(id=>!seen.has(String(id))))return false;
  }
  return true;
}

module.exports={couponScope,couponVisible,beneficiaryCustomerVisible,reservationsVisible};
