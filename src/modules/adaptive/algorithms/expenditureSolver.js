/**
 * Real-World Energy Expenditure (TDEE) Solver
 *
 * Employs the thermodynamic first law of energy balance:
 *   Energy Stored = Energy In - Energy Out
 *   Observed TDEE = Daily Calorie Intake - (Weight Velocity kg/day * 7700 kcal/kg)
 *
 * Includes anti-whiplash clamps, physiological bounding, and clinical safety floors.
 */

const {
  CALORIES_PER_KG,
  SAFETY_FLOORS,
  calculateGoalCalorieDelta,
  calculateSafetyFloor,
} = require('./calorieCalculator');
const { weightVelocityToEnergy } = require('./energyBalance');

const MAX_WEEKLY_ADJUSTMENT_KCAL = 150; // Anti-whiplash adjustment clamp
const MIN_CALORIES_FEMALE = SAFETY_FLOORS.FEMALE; // Clinical safety floor (1200)
const MIN_CALORIES_MALE = SAFETY_FLOORS.MALE;   // Clinical safety floor (1500)
const MIN_VALID_DAY_INTAKE = 500; // Exclude incomplete logging days (<500 kcal)
const MAINTENANCE_TOLERANCE_KG_PER_WEEK = 0.1; // Maintenance band tolerance (kg/week)

/**
 * Filters out incomplete/untracked days from meal log records.
 *
 * @param {Array<{ date: string, calories: number, isFastingDay?: boolean }>} dailyIntakes
 * @returns {Array<{ date: string, calories: number }>}
 */
function filterValidIntakeDays(dailyIntakes = []) {
  if (!Array.isArray(dailyIntakes)) return [];
  return dailyIntakes.filter((d) => {
    if (!d || typeof d.calories !== 'number' || isNaN(d.calories)) return false;
    if (d.isFastingDay) return true;
    return d.calories >= MIN_VALID_DAY_INTAKE;
  });
}

/**
 * Solves for empirical TDEE given average intake and weight velocity.
 *
 * @param {Object} params
 * @param {number} params.avgDailyIntake - Mean daily intake on valid logged days
 * @param {number} params.velocityKgPerDay - Smoothed weight rate of change (kg/day)
 * @param {number} [params.bmr] - Baseline BMR for physiological bounding
 * @returns {{
 *   observedTdee: number,
 *   dailyEnergySurplusKcal: number
 * }}
 */
function solveObservedTdee({ avgDailyIntake, velocityKgPerDay, bmr }) {
  if (!avgDailyIntake || avgDailyIntake <= 0) {
    return { observedTdee: null, dailyEnergySurplusKcal: 0 };
  }

  const dailyEnergySurplusKcal = weightVelocityToEnergy(velocityKgPerDay);
  let observedTdee = Math.round(avgDailyIntake - dailyEnergySurplusKcal);

  // Physiological bounds check if BMR is supplied
  if (bmr && bmr > 500) {
    const minPhysiological = Math.round(bmr * 0.85); // Extreme hypometabolic floor
    const maxPhysiological = Math.round(bmr * 2.5);  // Elite endurance ceiling
    observedTdee = Math.max(minPhysiological, Math.min(maxPhysiological, observedTdee));
  }

  return {
    observedTdee,
    dailyEnergySurplusKcal,
  };
}

/**
 * Computes recommended daily calorie intake and checks clinical safety floors.
 *
 * @param {Object} params
 * @param {number} params.effectiveTdee - Blended expenditure (baseline + observed)
 * @param {number} params.targetRateKgPerWeek - Desired rate (+0.25 for gain, -0.5 for loss, 0 for maintain)
 * @param {number} [params.currentCalories] - Current active target for anti-whiplash clamping
 * @param {string} [params.gender='MALE'] - For safety floor calculation
 * @param {number} [params.bodyWeightKg] - For rate of loss safety check
 * @returns {{
 *   recommendedCalories: number,
 *   rawTargetCalories: number,
 *   adjustmentKcal: number,
 *   isBelowSafetyFloor: boolean,
 *   safetyFloorKcal: number,
 *   isAggressiveRate: boolean,
 *   ratePercentPerWeek: number
 * }}
 */
