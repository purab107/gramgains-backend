/**
 * GramGains Adaptive Loop
 *
 * Formalised adaptive metabolic adjustment loop with clear phase boundaries.
 *
 * Phases:
 * 1. Collect - Gather raw data (weight logs, meal logs, activity logs, profile)
 * 2. Validate - Filter and validate data (valid food days, valid weight days, daily intakes)
 * 3. Smooth - Apply weight smoothing (Holt's linear exponential smoothing)
 * 4. Measure - Calculate observed TDEE and rate of change
 * 5. Assess Evidence - Evaluate evidence sufficiency and confidence
 * 6. Calculate Recommendation - Determine calorie target adjustment
 * 7. Explain - Build explanation/reasoning
 * 8. Await Confirmation - Return to frontend for user action
 */

const { prisma } = require('../../config/db');
const { getProfile } = require('../profile/profile.service');
const { calculateWeightTrend, calculateMultiWeekTrend } = require('./algorithms/weightSmoothing');
const {
  solveObservedTdee,
  calculateRecommendedCalories,
  calculateProportionalAdjustment,
  filterValidIntakeDays,
  MAINTENANCE_TOLERANCE_KG_PER_WEEK,
} = require('./algorithms/expenditureSolver');
const {
  evaluateExpenditureConfidence,
  evaluateEvidenceSufficiency,
} = require('./algorithms/confidenceModel');
const { allocateMacros } = require('./algorithms/macroAllocator');
const { computeAdherenceInWindow } = require('./algorithms/adherenceEvaluator');
const { computeActivityConsistency } = require('./algorithms/activityEvaluator');
const { METABOLIC_MODEL_VERSION } = require('../../config/metabolicModelVersion');

const EVALUATION_DAYS = 28;
const TREND_WINDOW_DAYS = 21;

/**
 * Phase 1: Collect - Gather raw data for the adaptive loop.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {number} [options.windowDays=28] - Evaluation window in days
 * @returns {Promise<Object>} Raw data collection
 */
async function collectRawData(userId, { windowDays = EVALUATION_DAYS } = {}) {
  const profile = await getProfile(userId);
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  cutoffDate.setHours(0, 0, 0, 0);

  // Fetch full weight history for multi-week trend
  const allWeightLogs = await prisma.weightLog.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
  });

  // Window to evaluation days for metrics
  const weightLogs = allWeightLogs.filter((w) => w.date >= cutoffDate);

  // Fetch meal logs over evaluation window
  const mealLogs = await prisma.mealLog.findMany({
    where: {
      userId,
      date: { gte: cutoffDate },
    },
    select: { date: true, calories: true },
  });

  return {
    profile,
    allWeightLogs,
    weightLogs,
    mealLogs,
    cutoffDate,
    now,
  };
}

/**
 * Phase 2: Validate - Filter and validate raw data.
 *
 * @param {Object} data - Collected raw data
 * @returns {Object} Validated data
 */
function validateData({ mealLogs, weightLogs }) {
  // Aggregate meal logs by date
  const dailyIntakeMap = new Map();
  for (const log of mealLogs) {
    const dStr = log.date.toISOString().split('T')[0];
    const curr = dailyIntakeMap.get(dStr) || 0;
    dailyIntakeMap.set(dStr, curr + (log.calories || 0));
  }

  const rawDailyIntakes = Array.from(dailyIntakeMap.entries()).map(([date, calories]) => ({
    date,
    calories: Math.round(calories),
  }));

  const validDays = filterValidIntakeDays(rawDailyIntakes);
  const validFoodDays = validDays.length;
  const validWeightDays = weightLogs.filter((w) => !w.isExcluded).length;

  const totalValidCalories = validDays.reduce((acc, d) => acc + d.calories, 0);
  const avgDailyIntake = validFoodDays > 0 ? Math.round(totalValidCalories / validFoodDays) : null;

  return {
    rawDailyIntakes,
    validDays,
    validFoodDays,
    validWeightDays,
    avgDailyIntake,
  };
}

/**
 * Phase 3: Smooth - Apply weight smoothing algorithms.
 *
 * @param {Object} data - Validated data with weight logs
 * @returns {Object} Smoothed weight data
 */
function smoothWeightData({ allWeightLogs, weightLogs, profile }) {
  const trendResult = calculateWeightTrend(weightLogs);
  const latestWeight = trendResult.latestRawKg || profile.weightKg || 70;

  // Compute multi-week (21-day) trend rate and stability from full history
  const fullTrendResult = calculateWeightTrend(allWeightLogs);
  const multiWeekTrend = calculateMultiWeekTrend(fullTrendResult.smoothedLogs, { windowDays: TREND_WINDOW_DAYS });

  return {
    trendResult,
    latestWeight,
    fullTrendResult,
    multiWeekTrend,
  };
}

/**
 * Phase 4: Measure - Calculate observed TDEE and rate of change.
 *
 * @param {Object} data - Smoothed data and validation results
 * @returns {Object} Measured expenditure metrics
 */
