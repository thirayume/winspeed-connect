'use strict';
const {sql}=require('../db');
const {invoiceFingerprint}=require('./initial-invoice-state');
const POLICY='O25-INV107-UAT2-v1';
async function verifyInvoiceContinuation(q,parent,manual,currentCutHash){
 const exists=(await q("SELECT OBJECT_ID('wf.NativeInitialInvoiceReceipt','U') AS InvoiceReceiptObject")).recordset?.[0]?.InvoiceReceiptObject;
 if(!exists)return false;
 const child=(await q('SELECT * FROM wf.NativeInitialInvoiceReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source',{
  source:{type:sql.Int,value:parent.SourceSOID}})).recordset?.[0];
 return Boolean(child&&child.PolicyVersion===POLICY
  &&Number(child.SourceSOID)===Number(manual.SourceSOID)
  &&Number(child.DeliverySOID)===Number(parent.DeliverySOID)
  &&Number(child.RedemptionID)===Number(manual.RedemptionID)
  &&child.DeliveryBeforeHash===manual.DeliveryAfterHash
  &&child.RedemptionBeforeHash===manual.RedemptionAfterHash
  &&child.DeliveryAfterHash===parent.DeliveryAfterHash
  &&child.RedemptionAfterHash===currentCutHash
  &&child.InvoiceAfterHash&&await invoiceFingerprint(q,child.InvoiceID)===child.InvoiceAfterHash);
}
module.exports={verifyInvoiceContinuation,POLICY};
