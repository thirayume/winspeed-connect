const { query } = require('./db');
query("SELECT Id, Status, DocuNo FROM wf.v_AllSalesOrders WHERE Id='3588'").then(console.log).catch(console.error).finally(()=>process.exit());
