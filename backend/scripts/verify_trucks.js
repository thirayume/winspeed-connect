const { runWithTarget, query } = require('c:/MyWork/WorldFert/winspeed-frontend/backend/db');

runWithTarget('remote_b', async () => {
  try {
    const trucks = await query(`SELECT TOP 5 TruckID, TruckLicn, TruckTypeID, TruckWeight, NetCapa, TruckTotalWeight FROM dbo.TMTruck WHERE TruckLicn IS NOT NULL AND TruckLicn <> ''`);
    console.log('--- TMTruck ---', trucks);

    const types = await query(`SELECT TOP 5 TruckTypeID, TruckTypeCode, TruckTypeName FROM dbo.TMTruckType`);
    console.log('--- TMTruckType ---', types);

    const wfTypes = await query(`SELECT TOP 5 Id, Name, MaxWeightMain, MaxWeightTrailer FROM wf.TruckType`);
    console.log('--- wf.TruckType ---', wfTypes);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
