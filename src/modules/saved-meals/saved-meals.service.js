const { prisma } = require('../../config/db');
const { DEFAULT_USER_ID } = require('../profile/profile.service');
const { parseDateInput, formatDateOutput } = require('../tracker/tracker.service');

function getServingWeight(food) {
  const defaultServing = food.servings?.find((s) => s.isDefault) || food.servings?.[0];
  return defaultServing?.weightGrams || 100;
}

async function getAll(userId = DEFAULT_USER_ID) {
  return await prisma.savedMeal.findMany({
    where: { userId },
    include: {
      items: {
        include: {
          food: {
            include: { servings: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function getById(id, userId = DEFAULT_USER_ID) {
  return await prisma.savedMeal.findFirst({
    where: { id, userId },
    include: {
      items: {
        include: {
          food: {
            include: { servings: true },
          },
        },
      },
    },
  });
}

async function buildItems(items) {
  let totalCalories = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0, totalFiber = 0;
  const itemsToCreate = [];

  for (const item of items) {
    const food = await prisma.food.findUnique({
      where: { id: item.foodId },
      include: { servings: true },
    });
    if (!food) throw new Error(`Food with ID ${item.foodId} not found`);

    const servingWeight = getServingWeight(food);
    const m = parseFloat(item.weightGrams || 100) / servingWeight;
    const r = (n) => Math.round(n * m * 10) / 10;

    const calories = r(food.calories);
    const protein = r(food.protein);
    const carbs = r(food.carbohydrates);
    const fat = r(food.fat);
    const fiber = r(food.fiber);

    totalCalories += calories;
    totalProtein += protein;
    totalCarbs += carbs;
    totalFat += fat;
    totalFiber += fiber;

    itemsToCreate.push({
      foodId: item.foodId,
      weightGrams: parseFloat(item.weightGrams || 100),
      calories,
      protein,
      carbohydrates: carbs,
      fat,
      fiber,
    });
  }

  const rnd = (n) => Math.round(n * 10) / 10;
  return {
    totals: {
      totalCalories: rnd(totalCalories),
      totalProtein: rnd(totalProtein),
      totalCarbs: rnd(totalCarbs),
      totalFat: rnd(totalFat),
      totalFiber: rnd(totalFiber),
    },
    itemsToCreate,
  };
}

async function create({ name, description, items }, userId = DEFAULT_USER_ID) {
  const { totals, itemsToCreate } = await buildItems(items);
  return await prisma.savedMeal.create({
    data: {
      userId,
      name,
      description,
      ...totals,
      items: { create: itemsToCreate },
    },
    include: {
      items: {
        include: {
          food: {
            include: { servings: true },
          },
        },
      },
    },
  });
}

async function update(id, input, userId = DEFAULT_USER_ID) {
  const existing = await prisma.savedMeal.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('Saved meal not found');

  if (input.items && input.items.length > 0) {
    await prisma.savedMealItem.deleteMany({ where: { savedMealId: id } });
    const { totals, itemsToCreate } = await buildItems(input.items);
    return await prisma.savedMeal.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        ...totals,
        items: { create: itemsToCreate },
      },
      include: {
        items: {
          include: {
            food: {
              include: { servings: true },
            },
          },
        },
      },
    });
  }

  return await prisma.savedMeal.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
    },
    include: {
      items: {
        include: {
          food: {
            include: { servings: true },
          },
        },
      },
    },
  });
}

async function remove(id, userId = DEFAULT_USER_ID) {
  return await prisma.savedMeal.delete({
    where: { id },
  });
}

async function logToTracker(savedMealId, date, mealType, userId = DEFAULT_USER_ID) {
  const savedMeal = await prisma.savedMeal.findFirst({
    where: { id: savedMealId, userId },
    include: {
      items: {
        include: {
          food: {
            include: { servings: true },
          },
        },
      },
    },
  });
  if (!savedMeal) throw new Error('Saved meal not found');

  const parsedDate = parseDateInput(date);
  const validMealType = String(mealType || 'BREAKFAST').toUpperCase();
  const logs = [];

  for (const item of savedMeal.items) {
    const servingWeight = getServingWeight(item.food);
    const servingsCount = item.weightGrams / servingWeight;

    const log = await prisma.mealLog.create({
      data: {
        userId,
        date: parsedDate,
        mealType: validMealType,
        foodId: item.foodId,
        servings: servingsCount,
        weightGrams: item.weightGrams,
        calories: item.calories,
        protein: item.protein,
        carbohydrates: item.carbohydrates,
        fat: item.fat,
        fiber: item.fiber,
      },
      include: { food: true },
    });
    logs.push({
      ...log,
      date: formatDateOutput(log.date),
    });
  }

  return { message: `Successfully logged "${savedMeal.name}" to tracker`, count: logs.length, logs };
}

module.exports = { getAll, getById, create, update, remove, logToTracker };
