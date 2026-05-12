const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// SQL Connection configuration
const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_demo',
  options: {
    trustedConnection: true, // Use Windows Authentication
    enableArithAbort: true,
  },
  driver: 'msnodesqlv8'
};

// Create connection pool
const pool = new sql.ConnectionPool(config);
const poolConnect = pool.connect();

poolConnect.then(() => {
    console.log('Connected to SQL Server (dbwins_demo)');
}).catch(err => {
    console.error('Database Connection Failed! Bad Config: ', err);
});

// GET /api/customers
app.get('/api/customers', async (req, res) => {
    try {
        await poolConnect;
        const request = pool.request();
        // Adjust the WHERE clause as needed, or remove it to get all customers
        const result = await request.query('SELECT CustID, CustName FROM EMCust');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error retrieving customers');
    }
});

// GET /api/items
app.get('/api/items', async (req, res) => {
    try {
        await poolConnect;
        const request = pool.request();
        // We simulate DailyCapacity since it's not in the base WINSpeed schema
        const result = await request.query(`
            SELECT 
                GoodID, 
                GoodCode, 
                GoodName1 as GoodName, 
                MainGoodUnitID as Unit,
                GoodGroupID as Category,
                ISNULL(StandardSalePrce, 0) as GoodPrice1,
                ISNULL(StockQty, 0) as StockQty,
                (ABS(LEN(GoodName1) * 73) % 400) + 100 as DailyCapacity
            FROM EMGood
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error retrieving items');
    }
});

// GET /api/vendors
app.get('/api/vendors', async (req, res) => {
    try {
        // Dummy data for vendors since EMVendor schema wasn't fully discussed, 
        // but let's query it if it exists.
        await poolConnect;
        const request = pool.request();
        const result = await request.query('SELECT VendorID, VendorName FROM EMVendor');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        // Fallback dummy data if table doesn't exist or errors
        res.json([
            { VendorID: "V001", VendorName: "Nippon Steel Supply" },
            { VendorID: "V002", VendorName: "Pacific Components Ltd" },
        ]);
    }
});

// GET /api/sales-orders (Paginated & Filtered)
app.get('/api/sales-orders', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const customer = req.query.customer || '';
        // status filtering omitted in DB query for now since we're mocking Status
        
        const offset = (page - 1) * limit;

        await poolConnect;
        
        let whereClauses = [];
        let params = [];

        if (search) {
            whereClauses.push(`(SOID LIKE @search OR DocuNo LIKE @search)`);
        }
        if (customer) {
            whereClauses.push(`CustID = @customer`);
        }

        const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Fetch Total Count
        const countRequest = pool.request();
        if (search) countRequest.input('search', sql.VarChar, `%${search}%`);
        if (customer) countRequest.input('customer', sql.VarChar, customer);
        
        const countResult = await countRequest.query(`
            SELECT COUNT(*) as Total 
            FROM SOHD 
            ${whereString}
        `);
        const total = countResult.recordset[0].Total;

        // Fetch Headers with Pagination
        const headerRequest = pool.request();
        if (search) headerRequest.input('search', sql.VarChar, `%${search}%`);
        if (customer) headerRequest.input('customer', sql.VarChar, customer);

        const headersResult = await headerRequest.query(`
            SELECT 
                S.SOID, S.DocuNo, S.CustID, C.CustName,
                CONVERT(varchar, S.DocuDate, 23) as DocuDate, 
                S.EmpID, S.BrchID, S.NetAmnt,
                S.AppvFlag, S.PkgStatus, S.clearflag
            FROM SOHD S
            LEFT JOIN EMCust C ON S.CustID = C.CustID
            ${whereString.replace(/SOID/g, 'S.SOID').replace(/DocuNo/g, 'S.DocuNo').replace(/CustID/g, 'S.CustID')}
            ORDER BY S.DocuDate DESC, S.SOID DESC
            OFFSET ${offset} ROWS
            FETCH NEXT ${limit} ROWS ONLY
        `);
        
        // Fetch Details for these headers
        const soids = headersResult.recordset.map(h => `'${h.SOID}'`).join(',');
        
        let detailsRecordset = [];
        if (soids.length > 0) {
            const detailRequest = pool.request();
            const detailsResult = await detailRequest.query(`
                SELECT D.SOID, D.ListNo, D.GoodID, D.GoodQty1, D.GoodPrice1, D.InveID, G.GoodName1 as GoodName
                FROM SODT D
                LEFT JOIN EMGood G ON RTRIM(D.GoodID) = RTRIM(G.GoodID)
                WHERE D.SOID IN (${soids})
            `);
            detailsRecordset = detailsResult.recordset;
        }

        // Assemble Data
        const data = headersResult.recordset.map(header => {
            const lines = detailsRecordset.filter(d => d.SOID === header.SOID);
            
            // Map the real DB status flags to our workflow states
            let mappedStatus = "Draft";
            if (header.clearflag === 'Y') mappedStatus = "Shipped";
            else if (header.PkgStatus === 'Y') mappedStatus = "Picking";
            else if (header.AppvFlag === 'Y') mappedStatus = "Confirmed";

            return {
                SOID: header.SOID,
                DocuNo: header.DocuNo,
                CustID: header.CustID,
                CustName: header.CustName, // Now included directly from DB!
                DocuDate: header.DocuDate,
                EmpID: header.EmpID,
                BrchID: header.BrchID,
                Status: mappedStatus, 
                TotalAmt: Number(header.NetAmnt) || 0, // Using real NetAmnt instead of line sum
                lines: lines
            };
        });

        res.json({
            data,
            total,
            page,
            limit
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error retrieving sales orders');
    }
});

// PUT /api/sales-orders/:id/status
app.put('/api/sales-orders/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        // Map status to flags
        let appv = 'N', pkg = 'N', clear = 'N';
        if (status === 'Confirmed') appv = 'Y';
        if (status === 'Picking') { appv = 'Y'; pkg = 'Y'; }
        if (status === 'Shipped') { appv = 'Y'; pkg = 'Y'; clear = 'Y'; }

        await poolConnect;
        const request = pool.request();
        await request
            .input('id', sql.VarChar, id)
            .input('appv', sql.VarChar, appv)
            .input('pkg', sql.VarChar, pkg)
            .input('clear', sql.VarChar, clear)
            .query('UPDATE SOHD SET AppvFlag = @appv, PkgStatus = @pkg, clearflag = @clear WHERE SOID = @id');
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating status');
    }
});

// DELETE /api/sales-orders/:id
app.delete('/api/sales-orders/:id', async (req, res) => {
    const transaction = new sql.Transaction(pool);
    try {
        const { id } = req.params;
        await poolConnect;
        await transaction.begin();
        
        const request = new sql.Request(transaction);
        await request.input('id', sql.VarChar, id).query('DELETE FROM SODT WHERE SOID = @id');
        await request.query('DELETE FROM SOHD WHERE SOID = @id');
        
        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error(err);
        res.status(500).send('Error deleting order');
    }
});

// PUT /api/sales-orders/:id (Update Order)
app.put('/api/sales-orders/:id', async (req, res) => {
    const transaction = new sql.Transaction(pool);
    try {
        const { id } = req.params;
        const { CustID, DocuDate, lines } = req.body;
        
        const netAmnt = lines.reduce((sum, l) => sum + (l.GoodQty1 * l.GoodPrice1), 0);
        
        await poolConnect;
        await transaction.begin();
        
        const request = new sql.Request(transaction);
        
        // Update Header
        await request
            .input('id', sql.VarChar, id)
            .input('cust', sql.VarChar, CustID)
            .input('date', sql.Date, DocuDate)
            .input('amnt', sql.Decimal(18, 2), netAmnt)
            .query('UPDATE SOHD SET CustID = @cust, DocuDate = @date, NetAmnt = @amnt WHERE SOID = @id');
            
        // Replace Lines
        await request.query('DELETE FROM SODT WHERE SOID = @id');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineReq = new sql.Request(transaction);
            await lineReq
                .input('id', sql.VarChar, id)
                .input('listNo', sql.Int, i + 1)
                .input('good', sql.VarChar, line.GoodID)
                .input('qty', sql.Decimal(18, 2), line.GoodQty1)
                .input('price', sql.Decimal(18, 2), line.GoodPrice1)
                .input('type', sql.VarChar, '112') // Default type from seeding
                .query(`
                    INSERT INTO SODT (SOID, ListNo, GoodID, GoodQty1, GoodPrice1, DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag, RemaQty, FreeFlag, GoodStockRate1, RemaGoodStockQty, remaamnt)
                    VALUES (@id, @listNo, @good, @qty, @price, @type, 'N', 'N', '1', '1', '0', 'G', '0', 'N', '0', '0', '0')
                `);
        }
        
        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error(err);
        res.status(500).send('Error updating order');
    }
});

// GET /api/purchase-orders
app.get('/api/purchase-orders', async (req, res) => {
    try {
        await poolConnect;
        const headerRequest = pool.request();
        const headersResult = await headerRequest.query(`
            SELECT TOP 50 
                POID, DocuNo, VendorID, 
                CONVERT(varchar, DocuDate, 23) as DocuDate
            FROM POHD 
            ORDER BY DocuDate DESC
        `);
        
        const poids = headersResult.recordset.map(h => `'${h.POID}'`).join(',');
        
        let detailsRecordset = [];
        if (poids.length > 0) {
            const detailRequest = pool.request();
            const detailsResult = await detailRequest.query(`
                SELECT POID, ListNo, GoodID, GoodQty1, GoodPrice1
                FROM PODT
                WHERE POID IN (${poids})
            `);
            detailsRecordset = detailsResult.recordset;
        }

        const formattedOrders = headersResult.recordset.map(header => {
            const lines = detailsRecordset.filter(d => d.POID === header.POID);
            const totalAmt = lines.reduce((sum, l) => sum + (l.GoodQty1 * l.GoodPrice1), 0);
            
            return {
                ...header,
                Status: "Pending Receipt", // Simulating status
                TotalAmt: totalAmt,
                lines: lines
            };
        });

        res.json(formattedOrders);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error retrieving purchase orders');
    }
});

// --- Unlock Request Logic (In-memory for now) ---
let unlockRequests = [];

app.get('/api/unlock-requests', (req, res) => {
    res.json(unlockRequests);
});

app.post('/api/unlock-requests', (req, res) => {
    const { SOID, reason } = req.body;
    const newRequest = {
        id: Math.random().toString(36).substr(2, 9),
        SOID,
        reason: reason || "No reason provided",
        createdAt: new Date().toISOString(),
        resolved: false
    };
    unlockRequests.push(newRequest);
    res.json(newRequest);
});

app.put('/api/unlock-requests/:id', (req, res) => {
    const { id } = req.params;
    const request = unlockRequests.find(r => r.id === id);
    if (request) {
        request.resolved = true;
        res.json({ success: true });
    } else {
        res.status(404).send('Request not found');
    }
});

app.get('/api/reports/kpi', async (req, res) => {
    try {
        await poolConnect;
        const request = pool.request();
        // Group by Employee and calculate stats
        // We'll simulate 'Cancellations' and 'Changes' since we don't have an audit log table yet
        const result = await request.query(`
            SELECT 
                EmpID as Sales,
                COUNT(SOID) as Orders,
                (ABS(CAST(CAST(EmpID AS VARBINARY) AS INT)) % 5) + 2 as Cancellations,
                (ABS(CAST(CAST(EmpID AS VARBINARY) AS INT)) % 10) + 5 as Changes
            FROM SOHD
            GROUP BY EmpID
        `);
        
        const data = result.recordset.map(r => ({
            ...r,
            Rate: Math.round(((r.Cancellations + r.Changes) / r.Orders) * 100)
        }));
        
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating report');
    }
});

app.listen(port, () => {
    console.log(`Backend API listening at http://localhost:${port}`);
});
