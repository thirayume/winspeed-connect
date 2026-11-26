'use strict';
const {randomUUID}=require('crypto');
const {sql}=require('../db');
const invalid=(message,status=400)=>Object.assign(Error(message),{status});
async function createDraftTrip(tx,user,orders,setup){
 if(!setup||typeof setup!=='object'||Array.isArray(setup)||orders.some(o=>o.tripId))throw invalid('ข้อมูลเที่ยวใหม่ไม่ถูกต้อง');
 const ids=await require('./trip-transaction-audit').requireTripAuditIdentity(user);
 const q=async(text,inputs={})=>{const r=tx.request();for(const[k,v]of Object.entries(inputs))r.input(k,v.type,v.value);return r.query(text);};
 const typeId=setup.truckTypeId==null?null:String(setup.truckTypeId).trim();
 if(typeId!==null&&(!typeId||typeId.length>50))throw invalid('ชนิดรถไม่ถูกต้อง');
 let capacity=null;
 if(typeId){
  const type=(await q('SELECT Id,MaxWeightMain,MaxWeightTrailer FROM wf.TruckType WITH(UPDLOCK,HOLDLOCK) WHERE Id=@type AND IsActive=1',{type:{type:sql.NVarChar(50),value:typeId}})).recordset?.[0];
  if(!type)throw invalid('ชนิดรถไม่มีอยู่หรือปิดใช้งานแล้ว',409);
  capacity=Number(type.MaxWeightMain||0)+Number(type.MaxWeightTrailer||0);
  if(!Number.isFinite(capacity)||capacity<=0)throw invalid('ชนิดรถยังไม่มีพิกัดบรรทุก',409);
 }
 const control=orders.every(o=>o.isControlTicket||o.soPrefix==='AI'||o.truckPlate==='ตั๋วคุม');
 const rawPlate=String(setup.transRegistration||'').trim();
 const plate=control||!rawPlate||['ยังไม่ระบุรถ','ตั๋วคุม','ไม่ระบุทะเบียนรถ'].includes(rawPlate)?null:rawPlate;
 if(plate&&plate.length>50)throw invalid('ทะเบียนรถยาวเกินกำหนด');
 const date=String(setup.deliveryDate||'').trim();
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T00:00:00Z').getTime())))throw invalid('วันที่รับสินค้าไม่ถูกต้อง');
 if(date){const {resolvePickupPolicy,evaluateTripLeadTime}=require('./so-pickup-policy'),policy=await resolvePickupPolicy();const check=evaluateTripLeadTime(date,policy.leadTimeDays,policy.strictMode);if(!check.valid&&check.blocked)throw invalid(check.error);}
 const code='TRIP-'+randomUUID(),preSling=orders.some(o=>Boolean(o.pSling));
 const result=await q(`INSERT INTO wf.SalesTrip(TripCode,TransRegistration,TruckCapacityTon,TruckTypeId,CreatedBy,PickupDueDate,DocumentRevision,PreSlingRequired)
  OUTPUT inserted.TripId VALUES(@code,@plate,@capacity,@type,@owner,@date,1,@sling)`,{
  code:{type:sql.VarChar(50),value:code},plate:{type:sql.VarChar(50),value:plate},capacity:{type:sql.Decimal(18,2),value:capacity},
  type:{type:sql.NVarChar(50),value:typeId},owner:{type:sql.Int,value:ids.effective},date:{type:sql.Date,value:date||null},sling:{type:sql.Bit,value:preSling}
 });
 const tripId=Number(result.recordset?.[0]?.TripId);if(!Number.isSafeInteger(tripId)||tripId<=0)throw invalid('สร้างเที่ยวไม่สำเร็จ',503);
 for(const order of orders)order.tripId=tripId;
 const trip={tripId,tripCode:code,truckTypeId:typeId,truckCapacityTon:capacity};
 await require('./trip-transaction-audit').logTripChange(tx,{tripId,action:'CREATE_WITH_BILLS',before:null,after:{...trip,plate,pickupDueDate:date||null,preSling,billCount:orders.length},effectiveId:ids.effective});
 return trip;
}
module.exports={createDraftTrip};
