'use strict';
// No database connection or credentials. Input is JSON encoded as base64 by the wrapper.
const {payload}=require('../services/native-writer-release');
try {console.log(JSON.stringify(payload(JSON.parse(Buffer.from(process.argv[2]||'','base64').toString('utf8')))));}
catch {console.error('NATIVE_RELEASE_PAYLOAD_INVALID');process.exitCode=1;}
