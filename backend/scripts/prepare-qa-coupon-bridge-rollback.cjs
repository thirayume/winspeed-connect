'use strict';
process.env.DOTENV_CONFIG_QUIET='true';
const fs=require('fs'),path=require('path'),runner=require('../run_migrations');
const hooks=require('../services/coupon-bridge-hooks'),baseline=require('../services/native-document-metadata.json');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const payload={up:runner.splitBatches(read('../migrations/270_coupon_bridge_contract.sql')+'\nGO\n'+read('../migrations/271_coupon_bridge_native_dispatch.sql')+'\nGO\n'+read('../migrations/272_coupon_bridge_native_save_order.sql')+'\nGO\n'+read('../migrations/273_coupon_bridge_native_session.sql')+'\nGO\n'+read('../migrations/274_coupon_bridge_native_detail_finalize.sql')+'\nGO\n'+read('../migrations/275_coupon_bridge_native_set_options.sql')),
 hooks:hooks.definitions.map(x=>x.sql),scenario:read('qa-coupon-bridge-scenario.sql'),module:hooks.moduleHash,
 baseline:baseline.triggers,expected:hooks.expectedTriggers(baseline.triggers),
 metadataQuery:'SELECT OBJECT_NAME(t.parent_id),t.name,t.is_disabled,m.definition FROM sys.triggers t LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id WHERE t.parent_id IN('
  +baseline.tables.map(name=>`OBJECT_ID('dbo.${name}')`).join(',')+')'};
if(['installed','upgrade'].includes(process.argv[2])){
 const prior=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 if(!/^[a-f0-9]{64}$/.test(prior.module)||!Array.isArray(prior.expected)||prior.expected.length!==baseline.triggers.length)throw Error('PRIOR_QA_METADATA_INVALID');
 payload.baseline=prior.expected;payload.priorModule=prior.module;
}
const template=['install','upgrade'].includes(process.argv[2])?'install-qa-coupon-bridge-hooks.ps1':'test-qa-coupon-bridge-rollback.ps1';
process.stdout.write(read(template).replace('__PAYLOAD__',Buffer.from(JSON.stringify(payload)).toString('base64')));
