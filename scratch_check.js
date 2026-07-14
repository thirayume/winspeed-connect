const { sql, getTarget, wfQuery } = require('./backend/db');
wfQuery("SELECT TOP 1 * FROM wf.AppUser").then(r => console.log('AppUser:', r.recordset)).catch(console.error).finally(() => process.exit(0));
