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
 * Incorporates food logging density, weight logging density, and trend stability.
 *
 * @param {Object} params
 * @param {number} params.validFoodDays - Number of complete food days in evaluation window
 * @param {number} params.validWeightDays - Number of valid weight logs in evaluation window
 * @param {number} params.formulaTdee - Mifflin-St Jeor baseline TDEE
 * @param {number|null} params.observedTdee - Empirical TDEE from energy balance solver
 * @param {number} [params.foodLogDensity] - Optional explicit food logging density (0..1)
 * @param {number} [params.weightLogDensity] - Optional explicit weight logging density (0..1)
 * @param {number} [params.trendStabilityScore=0] - Std-dev of velocity samples from weight smoothing
 * @param {number} [params.windowDays=28] - Observation evaluation window in days
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
  foodLogDensity,
  weightLogDensity,
  trendStabilityScore = 0,
  windowDays = EVALUATION_WINDOW_DAYS,
}) {
  const actualWindow = windowDays > 0 ? windowDays : EVALUATION_WINDOW_DAYS;
  const foodDensity = typeof foodLogDensity === 'number'
    ? foodLogDensity
    : Math.min(1.0, validFoodDays / actualWindow);
  const weightDensity = typeof weightLogDensity === 'number'
    ? weightLogDensity
    : Math.min(1.0, validWeightDays / actualWindow);

  // Stability factor: 1.0 when stable (std-dev 0), decreases as velocity noise exceeds 0.05 kg/day
  const stabilityFactor = typeof trendStabilityScore === 'number' && trendStabilityScore > 0
    ? Math.max(0.2, Math.min(1.0, 1.0 - (trendStabilityScore / 0.15)))
    : 1.0;

  // Composite: food density (0.4), weight density (0.3), stability (0.3)
  const compositeScore = (foodDensity * 0.4) + (weightDensity * 0.3) + (stabilityFactor * 0.3);
  const score = Math.max(0, Math.min(1.0, Math.round(compositeScore * 100) / 100));

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

/**
 * Evaluates whether logging history and trend data are sufficient to produce adaptive target recommendations.
 *
 * @param {Object} params
 * @param {number} params.validFoodDays
 * @param {number} params.validWeightDays
 * @param {number} [params.windowDays=21]
 * @param {number} [params.foodLogDensity]
 * @param {number} [params.weightLogDensity]
 * @param {number} [params.trendStabilityScore]
 * @param {number|null} [params.observedTdee]
 * @returns {{
 *   evidenceStatus: 'INSUFFICIENT' | 'CALIBRATING' | 'READY' | 'LOW_ADHERENCE',
 *   isReadyForRecommendation: boolean,
 *   message: string,
 *   foodLogDensity: number,
 *   weightLogDensity: number,
 *   trendStabilityScore: number
 * }}
 */
function evaluateEvidenceSufficiency({
  validFoodDays = 0,
  validWeightDays = 0,
  windowDays = 21,
  foodLogDensity,
  weightLogDensity,
  trendStabilityScore = 0,
  observedTdee,
}) {
  const actualWindow = windowDays > 0 ? windowDays : 21;
  const foodDensity = typeof foodLogDensity === 'number'
    ? foodLogDensity
    : Math.min(1.0, validFoodDays / actualWindow);
  const weightDensity = typeof weightLogDensity === 'number'
    ? weightLogDensity
    : Math.min(1.0, validWeightDays / actualWindow);

  let evidenceStatus = 'INSUFFICIENT';
  let isReadyForRecommendation = false;
  let message = '';

  if (validFoodDays < 14 || validWeightDays < 7 || !observedTdee) {
    evidenceStatus = 'INSUFFICIENT';
    isReadyForRecommendation = false;
    message = `Insufficient baseline data: Need at least 14 days of food logs and 7 weight logs (${validFoodDays}/14 food, ${validWeightDays}/7 weight).`;
  } else if (foodDensity < 0.50) {
    evidenceStatus = 'LOW_ADHERENCE';
    isReadyForRecommendation = false;
    message = `Low logging adherence: Only ${Math.round(foodDensity * 100)}% of days tracked. Minimum 50% density required for recommendations.`;
  } else if (validFoodDays >= 21 && validWeightDays >= 10 && foodDensity >= 0.60) {
    evidenceStatus = 'READY';
    isReadyForRecommendation = true;
    message = `High data sufficiency: Consistent logging across ${validFoodDays} days with stable weight trend.`;
  } else {
    // 14-20 food days, good adherence
    evidenceStatus = 'CALIBRATING';
    isReadyForRecommendation = false;
    message = `Calibrating: ${validFoodDays} days logged. Adaptation model is establishing your individual baseline.`;
  }

  return {
    evidenceStatus,
    isReadyForRecommendation,
    message,
    foodLogDensity: Math.round(foodDensity * 100) / 100,
    weightLogDensity: Math.round(weightDensity * 100) / 100,
    trendStabilityScore,
  };
}

module.exports = {
  evaluateExpenditureConfidence,
  evaluateEvidenceSufficiency,
  EVALUATION_WINDOW_DAYS,
  MIN_DAYS_FOR_CALIBRATION,
  MIN_DAYS_FOR_MODERATE,
  MIN_DAYS_FOR_HIGH,
};
