'use strict';
const router=require('express').Router();
const {requireAuth}=require('../middleware/auth');
const {nativeDocument,httpError}=require('../services/native-document-service');
router.use(requireAuth);
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
