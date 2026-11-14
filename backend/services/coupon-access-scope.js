'use strict';

const {sql,wfQuery}=require('../db');
const {getVisibleScope,scopeFilter}=require('./visible-scope');
const {actorPerspective}=require('./business-identity');

// Customer search is open; coupon documents belong to the salesperson on the
// issuing SO. Access As must be inside both users' document scopes.
async function couponScope(user) {
  if (!user) throw Object.assign(Error('COUPON_IDENTITY_REQUIRED'),{status:401});
  const actor=actorPerspective(user);
  const scopes=[await getVisibleScope(user),...(actor===user?[]:[await getVisibleScope(actor)])];
  const clauses=[],inputs={};
  for (const [i,scope] of scopes.entries()) {
    const f=scopeFilter(scope,{userCol:'couponOwnerExt.SalesUserId',empCol:'s.EmpID',prefix:`couponScope${i}`});
    clauses.push(`(${f.sql})`);Object.assign(inputs,f.inputs);
  }
  return {sql:clauses.join(' AND '),inputs};
}

async function couponVisible(user,id) {
  const n=Number(id);
  if (!/^\d+$/.test(String(id)) || !Number.isSafeInteger(n) || n<=0 || n>2147483647) return false;
  const filter=await couponScope(user);
  const result=await wfQuery(`SELECT TOP 1 1 AS ok FROM dbo.WFCoupon c
    JOIN dbo.SOHD s ON s.SOID=c.DocuID
    LEFT JOIN wf.SalesOrderExt couponOwnerExt ON couponOwnerExt.SOID=CONVERT(VARCHAR(50),s.SOID)
    WHERE c.CouponID=@scopeCouponId AND ${filter.sql}`,
  {...filter.inputs,scopeCouponId:{type:sql.Int,value:n}});
  return Boolean(result.recordset?.length);
}

module.exports={couponScope,couponVisible};
