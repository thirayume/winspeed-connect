require('dotenv').config();
const db = require('../db');

async function fixLog() {
    try {
        await db.ownerReady;
        const pool = db.ownerPool;
        console.log('Connected to target:', db.getTarget());
        const dbName = process.env.DB_NAME || 'dbwins_worldfert9';
        
        await pool.request().query(`ALTER DATABASE [${dbName}] SET RECOVERY SIMPLE;`);
        console.log('Recovery set to SIMPLE.');
        
        const result = await pool.request().query(`
            SELECT name FROM sys.master_files WHERE database_id = db_id('${dbName}') AND type = 1
        `);
        if (result.recordset.length > 0) {
            const logName = result.recordset[0].name;
            await pool.request().query(`DBCC SHRINKFILE ('${logName}', 1);`);
            console.log(`Shrunk log file: ${logName}`);
        }
        
        await pool.request().query(`ALTER DATABASE [${dbName}] SET RECOVERY FULL;`);
        console.log('Recovery set back to FULL.');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
fixLog();
