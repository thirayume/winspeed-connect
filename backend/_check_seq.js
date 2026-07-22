const { wfQuery } = require('./db');

async function run() {
  try {
    await wfQuery("ALTER TABLE wf.Quotation DROP CONSTRAINT FK__Quotation__Conve__176F17C2");
    console.log('Dropped FK');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
