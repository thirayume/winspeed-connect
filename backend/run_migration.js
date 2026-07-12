const { wfQuery } = require('./db');

async function run() {
  const sql = `
    IF COL_LENGTH('wf.AppUser', 'Address') IS NULL ALTER TABLE wf.AppUser ADD Address NVARCHAR(500) NULL;
    IF COL_LENGTH('wf.AppUser', 'Phone') IS NULL ALTER TABLE wf.AppUser ADD Phone NVARCHAR(50) NULL;
    IF COL_LENGTH('wf.AppUser', 'Email') IS NULL ALTER TABLE wf.AppUser ADD Email NVARCHAR(100) NULL;
    IF COL_LENGTH('wf.AppUser', 'IdCardNo') IS NULL ALTER TABLE wf.AppUser ADD IdCardNo NVARCHAR(20) NULL;
    IF COL_LENGTH('wf.AppUser', 'TaxId') IS NULL ALTER TABLE wf.AppUser ADD TaxId NVARCHAR(20) NULL;
    IF COL_LENGTH('wf.AppUser', 'SignatureFile') IS NULL ALTER TABLE wf.AppUser ADD SignatureFile NVARCHAR(255) NULL;
  `;
  try {
    await wfQuery(sql);
    console.log('Columns added');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
