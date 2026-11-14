'use strict';
// Verified password/token is rechecked against the locked identity row. No
// LINE identifiers, passwords, hashes, names or image URLs enter the audit.
async function linkLine({user, line}) {
  const {sql,wfTransaction}=require('../db');
  const id=Number(user?.Id);
  if(!Number.isSafeInteger(id)||id<=0||!user.PasswordHash||!line?.lineUserId) throw Object.assign(Error('LINE_LINK_INVALID'),{status:400});
  return wfTransaction(async tx=>{
    const current=(await tx.request().input('id',sql.Int,id).query('SELECT IsActive,PasswordHash,LineUserId FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id')).recordset?.[0];
    if(!current||!current.IsActive||current.PasswordHash!==user.PasswordHash) throw Object.assign(Error('LINE_ACCOUNT_CHANGED'),{status:409});
    if(current.LineUserId && current.LineUserId!==line.lineUserId) throw Object.assign(Error('LINE_ACCOUNT_ALREADY_LINKED'),{status:409});
    const existing=(await tx.request().input('line',sql.NVarChar(80),line.lineUserId).input('id',sql.Int,id)
      .query('SELECT TOP 1 Id FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE LineUserId=@line AND Id<>@id')).recordset?.[0];
    if(existing) throw Object.assign(Error('LINE_LINK_ALREADY_USED'),{status:409});
    const update=await tx.request().input('id',sql.Int,id).input('line',sql.NVarChar(80),line.lineUserId)
      .input('name',sql.NVarChar(150),line.lineDisplayName||null).input('picture',sql.NVarChar(500),line.linePictureUrl||null)
      .query('UPDATE wf.AppUser SET LineUserId=@line, LineDisplayName=@name, LinePictureUrl=@picture, LineLinkedAt=GETUTCDATE(), UpdatedAt=GETUTCDATE() WHERE Id=@id');
    if(Number(update.rowsAffected?.[0])!==1) throw Error('LINE_LINK_UPDATE_FAILED');
    await require('./admin-user-audit').auditUserMutation(tx,{actor:id,target:id,action:'LINE_LINK',fields:['lineUserId']});
  },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}
module.exports={linkLine};
