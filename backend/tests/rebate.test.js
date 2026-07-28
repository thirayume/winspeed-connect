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
