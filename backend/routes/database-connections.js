'use strict';
const express=require('express');
const rateLimit=require('express-rate-limit');
const {requireAuth}=require('../middleware/auth');
const {hasPermission,userRoles}=require('../services/role-capabilities');
const {createService}=require('../services/database-connections');
const router=express.Router(), service=createService();
function managementGuard(req,res,next) {
  if(req.user?.isImpersonating || (req.user?.actorSub && Number(req.user.actorSub)!==Number(req.user.sub)) || !userRoles(req.user).includes('ADMIN') || !hasPermission(req.user,'database.set-system')) return res.status(403).json({code:'FORBIDDEN',message:'เฉพาะผู้ดูแลระบบที่มีสิทธิ์ตั้งฐานระบบ และไม่ได้ใช้ Access As'});
  res.set('Cache-Control','no-store'); next();
}
router.use(requireAuth,managementGuard);
const messages={
  CONNECTION_STORE_NOT_CONFIGURED:'IT ยังไม่ได้เตรียมที่เก็บ connection แบบเข้ารหัส',
  CONNECTION_STORE_UNREADABLE:'อ่านที่เก็บ connection ไม่สำเร็จ กรุณาให้ IT ตรวจไฟล์และกุญแจ',
  CONNECTION_STORE_BUSY:'มีผู้ดูแลกำลังดำเนินการ กรุณาลองอีกครั้ง',
  CONNECTION_INVALID:'รูปแบบ connection ไม่ถูกต้อง กรุณาตรวจช่องที่กรอก',
  CONNECTION_PASSWORD_REQUIRED:'กรอกรหัสผ่านสำหรับ connection นี้',
  CONNECTION_STALE:'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุดก่อนดำเนินการต่อ',
  CONNECTION_TARGET_NOT_APPROVED:'IT ต้องเพิ่มปลายทางนี้ในรายการที่อนุญาตก่อนทดสอบ',
  CONNECTION_DATABASE_NOT_ALLOWED:'ฐานข้อมูลนี้ยังไม่อยู่ในรายการที่ IT อนุญาต',
  CONNECTION_PRIMARY_REQUIRES_DEPLOY_CONFIG:'การเปลี่ยนปลายทางฐานหลักต้องให้ IT ปรับ deployment และ migrator ให้ตรงกันก่อน',
  CONNECTION_TEST_FAILED:'ทดสอบไม่ผ่าน: ตรวจปลายทาง รหัสผ่าน TLS สิทธิ์ SQL และ schema กับ IT (ระบบไม่แสดงข้อความที่อาจมีข้อมูลลับ)',
};
function error(res,e){const code=messages[e.code]?e.code:'CONNECTION_OPERATION_FAILED';return res.status(e.status||500).json({code,message:messages[code]||'ดำเนินการ connection ไม่สำเร็จ กรุณาติดต่อ IT'});}
router.get('/',(req,res)=>{try{res.json(service.list());}catch(e){error(res,e);}});
router.put('/:name',async(req,res)=>{try{res.json(await service.save(req.params.name,req.body?.profile,req.body?.revision,req.user.actorSub||req.user.sub));}catch(e){error(res,e);}});
const limit=rateLimit({windowMs:60000,limit:4,standardHeaders:true,legacyHeaders:false,message:{message:'ทดสอบได้ไม่เกิน 4 ครั้งต่อนาที กรุณารอสักครู่'}});
let testing=false;
router.post('/:name/test',limit,async(req,res)=>{
  if(testing)return res.status(409).json({message:'กำลังทดสอบ connection อื่น กรุณารอสักครู่'});
  testing=true;
  try{res.json(await service.test(req.params.name,req.body?.revision,req.user.actorSub||req.user.sub));}catch(e){error(res,e);}finally{testing=false;}
});
module.exports=router;
module.exports.managementGuard=managementGuard;
