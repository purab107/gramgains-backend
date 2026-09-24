const { prisma } = require('../../config/db');
const { getProfile, DEFAULT_USER_ID } = require('../profile/profile.service');
const { calculateWeightTrend } = require('./algorithms/weightSmoothing');
const {
  solveObservedTdee,
  calculateRecommendedCalories,
  filterValidIntakeDays,
} = require('./algorithms/expenditureSolver');
const { evaluateExpenditureConfidence } = require('./algorithms/confidenceModel');
const { allocateMacros } = require('./algorithms/macroAllocator');

const EVALUATION_DAYS = 28;

/**
 * Computes and returns the complete adaptive metabolic status for a user.
 */
async function getAdaptiveStatus(userId = DEFAULT_USER_ID) {
  const profile = await getProfile(userId);
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - EVALUATION_DAYS);
  cutoffDate.setHours(0, 0, 0, 0);

  // 1. Fetch weight logs over the last 28 days
  const weightLogs = await prisma.weightLog.findMany({
    where: {
      userId,
      date: { gte: cutoffDate },
    },
    orderBy: { date: 'asc' },
  });

  const trendResult = calculateWeightTrend(weightLogs);
  const latestWeight = trendResult.latestRawKg || profile.weightKg || 70;

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

  const totalValidCalories = validDays.reduce((acc, d) => acc + d.calories, 0);
  const avgDailyIntake = validFoodDays > 0 ? Math.round(totalValidCalories / validFoodDays) : null;

  // 3. Solve observed TDEE
  const { observedTdee, dailyEnergySurplusKcal } = solveObservedTdee({
    avgDailyIntake,
    velocityKgPerDay: trendResult.velocityKgPerDay,
    bmr: profile.bmr,
  });

  // 4. Bayesian confidence evaluation
  const confidence = evaluateExpenditureConfidence({
    validFoodDays,
    validWeightDays,
    formulaTdee: profile.tdee,
    observedTdee,
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
    await prisma.metabolicSnapshot.upsert({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
      update: {
        rawWeightKg: trendResult.latestRawKg || latestWeight,
        trendWeightKg: trendResult.latestTrendKg || latestWeight,
        avgIntakeCalories: avgDailyIntake || profile.targetCalories,
        formulaTdee: profile.tdee,
        observedTdee: observedTdee || null,
        effectiveTdee: confidence.effectiveTdee,
        confidenceLevel: confidence.level,
        confidenceScore: confidence.score,
        validLogDays: validFoodDays,
      },
      create: {
        userId,
        date: today,
        rawWeightKg: trendResult.latestRawKg || latestWeight,
        trendWeightKg: trendResult.latestTrendKg || latestWeight,
        avgIntakeCalories: avgDailyIntake || profile.targetCalories,
        formulaTdee: profile.tdee,
        observedTdee: observedTdee || null,
        effectiveTdee: confidence.effectiveTdee,
        confidenceLevel: confidence.level,
        confidenceScore: confidence.score,
        validLogDays: validFoodDays,
      },
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
 * Retrieves the current or newly generated weekly check-in proposal.
 */
async function getCheckIn(userId = DEFAULT_USER_ID) {
  // Check for an existing pending check-in
  let checkIn = await prisma.adaptiveCheckIn.findFirst({
    where: { userId, status: 'PENDING' },
    orderBy: { date: 'desc' },
  });

  if (!checkIn) {
    // Generate fresh check-in proposal
    const status = await getAdaptiveStatus(userId);
    const profile = await getProfile(userId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 7);

    // Evaluate adherence in the last 7 days
    const weekLogs = await prisma.mealLog.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      select: { date: true, calories: true },
    });

    const daySums = new Map();
    for (const l of weekLogs) {
      const d = l.date.toISOString().split('T')[0];
      daySums.set(d, (daySums.get(d) || 0) + l.calories);
    }

    let adheredDays = 0;
    const target = profile.targetCalories;
    for (const [, kcal] of daySums.entries()) {
      if (Math.abs(kcal - target) <= Math.max(100, target * 0.10)) {
        adheredDays += 1;
      }
    }
    const adherenceScore = daySums.size > 0 ? Math.round((adheredDays / Math.max(1, daySums.size)) * 100) : 0;

    let headline = 'Steady Progress';
    let rationaleText = 'Your calorie targets are currently well-aligned with your metabolic expenditure.';

    const diff = status.targets.adjustmentKcal;
    if (status.confidence.level === 'INSUFFICIENT') {
      headline = 'Calibrating Baseline Data';
      rationaleText = `We are still gathering data (${status.confidence.validFoodDays}/7 days). Keep logging your meals and weight consistently!`;
    } else if (diff > 50) {
      headline = 'Expenditure Exceeds Expectations';
      rationaleText = `Your real-world expenditure (~${status.expenditure.effectiveTdee} kcal) is higher than estimated. We recommend increasing your intake by +${diff} kcal to fuel performance.`;
    } else if (diff < -50) {
      headline = 'Gradual Adjustment Recommended';
      rationaleText = `To maintain your target rate of change, we recommend a gentle adjustment of ${diff} kcal/day.`;
    }

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
        currentCalories: profile.targetCalories,
        suggestedCalories: status.targets.recommendedCalories,
        suggestedProtein: status.targets.recommendedMacros.proteinGrams,
        suggestedCarbs: status.targets.recommendedMacros.carbsGrams,
        suggestedFat: status.targets.recommendedMacros.fatGrams,
        adjustmentKcal: diff,
        headline,
        rationaleText,
        confidenceLevel: status.confidence.level,
      },
    });
  }

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
