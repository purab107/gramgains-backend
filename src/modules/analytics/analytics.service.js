const { prisma } = require('../../config/db');
const { getProfile, DEFAULT_USER_ID } = require('../profile/profile.service');
const { calculateWeightTrend } = require('../adaptive/algorithms/weightSmoothing');
const { getAdaptiveStatus } = require('../adaptive/adaptive.service');

/**
 * Returns a high-level summary of adherence, energy balance, and milestone projections.
 */
async function getOverview(days = 30, userId = DEFAULT_USER_ID) {
  const windowDays = Math.max(7, parseInt(days, 10) || 30);
  const profile = await getProfile(userId);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  cutoff.setHours(0, 0, 0, 0);

  // 1. Fetch meal logs and weight logs for the window
  const [mealLogs, weightLogs, adaptiveStatus] = await Promise.all([
    prisma.mealLog.findMany({
      where: { userId, date: { gte: cutoff } },
      select: { date: true, calories: true, protein: true },
      orderBy: { date: 'asc' },
    }),
    prisma.weightLog.findMany({
      where: { userId, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    }),
    getAdaptiveStatus(userId),
  ]);

  // Aggregate daily intake
  const dailyTotals = new Map();
  for (const log of mealLogs) {
    const dStr = log.date.toISOString().split('T')[0];
    const curr = dailyTotals.get(dStr) || { calories: 0, protein: 0 };
    curr.calories += log.calories || 0;
    curr.protein += log.protein || 0;
    dailyTotals.set(dStr, curr);
  }

  const targetCal = profile.targetCalories;
  const targetProt = profile.targetProtein;

  let daysInBand = 0;
  let daysMetProtein = 0;
  let totalConsumed = 0;

  for (const [, day] of dailyTotals.entries()) {
    totalConsumed += day.calories;
    if (Math.abs(day.calories - targetCal) <= Math.max(100, targetCal * 0.10)) {
      daysInBand += 1;
    }
    if (day.protein >= targetProt * 0.90) {
      daysMetProtein += 1;
    }
  }

  const loggedDaysCount = dailyTotals.size;
  const calorieScore = loggedDaysCount > 0 ? Math.round((daysInBand / loggedDaysCount) * 100) : 0;
  const proteinScore = loggedDaysCount > 0 ? Math.round((daysMetProtein / loggedDaysCount) * 100) : 0;

  // Streak calculation (consecutive days up to today)
  let currentStreak = 0;
  const today = new Date();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().split('T')[0];
    if (dailyTotals.has(dStr)) {
      currentStreak += 1;
    } else if (i > 0) {
      break;
    }
  }

  // Energy Balance
  const effectiveTdee = adaptiveStatus.expenditure.effectiveTdee || profile.tdee;
  const totalExpended = Math.round(effectiveTdee * windowDays);
  const netDeficitKcal = Math.round(totalConsumed - (effectiveTdee * loggedDaysCount));
  const predictedLossKg = Math.round((netDeficitKcal / 7700) * 100) / 100;

  const trendResult = calculateWeightTrend(weightLogs);
  const startTrend = trendResult.smoothedLogs[0]?.trendWeightKg || profile.weightKg;
  const currentTrend = trendResult.latestTrendKg || profile.weightKg;
  const actualTrendLossKg = Math.round((currentTrend - startTrend) * 100) / 100;

  // Milestone Projection
  let milestone = null;
  if (profile.targetWeightKg && profile.targetWeightKg > 0) {
    const remainingKg = Math.round(Math.abs(currentTrend - profile.targetWeightKg) * 10) / 10;
    const velocityPerWeek = Math.abs(trendResult.velocityKgPerWeek) > 0.05
      ? Math.abs(trendResult.velocityKgPerWeek)
      : Math.abs(profile.targetRateKgPerWeek) || 0.35;

    const estimatedWeeksRemaining = Math.round((remainingKg / velocityPerWeek) * 10) / 10;
    const projectedDate = new Date();
    projectedDate.setDate(projectedDate.getDate() + Math.round(estimatedWeeksRemaining * 7));

    milestone = {
      targetWeightKg: profile.targetWeightKg,
      currentTrendKg: currentTrend,
      remainingKg,
      estimatedWeeksRemaining,
      projectedDate: projectedDate.toISOString().split('T')[0],
    };
  }

  return {
    windowDays,
    adherence: {
      calorieScore,
      proteinScore,
      daysInTargetBand: daysInBand,
      loggedDaysCount,
      currentStreak,
    },
    energyBalance: {
      totalConsumedKcal: Math.round(totalConsumed),
      totalExpendedKcal: totalExpended,
      netDeficitKcal,
      predictedLossKg,
      actualTrendLossKg,
    },
    milestoneProjection: milestone,
  };
}

