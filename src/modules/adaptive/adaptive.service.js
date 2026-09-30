const { prisma } = require('../../config/db');
const { getProfile, DEFAULT_USER_ID } = require('../profile/profile.service');
const { calculateWeightTrend, calculateMultiWeekTrend } = require('./algorithms/weightSmoothing');
const {
  solveObservedTdee,
  calculateRecommendedCalories,
  filterValidIntakeDays,
} = require('./algorithms/expenditureSolver');
const {
  evaluateExpenditureConfidence,
  evaluateEvidenceSufficiency,
} = require('./algorithms/confidenceModel');
const { allocateMacros } = require('./algorithms/macroAllocator');
const { computeAdherenceInWindow } = require('./algorithms/adherenceEvaluator');

const EVALUATION_DAYS = 28;
const TREND_WINDOW_DAYS = 21;
const ADJUSTMENT_COOLDOWN_DAYS = 14;

/**
 * Computes and returns the complete adaptive metabolic status for a user.
 */
async function getAdaptiveStatus(userId = DEFAULT_USER_ID) {
  const profile = await getProfile(userId);
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - EVALUATION_DAYS);
  cutoffDate.setHours(0, 0, 0, 0);

  // 1a. Fetch full weight history for multi-week trend calculation
  const allWeightLogs = await prisma.weightLog.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
  });

  // 1b. Window to 28 days for evaluation metrics
  const weightLogs = allWeightLogs.filter((w) => w.date >= cutoffDate);

  const trendResult = calculateWeightTrend(weightLogs);
  const latestWeight = trendResult.latestRawKg || profile.weightKg || 70;

  // 1c. Compute multi-week (21-day) trend rate and stability from full history
  const fullTrendResult = calculateWeightTrend(allWeightLogs);
  const multiWeekTrend = calculateMultiWeekTrend(fullTrendResult.smoothedLogs, { windowDays: TREND_WINDOW_DAYS });

  // 2. Fetch meal logs over the last 28 days and aggregate by date
  const mealLogs = await prisma.mealLog.findMany({
    where: {
      userId,
      date: { gte: cutoffDate },
    },
    select: { date: true, calories: true },
  });

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

  // Compute log density metrics for composite confidence
  const foodLogDensity = Math.min(1.0, validFoodDays / EVALUATION_DAYS);
  const weightLogDensity = Math.min(1.0, validWeightDays / EVALUATION_DAYS);
  const trendStabilityScore = multiWeekTrend.trendStabilityScore;

  const totalValidCalories = validDays.reduce((acc, d) => acc + d.calories, 0);
  const avgDailyIntake = validFoodDays > 0 ? Math.round(totalValidCalories / validFoodDays) : null;

  // 3. Solve observed TDEE
  const { observedTdee, dailyEnergySurplusKcal } = solveObservedTdee({
    avgDailyIntake,
    velocityKgPerDay: trendResult.velocityKgPerDay,
    bmr: profile.bmr,
  });

  // 3b. Evaluate dietary adherence in 21-day observation window (Improvement 5)
  const trendWindowCutoff = new Date(now);
  trendWindowCutoff.setDate(trendWindowCutoff.getDate() - TREND_WINDOW_DAYS);
  trendWindowCutoff.setHours(0, 0, 0, 0);

  const windowDailyIntakes = rawDailyIntakes.filter((d) => {
    const intakeDate = new Date(d.date);
    intakeDate.setHours(0, 0, 0, 0);
    return intakeDate >= trendWindowCutoff;
  });

  const adherence = computeAdherenceInWindow({
    dailyIntakes: windowDailyIntakes,
    targetCalories: profile.targetCalories,
    windowDays: TREND_WINDOW_DAYS,
  });

  // 4. Bayesian confidence evaluation (now with density and stability inputs)
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

  // 4b. Evidence sufficiency gate (drives check-in recommendation decisions)
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

  // 5. Calculate recommended calorie target
  const targetRate = typeof profile.targetRateKgPerWeek === 'number' ? profile.targetRateKgPerWeek : 0;
  const targetRecommendation = calculateRecommendedCalories({
    effectiveTdee: confidence.effectiveTdee,
    targetRateKgPerWeek: targetRate,
    currentCalories: profile.targetCalories,
    gender: profile.gender,
    bodyWeightKg: latestWeight,
  });

  // 6. Allocate macros for the recommended target
  const recommendedMacros = allocateMacros({
    targetCalories: targetRecommendation.recommendedCalories,
    bodyWeightKg: latestWeight,
    macroPreset: profile.macroPreset || 'BALANCED',
    proteinGramsPerKg: profile.proteinGramsPerKg || 2.0,
    fatPercent: profile.fatPercent || 25.0,
  });

  // 7. Persist or update MetabolicSnapshot for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  try {
    const snapshotData = {
      rawWeightKg: trendResult.latestRawKg || latestWeight,
      trendWeightKg: trendResult.latestTrendKg || latestWeight,
      avgIntakeCalories: avgDailyIntake || profile.targetCalories,
      formulaTdee: profile.tdee,
      observedTdee: observedTdee || null,
      effectiveTdee: confidence.effectiveTdee,
      confidenceLevel: confidence.level,
      confidenceScore: confidence.score,
      validLogDays: validFoodDays,
      // Phase 1 / Phase 3 new fields
      foodLogDensity,
      weightLogDensity,
      trendStabilityScore,
      trendWindowDays: multiWeekTrend.windowDays,
      observedRateKgPerWeek: multiWeekTrend.observedRateKgPerWeek,
      metabolicModelVersion: 1,
    };
    await prisma.metabolicSnapshot.upsert({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
      update: snapshotData,
      create: { userId, date: today, ...snapshotData },
    });

    // Update profile with cached adaptive metrics
    await prisma.userProfile.update({
      where: { userId },
      data: {
        adaptiveTdee: observedTdee || null,
        confidenceLevel: confidence.level,
        confidenceDays: validFoodDays,
      },
    });
  } catch (err) {
    // Non-fatal logging
    console.error('Failed to update metabolic snapshot cache:', err.message);
  }

  // 8. Check for pending or available check-in
  const pendingCheckIn = await prisma.adaptiveCheckIn.findFirst({
    where: { userId, status: 'PENDING' },
    orderBy: { date: 'desc' },
  });

  return {
    isAdaptiveEnabled: profile.isAdaptiveEnabled !== false,
    confidence: {
      level: confidence.level,
      score: confidence.score,
      validFoodDays,
      validWeightDays,
      evaluationWindowDays: EVALUATION_DAYS,
      message: confidence.message,
      foodLogDensity,
      weightLogDensity,
      trendStabilityScore,
    },
    evidenceSufficiency: {
      evidenceStatus: evidenceSufficiency.evidenceStatus,
      isReadyForRecommendation: evidenceSufficiency.isReadyForRecommendation,
      message: evidenceSufficiency.message,
      adherence: evidenceSufficiency.adherence ? {
        totalLoggedDays: evidenceSufficiency.adherence.totalLoggedDays,
        adherentDays: evidenceSufficiency.adherence.adherentDays,
        density: evidenceSufficiency.adherence.density,
        adherenceRate: evidenceSufficiency.adherence.adherenceRate,
        adherenceScore: evidenceSufficiency.adherence.adherenceScore,
        isAdherent: evidenceSufficiency.adherence.isAdherent,
      } : null,
    },
    expenditure: {
      formulaBaselineTdee: profile.tdee,
      observedTdee,
      effectiveTdee: confidence.effectiveTdee,
      dailyEnergySurplusKcal,
      unit: 'kcal',
    },
    weightTrend: {
      latestRawKg: trendResult.latestRawKg || latestWeight,
      latestTrendKg: trendResult.latestTrendKg || latestWeight,
      velocityKgPerDay: trendResult.velocityKgPerDay,
      velocityKgPerWeek: trendResult.velocityKgPerWeek,
      targetVelocityKgPerWeek: targetRate,
      multiWeekObservedRateKgPerWeek: multiWeekTrend.observedRateKgPerWeek,
      trendWindowDays: multiWeekTrend.windowDays,
      sufficientTrendData: multiWeekTrend.sufficientData,
    },
    targets: {
      currentCalories: profile.targetCalories,
      recommendedCalories: targetRecommendation.recommendedCalories,
      adjustmentKcal: targetRecommendation.adjustmentKcal,
      isBelowSafetyFloor: targetRecommendation.isBelowSafetyFloor,
      safetyFloorKcal: targetRecommendation.safetyFloorKcal,
      isAggressiveRate: targetRecommendation.isAggressiveRate,
      recommendedMacros,
      isCheckInAvailable: Boolean(pendingCheckIn) || validFoodDays >= 7,
      pendingCheckInId: pendingCheckIn?.id || null,
    },
  };
}

