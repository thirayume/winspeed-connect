'use strict';
const { wfQuery, runWithTarget } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    for (const tbl of ['RebateClaimLine', 'RebateClaimApproval', 'RebateClaimInvoice']) {
      const cols = await wfQuery(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'wf' AND TABLE_NAME = @tbl
        ORDER BY ORDINAL_POSITION
      `, { tbl: { type: require('../backend/db').sql.NVarChar, value: tbl } });
      console.log(`\nTABLE wf.${tbl}:`);
      cols.recordset.forEach(c => console.log(` - ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH || ''}) nullable=${c.IS_NULLABLE}`));
    }
  });
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