function measureExpenditure({ avgDailyIntake, trendResult, profile, multiWeekTrend }) {
  const { observedTdee, dailyEnergySurplusKcal } = solveObservedTdee({
    avgDailyIntake,
    velocityKgPerDay: trendResult.velocityKgPerDay,
    bmr: profile.bmr,
  });

  return {
    observedTdee,
    dailyEnergySurplusKcal,
    observedRateKgPerWeek: multiWeekTrend.observedRateKgPerWeek ?? trendResult.velocityKgPerWeek ?? 0,
  };
}

/**
 * Phase 5: Assess Evidence - Evaluate evidence sufficiency and confidence.
 *
 * @param {Object} data - All previous phase outputs
 * @returns {Object} Evidence assessment and confidence
 */
function assessEvidence({ validFoodDays, validWeightDays, profile, observedTdee, multiWeekTrend, windowDailyIntakes, windowDays }) {
  // Compute log density metrics for composite confidence
  const foodLogDensity = Math.min(1.0, validFoodDays / EVALUATION_DAYS);
  const weightLogDensity = Math.min(1.0, validWeightDays / EVALUATION_DAYS);
  const trendStabilityScore = multiWeekTrend.trendStabilityScore;

  // Compute adherence in observation window
  const adherence = computeAdherenceInWindow({
    dailyIntakes: windowDailyIntakes,
    targetCalories: profile.targetCalories,
    windowDays: windowDays || TREND_WINDOW_DAYS,
  });

  // Bayesian confidence evaluation
  const confidence = evaluateExpenditureConfidence({
    validFoodDays,
    validWeightDays,
    formulaTdee: profile.tdee,
    observedTdee,
    foodLogDensity,
    weightLogDensity,
    trendStabilityScore,
    windowDays: EVALUATION_DAYS,
  });

  // Evidence sufficiency gate
  const evidenceSufficiency = evaluateEvidenceSufficiency({
    validFoodDays,
    validWeightDays,
    windowDays: TREND_WINDOW_DAYS,
    foodLogDensity,
    weightLogDensity,
    trendStabilityScore,
    observedTdee,
    adherence,
  });

  return {
    confidence,
    evidenceSufficiency,
    foodLogDensity,
    weightLogDensity,
    trendStabilityScore,
    adherence,
  };
}

/**
 * Phase 6: Calculate Recommendation - Determine calorie target adjustment.
 *
 * @param {Object} data - Evidence assessment and profile data
 * @returns {Object} Calorie recommendation
 */
function calculateRecommendation({ confidence, profile, latestWeight, multiWeekTrend, evidenceSufficiency }) {
  const targetRate = typeof profile.targetRateKgPerWeek === 'number' ? profile.targetRateKgPerWeek : 0;
  const targetRecommendation = calculateRecommendedCalories({
    effectiveTdee: confidence.effectiveTdee,
    targetRateKgPerWeek: targetRate,
    currentCalories: profile.targetCalories,
    gender: profile.gender,
    bodyWeightKg: latestWeight,
  });

  // Apply proportional adjustment when evidence is READY
  if (evidenceSufficiency.evidenceStatus === 'READY' && profile.targetCalories) {
    const proportionalCalories = calculateProportionalAdjustment({
      currentCalories: profile.targetCalories,
      rawTargetCalories: targetRecommendation.rawTargetCalories,
      observedRateKgPerWeek: multiWeekTrend.observedRateKgPerWeek ?? 0,
      targetRateKgPerWeek: targetRate,
    });
    targetRecommendation.recommendedCalories = proportionalCalories;
    targetRecommendation.adjustmentKcal = proportionalCalories - profile.targetCalories;
  }

  // Allocate macros
  const recommendedMacros = allocateMacros({
    targetCalories: targetRecommendation.recommendedCalories,
    bodyWeightKg: latestWeight,
    macroPreset: profile.macroPreset || 'BALANCED',
    proteinGramsPerKg: profile.proteinGramsPerKg || 2.0,
    fatPercent: profile.fatPercent || 25.0,
  });

  return {
    targetRecommendation,
    recommendedMacros,
    targetRate,
  };
}

/**
 * Phase 7: Explain - Build explanation and rationale.
 *
 * @param {Object} data - All previous phase outputs
 * @returns {Object} Explanation data
 */
function buildExplanation({ confidence, evidenceSufficiency, targetRecommendation, targetRate, multiWeekTrend }) {
  const dailyTargetDeltaKcal = targetRecommendation.dailyDeficitKcal ?? 0;
  const expectedTarget = Math.round(confidence.effectiveTdee + dailyTargetDeltaKcal);
  const targetDeviation = Math.abs((targetRecommendation.currentCalories || 0) - expectedTarget);

  // Derivation chain enforcement warning
  if (targetDeviation > 300) {
    console.warn(`[Adaptive] Target deviation detected: stored ${targetRecommendation.currentCalories} vs expected ${expectedTarget} (δ=${targetDeviation} kcal). effectiveTdee=${confidence.effectiveTdee}`);
  }

  return {
    targetDeviation,
    expectedTarget,
    message: confidence.message,
    evidenceMessage: evidenceSufficiency.message,
  };
}