/**
 * Returns merged time-series data for charting (raw weight, trend weight, intake, expenditure).
 */
async function getTrends(days = 60, userId = DEFAULT_USER_ID) {
  const windowDays = Math.max(7, parseInt(days, 10) || 60);
  const profile = await getProfile(userId);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  cutoff.setHours(0, 0, 0, 0);

  const [mealLogs, weightLogs, snapshots] = await Promise.all([
    prisma.mealLog.findMany({
      where: { userId, date: { gte: cutoff } },
      select: { date: true, calories: true, protein: true, carbohydrates: true, fat: true },
      orderBy: { date: 'asc' },
    }),
    prisma.weightLog.findMany({
      where: { userId, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    }),
    prisma.metabolicSnapshot.findMany({
      where: { userId, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const trendResult = calculateWeightTrend(weightLogs);
  const smoothedMap = new Map(trendResult.smoothedLogs.map((l) => [l.date, l]));
  const snapshotMap = new Map(snapshots.map((s) => [s.date.toISOString().split('T')[0], s]));

  // Aggregate daily meal logs
  const dailyMealsMap = new Map();
  for (const m of mealLogs) {
    const dStr = m.date.toISOString().split('T')[0];
    const curr = dailyMealsMap.get(dStr) || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    curr.calories += m.calories || 0;
    curr.protein += m.protein || 0;
    curr.carbs += m.carbohydrates || 0;
    curr.fat += m.fat || 0;
    dailyMealsMap.set(dStr, curr);
  }

  // Build sorted daily series
  const series = [];
  const today = new Date();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().split('T')[0];

    const meal = dailyMealsMap.get(dStr);
    const weight = smoothedMap.get(dStr);
    const snap = snapshotMap.get(dStr);

    if (meal || weight || snap) {
      series.push({
        date: dStr,
        rawWeightKg: weight ? weight.rawWeightKg : null,
        trendWeightKg: weight ? weight.trendWeightKg : null,
        caloriesConsumed: meal ? Math.round(meal.calories) : null,
        targetCalories: profile.targetCalories,
        proteinGrams: meal ? Math.round(meal.protein) : null,
        carbsGrams: meal ? Math.round(meal.carbs) : null,
        fatGrams: meal ? Math.round(meal.fat) : null,
        observedTdee: snap?.observedTdee || null,
        effectiveTdee: snap?.effectiveTdee || profile.tdee,
      });
    }
  }

  return {
    windowDays,
    seriesCount: series.length,
    series,
  };
}

/**
 * Returns chrono-nutrition patterns, meal distribution, and actionable alerts.
 */
async function getPatterns(days = 14, userId = DEFAULT_USER_ID) {
  const windowDays = Math.max(7, parseInt(days, 10) || 14);
  const profile = await getProfile(userId);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  cutoff.setHours(0, 0, 0, 0);

  const mealLogs = await prisma.mealLog.findMany({
    where: { userId, date: { gte: cutoff } },
    select: { date: true, mealType: true, calories: true, protein: true, carbohydrates: true, fat: true, fiber: true, createdAt: true },
  });

  const mealTypeTotals = {
    BREAKFAST: 0,
    LUNCH: 0,
    DINNER: 0,
    SNACK: 0,
  };

  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let totalFiber = 0;
  let lateNightCalories = 0;

  const weekendCalories = [];
  const weekdayCalories = [];
  const dailyMap = new Map();

  for (const log of mealLogs) {
    const cal = log.calories || 0;
    totalCalories += cal;
    totalProtein += log.protein || 0;
    totalCarbs += log.carbohydrates || 0;
    totalFat += log.fat || 0;
    totalFiber += log.fiber || 0;

    const mType = String(log.mealType || 'BREAKFAST').toUpperCase();
    if (mealTypeTotals[mType] !== undefined) {
      mealTypeTotals[mType] += cal;
    }

    // Check late night (logged after 20:30 UTC / local if createdAt available)
    if (log.createdAt) {
      const hour = log.createdAt.getHours();
      if (hour >= 21 || hour < 4) {
        lateNightCalories += cal;
      }
    }

    // Weekend vs Weekday analysis
    const dStr = log.date.toISOString().split('T')[0];
    const dDay = log.date.getDay(); // 0 = Sunday, 6 = Saturday
    dailyMap.set(dStr, {
      calories: (dailyMap.get(dStr)?.calories || 0) + cal,
      isWeekend: dDay === 0 || dDay === 6,
    });
  }

  for (const [, val] of dailyMap.entries()) {
    if (val.isWeekend) weekendCalories.push(val.calories);
    else weekdayCalories.push(val.calories);
  }

  const avgWeekend = weekendCalories.length > 0 ? Math.round(weekendCalories.reduce((a, b) => a + b, 0) / weekendCalories.length) : null;
  const avgWeekday = weekdayCalories.length > 0 ? Math.round(weekdayCalories.reduce((a, b) => a + b, 0) / weekdayCalories.length) : null;
  const weekendDeltaKcal = (avgWeekend && avgWeekday) ? avgWeekend - avgWeekday : 0;

  const totalSafe = Math.max(1, totalCalories);
  const mealDistribution = {
    breakfastPercent: Math.round((mealTypeTotals.BREAKFAST / totalSafe) * 100),
    lunchPercent: Math.round((mealTypeTotals.LUNCH / totalSafe) * 100),
    dinnerPercent: Math.round((mealTypeTotals.DINNER / totalSafe) * 100),
    snackPercent: Math.round((mealTypeTotals.SNACK / totalSafe) * 100),
  };

  const loggedDays = Math.max(1, dailyMap.size);

  // Generate actionable insights
  const activeInsights = [];

  // 1. Protein adherence insight
  const avgDailyProtein = Math.round(totalProtein / loggedDays);
  if (avgDailyProtein >= profile.targetProtein * 0.90) {
    activeInsights.push({
      type: 'PROTEIN_TARGET_MET',
      level: 'SUCCESS',
      title: 'Strong Protein Consistency',
      message: `Averaging ${avgDailyProtein}g protein/day (${Math.round((avgDailyProtein / profile.targetProtein) * 100)}% of target). Optimal for lean tissue preservation.`,
    });
  } else {
    activeInsights.push({
      type: 'PROTEIN_DEFICIT',
      level: 'WARNING',
      title: 'Protein Intake Below Target',
      message: `Averaging ${avgDailyProtein}g vs target ${profile.targetProtein}g. Consider adding an extra protein source to lunch or snacks.`,
    });
  }

  // 2. Weekend surplus insight
  if (weekendDeltaKcal > 300) {
    activeInsights.push({
      type: 'WEEKEND_SURPLUS',
      level: 'INFO',
      title: 'Weekend Intake Elevation',
      message: `Weekend days average +${weekendDeltaKcal} kcal higher than weekdays. Awareness here can accelerate your target timeline.`,
    });
  }

  // 3. Late night snack insight
  const lateNightPercent = Math.round((lateNightCalories / totalSafe) * 100);
  if (lateNightPercent > 20) {
    activeInsights.push({
      type: 'LATE_NIGHT_EATING',
      level: 'INFO',
      title: 'Late Evening Nutrition',
      message: `${lateNightPercent}% of intake happens late at night. Shifting calories earlier in the day may support sleep and training recovery.`,
    });
  }

  return {
    windowDays,
    mealDistribution,
    macroAverages: {
      proteinGrams: avgDailyProtein,
      carbsGrams: Math.round(totalCarbs / loggedDays),
      fatGrams: Math.round(totalFat / loggedDays),
      fiberGrams: Math.round(totalFiber / loggedDays),
    },
    chronoInsights: {
      lateNightCaloriesPercent: lateNightPercent,
      avgWeekdayCalories: avgWeekday,
      avgWeekendCalories: avgWeekend,
      weekendDeltaKcal,
    },
    activeInsights,
  };
}

module.exports = {
  getOverview,
  getTrends,
  getPatterns,
};
