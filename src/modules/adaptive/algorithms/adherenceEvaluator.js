/**
 * Dietary Adherence Evaluator
 *
 * Quantifies meal tracking consistency and adherence to calorie targets
 * across an observation window (default 21 days).
 */

const DEFAULT_WINDOW_DAYS = 21;
const MIN_VALID_CALORIES = 500;
const DEFAULT_CALORIE_TOLERANCE_PERCENT = 0.10;
const MIN_CALORIE_TOLERANCE_KCAL = 100;

/**
 * Computes adherence metrics from daily intake records over an observation window.
 *
 * @param {Object} params
 * @param {Array<{ date: string|Date, calories: number }>} params.dailyIntakes
 * @param {number} params.targetCalories
 * @param {number} [params.windowDays=21]
 * @param {number} [params.calorieTolerancePercent=0.10]
 * @param {number} [params.minCalorieTolerance=100]
 * @returns {{
 *   adherentDays: number,
 *   totalLoggedDays: number,
 *   density: number,
 *   adherenceRate: number,
 *   adherenceScore: number,
 *   isAdherent: boolean
 * }}
 */
function computeAdherenceInWindow({
  dailyIntakes = [],
  targetCalories,
  windowDays = DEFAULT_WINDOW_DAYS,
  calorieTolerancePercent = DEFAULT_CALORIE_TOLERANCE_PERCENT,
  minCalorieTolerance = MIN_CALORIE_TOLERANCE_KCAL,
}) {
  const target = targetCalories > 0 ? targetCalories : 2000;
  const tolerance = Math.max(minCalorieTolerance, target * calorieTolerancePercent);

  // Filter out incomplete days (< 500 kcal)
  const validDays = dailyIntakes.filter((d) => (d.calories || 0) >= MIN_VALID_CALORIES);

  // Adherent days are within ±tolerance of calorie target
  const adherentDays = validDays.filter(
    (d) => Math.abs((d.calories || 0) - target) <= tolerance
  );

  const totalLoggedDays = validDays.length;
  const actualWindow = windowDays > 0 ? windowDays : DEFAULT_WINDOW_DAYS;
  const density = Math.min(1.0, totalLoggedDays / actualWindow);
  const adherenceRate = totalLoggedDays > 0 ? adherentDays.length / totalLoggedDays : 0;
  const adherenceScore = Math.round(adherenceRate * 100);

  // Adherent if density is at least 50% and adherence rate is at least 50%
  const isAdherent = density >= 0.5 && adherenceRate >= 0.5;

  return {
    adherentDays: adherentDays.length,
    totalLoggedDays,
    density: Math.round(density * 100) / 100,
    adherenceRate: Math.round(adherenceRate * 100) / 100,
    adherenceScore,
    isAdherent,
  };
}

module.exports = {
  computeAdherenceInWindow,
  DEFAULT_WINDOW_DAYS,
  MIN_VALID_CALORIES,
};