/**
 * Main adaptive loop orchestrator - runs all phases sequentially.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {number} [options.windowDays=28] - Evaluation window in days
 * @returns {Promise<Object>} Complete adaptive loop output
 */
async function runAdaptiveLoop(userId, { windowDays = EVALUATION_DAYS } = {}) {
  // Phase 1: Collect
  const rawData = await collectRawData(userId, { windowDays });

  // Phase 2: Validate
  const validatedData = validateData(rawData);

  // Phase 3: Smooth
  const smoothedData = smoothWeightData({
    allWeightLogs: rawData.allWeightLogs,
    weightLogs: rawData.weightLogs,
    profile: rawData.profile,
  });

  // Phase 4: Measure
  const measuredData = measureExpenditure({
    avgDailyIntake: validatedData.avgDailyIntake,
    trendResult: smoothedData.trendResult,
    profile: rawData.profile,
    multiWeekTrend: smoothedData.multiWeekTrend,
  });

  // Prepare window daily intakes for adherence calculation
  const trendWindowCutoff = new Date(rawData.now);
  trendWindowCutoff.setDate(trendWindowCutoff.getDate() - TREND_WINDOW_DAYS);
  trendWindowCutoff.setHours(0, 0, 0, 0);

  const windowDailyIntakes = validatedData.rawDailyIntakes.filter((d) => {
    const intakeDate = new Date(d.date);
    intakeDate.setHours(0, 0, 0, 0);
    return intakeDate >= trendWindowCutoff;
  });

  // Phase 5: Assess Evidence
  const evidenceData = assessEvidence({
    validFoodDays: validatedData.validFoodDays,
    validWeightDays: validatedData.validWeightDays,
    profile: rawData.profile,
    observedTdee: measuredData.observedTdee,
    multiWeekTrend: smoothedData.multiWeekTrend,
    windowDailyIntakes,
    windowDays: TREND_WINDOW_DAYS,
  });

  // Phase 6: Calculate Recommendation
  const recommendationData = calculateRecommendation({
    confidence: evidenceData.confidence,
    evidenceSufficiency: evidenceData.evidenceSufficiency,
    profile: rawData.profile,
    latestWeight: smoothedData.latestWeight,
    multiWeekTrend: smoothedData.multiWeekTrend,
  });

  // Phase 7: Explain
  const explanationData = buildExplanation({
    confidence: evidenceData.confidence,
    evidenceSufficiency: evidenceData.evidenceSufficiency,
    targetRecommendation: recommendationData.targetRecommendation,
    targetRate: recommendationData.targetRate,
    multiWeekTrend: smoothedData.multiWeekTrend,
  });

  // Phase 8: Await Confirmation (return structured output for frontend)
  return {
    // Raw data
    profile: rawData.profile,
    validFoodDays: validatedData.validFoodDays,
    validWeightDays: validatedData.validWeightDays,
    avgDailyIntake: validatedData.avgDailyIntake,

    // Smoothed data
    latestWeight: smoothedData.latestWeight,
    trendResult: smoothedData.trendResult,
    multiWeekTrend: smoothedData.multiWeekTrend,

    // Measured data
    observedTdee: measuredData.observedTdee,
    dailyEnergySurplusKcal: measuredData.dailyEnergySurplusKcal,
    observedRateKgPerWeek: measuredData.observedRateKgPerWeek,

    // Evidence data
    confidence: evidenceData.confidence,
    evidenceSufficiency: evidenceData.evidenceSufficiency,
    foodLogDensity: evidenceData.foodLogDensity,
    weightLogDensity: evidenceData.weightLogDensity,
    trendStabilityScore: evidenceData.trendStabilityScore,
    adherence: evidenceData.adherence,

    // Recommendation data
    targetRecommendation: recommendationData.targetRecommendation,
    recommendedMacros: recommendationData.recommendedMacros,
    targetRate: recommendationData.targetRate,

    // Explanation data
    explanation: explanationData,

    // Lead-Up status & suppression
    leadUpStatus: {
      isActive: Boolean(rawData.profile.leadUpActive),
      currentStep: rawData.profile.leadUpCurrentStep ?? 0,
      totalSteps: rawData.profile.leadUpTotalSteps ?? 0,
      startDate: rawData.profile.leadUpStartDate,
      calculatedGoalTarget: rawData.profile.calculatedGoalTarget ?? rawData.profile.targetCalories,
      schedule: rawData.profile.leadUpScheduleJson,
      isSuppressed: Boolean(rawData.profile.leadUpActive && evidenceData.confidence.level === 'INSUFFICIENT'),
    },

    // Metadata
    metabolicModelVersion: METABOLIC_MODEL_VERSION,
    evaluationWindowDays: EVALUATION_DAYS,
    trendWindowDays: TREND_WINDOW_DAYS,
  };
}

module.exports = {
  runAdaptiveLoop,
  collectRawData,
  validateData,
  smoothWeightData,
  measureExpenditure,
  assessEvidence,
  calculateRecommendation,
  buildExplanation,
};
