'use strict';

// The continuation position can correspond to an out-of-scope authorization.
// Encrypt it rather than disclosing the ID; bind it to both identities, selected
// DB and the global cutoff. This is not a grant of access to any record.
const crypto=require('crypto');
const MAX_AGE_MS=15*60*1000;
function error(code,status){throw Object.assign(new Error(code),{code,status});}
function key(secret){
 if(typeof secret!=='string'||secret.length<16||secret==='dev_secret_change_in_production')
  error('COUPON_REVIEW_CURSOR_UNAVAILABLE',503);
 return crypto.createHmac('sha256',secret).update('coupon-native-review-cursor-v1').digest();
}
function context(actor,db,window){
 const effective=Number(actor?.sub??actor?.id),actual=Number(actor?.actorSub??actor?.actorId??effective);
 if(!Number.isSafeInteger(effective)||effective<=0||!Number.isSafeInteger(actual)||actual<=0||
    typeof db!=='string'||!db||typeof window!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(window))
  error('COUPON_REVIEW_CURSOR_INVALID',400);
 return JSON.stringify([effective,actual,db.toLowerCase(),window]);
}
function encodeCursor(position,actor,db,window,secret=process.env.JWT_SECRET,now=Date.now()){
 if(!Number.isSafeInteger(position)||position<0)error('COUPON_REVIEW_CURSOR_INVALID',400);
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',key(secret),iv);
 cipher.setAAD(Buffer.from(context(actor,db,window)));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({p:position,t:now}),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function decodeCursor(token,actor,db,window,secret=process.env.JWT_SECRET,now=Date.now()){
 const encryptionKey=key(secret),aad=context(actor,db,window);
 if(typeof token!=='string'||token.length<40||token.length>300||!/^[A-Za-z0-9_-]+$/.test(token))
  error('COUPON_REVIEW_CURSOR_INVALID',400);
 try{
  const raw=Buffer.from(token,'base64url');
  if(raw.length<29||raw.toString('base64url')!==token)throw Error('invalid token');
  const cipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey,raw.subarray(0,12));
  cipher.setAuthTag(raw.subarray(12,28));cipher.setAAD(Buffer.from(aad));
  const value=JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8'));
  if(!Number.isSafeInteger(value.p)||value.p<0||!Number.isSafeInteger(value.t)||value.t>now||now-value.t>MAX_AGE_MS)
   throw Error('expired token');
  return value.p;
 }catch(_){error('COUPON_REVIEW_CURSOR_INVALID',400);}
}
module.exports={encodeCursor,decodeCursor};
