'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect,normalizeDuplicates,effectiveEnv,validate}=require('../scripts/env-audit.cjs');
test('duplicate normalization follows installed dotenv last-value semantics',()=>{
 const text='LOCAL_DB_SERVER=first\nLOCAL_DB_SERVER=second\nJWT_SECRET="fixture-only"\n';
 const result=normalizeDuplicates(text);
 assert.deepEqual(inspect(result).duplicates,[]);
 assert.deepEqual(effectiveEnv(result),effectiveEnv(text));
 assert.equal(effectiveEnv(result).LOCAL_DB_SERVER,'second');
});
test('inherited process environment retains precedence after normalization',()=>{
 const text='DB_MODE=remote\nDB_MODE=local\n';
 assert.equal(effectiveEnv(normalizeDuplicates(text),{DB_MODE:'local_rehearsal'}).DB_MODE,'local_rehearsal');
});
test('multiline duplicates cannot silently change parsed values',()=>{
 const text='TEXT="first\nDB_MODE=pretend\nlast"\nDB_MODE=local\n';
 assert.throws(()=>normalizeDuplicates(text),/changes effective/);
});
test('reports only key names, never values',()=>{
 const summary=inspect('JWT_SECRET=canary-secret\nJWT_SECRET=other-canary');
 assert.equal(JSON.stringify(summary).includes('canary'),false);
 assert.deepEqual(summary.duplicates,['JWT_SECRET']);
});
test('profiles require explicit fields and valid target',()=>{
 assert.ok(validate({DB_MODE:'typo'}).some(e=>e.startsWith('DB_MODE')));
 assert.ok(validate({DB_MODE:'local_rehearsal'}).some(e=>e.startsWith('LOCAL_REHEARSAL_PASSWORD')));
 assert.deepEqual(validate({DB_MODE:'local',LOCAL_DB_SERVER:'fixture',DB_NAME:'fixture'}),[]);
});
test('frontend refuses secrets while permitting API base URL',()=>{
 assert.equal(validate({VITE_API_BASE_URL:'https://example.invalid'},{frontend:true}).length,0);
 assert.ok(validate({VITE_DB_PASSWORD:'canary'},{frontend:true}).length);
});
test('ports and control flags fail on invalid values without echoing them',()=>{
 const result=validate({DB_MODE:'local',LOCAL_DB_SERVER:'fixture',DB_NAME:'fixture',PORT:'canary',ALLOW_LIVE_REHEARSAL:'yes'});
 assert.equal(result.length,2);assert.equal(JSON.stringify(result).includes('canary'),false);
});

