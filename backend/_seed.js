require('dotenv').config();
const { wfQuery } = require('./db.js');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const script = fs.readFileSync(path.join(__dirname, '../db-init/e2e-seed.sql'), 'utf8');
    await wfQuery(script);
    console.log('Seed executed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}
run();
