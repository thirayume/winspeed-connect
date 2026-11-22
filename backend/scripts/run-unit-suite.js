'use strict';
// Keep npm's command below Windows cmd.exe's 8191-character limit. Preserve the
// explicit CI selection; never discover integration tests or start SQL implicitly.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const suites=require('../tests/unit-suites.json');
const name=process.argv[2]||'test',files=suites[name];
if(!Array.isArray(files)||!files.length||files.some(file=>!/^tests\/[a-zA-Z0-9_.-]+\.(js|cjs)$/.test(file))){
 console.error('Unknown or invalid unit test suite');process.exitCode=1;
}else{
 const result=spawnSync(process.execPath,['--test',...process.argv.slice(3),...files],{
  cwd:path.resolve(__dirname,'..'),stdio:'inherit',shell:false,
 });
 if(result.error){console.error(result.error.message);process.exitCode=1;}
 else process.exitCode=result.status??1;
}
