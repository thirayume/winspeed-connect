'use strict';
const {wfQuery,sql}=require('../db');
const {getVisibleScope,scopeFilter}=require('./visible-scope');
const {actorPerspective}=require('./business-identity');
const {readGlobalDataWindow}=require('./global-data-window-store');
async function tripScopeSql(user, alias = 't',queryFn=wfQuery) {
  const dataWindow = await readGlobalDataWindow();
  const actor = actorPerspective(user);
  const effectiveScope = await getVisibleScope(user,queryFn);
  const actorScope = actor === user ? effectiveScope : await getVisibleScope(actor,queryFn);
  const visibility = (scope, prefix) => {
    if (scope.all) return { sql: '1=1', inputs: {} };
    const created = scopeFilter(scope, { userCol: `${alias}.CreatedBy`, prefix: `${prefix}c` });
    const member = scopeFilter(scope, { userCol: 'm.SalesUserId', prefix: `${prefix}m` });
    // Board responses include every member and line of a selected trip. On a
    // secondary database, don't expose a mixed trip just because one member is
    // in scope. NULL owners are also treated as out of scope.
    const foreignMember = scopeFilter(scope, { userCol: 'outsideMember.SalesUserId', prefix: `${prefix}outside` });
    const fullTripScope = ` AND NOT EXISTS (
      SELECT 1 FROM wf.v_TripMember outsideMember WHERE outsideMember.TripId = ${alias}.TripId
        AND CASE WHEN ${foreignMember.sql} THEN 0 ELSE 1 END = 1)`;
    return {
      sql: `((${created.sql} OR EXISTS (SELECT 1 FROM wf.v_TripMember m WHERE m.TripId = ${alias}.TripId AND ${member.sql}))${fullTripScope})`,
      inputs: { ...created.inputs, ...member.inputs, ...foreignMember.inputs },
    };
  };
  const effective = visibility(effectiveScope, 'te');
  const realActor = visibility(actorScope, 'ta');
  // A mixed trip must not silently omit older members: its loading plan and
  // approval totals are computed from the complete trip. Hide the whole trip
  // until it is reviewed rather than exposing or operating on old documents.
  const windowSql = `${alias}.CreatedAt >= @tripStartUtc AND NOT EXISTS (
    SELECT 1 FROM wf.v_TripMember tw
    LEFT JOIN wf.SalesOrder draft ON tw.MemberKind='DRAFT' AND CAST(draft.Id AS VARCHAR(50))=tw.MemberId
    LEFT JOIN dbo.SOHD native ON tw.MemberKind='CONFIRMED' AND native.SOID=tw.SOID AND native.DocuType=103
    WHERE tw.TripId=${alias}.TripId AND (
      (tw.MemberKind='DRAFT' AND (draft.Id IS NULL OR draft.CreatedAt IS NULL OR draft.CreatedAt < @tripStartUtc)) OR
      (tw.MemberKind='CONFIRMED' AND (native.SOID IS NULL OR native.DocuDate IS NULL OR native.DocuDate < @tripStartDate)) OR
      tw.MemberKind IS NULL OR tw.MemberKind NOT IN ('DRAFT','CONFIRMED')
    ))`;
  return {
    sql: `(${windowSql}) AND (${effective.sql}) AND (${realActor.sql})`,
    inputs: { ...effective.inputs, ...realActor.inputs,
      tripStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
      tripStartDate: { type: sql.Date, value: dataWindow.businessDate } },
  };
}

async function assertTripScopeInTransaction(tx,user,tripId){
 const q=async(text,inputs={})=>{const r=tx.request();for(const[k,v]of Object.entries(inputs))r.input(k,v.type,v.value);return r.query(text);};
 const scope=await tripScopeSql(user,'t',q);
 const visible=(await q(`SELECT 1 AS ok FROM wf.SalesTrip t WITH(HOLDLOCK) WHERE t.TripId=@scopeTripId AND ${scope.sql}`,
  {scopeTripId:{type:sql.Int,value:Number(tripId)},...scope.inputs})).recordset?.[0];
 if(!visible)throw Object.assign(Error('ไม่พบเที่ยวรถในสายงานที่มีสิทธิ์'),{status:404,code:'TRIP_NOT_FOUND'});
}
module.exports={tripScopeSql,assertTripScopeInTransaction};
