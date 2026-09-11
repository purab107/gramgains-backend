const { prisma } = require('../../config/db');
const { DEFAULT_USER_ID, ensureDefaultUser } = require('../profile/profile.service');

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
  };
}

async function logMeal({ date, mealType, foodId, servings = 1, customWeightGrams }, userId = DEFAULT_USER_ID) {
  const food = await prisma.food.findUnique({
    where: { id: foodId },
    include: { servings: true },
  });
  if (!food) throw new Error('Food item not found');

  const servingWeight = getServingWeight(food);
  const numServings = parseFloat(servings) || 1;
  const computedWeight = customWeightGrams ? parseFloat(customWeightGrams) : servingWeight * numServings;
  const multiplier = computedWeight / servingWeight;

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
      servingUnit: created.food.servings?.find((s) => s.isDefault)?.unitLabel || 'g',
      servingWeight: getServingWeight(created.food),
    },
  };
}

async function updateLog(id, { servings, customWeightGrams, mealType }, userId = DEFAULT_USER_ID) {
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
  const newServings = servings !== undefined ? parseFloat(servings) : existing.servings;
  const computedWeight = customWeightGrams !== undefined ? parseFloat(customWeightGrams) : servingWeight * newServings;
  const multiplier = computedWeight / servingWeight;

  const updated = await prisma.mealLog.update({
    where: { id },
    data: {
      mealType: mealType ? String(mealType).toUpperCase() : existing.mealType,
      servings: newServings,
      weightGrams: computedWeight,
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
    ...updated,
    date: formatDateOutput(updated.date),
    food: {
      ...updated.food,
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

module.exports = { getDailyLogs, logMeal, updateLog, deleteLog, parseDateInput, formatDateOutput };
