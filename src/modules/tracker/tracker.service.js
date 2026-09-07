const { prisma } = require('../../config/db');

async function getDailyLogs(date) {
  const logs = await prisma.mealLog.findMany({
    where: { date },
    include: { food: true },
    orderBy: { createdAt: 'asc' },
  });

  const summary = logs.reduce(
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
    date,
    summary: {
      calories: Math.round(summary.calories * 10) / 10,
      protein: Math.round(summary.protein * 10) / 10,
      carbohydrates: Math.round(summary.carbohydrates * 10) / 10,
      fat: Math.round(summary.fat * 10) / 10,
      fiber: Math.round(summary.fiber * 10) / 10,
    },
    logs,
  };
}

async function logMeal({ date, mealType, foodId, servings = 1, customWeightGrams }) {
  const food = await prisma.food.findUnique({ where: { id: foodId } });
  if (!food) throw new Error('Food item not found');

  const computedWeight = customWeightGrams ? customWeightGrams : food.servingWeight * servings;
  const multiplier = computedWeight / food.servingWeight;

  return await prisma.mealLog.create({
    data: {
      date,
      mealType,
      foodId,
      servings,
      weightGrams: computedWeight,
      calories: Math.round(food.calories * multiplier * 10) / 10,
      protein: Math.round(food.protein * multiplier * 10) / 10,
      carbohydrates: Math.round(food.carbohydrates * multiplier * 10) / 10,
      fat: Math.round(food.fat * multiplier * 10) / 10,
      fiber: Math.round(food.fiber * multiplier * 10) / 10,
    },
    include: { food: true },
  });
}

async function updateLog(id, { servings, customWeightGrams, mealType }) {
  const existing = await prisma.mealLog.findUnique({ where: { id }, include: { food: true } });
  if (!existing) throw new Error('Meal log not found');

  const food = existing.food;
  const newServings = servings || existing.servings;
  const computedWeight = customWeightGrams ? customWeightGrams : food.servingWeight * newServings;
  const multiplier = computedWeight / food.servingWeight;

  return await prisma.mealLog.update({
    where: { id },
    data: {
      mealType: mealType || existing.mealType,
      servings: newServings,
      weightGrams: computedWeight,
      calories: Math.round(food.calories * multiplier * 10) / 10,
      protein: Math.round(food.protein * multiplier * 10) / 10,
      carbohydrates: Math.round(food.carbohydrates * multiplier * 10) / 10,
      fat: Math.round(food.fat * multiplier * 10) / 10,
      fiber: Math.round(food.fiber * multiplier * 10) / 10,
    },
    include: { food: true },
  });
}

async function deleteLog(id) {
  return await prisma.mealLog.delete({ where: { id } });
}

module.exports = { getDailyLogs, logMeal, updateLog, deleteLog };
