'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const queue = ['docs/README.md','docs/CURRENT-STATE.md','docs/DEPLOYMENT.md'];
const seen = new Set();
const errors = [];
// Design baseline v2.0.0 is historical; release manifests must agree with root.
const releaseVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseVersion || '')) errors.push('Invalid root release version');
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const text = fs.readFileSync(path.join(root,file),'utf8').replace(/```[\s\S]*?```/g,'');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g,'').split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    const absolute = path.resolve(root,path.dirname(file),decodeURIComponent(target));
    if (!fs.existsSync(absolute)) {errors.push(file+': missing '+target);continue;}
    const relative = path.relative(root,absolute).split(path.sep).join('/');
    if (relative.startsWith('docs/') && relative.endsWith('.md') && !/^docs\/(archive|enterprise)\//.test(relative)) queue.push(relative);
  }
}
for (const directory of ['','backend','WSSale-App']) {
  for (const name of ['package.json','package-lock.json']) {
    const p=path.join(root,directory,name),j=JSON.parse(fs.readFileSync(p));
    if (j.version !== releaseVersion || (j.packages && j.packages['']?.version !== releaseVersion)) errors.push(p+': version mismatch');
  }
}
errors.forEach(x=>console.error(x));
console.log(`Canonical documents checked: ${seen.size}; errors: ${errors.length}`);
process.exitCode=errors.length?1:0;
