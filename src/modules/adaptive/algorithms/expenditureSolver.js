/**
 * Real-World Energy Expenditure (TDEE) Solver
 *
 * Employs the thermodynamic first law of energy balance:
 *   Energy Stored = Energy In - Energy Out
 *   Observed TDEE = Daily Calorie Intake - (Weight Velocity kg/day * 7700 kcal/kg)
 *
 * Includes anti-whiplash clamps, physiological bounding, and clinical safety floors.
 */

const CALORIES_PER_KG_WEIGHT = 7700; // Standard tissue caloric equivalent
const MAX_WEEKLY_ADJUSTMENT_KCAL = 150; // Anti-whiplash adjustment clamp
const MIN_CALORIES_FEMALE = 1200; // Clinical safety floor
const MIN_CALORIES_MALE = 1500;   // Clinical safety floor
const MIN_VALID_DAY_INTAKE = 500; // Exclude incomplete logging days (<500 kcal)

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

  const dailyEnergySurplusKcal = Math.round(velocityKgPerDay * CALORIES_PER_KG_WEIGHT);
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
  const dailyTargetDeltaKcal = Math.round((targetRateKgPerWeek * CALORIES_PER_KG_WEIGHT) / 7);
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

  const isFemale = String(gender).toUpperCase() === 'FEMALE';
  const safetyFloorKcal = isFemale ? MIN_CALORIES_FEMALE : MIN_CALORIES_MALE;
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

module.exports = {
  solveObservedTdee,
  calculateRecommendedCalories,
  filterValidIntakeDays,
  CALORIES_PER_KG_WEIGHT,
  MAX_WEEKLY_ADJUSTMENT_KCAL,
  MIN_CALORIES_FEMALE,
  MIN_CALORIES_MALE,
  MIN_VALID_DAY_INTAKE,
};
