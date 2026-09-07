const { prisma } = require('../../config/db');

async function getAll() {
  return await prisma.savedMeal.findMany({
    include: { items: { include: { food: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function getById(id) {
  return await prisma.savedMeal.findUnique({
    where: { id },
    include: { items: { include: { food: true } } },
  });
}

async function buildItems(items) {
  let totalCalories = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0, totalFiber = 0;
  const itemsToCreate = [];

  for (const item of items) {
    const food = await prisma.food.findUnique({ where: { id: item.foodId } });
    if (!food) throw new Error(`Food with ID ${item.foodId} not found`);

    const m = item.weightGrams / food.servingWeight;
    const r = (n) => Math.round(n * m * 10) / 10;

    const calories = r(food.calories), protein = r(food.protein),
      carbs = r(food.carbohydrates), fat = r(food.fat), fiber = r(food.fiber);

    totalCalories += calories; totalProtein += protein;
    totalCarbs += carbs; totalFat += fat; totalFiber += fiber;

    itemsToCreate.push({ foodId: item.foodId, weightGrams: item.weightGrams, calories, protein, carbs, fat, fiber });
  }

  const rnd = (n) => Math.round(n * 10) / 10;
  return {
    totals: { totalCalories: rnd(totalCalories), totalProtein: rnd(totalProtein), totalCarbs: rnd(totalCarbs), totalFat: rnd(totalFat), totalFiber: rnd(totalFiber) },
    itemsToCreate,
  };
}

async function create({ name, description, items }) {
  const { totals, itemsToCreate } = await buildItems(items);
  return await prisma.savedMeal.create({
    data: { name, description, ...totals, items: { create: itemsToCreate } },
    include: { items: { include: { food: true } } },
  });
}

async function update(id, input) {
  const existing = await prisma.savedMeal.findUnique({ where: { id } });
  if (!existing) throw new Error('Saved meal not found');

  if (input.items && input.items.length > 0) {
    await prisma.savedMealItem.deleteMany({ where: { savedMealId: id } });
    const { totals, itemsToCreate } = await buildItems(input.items);
    return await prisma.savedMeal.update({
      where: { id },
      data: { name: input.name ?? existing.name, description: input.description ?? existing.description, ...totals, items: { create: itemsToCreate } },
      include: { items: { include: { food: true } } },
    });
  }

  return await prisma.savedMeal.update({
    where: { id },
    data: { name: input.name ?? existing.name, description: input.description ?? existing.description },
    include: { items: { include: { food: true } } },
  });
}

async function remove(id) {
  return await prisma.savedMeal.delete({ where: { id } });
}

async function logToTracker(savedMealId, date, mealType) {
  const savedMeal = await prisma.savedMeal.findUnique({
    where: { id: savedMealId },
    include: { items: { include: { food: true } } },
  });
  if (!savedMeal) throw new Error('Saved meal not found');

  const logs = [];
  for (const item of savedMeal.items) {
    const log = await prisma.mealLog.create({
      data: {
        date, mealType, foodId: item.foodId,
        servings: item.weightGrams / item.food.servingWeight,
        weightGrams: item.weightGrams,
        calories: item.calories, protein: item.protein,
        carbohydrates: item.carbs, fat: item.fat, fiber: item.fiber,
      },
      include: { food: true },
    });
    logs.push(log);
  }

  return { message: `Successfully logged "${savedMeal.name}" to tracker`, count: logs.length, logs };
}

module.exports = { getAll, getById, create, update, remove, logToTracker };
