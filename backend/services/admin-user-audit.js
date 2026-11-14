'use strict';
const FIELD_NAMES = new Set(['username','displayName','role','roleCodes','empId','isActive','address','phone','email','idCardNo','taxId','positionCode','lineUserId','password']);
async function auditUserMutation(tx, { actor, target, action, fields }) {
  const { sql } = require('../db');
  actor=Number(actor); target=Number(target);
  if (!Number.isSafeInteger(actor) || actor<=0 || !Number.isSafeInteger(target) || target<=0 || !['USER_CREATE','USER_UPDATE','USER_DELETE','LINE_LINK'].includes(action)) throw Error('USER_AUDIT_INPUT_INVALID');
  const names=[...new Set(fields.filter(x=>FIELD_NAMES.has(x)))].sort();
  const result=await tx.request().input('actor',sql.Int,actor).input('target',sql.NVarChar(100),String(target))
    .input('action',sql.VarChar(40),action).input('detail',sql.NVarChar(sql.MAX),JSON.stringify({requestedFields:names}))
    .query('INSERT INTO wf.AdminChangeAudit (ActorId, Action, Target, Detail) VALUES (@actor, @action, @target, @detail)');
  if(Number(result.rowsAffected?.[0])!==1) throw Error('USER_AUDIT_FAILED');
}
module.exports={auditUserMutation};
