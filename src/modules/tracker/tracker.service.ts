import { prisma } from '../../config/db';

interface MacroSummary {
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
}

export class TrackerService {
  static async getDailyLogs(date: string) {
    const logs = await prisma.mealLog.findMany({
      where: { date },
      include: { food: true },
      orderBy: { createdAt: 'asc' },
    });

    const summary: MacroSummary = (logs as any[]).reduce(
      (acc: MacroSummary, log: any) => {
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

  static async logMeal(data: {
    date: string;
    mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
    foodId: string;
    servings?: number;
    customWeightGrams?: number;
  }) {
    const food = await prisma.food.findUnique({
      where: { id: data.foodId },
    });

    if (!food) {
      throw new Error('Food item not found');
    }

    const servings = data.servings || 1;
    const computedWeight = data.customWeightGrams
      ? data.customWeightGrams
      : food.servingWeight * servings;

    const multiplier = computedWeight / food.servingWeight;

    const calories = Math.round(food.calories * multiplier * 10) / 10;
    const protein = Math.round(food.protein * multiplier * 10) / 10;
    const carbohydrates = Math.round(food.carbohydrates * multiplier * 10) / 10;
    const fat = Math.round(food.fat * multiplier * 10) / 10;
    const fiber = Math.round(food.fiber * multiplier * 10) / 10;

    return await prisma.mealLog.create({
      data: {
        date: data.date,
        mealType: data.mealType,
        foodId: data.foodId,
        servings,
        weightGrams: computedWeight,
        calories,
        protein,
        carbohydrates,
        fat,
        fiber,
      },
      include: { food: true },
    });
  }

  static async updateLog(id: string, data: {
    servings?: number;
    customWeightGrams?: number;
    mealType?: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
  }) {
    const existing = await prisma.mealLog.findUnique({
      where: { id },
      include: { food: true },
    });

    if (!existing) throw new Error('Meal log not found');

    const food = existing.food;
    const servings = data.servings || existing.servings;
    const computedWeight = data.customWeightGrams
      ? data.customWeightGrams
      : food.servingWeight * servings;

    const multiplier = computedWeight / food.servingWeight;

    return await prisma.mealLog.update({
      where: { id },
      data: {
        mealType: data.mealType ?? existing.mealType,
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

  static async deleteLog(id: string) {
    return await prisma.mealLog.delete({
      where: { id },
    });
  }
}
