'use strict';
const fields=Object.freeze({docuDate:'COALESCE(q.DocuDate,q.CreatedAt)',docuNo:"COALESCE(NULLIF(q.ImportedDocuNo,''),q.WfRef)",docuType:'q.DocuType',status:'q.Status',deliveryDate:'COALESCE(q.DeliveryDate,q.CreatedAt)'});
function documentOrder(query={}){
 const key=query.sortBy||'docuDate',direction=String(query.sortDirection||'desc').toUpperCase();
 if(!Object.hasOwn(fields,key)||!['ASC','DESC'].includes(direction))throw Object.assign(Error('ตัวเลือกเรียงเอกสารไม่ถูกต้อง'),{status:400});
 return `${fields[key]} ${direction},q.Id ${direction}`;
}
module.exports={documentOrder};
