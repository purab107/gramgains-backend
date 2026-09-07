import { prisma } from '../../config/db';

export interface CreateSavedMealItemInput {
  foodId: string;
  weightGrams: number;
}

export interface CreateSavedMealInput {
  name: string;
  description?: string;
  items: CreateSavedMealItemInput[];
}

export class SavedMealsService {
  static async getAll() {
    return await prisma.savedMeal.findMany({
      include: {
        items: {
          include: { food: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getById(id: string) {
    return await prisma.savedMeal.findUnique({
      where: { id },
      include: {
        items: {
          include: { food: true },
        },
      },
    });
  }

  static async create(input: CreateSavedMealInput) {
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalFiber = 0;

    const itemsToCreate = [];

    for (const item of input.items) {
      const food = await prisma.food.findUnique({ where: { id: item.foodId } });
      if (!food) {
        throw new Error(`Food with ID ${item.foodId} not found`);
      }

      const multiplier = item.weightGrams / food.servingWeight;
      const calories = Math.round(food.calories * multiplier * 10) / 10;
      const protein = Math.round(food.protein * multiplier * 10) / 10;
      const carbs = Math.round(food.carbohydrates * multiplier * 10) / 10;
      const fat = Math.round(food.fat * multiplier * 10) / 10;
      const fiber = Math.round(food.fiber * multiplier * 10) / 10;

      totalCalories += calories;
      totalProtein += protein;
      totalCarbs += carbs;
      totalFat += fat;
      totalFiber += fiber;

      itemsToCreate.push({
        foodId: item.foodId,
        weightGrams: item.weightGrams,
        calories,
        protein,
        carbs,
        fat,
        fiber,
      });
    }

    return await prisma.savedMeal.create({
      data: {
        name: input.name,
        description: input.description,
        totalCalories: Math.round(totalCalories * 10) / 10,
        totalProtein: Math.round(totalProtein * 10) / 10,
        totalCarbs: Math.round(totalCarbs * 10) / 10,
        totalFat: Math.round(totalFat * 10) / 10,
        totalFiber: Math.round(totalFiber * 10) / 10,
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        items: {
          include: { food: true },
        },
      },
    });
  }

  static async update(id: string, input: Partial<CreateSavedMealInput>) {
    const existing = await prisma.savedMeal.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Saved meal not found');
    }

    // If items are provided, delete existing items and rebuild
    if (input.items && input.items.length > 0) {
      await prisma.savedMealItem.deleteMany({ where: { savedMealId: id } });

      let totalCalories = 0;
      let totalProtein = 0;
      let totalCarbs = 0;
      let totalFat = 0;
      let totalFiber = 0;

      const itemsToCreate = [];

      for (const item of input.items) {
        const food = await prisma.food.findUnique({ where: { id: item.foodId } });
        if (!food) throw new Error(`Food with ID ${item.foodId} not found`);

        const multiplier = item.weightGrams / food.servingWeight;
        const calories = Math.round(food.calories * multiplier * 10) / 10;
        const protein = Math.round(food.protein * multiplier * 10) / 10;
        const carbs = Math.round(food.carbohydrates * multiplier * 10) / 10;
        const fat = Math.round(food.fat * multiplier * 10) / 10;
        const fiber = Math.round(food.fiber * multiplier * 10) / 10;

        totalCalories += calories;
        totalProtein += protein;
        totalCarbs += carbs;
        totalFat += fat;
        totalFiber += fiber;

        itemsToCreate.push({
          foodId: item.foodId,
          weightGrams: item.weightGrams,
          calories,
          protein,
          carbs,
          fat,
          fiber,
        });
      }

      return await prisma.savedMeal.update({
        where: { id },
        data: {
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          totalCalories: Math.round(totalCalories * 10) / 10,
          totalProtein: Math.round(totalProtein * 10) / 10,
          totalCarbs: Math.round(totalCarbs * 10) / 10,
          totalFat: Math.round(totalFat * 10) / 10,
          totalFiber: Math.round(totalFiber * 10) / 10,
          items: {
            create: itemsToCreate,
          },
        },
        include: {
          items: { include: { food: true } },
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
        items: { include: { food: true } },
      },
    });
  }

  static async delete(id: string) {
    return await prisma.savedMeal.delete({
      where: { id },
    });
  }

  static async logToTracker(savedMealId: string, date: string, mealType: string) {
    const savedMeal = await prisma.savedMeal.findUnique({
      where: { id: savedMealId },
      include: { items: { include: { food: true } } },
    });

    if (!savedMeal) {
      throw new Error('Saved meal not found');
    }

    const createdLogs = [];
    for (const item of savedMeal.items) {
      const servings = item.weightGrams / item.food.servingWeight;
      const log = await prisma.mealLog.create({
        data: {
          date,
          mealType,
          foodId: item.foodId,
          servings,
          weightGrams: item.weightGrams,
          calories: item.calories,
          protein: item.protein,
          carbohydrates: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
        },
        include: { food: true },
      });
      createdLogs.push(log);
    }

    return {
      message: `Successfully logged saved meal "${savedMeal.name}" into daily tracker`,
      count: createdLogs.length,
      logs: createdLogs,
    };
  }
}
