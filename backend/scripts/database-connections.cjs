'use strict';
// Run only from the host/container's protected environment. No passwords on the command line.
require('dotenv').config({path:require('node:path').resolve(__dirname,'../.env'),quiet:true});
const store=require('../services/database-connection-store');
const service=require('../services/database-connections').createService();
async function main(){
  const [action,name,rawRevision,confirmation]=process.argv.slice(2);
  if(action==='init'){store.initialize(process.env);console.log('ENCRYPTED_CONNECTION_STORE_CREATED');return;}
  if(action==='test'&&name){console.log(JSON.stringify(await service.test(name,Number(rawRevision),'IT:'+require('node:os').userInfo().username)));return;}
  if(!['activate','rollback'].includes(action)||!name)throw store.fail('Usage: init | test <logical-database> <revision> | activate <logical-database> <revision> MAINTENANCE | rollback <logical-database> MAINTENANCE');
  if((action==='activate'?confirmation:rawRevision)!=='MAINTENANCE')throw store.fail('Stop web services and confirm the maintenance window with MAINTENANCE');
  const actor='IT:'+require('node:os').userInfo().username;
  const result=action==='activate'?await service.activate(name,Number(rawRevision),actor):await service.rollback(name,actor);
  console.log(JSON.stringify({result:'SUCCESS',...result}));
}
main().catch(e=>{console.error(e.code||'CONNECTION_OPERATION_FAILED');process.exitCode=1;});
