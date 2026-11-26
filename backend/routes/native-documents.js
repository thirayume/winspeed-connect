'use strict';
const router=require('express').Router();
const {requireAuth}=require('../middleware/auth');
const {nativeDocument,httpError}=require('../services/native-document-service');
router.use(requireAuth);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/native116/queue',async(req,res)=>{
 try{res.json(await require('../services/native-116-recovery').native116Recovery({operation:'queue',user:req.user}));}
 catch(e){const r=httpError(e);res.status(r.status).json({...r,message:r.code});}
});
for(const operation of ['inspect','restore'])router.post('/native116/'+operation,async(req,res)=>{
 try{res.json(await require('../services/native-116-recovery').native116Recovery({operation,user:req.user,
  stageId:req.body?.stageId,fingerprint:req.body?.fingerprint,reason:req.body?.reason}));}
 catch(e){const r=httpError(e);res.status(r.status).json({...r,message:r.code});}
});
router.get('/bridge/queue',async(req,res)=>{
 try{res.json(await require('../services/coupon-bridge-service').bridgeOperation({operation:'queue',user:req.user}));}
 catch(e){const r=require('../services/coupon-bridge-service').httpError(e);res.status(r.status).json({...r,message:r.code});}
});
for(const operation of ['inspect','publish','adopt','release','withdraw','recover'])router.post('/bridge/'+operation,async(req,res)=>{
 try{
  const body=req.body||{};
  res.json(await require('../services/coupon-bridge-service').bridgeOperation({operation,user:req.user,nativeId:body.nativeId,docuNo:body.docuNo,custId:body.custId,
   requestId:body.requestId,permitId:body.permitId,operationType:body.operationType,lines:body.lines,data:body.data,fingerprint:body.fingerprint,reason:body.reason}));
 }catch(e){const r=require('../services/coupon-bridge-service').httpError(e);res.status(r.status).json({...r,message:r.code});}
});
router.get('/credit-requests',async(req,res)=>{
 try{res.json(await require('../services/native-document-context').listCreditRequests(req.user));}
 catch(e){const result=httpError(e);res.status(result.status).json({...result,message:result.code});}
});
router.get('/booking/:id',async(req,res)=>{
 try{res.json(await require('../services/native-document-context').inspectBooking({soid:req.params.id,user:req.user,couponNo:req.query.couponNo||''}));}
 catch(e){const result=httpError(e);res.status(result.status).json({...result,message:result.code});}
});
for(const operation of ['preview','request','approve','reject','cancel','apply']){
 router.post('/:type/:sourceId/'+operation,async(req,res)=>{
  try{
   const result=await nativeDocument({operation,type:Number(req.params.type),sourceId:req.params.sourceId,user:req.user,
    requestId:req.body?.requestId,fingerprint:req.body?.fingerprint,reason:req.body?.reason,lines:req.body?.lines,data:req.body?.data});
   if(operation==='apply'&&!result.replayed)require('../services/socket').broadcast('so_updated',{
    action:'native_document_applied',docuType:result.docuType,nativeId:result.nativeId});
   res.json(result);
  }catch(e){const result=httpError(e);res.status(result.status).json({...result,message:result.code});}
 });
}
module.exports=router;
