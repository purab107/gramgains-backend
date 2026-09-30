/**
 * Activity Data Consistency & Contextual Evaluator (Improvement 19)
 *
 * Evaluates activity trends, exercise volume consistency, and caloric expenditure signals
 * over an observation window.
 *
 * Note: Activity calories are used contextually to explain TDEE shifts,
 * NOT directly added into the empirical energy-balance equation (which captures total expenditure).
 */

/**
 * Computes activity consistency metrics for a window of days.
 *
 * @param {Array<{ date: Date|string, caloriesBurned: number, durationMinutes?: number, label?: string }>} activityLogs
 * @param {number} [windowDays=21]
 * @returns {{
 *   totalActiveDays: number,
 *   activityDensity: number,
 *   avgDailyCaloriesBurned: number,
 *   avgSessionCaloriesBurned: number,
 *   isConsistent: boolean,
 *   annotation: string|null
 * }}
 */
function computeActivityConsistency(activityLogs = [], windowDays = 21) {
  if (!Array.isArray(activityLogs) || activityLogs.length === 0 || windowDays <= 0) {
    return {
      totalActiveDays: 0,
      activityDensity: 0,
      avgDailyCaloriesBurned: 0,
      avgSessionCaloriesBurned: 0,
      isConsistent: false,
      annotation: null,
    };
  }

  // Count distinct active calendar days
  const activeDaysSet = new Set();
  let totalCaloriesBurned = 0;

  for (const log of activityLogs) {
    if (log.date) {
      const dateStr = log.date instanceof Date ? log.date.toISOString().split('T')[0] : String(log.date).split('T')[0];
      activeDaysSet.add(dateStr);
    }
    totalCaloriesBurned += (typeof log.caloriesBurned === 'number' && !isNaN(log.caloriesBurned)) ? log.caloriesBurned : 0;
  }

  const totalActiveDays = activeDaysSet.size;
  const activityDensity = Math.min(1.0, totalActiveDays / windowDays);
  const avgDailyCaloriesBurned = Math.round(totalCaloriesBurned / windowDays);
  const avgSessionCaloriesBurned = activityLogs.length > 0 ? Math.round(totalCaloriesBurned / activityLogs.length) : 0;

  // Consistent if user logs activity on >= 40% of window days
  const isConsistent = activityDensity >= 0.4;

  let annotation = null;
  if (isConsistent && avgDailyCaloriesBurned >= 250) {
    annotation = `Consistent training volume (~${avgDailyCaloriesBurned} kcal/day burned across ${totalActiveDays} days) supports elevated metabolic rate.`;
  } else if (!isConsistent && totalActiveDays > 0) {
    annotation = `Intermittent activity logged (${totalActiveDays} of ${windowDays} days).`;
  }

  return {
    totalActiveDays,
    activityDensity: parseFloat(activityDensity.toFixed(2)),
    avgDailyCaloriesBurned,
    avgSessionCaloriesBurned,
    isConsistent,
    annotation,
  };
}

module.exports = {
  computeActivityConsistency,
};
