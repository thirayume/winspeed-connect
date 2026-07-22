const fs = require('fs');

async function runTests() {
  const API_BASE = 'http://localhost:3000/api';
  // 0. Login
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'uat_admin', password: 'TestAdmin2026' })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const { accessToken: token } = await loginRes.json();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  const results = [];

  const scenarios = [
    { id: 'UAT-01', plate: 'กข-1234', tare: 8500, gross: 33500, mb: '6907-0001', remark: 'UAT-01', prefix: 'I', isControl: false, psling: false, seq: false },
    { id: 'UAT-02', plate: 'ขค-5678', tare: 9000, gross: 34000, mb: '6907-0002', remark: 'UAT-02', prefix: 'K', isControl: false, psling: false, seq: false },
    { id: 'UAT-03', plate: 'คง-9012', tare: 8200, gross: 38200, mb: '6907-0003', remark: 'UAT-03', prefix: 'I', isControl: false, psling: false, seq: false },
    { id: 'UAT-04', plate: 'ตั๋วคุม',   tare: 7800, gross: 32800, mb: '6907-0004', remark: 'UAT-04', prefix: 'I', isControl: true,  psling: false, seq: false },
    { id: 'UAT-05', plate: 'จฉ-3456', tare: 8100, gross: 33100, mb: '6907-0005', remark: 'UAT-05', prefix: 'I', isControl: false, psling: false, seq: false },
    { id: 'UAT-06', plate: 'ชซ-7890', tare: 9200, gross: 34200, mb: '6907-0006', remark: 'UAT-06', prefix: 'I', isControl: false, psling: true,  seq: false },
    { id: 'UAT-07', plate: 'ฌญ-1357', tare: 8600, gross: 33600, mb: '6907-0007', remark: 'UAT-07', prefix: 'I', isControl: false, psling: false, seq: true  },
    { id: 'UAT-08', plate: 'ตั๋วคุม',   tare: 8000, gross: 33000, mb: '6907-0008', remark: 'UAT-08', prefix: 'I', isControl: true,  psling: true,  seq: true  },
    { id: 'UAT-09', plate: 'ดต-2468', tare: 8400, gross: 33400, mb: '6907-0009', remark: 'UAT-09', prefix: 'I', isControl: false, psling: false, seq: false, isQuote: true },
    { id: 'UAT-10', plate: 'ตั๋วคุม',   tare: 8800, gross: 33800, mb: '6907-0010', remark: 'UAT-10', prefix: 'I', isControl: true,  psling: true,  seq: true, isQuote: true },
  ];

  for (const s of scenarios) {
    try {
      console.log(`\n--- Running ${s.id} ---`);
      
      const lines = [
        {
          goodId: 1091,
          goodName: '3-3-33 เชิงผสม ตรารถเกษตร',
          goodQty2: 500, // 500 bags = 25 tons
          qtyTon: 25,
          goodPrice2: 600,
          pricePerTon: 12000,
          loadSequence: s.seq ? 1 : null,
          refControlTicketNo: s.isControl ? 'AI-TEST' : null
        }
      ];
      
      if (s.id === 'UAT-03') {
        lines.push({
          goodId: 1091,
          goodName: '3-3-33 เชิงผสม ตรารถเกษตร',
          goodQty2: 100,
          qtyTon: 5,
          goodPrice2: 600,
          pricePerTon: 12000,
          loadSequence: null,
          refControlTicketNo: null,
          soPrefix: 'K' // Multi bill scenario
        });
      }
      
      // 1. Create SO
      const payload = {
        custId: '1086',
        truckPlate: s.plate,
        soPrefix: s.prefix,
        remark: s.remark,
        deliveryDate: new Date().toISOString(),
        pSling: s.psling,
        loadInOrder: s.seq,
        lines
      };
      
      let res = await fetch(`${API_BASE}/so`, { method: 'POST', headers, body: JSON.stringify(payload) });
      let data = await res.json();
      if (!res.ok) throw new Error(`Create failed: ${JSON.stringify(data)}`);
      let soId = data.id;
      console.log(`${s.id}: Created SO ${soId}`);

      if (s.isQuote) {
        // Create Quotation
        res = await fetch(`${API_BASE}/quotation/from-so-trip`, { method: 'POST', headers, body: JSON.stringify({ soIds: [soId] }) });
        let qData = await res.json();
        if (!res.ok) throw new Error(`Create Quote failed: ${JSON.stringify(qData)}`);
        const quoteId = qData.id;
        console.log(`${s.id}: Created Quote ${quoteId}, locking Draft SO`);
        
        // Accept Quote
        res = await fetch(`${API_BASE}/quotation/${quoteId}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'ACCEPTED' }) });
        if (!res.ok) throw new Error(`Accept Quote failed`);
        console.log(`${s.id}: Accepted Quote ${quoteId}`);
        
        // Convert to new SO
        const qPayload = { ...payload, convertFromQuoteId: quoteId };
        res = await fetch(`${API_BASE}/so`, { method: 'POST', headers, body: JSON.stringify(qPayload) });
        let qNewData = await res.json();
        if (!res.ok) throw new Error(`Quote Conversion failed: ${JSON.stringify(qNewData)}`);
        console.log(`${s.id}: Converted to new SO ${qNewData.id}, original deleted`);
        soId = qNewData.id; // Override to test the new converted SO
      }

      // 2. Verify
      res = await fetch(`${API_BASE}/so/${soId}/verify`, { method: 'PATCH', headers, body: JSON.stringify({ verified: true }) });
      if (!res.ok) throw new Error(`Verify failed: ${await res.text()}`);
      console.log(`${s.id}: Verified SO ${soId}`);

      // 3. Confirm (WINSpeed sync)
      res = await fetch(`${API_BASE}/so/${soId}/confirm`, { method: 'PATCH', headers, body: JSON.stringify({}) });
      data = await res.json();
      if (!res.ok) throw new Error(`Confirm failed: ${JSON.stringify(data)}`);
      soId = data.id; // UPDATE ID!
      console.log(`${s.id}: Confirmed SO ${soId}`);

      // 4. Picking
      res = await fetch(`${API_BASE}/so/${soId}/picking`, { method: 'PATCH', headers, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(`Pick failed: ${await res.text()}`);
      console.log(`${s.id}: Picking SO ${soId}`);

      // 5. Loaded
      res = await fetch(`${API_BASE}/so/${soId}/load`, { method: 'PATCH', headers, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(`Load failed: ${await res.text()}`);
      console.log(`${s.id}: Loaded SO ${soId}`);

      // 6. Ship (TruckScale)
      res = await fetch(`${API_BASE}/so/${soId}/ship`, { 
        method: 'PATCH', 
        headers, 
        body: JSON.stringify({
          weighOutWeight: s.gross,
          tareKg: s.tare,
          movebill: s.mb,
          scaleNo: 1
        }) 
      });
      data = await res.json();
      if (!res.ok) throw new Error(`Ship failed: ${JSON.stringify(data)}`);
      console.log(`${s.id}: Shipped SO ${soId} - Net: ${data.netKg}`);

      results.push({ test: s.id, status: 'PASS', soId, error: null });
    } catch (e) {
      console.error(`${s.id} FAILED:`, e.message);
      results.push({ test: s.id, status: 'FAIL', soId: null, error: e.message });
    }
  }

  // Save results
  fs.writeFileSync('uat_results.json', JSON.stringify(results, null, 2));
  console.log('\nAll done.');
}

runTests();
