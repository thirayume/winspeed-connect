'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runTransaction}=require('../services/transaction-execution');
const {removeRolledBackUpload}=require('../services/signature-staging');
test('only confirmed pre-commit rollback removes the new upload',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wf-signature-test-'));
  const filename='sig_7_0123456789abcdef0123456789abcdef.png',file={filename,path:path.join(dir,filename)};
  try{
    const cleanup=()=>removeRolledBackUpload(dir,file);
    await fs.writeFile(file.path,'fixture');
    await assert.rejects(runTransaction({rollback:async()=>{},commit:async()=>{}},async()=>{throw Error('audit');},cleanup),/audit/);
    await assert.rejects(fs.stat(file.path),{code:'ENOENT'});
    await fs.writeFile(file.path,'fixture');
    await assert.rejects(runTransaction({rollback:async()=>{throw Error('connection');},commit:async()=>{}},async()=>{throw Error('audit');},cleanup),/audit/);
    assert.ok((await fs.stat(file.path)).isFile());
    await assert.rejects(runTransaction({rollback:async()=>{},commit:async()=>{throw Error('uncertain commit');}},async()=>{},cleanup),/uncertain commit/);
    assert.ok((await fs.stat(file.path)).isFile());
    await runTransaction({rollback:async()=>{},commit:async()=>{}},async()=>{},cleanup);assert.ok((await fs.stat(file.path)).isFile());
    assert.equal(await removeRolledBackUpload(dir,{filename:'../old.png',path:file.path}),false);
    assert.equal(await removeRolledBackUpload(dir,{filename,path:path.join(dir,'other.png')}),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
