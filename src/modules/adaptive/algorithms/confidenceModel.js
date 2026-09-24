/**
 * Data Confidence & Bayesian Shrinkage Model
 *
 * Quantifies logging density and blends population baseline (Mifflin-St Jeor)
 * with empirical observed expenditure.
 */

const EVALUATION_WINDOW_DAYS = 28;
const MIN_DAYS_FOR_CALIBRATION = 7;
const MIN_DAYS_FOR_MODERATE = 14;
const MIN_DAYS_FOR_HIGH = 21;

/**
 * Calculates confidence score, tier, and Bayesian blended TDEE.
 *
 * @param {Object} params
 * @param {number} params.validFoodDays - Number of complete food days in last 28d
 * @param {number} params.validWeightDays - Number of valid weight logs in last 28d
 * @param {number} params.formulaTdee - Mifflin-St Jeor baseline TDEE
 * @param {number|null} params.observedTdee - Empirical TDEE from energy balance solver
 * @returns {{
 *   level: 'INSUFFICIENT' | 'CALIBRATING' | 'MODERATE' | 'HIGH',
 *   score: number,
 *   effectiveTdee: number,
 *   blendWeights: { formula: number, observed: number },
 *   message: string
 * }}
 */
function evaluateExpenditureConfidence({
  validFoodDays = 0,
  validWeightDays = 0,
  formulaTdee,
  observedTdee,
}) {
  const density = (validFoodDays * 0.6 + validWeightDays * 0.4) / EVALUATION_WINDOW_DAYS;
  const score = Math.max(0, Math.min(1.0, Math.round(density * 100) / 100));

  let level = 'INSUFFICIENT';
  let observedWeight = 0;
  let message = '';

  if (validFoodDays < MIN_DAYS_FOR_CALIBRATION || validWeightDays < 3 || !observedTdee) {
    level = 'INSUFFICIENT';
    observedWeight = 0.0;
    message = `Need at least ${MIN_DAYS_FOR_CALIBRATION} days of logs to start adaptive calibration (${validFoodDays}/${MIN_DAYS_FOR_CALIBRATION} logged).`;
  } else if (validFoodDays < MIN_DAYS_FOR_MODERATE) {
    level = 'CALIBRATING';
    // Smooth transition from 20% to 45% observed
    observedWeight = 0.20 + (score * 0.25);
    message = `Calibrating: ${validFoodDays} days of intake logged. Initial adaptation in progress.`;
  } else if (validFoodDays < MIN_DAYS_FOR_HIGH) {
    level = 'MODERATE';
    // Moderate confidence: 50% to 75% observed
    observedWeight = 0.50 + (score * 0.25);
    message = `Moderate confidence: ${validFoodDays} days logged. Adaptive targets are active.`;
  } else {
    level = 'HIGH';
    // High confidence: 80% to 95% observed
    observedWeight = Math.min(0.95, 0.75 + (score * 0.20));
    message = `High confidence: Consistent real-world data across ${validFoodDays} days.`;
  }

  const formulaWeight = Math.round((1 - observedWeight) * 100) / 100;
  observedWeight = Math.round(observedWeight * 100) / 100;

  const effectiveTdee = observedTdee && observedWeight > 0
    ? Math.round(formulaWeight * formulaTdee + observedWeight * observedTdee)
    : Math.round(formulaTdee);

  return {
    level,
    score,
    effectiveTdee,
    blendWeights: {
      formula: formulaWeight,
      observed: observedWeight,
    },
    message,
  };
}

module.exports = {
  evaluateExpenditureConfidence,
  EVALUATION_WINDOW_DAYS,
  MIN_DAYS_FOR_CALIBRATION,
  MIN_DAYS_FOR_MODERATE,
  MIN_DAYS_FOR_HIGH,
};
