/**
 * Holt's Linear Exponential Smoothing for Body Weight Tracking
 *
 * Daily scale readings are corrupted by high-frequency physiological noise:
 * - Glycogen binding (1g glycogen binds ~3-4g water)
 * - Sodium intake and fluid retention
 * - Gastrointestinal residue & meal timing
 * - Exercise-induced muscle damage (EIMD) inflammation
 *
 * Holt's Double Exponential Smoothing models both the smoothed level (L_t)
 * and the underlying rate of change / trend velocity (T_t) without the severe
 * lag of simple moving averages.
 */

const DEFAULT_ALPHA = 0.15; // Level smoothing factor
const DEFAULT_BETA  = 0.05; // Trend velocity smoothing factor
const OUTLIER_THRESHOLD_KG = 2.5; // Single-day scale spike threshold

/**
 * Calculates smoothed trend weight and velocity across sorted weight records.
 *
 * @param {Array<{ id?: string, date: Date|string, weightKg: number, isExcluded?: boolean }>} logs
 *        Must be non-empty and pre-sorted in ascending chronological order.
 * @param {Object} [options]
 * @param {number} [options.alpha=0.15]
 * @param {number} [options.beta=0.05]
 * @returns {{
 *   smoothedLogs: Array<{ id?: string, date: string, rawWeightKg: number, trendWeightKg: number, isExcluded: boolean }>,
 *   latestRawKg: number,
 *   latestTrendKg: number,
 *   velocityKgPerDay: number,
 *   velocityKgPerWeek: number
 * }}
 */
function calculateWeightTrend(logs, options = {}) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return {
      smoothedLogs: [],
      latestRawKg: 0,
      latestTrendKg: 0,
      velocityKgPerDay: 0,
      velocityKgPerWeek: 0,
    };
  }

  const alpha = typeof options.alpha === 'number' ? options.alpha : DEFAULT_ALPHA;
  const beta  = typeof options.beta  === 'number' ? options.beta  : DEFAULT_BETA;

  // Filter and sort chronologically
  const sorted = logs
    .filter((l) => l && typeof l.weightKg === 'number' && !isNaN(l.weightKg) && l.weightKg > 0)
    .map((l) => ({
      ...l,
      weightKg: Number(l.weightKg),
      dateObj: l.date instanceof Date ? l.date : new Date(l.date),
      isExcluded: Boolean(l.isExcluded),
    }))
    .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

  if (sorted.length === 0) {
    return {
      smoothedLogs: [],
      latestRawKg: 0,
      latestTrendKg: 0,
      velocityKgPerDay: 0,
      velocityKgPerWeek: 0,
    };
  }

  // Initialize level and trend with first valid non-excluded point (or first point)
  const firstLog = sorted.find((l) => !l.isExcluded) || sorted[0];
  let level = firstLog.weightKg;
  let trend = 0; // Initial velocity (kg/day)

  // If we have at least 2 points early on, give a sensible initial trend
  if (sorted.length > 1) {
    const secondLog = sorted.find((l, idx) => idx > 0 && !l.isExcluded);
    if (secondLog) {
      const dayDiff = Math.max(1, Math.round((secondLog.dateObj.getTime() - firstLog.dateObj.getTime()) / (1000 * 60 * 60 * 24)));
      trend = (secondLog.weightKg - firstLog.weightKg) / dayDiff;
      // Clamp initial trend velocity to prevent extreme starts
      trend = Math.max(-0.3, Math.min(0.3, trend));
    }
  }

  let prevDateObj = sorted[0].dateObj;
  const smoothedLogs = [];

  // Record baseline for first point
  smoothedLogs.push({
    id: sorted[0].id,
    date: sorted[0].dateObj.toISOString().split('T')[0],
    rawWeightKg: Math.round(sorted[0].weightKg * 10) / 10,
    trendWeightKg: Math.round(level * 100) / 100,
    isExcluded: Boolean(sorted[0].isExcluded),
  });

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const dayDiff = Math.max(1, Math.round((item.dateObj.getTime() - prevDateObj.getTime()) / (1000 * 60 * 60 * 24)));
    prevDateObj = item.dateObj;

    if (item.isExcluded) {
      // Excluded day (e.g. sickness, sodium bloat): advance trend without updating from scale
      level = level + trend * dayDiff;
      smoothedLogs.push({
        id: item.id,
        date: item.dateObj.toISOString().split('T')[0],
        rawWeightKg: Math.round(item.weightKg * 10) / 10,
        trendWeightKg: Math.round(level * 100) / 100,
        isExcluded: true,
      });
      continue;
    }

    // Outlier check: If scale deviates by more than OUTLIER_THRESHOLD_KG from expected level, dampen its weight
    let effectiveWeight = item.weightKg;
    const expectedWeight = level + trend * dayDiff;
    const delta = Math.abs(item.weightKg - expectedWeight);

    let effectiveAlpha = alpha;
    if (delta > OUTLIER_THRESHOLD_KG && i > 0) {
      // Scale down alpha for sudden spikes to prevent skewing the true trend
      effectiveAlpha = alpha * 0.4;
    }

    // Holt's equations adjusted for time delta
    const prevLevel = level;
    level = effectiveAlpha * effectiveWeight + (1 - effectiveAlpha) * (prevLevel + trend * dayDiff);
    trend = beta * (level - prevLevel) / dayDiff + (1 - beta) * trend;

    // Safety clamp on trend velocity: Max reasonable physiological rate is ~0.25 kg/day (1.75 kg/week)
    trend = Math.max(-0.25, Math.min(0.25, trend));

    smoothedLogs.push({
      id: item.id,
      date: item.dateObj.toISOString().split('T')[0],
      rawWeightKg: Math.round(item.weightKg * 10) / 10,
      trendWeightKg: Math.round(level * 100) / 100,
      isExcluded: false,
    });
  }

  const latest = smoothedLogs[smoothedLogs.length - 1];

  // Robust velocity calculation:
  // Instead of an overly damped instantaneous derivative, calculate velocity
  // from the smoothed level change over the last 7-14 days.
  let velocityKgPerDay = trend;
  if (smoothedLogs.length >= 2) {
    // Look back up to 14 days, or at least to the oldest available log
    const windowDays = Math.min(14, smoothedLogs.length - 1);
    const windowStartLog = smoothedLogs[smoothedLogs.length - 1 - windowDays];
    const daysElapsed = Math.max(1, Math.round(
      (new Date(latest.date).getTime() - new Date(windowStartLog.date).getTime()) / (1000 * 60 * 60 * 24)
    ));
    velocityKgPerDay = (latest.trendWeightKg - windowStartLog.trendWeightKg) / daysElapsed;
  }

  return {
    smoothedLogs,
    latestRawKg: latest.rawWeightKg,
    latestTrendKg: latest.trendWeightKg,
    velocityKgPerDay: Math.round(velocityKgPerDay * 1000) / 1000,
    velocityKgPerWeek: Math.round(velocityKgPerDay * 7 * 100) / 100,
  };
}

module.exports = {
  calculateWeightTrend,
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  OUTLIER_THRESHOLD_KG,
};