function calculateRecommendedCalories({
  effectiveTdee,
  targetRateKgPerWeek = 0,
  currentCalories,
  gender = 'MALE',
  bodyWeightKg = 70,
}) {
  const dailyTargetDeltaKcal = calculateGoalCalorieDelta({ targetRateKgPerWeek });
  const rawTargetCalories = Math.round(effectiveTdee + dailyTargetDeltaKcal);

  // Anti-whiplash clamping if currentCalories exists
  let recommendedCalories = rawTargetCalories;
  let adjustmentKcal = 0;

  if (currentCalories && currentCalories > 0) {
    const delta = rawTargetCalories - currentCalories;
    if (Math.abs(delta) > MAX_WEEKLY_ADJUSTMENT_KCAL) {
      adjustmentKcal = delta > 0 ? MAX_WEEKLY_ADJUSTMENT_KCAL : -MAX_WEEKLY_ADJUSTMENT_KCAL;
      recommendedCalories = Math.round(currentCalories + adjustmentKcal);
    } else {
      adjustmentKcal = delta;
      recommendedCalories = rawTargetCalories;
    }
  }

  const safetyFloorKcal = calculateSafetyFloor({ gender });
  const isBelowSafetyFloor = recommendedCalories < safetyFloorKcal;

  // Rate safety check: Loss exceeding 1% body weight per week risks lean tissue loss
  const ratePercentPerWeek = bodyWeightKg > 0
    ? Math.round((Math.abs(targetRateKgPerWeek) / bodyWeightKg) * 1000) / 10
    : 0;
  const isAggressiveRate = targetRateKgPerWeek < 0 && ratePercentPerWeek > 1.0;

  return {
    recommendedCalories,
    rawTargetCalories,
    adjustmentKcal,
    isBelowSafetyFloor,
    safetyFloorKcal,
    isAggressiveRate,
    ratePercentPerWeek,
  };
}

/**
 * Calculates proportional calorie adjustments based on rate deviation magnitude (Improvement 14).
 * Replaces hard binary ±150 kcal clamp with graduated responses.
 *
 * @param {Object} params
 * @param {number} params.currentCalories
 * @param {number} params.rawTargetCalories
 * @param {number} params.observedRateKgPerWeek
 * @param {number} params.targetRateKgPerWeek
 * @param {number} [params.maxAdjustmentKcal=150]
 * @returns {number} recommendedCalories
 */
function calculateProportionalAdjustment({
  currentCalories,
  rawTargetCalories,
  observedRateKgPerWeek,
  targetRateKgPerWeek,
  maxAdjustmentKcal = MAX_WEEKLY_ADJUSTMENT_KCAL,
}) {
  if (!currentCalories || currentCalories <= 0) {
    return Math.round(rawTargetCalories);
  }

  const delta = rawTargetCalories - currentCalories;
  if (delta === 0) return Math.round(currentCalories);

  // Normalize deviation magnitude against target rate (minimum 0.1 to prevent division by zero in maintain goals)
  const deviationFraction = Math.abs(observedRateKgPerWeek - targetRateKgPerWeek) / Math.max(0.1, Math.abs(targetRateKgPerWeek));

  // Small deviation (< 50%): move 50% toward target, max 75 kcal
  // Medium deviation (50–100%): move 75% toward target, max 100 kcal
  // Large deviation (> 100%): move fully clamped at maxAdjustmentKcal
  const adjustmentFraction = deviationFraction < 0.5 ? 0.5 : deviationFraction < 1.0 ? 0.75 : 1.0;
  const maxForDeviation = deviationFraction < 0.5 ? 75 : deviationFraction < 1.0 ? 100 : maxAdjustmentKcal;

  const rawAdjustment = delta * adjustmentFraction;
  const clampedAdjustment = Math.sign(delta) * Math.min(Math.abs(rawAdjustment), maxForDeviation);

  return Math.round(currentCalories + clampedAdjustment);
}

module.exports = {
  solveObservedTdee,
  calculateRecommendedCalories,
  calculateProportionalAdjustment,
  filterValidIntakeDays,
  MAX_WEEKLY_ADJUSTMENT_KCAL,
  MIN_CALORIES_FEMALE,
  MIN_CALORIES_MALE,
  MIN_VALID_DAY_INTAKE,
  MAINTENANCE_TOLERANCE_KG_PER_WEEK,
};
