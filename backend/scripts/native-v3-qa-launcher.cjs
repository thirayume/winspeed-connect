'use strict';
// Isolated rehearsal launcher only. Never used by Compose/deploy targets.
const fs=require('fs'),dotenv=require('dotenv');
Object.assign(process.env,dotenv.parse(fs.readFileSync('/review-config/.env')));
const {QA}=require('../services/native-document-target');
if(process.env.ONPREM_DB_NAME!==QA)throw Error('QA_RUNTIME_ISOLATION_REQUIRED');
const file='/review-state/qa-ticket-treatment.json';
const treatment=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).treatment:'ZERO';
if(!['ZERO','DISCOUNT'].includes(treatment))throw Error('QA_TREATMENT_INVALID');
Object.assign(process.env,{DB_MODE:'onprem',NATIVE_DOCUMENT_WRITER_VERSION:'v3',NATIVE_COUPON_BRIDGE_ENABLED:'true',
 NATIVE_BOOKING_AI_ENABLED:'true',NATIVE_DELIVERY_104_ENABLED:'true',NATIVE_MANUAL_116_ENABLED:'true',NATIVE_INVOICE_107_ENABLED:'true',
 QA_NATIVE_REBATE_PROFILE:'on',REBATE_RESET_DATABASES:QA,REBATE_TICKET_REDEMPTION_TREATMENT:QA+':'+treatment,
 DISABLE_BACKGROUND_WORKERS:'true',ONPREM_CONNECTION_PROFILES_DISABLE:'true',ONPREM_SWITCHABLE_DATABASES:QA,
 ...Object.fromEntries(require('./native-v3-qa-profile.cjs').FLAGS.map(k=>[k,'true']))});
require('./native-v3-qa-server.cjs');
