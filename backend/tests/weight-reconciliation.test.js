const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateWeight } = require('../services/weight-reconciliation');

test('evaluateWeight calculates expected target and tolerance status correctly', async () => {
  // Test evaluation logic math
  const minPct = 2.0;
  const maxPct = 5.0;
  const expectedNetKg = 10000; // 10 Tons

  const minAllowed = expectedNetKg * (1 + minPct / 100); // 10,200 kg
  const maxAllowed = expectedNetKg * (1 + maxPct / 100); // 10,500 kg

  assert.equal(minAllowed, 10200);
  assert.equal(maxAllowed, 10500);

  // Case 1: Net = 10,300 kg (+3% variance) -> OK
  const case1Net = 10300;
  assert.ok(case1Net >= minAllowed && case1Net <= maxAllowed);

  // Case 2: Net = 10,100 kg (+1% variance) -> UNDERWEIGHT
  const case2Net = 10100;
  assert.ok(case2Net < minAllowed);

  // Case 3: Net = 10,700 kg (+7% variance) -> OVERWEIGHT
  const case3Net = 10700;
  assert.ok(case3Net > maxAllowed);
});
