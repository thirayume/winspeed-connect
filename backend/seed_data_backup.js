const sql = require('mssql/msnodesqlv8');

const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_demo',
  options: {
    trustedConnection: true,
  },
  driver: 'msnodesqlv8'
};

async function seedData() {
  try {
    const pool = await sql.connect(config);
    console.log("Connected to DB. Starting seed...");

    // 1. Fetch valid Customers and Items
    const custResult = await pool.request().query('SELECT CustID FROM EMCust');
    const customers = custResult.recordset.map(r => r.CustID);
    
    const goodResult = await pool.request().query('SELECT GoodID FROM EMGood');
    const goods = goodResult.recordset;

    if (customers.length === 0 || goods.length === 0) {
      throw new Error("Missing customers or goods in DB");
    }

    // Get max SOID to continue from
    const maxSoidRes = await pool.request().query('SELECT ISNULL(MAX(CAST(SOID as INT)), 1000) as MaxSOID FROM SOHD');
    let nextSoid = maxSoidRes.recordset[0].MaxSOID + 1;

    // We need 50 records
    // 15 Drafts, 15 Confirmed, 10 Picking, 10 Shipped
    const states = [
      ...Array(15).fill({ AppvFlag: 'N', PkgStatus: 'N', clearflag: 'N' }), // Draft
      ...Array(15).fill({ AppvFlag: 'Y', PkgStatus: 'N', clearflag: 'N' }), // Confirmed
      ...Array(10).fill({ AppvFlag: 'Y', PkgStatus: 'Y', clearflag: 'N' }), // Picking
      ...Array(10).fill({ AppvFlag: 'Y', PkgStatus: 'Y', clearflag: 'Y' })  // Shipped
    ];

    // Shuffle states
    states.sort(() => Math.random() - 0.5);

    let insertedHeaders = 0;
    let insertedDetails = 0;

    for (let i = 0; i < 50; i++) {
      const soid = nextSoid.toString();
      nextSoid++;

      const docuNo = `SO6705-${soid.padStart(5, '0')}`;
      const custId = customers[Math.floor(Math.random() * customers.length)];
      
      // Random date within last 3 months
      const date = new Date();
      date.setDate(date.getDate() - Math.floor(Math.random() * 90));
      const docuDate = date.toISOString().split('T')[0];
      
      const state = states[i];

      // Generate 1 to 5 lines
      const lineCount = Math.floor(Math.random() * 5) + 1;
      let totalAmnt = 0;

      const lines = [];
      for (let j = 1; j <= lineCount; j++) {
        const good = goods[Math.floor(Math.random() * goods.length)];
        const qty = Math.floor(Math.random() * 10) + 1;
        const price = good.GoodPrice1 || Math.floor(Math.random() * 1000) + 100;
        
        totalAmnt += qty * price;

        lines.push({
          SOID: soid,
          ListNo: j,
          GoodID: good.GoodID,
          GoodQty1: qty,
          GoodPrice1: price
        });
      }

      // Insert Header
      await pool.request()
        .input('SOID', sql.VarChar, soid)
        .input('DocuNo', sql.VarChar, docuNo)
        .input('CustID', sql.VarChar, custId)
        .input('DocuDate', sql.Date, docuDate)
        .input('NetAmnt', sql.Decimal(18, 2), totalAmnt)
        .input('AppvFlag', sql.VarChar, state.AppvFlag)
        .input('PkgStatus', sql.VarChar, state.PkgStatus)
        .input('clearflag', sql.VarChar, state.clearflag)
        .input('EmpID', sql.VarChar, '1003')
        .input('BrchID', sql.VarChar, '2')
        // Not null defaults
        .input('DocuType', sql.VarChar, '112')
        .input('OnHold', sql.VarChar, 'N')
        .input('VatRate', sql.VarChar, '7')
        .input('VatType', sql.VarChar, '1')
        .input('GoodType', sql.VarChar, '1')
        .input('ExchRate', sql.VarChar, '1')
        .input('ClearSO', sql.VarChar, 'N')
        .input('MultiCurrency', sql.VarChar, 'N')
        .input('DocuStatus', sql.VarChar, 'Y')
        .input('AlertFlag', sql.VarChar, 'N')
        .query(`
          INSERT INTO SOHD (
            SOID, DocuNo, CustID, DocuDate, NetAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, GoodType, ExchRate, ClearSO, MultiCurrency, DocuStatus, AlertFlag
          )
          VALUES (
            @SOID, @DocuNo, @CustID, @DocuDate, @NetAmnt, @AppvFlag, @PkgStatus, @clearflag, @EmpID, @BrchID,
            @DocuType, @OnHold, @VatRate, @VatType, @GoodType, @ExchRate, @ClearSO, @MultiCurrency, @DocuStatus, @AlertFlag
          )
        `);
      insertedHeaders++;

      // Insert Lines
      for (const line of lines) {
        await pool.request()
          .input('SOID', sql.VarChar, line.SOID)
          .input('ListNo', sql.Int, line.ListNo)
          .input('GoodID', sql.VarChar, line.GoodID)
          .input('GoodQty1', sql.Decimal(18, 2), line.GoodQty1)
          .input('GoodPrice1', sql.Decimal(18, 2), line.GoodPrice1)
          // Not null defaults
          .input('DocuType', sql.VarChar, '112')
          .input('LotFlag', sql.VarChar, 'N')
          .input('SerialFlag', sql.VarChar, 'N')
          .input('GoodType', sql.VarChar, '1')
          .input('VatType', sql.VarChar, '1')
          .input('StockFlag', sql.VarChar, '0')
          .input('GoodFlag', sql.VarChar, 'G')
          .input('RemaQty', sql.VarChar, '0')
          .input('FreeFlag', sql.VarChar, 'N')
          .input('GoodStockRate1', sql.VarChar, '0')
          .input('RemaGoodStockQty', sql.VarChar, '0')
          .input('remaamnt', sql.VarChar, '0')
          .query(`
            INSERT INTO SODT (
                SOID, ListNo, GoodID, GoodQty1, GoodPrice1,
                DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag, RemaQty, FreeFlag,
                GoodStockRate1, RemaGoodStockQty, remaamnt
            )
            VALUES (
                @SOID, @ListNo, @GoodID, @GoodQty1, @GoodPrice1,
                @DocuType, @LotFlag, @SerialFlag, @GoodType, @VatType, @StockFlag, @GoodFlag, @RemaQty, @FreeFlag,
                @GoodStockRate1, @RemaGoodStockQty, @remaamnt
            )
          `);
        insertedDetails++;
      }
    }

    console.log(`Successfully seeded ${insertedHeaders} SOHD records and ${insertedDetails} SODT records!`);
    pool.close();
  } catch (err) {
    console.error("Seeding failed:", err);
  }
}

seedData();
