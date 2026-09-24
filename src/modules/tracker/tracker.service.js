const { prisma } = require('../../config/db');
const { DEFAULT_USER_ID, ensureDefaultUser } = require('../profile/profile.service');
const { calculateWeightTrend } = require('../adaptive/algorithms/weightSmoothing');

function parseDateInput(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  }
  return new Date(dateStr);
}

function formatDateOutput(dateObj) {
  if (!dateObj) return '';
  if (typeof dateObj === 'string') return dateObj.split('T')[0];
  return dateObj.toISOString().split('T')[0];
}

function getServingWeight(food) {
  const defaultServing = food.servings?.find((s) => s.isDefault) || food.servings?.[0];
  return defaultServing?.weightGrams || 100;
}

async function getDailyLogs(date, userId = DEFAULT_USER_ID) {
  const parsedDate = parseDateInput(date);
  const dateStr = formatDateOutput(parsedDate);

  const logs = await prisma.mealLog.findMany({
    where: {
      userId,
      date: parsedDate,
    },
    include: {
      food: {
        include: { servings: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const formattedLogs = logs.map((log) => ({
    ...log,
    date: dateStr,
    food: {
      ...log.food,
      servings: log.food.servings || [],
      servingUnit: log.food.servings?.find((s) => s.isDefault)?.unitLabel || 'g',
      servingWeight: getServingWeight(log.food),
    },
  }));

  const summary = formattedLogs.reduce(
    (acc, log) => {
      acc.calories += log.calories || 0;
      acc.protein += log.protein || 0;
      acc.carbohydrates += log.carbohydrates || 0;
      acc.fat += log.fat || 0;
      acc.fiber += log.fiber || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0 }
  );

  const waterData = await getDailyWaterLogs(date, userId);

  return {
    date: dateStr,
    summary: {
      calories: Math.round(summary.calories * 10) / 10,
      protein: Math.round(summary.protein * 10) / 10,
      carbohydrates: Math.round(summary.carbohydrates * 10) / 10,
      fat: Math.round(summary.fat * 10) / 10,
      fiber: Math.round(summary.fiber * 10) / 10,
    },
    logs: formattedLogs,
    water: waterData,
  };
}

async function getDailyWaterLogs(date, userId = DEFAULT_USER_ID) {
  const parsedDate = parseDateInput(date);
  const dateStr = formatDateOutput(parsedDate);

  const logs = await prisma.waterLog.findMany({
    where: {
      userId,
      date: parsedDate,
    },
    orderBy: { createdAt: 'asc' },
  });

  const totalMl = logs.reduce((acc, log) => acc + (log.amountMl || 0), 0);

  return {
    date: dateStr,
    totalMl,
    logs: logs.map((log) => ({
      ...log,
      date: dateStr,
    })),
  };
}

async function logWater({ date, amountMl }, userId = DEFAULT_USER_ID) {
  const parsedDate = parseDateInput(date);
  const ml = parseInt(amountMl, 10);
  if (!ml || isNaN(ml) || ml <= 0) {
    throw new Error('Valid water amount in ml is required');
  }

  const created = await prisma.waterLog.create({
    data: {
      userId,
      date: parsedDate,
      amountMl: ml,
    },
  });

  return {
    ...created,
    date: formatDateOutput(created.date),
  };
}

async function deleteWaterLog(id, userId = DEFAULT_USER_ID) {
  return await prisma.waterLog.delete({
    where: { id },
  });
}

async function logMeal({ date, mealType, foodId, servings = 1, customWeightGrams, unitLabel }, userId = DEFAULT_USER_ID) {
  const food = await prisma.food.findUnique({
    where: { id: foodId },
    include: { servings: true },
  });
  if (!food) throw new Error('Food item not found');

  const servingWeight = getServingWeight(food);
  const numServings = parseFloat(servings) || 1;
  const computedWeight = customWeightGrams !== undefined && customWeightGrams !== null && !isNaN(parseFloat(customWeightGrams))
    ? parseFloat(customWeightGrams)
    : servingWeight * numServings;

  // Scientific standard: food.calories & nutrients are per 100g
  const multiplier = computedWeight / 100;

  const parsedDate = parseDateInput(date);
  const validMealType = String(mealType || 'BREAKFAST').toUpperCase();

  const created = await prisma.mealLog.create({
    data: {
      userId,
      date: parsedDate,
      mealType: validMealType,
      foodId,
      servings: numServings,
      weightGrams: computedWeight,
      unitLabel: unitLabel || null,
      calories: Math.round(food.calories * multiplier * 10) / 10,
      protein: Math.round(food.protein * multiplier * 10) / 10,
      carbohydrates: Math.round(food.carbohydrates * multiplier * 10) / 10,
      fat: Math.round(food.fat * multiplier * 10) / 10,
      fiber: Math.round(food.fiber * multiplier * 10) / 10,
    },
    include: {
      food: {
        include: { servings: true },
      },
    },
  });

  return {
    ...created,
    date: formatDateOutput(created.date),
    food: {
      ...created.food,
      servings: created.food.servings || [],
      servingUnit: created.food.servings?.find((s) => s.isDefault)?.unitLabel || 'g',
      servingWeight: getServingWeight(created.food),
    },
  };
}

async function updateLog(id, { servings, customWeightGrams, mealType, unitLabel }, userId = DEFAULT_USER_ID) {
  const existing = await prisma.mealLog.findFirst({
    where: { id, userId },
    include: {
      food: {
        include: { servings: true },
      },
    },
  });
  if (!existing) throw new Error('Meal log not found');

  const food = existing.food;
  const servingWeight = getServingWeight(food);
  const newServings = servings !== undefined && servings !== null ? parseFloat(servings) : existing.servings;
  const computedWeight = customWeightGrams !== undefined && customWeightGrams !== null && !isNaN(parseFloat(customWeightGrams))
    ? parseFloat(customWeightGrams)
    : servingWeight * newServings;

  // Scientific standard: food.calories & nutrients are per 100g
  const multiplier = computedWeight / 100;

  const updateData = {
    mealType: mealType ? String(mealType).toUpperCase() : existing.mealType,
    servings: newServings,
    weightGrams: computedWeight,
    calories: Math.round(food.calories * multiplier * 10) / 10,
    protein: Math.round(food.protein * multiplier * 10) / 10,
    carbohydrates: Math.round(food.carbohydrates * multiplier * 10) / 10,
    fat: Math.round(food.fat * multiplier * 10) / 10,
    fiber: Math.round(food.fiber * multiplier * 10) / 10,
  };
  if (unitLabel !== undefined) {
    updateData.unitLabel = unitLabel || null;
  }

  const updated = await prisma.mealLog.update({
    where: { id },
    data: updateData,
    include: {
      food: {
        include: { servings: true },
      },
    },
  });

  return {
    ...updated,
    date: formatDateOutput(updated.date),
    food: {
      ...updated.food,
      servings: updated.food.servings || [],
      servingUnit: updated.food.servings?.find((s) => s.isDefault)?.unitLabel || 'g',
      servingWeight: getServingWeight(updated.food),
    },
  };
}

async function deleteLog(id, userId = DEFAULT_USER_ID) {
  return await prisma.mealLog.delete({
    where: { id },
  });
}

async function getRecentFoods(userId = DEFAULT_USER_ID, limit = 30) {
  const logs = await prisma.mealLog.findMany({
    where: { userId },
    distinct: ['foodId'],
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      food: {
        include: { servings: true },
      },
    },
  });

  return logs.map((log) => ({
    ...log.food,
    servingUnit: log.food.servings?.find((s) => s.isDefault)?.unitLabel || 'g',
    servingWeight: getServingWeight(log.food),
    lastLoggedAt: log.createdAt,
    lastMealType: log.mealType,
  }));
}

async function getWeightLogs(days = 90, userId = DEFAULT_USER_ID) {
  const daysNum = Math.max(1, parseInt(days, 10) || 90);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysNum);
  cutoffDate.setHours(0, 0, 0, 0);

  const logs = await prisma.weightLog.findMany({
    where: {
      userId,
      date: { gte: cutoffDate },
    },
    orderBy: { date: 'asc' },
  });

  const trendResult = calculateWeightTrend(logs);

  return {
    windowDays: daysNum,
    latestRawKg: trendResult.latestRawKg,
    latestTrendKg: trendResult.latestTrendKg,
    velocityKgPerDay: trendResult.velocityKgPerDay,
    velocityKgPerWeek: trendResult.velocityKgPerWeek,
    logs: trendResult.smoothedLogs.map((item, idx) => ({
      ...item,
      id: logs[idx]?.id,
      note: logs[idx]?.note || null,
    })),
  };
}

async function logWeight({ date, weightKg, note, isExcluded = false }, userId = DEFAULT_USER_ID) {
  const parsedDate = parseDateInput(date);
  const weight = parseFloat(weightKg);
  if (!weight || isNaN(weight) || weight <= 0) {
    throw new Error('Valid weight in kg is required');
  }

  const log = await prisma.weightLog.upsert({
    where: {
      userId_date: {
        userId,
        date: parsedDate,
      },
    },
    update: {
      weightKg: weight,
      note: note !== undefined ? note : undefined,
      isExcluded: Boolean(isExcluded),
    },
    create: {
      userId,
      weightKg: weight,
      date: parsedDate,
      note: note || null,
      isExcluded: Boolean(isExcluded),
    },
  });

  // Re-sync trend weights for all user's logs
  await syncWeightTrends(userId);

  return {
    ...log,
    date: formatDateOutput(log.date),
  };
}

async function toggleWeightExclusion(id, userId = DEFAULT_USER_ID) {
  const existing = await prisma.weightLog.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Weight log not found');

  const updated = await prisma.weightLog.update({
    where: { id },
    data: { isExcluded: !existing.isExcluded },
  });

  await syncWeightTrends(userId);

  return {
    ...updated,
    date: formatDateOutput(updated.date),
  };
}

async function deleteWeightLog(id, userId = DEFAULT_USER_ID) {
  const existing = await prisma.weightLog.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Weight log not found');

  const deleted = await prisma.weightLog.delete({
    where: { id },
  });

  await syncWeightTrends(userId);
  return deleted;
}

async function syncWeightTrends(userId = DEFAULT_USER_ID) {
  const allLogs = await prisma.weightLog.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
  });

  if (allLogs.length === 0) return;

  const trendResult = calculateWeightTrend(allLogs);

  for (let i = 0; i < allLogs.length; i++) {
    const smoothed = trendResult.smoothedLogs[i];
    if (smoothed && allLogs[i].trendWeightKg !== smoothed.trendWeightKg) {
      await prisma.weightLog.update({
        where: { id: allLogs[i].id },
        data: { trendWeightKg: smoothed.trendWeightKg },
      });
    }
  }
}

module.exports = {
  getDailyLogs,
  getDailyWaterLogs,
  logWater,
  deleteWaterLog,
  logMeal,
  updateLog,
  deleteLog,
  getRecentFoods,
  getWeightLogs,
  logWeight,
  toggleWeightExclusion,
  deleteWeightLog,
  syncWeightTrends,
  parseDateInput,
  formatDateOutput,
};

