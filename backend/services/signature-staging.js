'use strict';
const fs=require('fs');
const path=require('path');
// Only the new random-named upload created by this request can be removed.
// Legacy/shared files, symlinks and unexpected paths must never be touched.
async function removeRolledBackUpload(directory, file) {
  const filename=file?.filename;
  if(typeof filename!=='string' || !/^sig_[0-9]+_[a-f0-9]{32}(?:\.[a-z0-9]{1,10})?$/i.test(filename)) return false;
  const dir=path.resolve(directory), target=path.resolve(dir,filename);
  if(path.dirname(target)!==dir || path.resolve(String(file.path||''))!==target) return false;
  let stat;
  try { stat=await fs.promises.lstat(target); } catch(e) { if(e.code==='ENOENT') return false; throw e; }
  if(!stat.isFile() || stat.isSymbolicLink()) return false;
  await fs.promises.unlink(target);
  return true;
}
module.exports={removeRolledBackUpload};
