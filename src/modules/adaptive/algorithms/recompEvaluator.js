/**
 * Body Recomposition (RECOMP) Evaluation Engine (Improvement 17)
 *
 * For users with goal === 'RECOMP':
 * 1. Scale weight is NOT the sole primary signal. Target weight velocity ≈ 0.
 * 2. Cross-references secondary signals:
 *    - Strength / Performance progression from activity logs
 *    - Waist circumference trend (if logged)
 * 3. Outlines outcomes:
 *    - KEEP: Weight stable, performance maintained or improving
 *    - INCREASE: Losing weight unintentionally or performance dropping
 *    - DECREASE: Gaining weight above recomposition band without performance increase
 *    - INSUFFICIENT_SIGNALS: Lack of auxiliary signals or inconsistent tracking
 */

const RECOMP_WEIGHT_TOLERANCE_KG_PER_WEEK = 0.15;

/**
 * Evaluates recomposition indicators.
 *
 * @param {Object} params
 * @param {number} [params.observedRateKgPerWeek=0]
 * @param {Array<Object>} [params.activityLogs=[]]
 * @param {Array<Object>|null} [params.waistLogs=null]
 * @returns {{ outcome: 'KEEP'|'INCREASE'|'DECREASE'|'INSUFFICIENT_SIGNALS', confidence: 'LOW'|'MEDIUM'|'HIGH', reasoning: string }}
 */
function evaluateRecomp({
  observedRateKgPerWeek = 0,
  activityLogs = [],
  waistLogs = null,
} = {}) {
  const isWeightStable = Math.abs(observedRateKgPerWeek) <= RECOMP_WEIGHT_TOLERANCE_KG_PER_WEEK;

  // Check activity / strength signal
  const hasActivityLogs = Array.isArray(activityLogs) && activityLogs.length >= 3;
  let strengthImproving = false;
  if (hasActivityLogs) {
    // Basic heuristic: active resistance sessions logged regularly
    strengthImproving = activityLogs.some(
      (a) => a.activityType === 'RESISTANCE_TRAINING' || a.activityType === 'WEIGHTLIFTING' || (a.durationMinutes && a.durationMinutes >= 30)
    );
  }

  // Check waist signal if available
  let waistDeclining = false;
  if (Array.isArray(waistLogs) && waistLogs.length >= 2) {
    const firstWaist = waistLogs[0].waistCm || waistLogs[0].value;
    const lastWaist = waistLogs[waistLogs.length - 1].waistCm || waistLogs[waistLogs.length - 1].value;
    if (typeof firstWaist === 'number' && typeof lastWaist === 'number') {
      waistDeclining = lastWaist <= firstWaist;
    }
  }

  // If weight is stable and we have confirmation from either strength or waist
  if (isWeightStable) {
    if (strengthImproving || waistDeclining) {
      return {
        outcome: 'KEEP',
        confidence: 'HIGH',
        reasoning: 'Scale weight is stable while performance and body composition indicators remain positive. Maintaining current intake.',
      };
    }
    return {
      outcome: 'KEEP',
      confidence: 'MEDIUM',
      reasoning: 'Scale weight is stable within recomposition tolerances (+/- 0.15 kg/week). Continuing current intake.',
    };
  }

  // Weight drift detected
  if (observedRateKgPerWeek > RECOMP_WEIGHT_TOLERANCE_KG_PER_WEEK) {
    // Gaining weight above recomposition band
    return {
      outcome: 'DECREASE',
      confidence: 'MEDIUM',
      reasoning: `Weight is trending upward (+${observedRateKgPerWeek.toFixed(2)} kg/week) faster than desired for recomposition. Gentle decrease recommended.`,
    };
  }

  if (observedRateKgPerWeek < -RECOMP_WEIGHT_TOLERANCE_KG_PER_WEEK) {
    // Losing weight faster than recomposition band
    return {
      outcome: 'INCREASE',
      confidence: 'MEDIUM',
      reasoning: `Weight is dropping (${observedRateKgPerWeek.toFixed(2)} kg/week) below recomposition band. Gentle increase recommended to preserve lean tissue.`,
    };
  }

  return {
    outcome: 'INSUFFICIENT_SIGNALS',
    confidence: 'LOW',
    reasoning: 'Insufficient secondary signals to evaluate body recomposition. Continuing current target.',
  };
}

module.exports = {
  evaluateRecomp,
  RECOMP_WEIGHT_TOLERANCE_KG_PER_WEEK,
};
