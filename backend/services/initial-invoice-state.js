'use strict';
const {createHash}=require('crypto');
const {sql}=require('../db');
async function invoiceSnapshot(q,id){
 const parts=[];
 const statements=[
  'SELECT * FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE SOInvID=@id AND Docutype=107 ORDER BY SOInvID',
  'SELECT * FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE SOInvID=@id AND Docutype=107 ORDER BY ListNo',
  'SELECT s.* FROM dbo.SMSat s WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOInvHD h ON h.PostID=s.GlobalID AND h.Docutype=s.GlobalFlag WHERE h.SOInvID=@id AND h.Docutype=107 ORDER BY s.GlobalID',
  'SELECT * FROM dbo.ICStockDetail WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@id AND DocuType=107 ORDER BY stockdetailid',
 ];
 for(const statement of statements){
  const value=(await q(`SELECT COALESCE(CONVERT(nvarchar(max),(${statement} FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL)),N'') AS Snapshot`,{id:{type:sql.Int,value:id}})).recordset?.[0]?.Snapshot;
  if(typeof value!=='string')throw Error('IP_SNAPSHOT_UNAVAILABLE');parts.push(value);
 }
 return parts;
}
async function invoiceFingerprint(q,id){return createHash('sha256').update(JSON.stringify(await invoiceSnapshot(q,id)),'utf8').digest('hex');}
module.exports={invoiceSnapshot,invoiceFingerprint};
