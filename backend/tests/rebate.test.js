const test = require('node:test');
const assert = require('node:assert/strict');

test('Rebate claim line calculations: RebatePerTon = PricePerTon - NetPricePerTon', () => {
  const line = {
    goodCode: '18-4-5',
    qtyTon: 10,
    pricePerTon: 15000,
    netPricePerTon: 14200
  };

  const rebatePerTon = line.pricePerTon - line.netPricePerTon;
  const lineAmount = line.qtyTon * rebatePerTon;

  assert.equal(rebatePerTon, 800);
  assert.equal(lineAmount, 8000);
});

test('Rebate 4-Tier Approval progression hierarchy', () => {
  const tiers = {
    1: { role: 'SALES', label: 'ยื่นใบขอเคลียร์' },
    2: { role: 'REGIONAL_MGR', label: 'ผู้จัดการภาค' },
    3: { role: 'MARKETING_MGR', label: 'ผู้จัดการฝ่ายตลาด' },
    4: { role: 'EXECUTIVE', label: 'กรรมการบริหาร' }
  };

  assert.equal(tiers[1].role, 'SALES');
  assert.equal(tiers[2].role, 'REGIONAL_MGR');
  assert.equal(tiers[3].role, 'MARKETING_MGR');
  assert.equal(tiers[4].role, 'EXECUTIVE');
});

test('SO-02: Rebate 100/0 baseline ratio calculation', () => {
  const totalAmt = 150000.50;
  const customerRatio = 100.00;
  const companyRatio = 0.00;

  assert.equal(customerRatio + companyRatio, 100.00);

  const customerAmount = Math.round(totalAmt * (customerRatio / 100) * 100) / 100;
  const retainedAmount = Math.round(totalAmt * (companyRatio / 100) * 100) / 100;

  assert.equal(customerAmount, 150000.50);
  assert.equal(retainedAmount, 0.00);
});

test('SO-02: Rebate ratio distribution with effective future split', () => {
  const totalAmt = 200000;
  const customerRatio = 80.00;
  const companyRatio = 20.00;

  assert.equal(customerRatio + companyRatio, 100.00);

  const customerAmount = Math.round(totalAmt * (customerRatio / 100) * 100) / 100;
  const retainedAmount = Math.round(totalAmt * (companyRatio / 100) * 100) / 100;

  assert.equal(customerAmount, 160000);
  assert.equal(retainedAmount, 40000);
  assert.equal(customerAmount + retainedAmount, totalAmt);
});
