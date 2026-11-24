'use strict';

const { normalizeDateString, isValidDateString, addBangkokCalendarDays, getBangkokDateString,
  diffBangkokCalendarDays } = require('./so-pickup-policy');

const DEFAULT_LIFE_DAYS = 90;
const DEFAULT_WARNING_DAYS = 30;
function positiveDays(value, fallback) {
  const n=Number(value);return Number.isSafeInteger(n)&&n>0 ? n : fallback;
}
function readDate(value) {
  if(value==null||value==='')return null;
  const day=normalizeDateString(value,{isWallClock:true});
  if(!day||!isValidDateString(day))throw Object.assign(new Error('ไม่สามารถตรวจวันหมดอายุของตั๋วได้'),{code:'COUPON_EXPIRY_INVALID',status:409});
  return day;
}
// The same precedence and Bangkok calendar boundary for reads and transactional use.
function couponExpiry({controlDate,ticketDate,issueDate,lifeDays,warningDays,controlRows=1},asOf=new Date()) {
  if(Number(controlRows)>1)throw Object.assign(new Error('ข้อมูลวันหมดอายุตั๋วซ้ำ กรุณาติดต่อผู้ดูแล'),{code:'COUPON_EXPIRY_AMBIGUOUS',status:409});
  const days=positiveDays(lifeDays,DEFAULT_LIFE_DAYS);
  const lead=warningDays!=null&&Number.isSafeInteger(Number(warningDays))&&Number(warningDays)>=0 ? Number(warningDays) : DEFAULT_WARNING_DAYS;
  let expiryDate=readDate(controlDate),source='CONTROL_TICKET';
  if(!expiryDate){expiryDate=readDate(ticketDate);source='TICKET';}
  if(!expiryDate){const issued=readDate(issueDate);expiryDate=issued?addBangkokCalendarDays(issued,days):null;source='DEFAULT';}
  const today=typeof asOf==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(asOf)?readDate(asOf):getBangkokDateString(asOf);
  const daysRemaining=expiryDate?diffBangkokCalendarDays(expiryDate,today):null;
  const status=daysRemaining==null?'UNKNOWN':daysRemaining<0?'EXPIRED':daysRemaining===0?'TODAY':daysRemaining<=lead?'NEAR_EXPIRY':'VALID';
  return {expiryDate,source:expiryDate?source:null,lifeDays:days,warningDays:lead,daysRemaining,status,
    expired:status==='EXPIRED',isToday:status==='TODAY',isExpiringSoon:status==='NEAR_EXPIRY',blocked:false};
}
async function readCouponExpirySettings(query) {
  const result=await query("SELECT SettingKey,SettingValue FROM wf.SystemSetting WHERE SettingKey IN ('TICKET_EXPIRY_DEFAULT_DAYS','TICKET_EXPIRY_WARNING_LEAD_DAYS')");
  const settings=Object.fromEntries((result.recordset||result||[]).map(r=>[r.SettingKey,r.SettingValue]));
  const lead=Number(settings.TICKET_EXPIRY_WARNING_LEAD_DAYS);
  return {lifeDays:positiveDays(settings.TICKET_EXPIRY_DEFAULT_DAYS,DEFAULT_LIFE_DAYS),
    warningDays:settings.TICKET_EXPIRY_WARNING_LEAD_DAYS!=null&&Number.isSafeInteger(lead)&&lead>=0?lead:DEFAULT_WARNING_DAYS};
}
module.exports={couponExpiry,readCouponExpirySettings,DEFAULT_LIFE_DAYS,DEFAULT_WARNING_DAYS};
