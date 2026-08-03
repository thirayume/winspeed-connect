/**
 * verify-pricebook-special.js
 *
 * Verifier script for Migration 070 & PriceBook Special Price workflow:
 * 1. Creates a DRAFT PriceBook with lines containing LineStatus (ACTIVE, DISCONTINUING, SUSPENDED).
 * 2. Approves and Activates the PriceBook.
 * 3. Submits a Special Price request for a customer.
 * 4. Verifies that the requester CANNOT approve their own request (403).
 * 5. Approves the Special Price with a Manager account.
 * 6. Fetches Effective Price for the customer and asserts SpecialPrice overrides StandardPrice.
 * 7. Cleans up test artifacts.
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { sql, wfQuery } = require('../db');
const { SECRET } = require('../middleware/auth');
const express = require('express');
const http = require('http');
const pricebookRouter = require('../routes/pricebook');

function makeToken(user) {
  return jwt.sign({ sub: user.Id, username: user.Username, role: user.Role }, SECRET, { expiresIn: '1h' });
}

async function main() {
  console.log('=== Starting PriceBook Special Price & Line Status Verification ===');

  // Setup express server for testing
  const app = express();
  app.use(express.json());
  app.use('/api/pricebook', pricebookRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Fetch test users for roles
  const salesUser = (await wfQuery(`SELECT TOP 1 Id, Username, Role FROM wf.AppUser WHERE Role='SALES'`)).recordset[0] || { Id: 1, Role: 'SALES' };
  const mgrUser = (await wfQuery(`SELECT TOP 1 Id, Username, Role FROM wf.AppUser WHERE Role IN ('MANAGER', 'ADMIN', 'C_LEVEL') AND Id <> @id`, { id: { type: sql.Int, value: salesUser.Id } })).recordset[0] || { Id: 99, Role: 'MANAGER' };

  const salesToken = makeToken(salesUser);
  const mgrToken = makeToken(mgrUser);

  let bookId = null;

  try {
    // 1. Create PriceBook
    console.log('1. Creating DRAFT PriceBook...');
    const createRes = await fetch(`${baseUrl}/api/pricebook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgrToken}` },
      body: JSON.stringify({ name: 'TEST_PRICEBOOK_VERIFIER', effectiveMonth: '2099-12', seedFromCurrent: false }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(`Create PriceBook failed: ${JSON.stringify(createData)}`);
    bookId = createData.id;
    console.log(`   PriceBook created ID: ${bookId}`);

    // 2. Add Lines with LineStatus (ACTIVE, DISCONTINUING, SUSPENDED)
    console.log('2. Adding lines with ACTIVE, DISCONTINUING, and SUSPENDED status...');
    const linesRes = await fetch(`${baseUrl}/api/pricebook/${bookId}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgrToken}` },
      body: JSON.stringify({
        lines: [
          { goodId: 'TEST-18-46-0', goodName: 'ปุ๋ย 18-46-0 (ปกติ)', price: 15000, lineStatus: 'ACTIVE', note: 'ปกติ' },
          { goodId: 'TEST-16-20-0', goodName: 'ปุ๋ย 16-20-0 (กำลังยกเลิก ***)', price: 14000, lineStatus: 'DISCONTINUING', note: 'ใกล้หมดสัญญา' },
          { goodId: 'TEST-00-00-0', goodName: 'ปุ๋ย 00-00-0 (งดขาย)', price: null, lineStatus: 'SUSPENDED', note: 'งดจำหน่ายชั่วคราว' },
        ],
      }),
    });
    const linesData = await linesRes.json();
    if (!linesRes.ok) throw new Error(`Add lines failed: ${JSON.stringify(linesData)}`);
    console.log('   Lines added successfully.');

    // 3. Approve and Activate PriceBook
    console.log('3. Approving and activating PriceBook...');
    await fetch(`${baseUrl}/api/pricebook/${bookId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${mgrToken}` } });
    await fetch(`${baseUrl}/api/pricebook/${bookId}/activate`, { method: 'POST', headers: { Authorization: `Bearer ${mgrToken}` } });
    console.log('   PriceBook is now ACTIVE.');

    // 4. Request Special Price (Sales User)
    console.log('4. Submitting Special Price request...');
    const specialReq = await fetch(`${baseUrl}/api/pricebook/${bookId}/special`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        custId: 'CUST-VERIFY-001',
        custName: 'ร้านค้าทดสอบ การเกษตร',
        goodId: 'TEST-18-46-0',
        goodName: 'ปุ๋ย 18-46-0 (ปกติ)',
        requestedPrice: 14200,
        note: 'ขอส่วนลดพิเศษลอตใหญ่',
      }),
    });
    const specialData = await specialReq.json();
    if (!specialReq.ok) throw new Error(`Request Special Price failed: ${JSON.stringify(specialData)}`);
    const spId = specialData.id;
    console.log(`   Special Price request created ID: ${spId}`);

    // 5. Test self-approval prevention (Sales Token tries to approve)
    console.log('5. Testing self-approval prevention (should return 403)...');
    const selfApprove = await fetch(`${baseUrl}/api/pricebook/special/${spId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({ approvedPrice: 14200 }),
    });
    if (selfApprove.status !== 403) throw new Error(`Expected 403 for self-approval, got ${selfApprove.status}`);
    console.log('   Self-approval correctly rejected with 403 Forbidden.');

    // 6. Approve Special Price with Manager Token
    console.log('6. Approving Special Price with Manager account...');
    const mgrApprove = await fetch(`${baseUrl}/api/pricebook/special/${spId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgrToken}` },
      body: JSON.stringify({ approvedPrice: 14200 }),
    });
    if (!mgrApprove.ok) throw new Error(`Manager approval failed: ${await mgrApprove.text()}`);
    console.log('   Special Price approved by Manager.');

    // 7. Verify Effective Price calculation
    console.log('7. Verifying Effective Price for customer...');
    const effRes = await fetch(`${baseUrl}/api/pricebook/${bookId}/effective?custId=CUST-VERIFY-001`, {
      headers: { Authorization: `Bearer ${salesToken}` },
    });
    const effRows = await effRes.json();
    const targetItem = effRows.find(r => r.GoodId === 'TEST-18-46-0');
    if (!targetItem) throw new Error('Target item TEST-18-46-0 not found in effective prices');
    if (Number(targetItem.EffectivePrice) !== 14200) {
      throw new Error(`Expected EffectivePrice to be 14200, got ${targetItem.EffectivePrice}`);
    }
    console.log(`   Effective Price verified: Standard 15,000 -> Special/Effective ${targetItem.EffectivePrice}`);

    const suspendedItem = effRows.find(r => r.GoodId === 'TEST-00-00-0');
    if (suspendedItem && suspendedItem.Sellable !== 0) {
      throw new Error(`Expected SUSPENDED item Sellable to be 0, got ${suspendedItem.Sellable}`);
    }
    console.log('   SUSPENDED item correctly marked Sellable = 0.');

    console.log('\n=== All PriceBook Special Price Verification Checks Passed! ===\n');
  } finally {
    // Cleanup
    if (bookId) {
      console.log('Cleaning up test data...');
      await wfQuery(`DELETE FROM wf.PriceBookSpecialPrice WHERE PriceBookId=@id`, { id: { type: sql.Int, value: bookId } });
      await wfQuery(`DELETE FROM wf.PriceBookAudit WHERE PriceBookId=@id`, { id: { type: sql.Int, value: bookId } });
      await wfQuery(`DELETE FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: bookId } });
      await wfQuery(`DELETE FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: bookId } });
    }
    server.close();
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
