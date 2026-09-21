'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

const TEST_LOGIN = process.env.WF_TEST_LOGIN || process.env.REMOTE_B_DB_USER || 'wf_test';
const TEST_PWD = process.env.WF_TEST_PASSWORD || process.env.REMOTE_B_DB_PASSWORD;
if (!TEST_PWD) {
  throw new Error('Missing password in WF_TEST_PASSWORD or REMOTE_B_DB_PASSWORD');
}

async function main() {
  await db.runWithTarget('remote_b', async () => {
    console.log('Connecting via sa to provision wf_test login...');

    // 1. Create login if not exists
    await db.wfQuery(`
      IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${TEST_LOGIN}')
      BEGIN
        CREATE LOGIN [${TEST_LOGIN}] WITH PASSWORD = '${TEST_PWD}', CHECK_POLICY = OFF;
        PRINT 'Created login ${TEST_LOGIN}';
      END
      ELSE
      BEGIN
        ALTER LOGIN [${TEST_LOGIN}] WITH PASSWORD = '${TEST_PWD}';
        PRINT 'Updated login ${TEST_LOGIN} password';
      END
    `);

    // 2. Map user in dbwins_worldfert9_test_v2 and grant db_owner
    await db.wfQuery(`
      USE dbwins_worldfert9_test_v2;
      IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${TEST_LOGIN}')
      BEGIN
        CREATE USER [${TEST_LOGIN}] FOR LOGIN [${TEST_LOGIN}];
        PRINT 'Created user ${TEST_LOGIN} in test_v2';
      END;
      ALTER ROLE db_owner ADD MEMBER [${TEST_LOGIN}];
    `);

    // 3. Ensure NO user exists in dbwins_worldfert9 (production)
    await db.wfQuery(`
      USE dbwins_worldfert9;
      IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${TEST_LOGIN}')
      BEGIN
        DROP USER [${TEST_LOGIN}];
        PRINT 'Dropped user ${TEST_LOGIN} from production';
      END;
    `);

    console.log('wf_test login provisioned successfully.');
  });
}

main().catch(err => {
  console.error('PROVISION ERROR:', err);
  process.exit(1);
});