/**
 * Calculates start of week given a reference date and start day (0=Sunday, 1=Monday).
 */
function getStartOfWeek(date, startDay = 1) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day < startDay ? 7 : 0) + day - startDay;
  d.setDate(d.getDate() - diff);
  return d;
}

/**
 * Retrieves the current or newly generated weekly check-in proposal.
 */
async function getCheckIn(userId = DEFAULT_USER_ID, { forceGenerate = false } = {}) {
  // 1. Check for an existing pending check-in (pending takes priority)
  let checkIn = await prisma.adaptiveCheckIn.findFirst({
    where: { userId, status: 'PENDING' },
    orderBy: { date: 'desc' },
  });

  if (checkIn) {
    if (!forceGenerate) {
      return checkIn;
    }
    await prisma.adaptiveCheckIn.delete({ where: { id: checkIn.id } });
  }

  const profile = await getProfile(userId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 2. Server-side check-in cadence guard (Improvement 12)
  const todayDow = today.getDay(); // 0=Sunday, 1=Monday, ...
  const checkInDay = typeof profile.checkInDayOfWeek === 'number' ? profile.checkInDayOfWeek : 1;

  if (todayDow !== checkInDay && !forceGenerate) {
    return null; // Not check-in day
  }

  // 3. Idempotency guard (Improvement 22)
  // Check if a check-in already exists for current observation window end date (today)
  const existingForPeriod = await prisma.adaptiveCheckIn.findFirst({
    where: {
      userId,
      observationEnd: today,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existingForPeriod && !forceGenerate) {
    return existingForPeriod;
  }

  // Also check if a check-in was already created this week
  const startOfWeek = getStartOfWeek(today, checkInDay);
  const existingThisWeek = await prisma.adaptiveCheckIn.findFirst({
    where: {
      userId,
      createdAt: { gte: startOfWeek },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existingThisWeek && !forceGenerate) {
    return existingThisWeek;
  }

  // 4. Generate fresh check-in proposal
  const status = await getAdaptiveStatus(userId);

  const observationEnd = new Date(today);
  const observationStart = new Date(today);
  observationStart.setDate(observationStart.getDate() - TREND_WINDOW_DAYS);
  observationStart.setHours(0, 0, 0, 0);

  const currentCalories = profile.targetCalories;

  // 5. Use 21-day window adherence from getAdaptiveStatus (Improvement 5 — Phase 6)
  const windowAdherence = status.evidenceSufficiency?.adherence || null;
  const adherenceScore = windowAdherence ? windowAdherence.adherenceScore : 0;

  // 6. Recommendation and Reason Code Logic (Improvement 1, 15)
  const evidenceStatus = status.evidenceSufficiency?.evidenceStatus || 'INSUFFICIENT';
  const targetRate = typeof profile.targetRateKgPerWeek === 'number' ? profile.targetRateKgPerWeek : 0;
  const observedRate = typeof status.weightTrend.multiWeekObservedRateKgPerWeek === 'number'
    ? status.weightTrend.multiWeekObservedRateKgPerWeek
    : (status.weightTrend.velocityKgPerWeek || 0);

  const RATE_TOLERANCE_KG_PER_WEEK = 0.1;
  const rateDeviation = observedRate - targetRate;
  const isWithinTolerance = Math.abs(rateDeviation) <= RATE_TOLERANCE_KG_PER_WEEK;

  // Check 14-day adjustment cooldown (Improvement 2)
  let isCooldownActive = false;
  let cooldownDaysSince = 0;
  if (profile.lastAdjustmentAppliedAt) {
    const elapsedMs = today.getTime() - new Date(profile.lastAdjustmentAppliedAt).getTime();
    cooldownDaysSince = Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));
    if (cooldownDaysSince < ADJUSTMENT_COOLDOWN_DAYS) {
      isCooldownActive = true;
    }
  }

  const safetyFloorKcal = status.targets.safetyFloorKcal || (profile.gender === 'FEMALE' ? 1200 : 1500);
  const isCurrentBelowSafetyFloor = currentCalories < safetyFloorKcal;
  const isBelowSafetyFloor = Boolean(status.targets.isBelowSafetyFloor) || isCurrentBelowSafetyFloor;

  let reasonCode = 'KEEP_CURRENT_TARGET';
  let suggestedCalories = currentCalories;
  let adjustmentKcal = 0;
  let headline = 'Steady Progress';
  let rationaleText = 'Your calorie targets are currently well-aligned with your metabolic expenditure.';

  if (isBelowSafetyFloor) {
    // Safety floor violation overrides cooldown and calibration gates
    reasonCode = 'TREND_BELOW_TARGET';
    headline = 'Safety Floor Adjustment';
    suggestedCalories = Math.max(status.targets.recommendedCalories || safetyFloorKcal, safetyFloorKcal);
    adjustmentKcal = suggestedCalories - currentCalories;
    rationaleText = `Intake was below the clinical safety floor (${safetyFloorKcal} kcal). Target has been raised to protect metabolic health.`;
  } else if (isCooldownActive) {
    // 14-day cooldown active between adjustments (Improvement 2)
    reasonCode = 'COOLDOWN_ACTIVE';
    suggestedCalories = currentCalories;
    adjustmentKcal = 0;
    headline = 'Recent Adjustment Active';
    const daysRemaining = Math.max(1, Math.ceil(ADJUSTMENT_COOLDOWN_DAYS - cooldownDaysSince));
    rationaleText = `Your calories were adjusted ${Math.floor(cooldownDaysSince)} day${Math.floor(cooldownDaysSince) === 1 ? '' : 's'} ago. Maintaining current targets for ${daysRemaining} more day${daysRemaining === 1 ? '' : 's'} to observe metabolic adaptation before making further changes.`;
  } else if (evidenceStatus === 'INSUFFICIENT') {
    reasonCode = 'INSUFFICIENT_DATA';
    suggestedCalories = currentCalories;
    adjustmentKcal = 0;
    headline = 'Calibrating Baseline Data';
    rationaleText = `We are still gathering data (${status.confidence.validFoodDays} of ${EVALUATION_DAYS} days). Keep logging your meals and weight consistently!`;
  } else if (evidenceStatus === 'CALIBRATING') {
    reasonCode = 'KEEP_CURRENT_TARGET';
    suggestedCalories = currentCalories;
    adjustmentKcal = 0;
    headline = 'Calibrating Baseline Data';
    rationaleText = `Your metabolic baseline is calibrating (${status.confidence.validFoodDays} days logged). Maintaining current targets until enough evidence is established.`;
  } else if (evidenceStatus === 'LOW_ADHERENCE') {
    reasonCode = 'LOW_ADHERENCE';
    suggestedCalories = currentCalories;
    adjustmentKcal = 0;
    headline = 'More Consistent Logging Needed';
    rationaleText = 'Logging frequency has been inconsistent. Aim for at least 14 days of complete meal tracking across the observation period for accurate adaptation.';
  } else if (evidenceStatus === 'READY') {
    if (isWithinTolerance) {
      reasonCode = profile.goal === 'MAINTAIN' ? 'MAINTENANCE_IN_BAND' : 'TREND_ON_TARGET';
      suggestedCalories = currentCalories;
      adjustmentKcal = 0;
      headline = 'Steady Progress';
      rationaleText = 'Your calorie targets are currently well-aligned with your metabolic expenditure.';
    } else {
      const diff = status.targets.adjustmentKcal;
      if (rateDeviation < -RATE_TOLERANCE_KG_PER_WEEK || diff > 0) {
        reasonCode = 'TREND_BELOW_TARGET';
        headline = 'Expenditure Exceeds Expectations';
        rationaleText = `Your real-world expenditure (~${status.expenditure.effectiveTdee} kcal) is higher than estimated. We recommend increasing your intake by +${diff} kcal to fuel performance.`;
        suggestedCalories = status.targets.recommendedCalories;
        adjustmentKcal = diff;
      } else {
        reasonCode = 'TREND_ABOVE_TARGET';
        headline = 'Gradual Adjustment Recommended';
        rationaleText = `To maintain your target rate of change, we recommend a gentle adjustment of ${diff} kcal/day.`;
        suggestedCalories = status.targets.recommendedCalories;
        adjustmentKcal = diff;
      }
    }
  }

  // Allocate macros for the determined suggestedCalories
  const suggestedMacros = allocateMacros({
    targetCalories: suggestedCalories,
    bodyWeightKg: status.weightTrend.latestRawKg || profile.weightKg || 70,
    macroPreset: profile.macroPreset || 'BALANCED',
    proteinGramsPerKg: profile.proteinGramsPerKg || 2.0,
    fatPercent: profile.fatPercent || 25.0,
  });

  checkIn = await prisma.adaptiveCheckIn.create({
    data: {
      userId,
      date: today,
      status: 'PENDING',
      startWeightKg: status.weightTrend.latestTrendKg,
      endWeightKg: status.weightTrend.latestRawKg,
      trendChangeKg: status.weightTrend.velocityKgPerWeek,
      avgIntakeKcal: status.expenditure.observedTdee || profile.targetCalories,
      adherenceScore,
      currentCalories,
      suggestedCalories,
      suggestedProtein: suggestedMacros.proteinGrams,
      suggestedCarbs: suggestedMacros.carbsGrams,
      suggestedFat: suggestedMacros.fatGrams,
      adjustmentKcal,
      headline,
      rationaleText,
      confidenceLevel: status.confidence.level,
      // Phase 1 / Phase 4 fields
      reasonCode,
      observationStart,
      observationEnd,
      targetRateKgPerWeek: targetRate,
      observedRateKgPerWeek: observedRate,
      effectiveTdee: status.expenditure.effectiveTdee,
      validFoodDays: status.confidence.validFoodDays,
      validWeightDays: status.confidence.validWeightDays,
      confidenceScore: status.confidence.score,
      metabolicModelVersion: 1,
      evidenceStatus,
    },
  });

  return checkIn;
}

/**
 * Applies, adjusts, or dismisses a weekly check-in recommendation.
 */
async function applyCheckIn({ checkInId, action = 'ACCEPT', customCalories }, userId = DEFAULT_USER_ID) {
  const checkIn = await prisma.adaptiveCheckIn.findFirst({
    where: { id: checkInId, userId },
  });

  if (!checkIn) {
    throw new Error('Check-in record not found');
  }

  const profile = await getProfile(userId);
  const normalizedAction = String(action).toUpperCase();

  if (normalizedAction === 'DISMISS') {
    return await prisma.adaptiveCheckIn.update({
      where: { id: checkInId },
      data: { status: 'DISMISSED' },
    });
  }

  let finalCalories = checkIn.suggestedCalories;
  if (normalizedAction === 'ADJUST' && customCalories && Number(customCalories) > 0) {
    finalCalories = Math.round(Number(customCalories));
  }

  const macros = allocateMacros({
    targetCalories: finalCalories,
    bodyWeightKg: profile.weightKg || 70,
    macroPreset: profile.macroPreset || 'BALANCED',
    proteinGramsPerKg: profile.proteinGramsPerKg || 2.0,
    fatPercent: profile.fatPercent || 25.0,
  });

  // Atomically update user profile targets
  const updatedProfile = await prisma.userProfile.update({
    where: { userId },
    data: {
      targetCalories: finalCalories,
      targetProtein: macros.proteinGrams,
      targetCarbs: macros.carbsGrams,
      targetFat: macros.fatGrams,
      targetFiber: macros.fiberGrams,
      lastCheckInDate: new Date(),
      lastAdjustmentAppliedAt: new Date(),
    },
  });

  // Mark check-in as accepted/adjusted
  await prisma.adaptiveCheckIn.update({
    where: { id: checkInId },
    data: {
      status: normalizedAction === 'ADJUST' ? 'ADJUSTED' : 'ACCEPTED',
      appliedAt: new Date(),
    },
  });

  return {
    success: true,
    action: normalizedAction,
    profile: updatedProfile,
  };
}

module.exports = {
  getAdaptiveStatus,
  getCheckIn,
  applyCheckIn,
};
