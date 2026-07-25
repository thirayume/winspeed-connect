/**
 * weight-reconciliation.js — Service for calculating expected target net weights,
 * machine calibration error tolerance bounds (+2% to +5%), and verifying actual net weight.
 */
const { sql, wfQuery } = require('../db');

/**
 * Load weight tolerance settings from wf.SystemSetting
 */
async function getWeightSettings() {
  try {
    const rows = (await wfQuery(`SELECT SettingKey, SettingValue FROM wf.SystemSetting`)).recordset || [];
    const settings = {};
    for (const r of rows) {
      settings[r.SettingKey] = parseFloat(r.SettingValue);
    }
    return {
      minPct: !isNaN(settings.WEIGHT_TOLERANCE_MIN_PCT) ? settings.WEIGHT_TOLERANCE_MIN_PCT : 2.0,
      maxPct: !isNaN(settings.WEIGHT_TOLERANCE_MAX_PCT) ? settings.WEIGHT_TOLERANCE_MAX_PCT : 5.0,
      standardBagKg: !isNaN(settings.STANDARD_BAG_WEIGHT_KG) ? settings.STANDARD_BAG_WEIGHT_KG : 50.0,
    };
  } catch (e) {
    return { minPct: 2.0, maxPct: 5.0, standardBagKg: 50.0 };
  }
}

/**
 * Calculate expected target weight for a given SO
 */
async function computeExpectedNetKg(soId) {
  const lines = (await wfQuery(`
    SELECT QtyTon, QtyBag, IsGiveaway
    FROM wf.v_AllSalesOrderLines
    WHERE SoId = @id
  `, { id: { type: sql.VarChar(50), value: String(soId) } })).recordset || [];

  let expectedKg = 0;
  for (const line of lines) {
    const ton = Number(line.QtyTon) || 0;
    expectedKg += ton * 1000;
  }
  return expectedKg;
}

/**
 * Evaluate actual net weight against theoretical expected weight and system tolerance
 */
async function evaluateWeight(soId, netKg) {
  const settings = await getWeightSettings();
  const expectedNetKg = await computeExpectedNetKg(soId);

  if (netKg == null || isNaN(Number(netKg)) || Number(netKg) <= 0) {
    return {
      expectedNetKg,
      netKg: null,
      varianceKg: null,
      variancePct: null,
      status: 'UNVERIFIED',
      minAllowedKg: expectedNetKg * (1 + settings.minPct / 100),
      maxAllowedKg: expectedNetKg * (1 + settings.maxPct / 100),
      settings,
    };
  }

  const actualNet = Number(netKg);
  const varianceKg = actualNet - expectedNetKg;
  const variancePct = expectedNetKg > 0 ? (varianceKg / expectedNetKg) * 100 : 0;

  // Tolerance bounds: Target is Expected + [minPct%, maxPct%]
  const minAllowedKg = expectedNetKg * (1 + settings.minPct / 100);
  const maxAllowedKg = expectedNetKg * (1 + settings.maxPct / 100);

  let status = 'OK';
  if (actualNet < minAllowedKg) {
    status = 'UNDERWEIGHT';
  } else if (actualNet > maxAllowedKg) {
    status = 'OVERWEIGHT';
  }

  return {
    expectedNetKg,
    netKg: actualNet,
    varianceKg,
    variancePct: Math.round(variancePct * 100) / 100,
    minAllowedKg,
    maxAllowedKg,
    status,
    settings,
  };
}

module.exports = {
  getWeightSettings,
  computeExpectedNetKg,
  evaluateWeight,
};
