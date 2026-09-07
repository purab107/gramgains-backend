import { prisma } from '../../config/db';
import { ProfileService } from '../profile/profile.service';

export class DashboardService {
  static async getSummary(date: string) {
    const profile = await ProfileService.getProfile();

    const logs = await prisma.mealLog.findMany({
      where: { date },
      include: { food: true },
    });

    let consumedCalories = 0;
    let consumedProtein = 0;
    let consumedCarbs = 0;
    let consumedFat = 0;
    let consumedFiber = 0;

    for (const log of logs) {
      consumedCalories += log.calories;
      consumedProtein += log.protein;
      consumedCarbs += log.carbohydrates;
      consumedFat += log.fat;
      consumedFiber += log.fiber;
    }

    consumedCalories = Math.round(consumedCalories * 10) / 10;
    consumedProtein = Math.round(consumedProtein * 10) / 10;
    consumedCarbs = Math.round(consumedCarbs * 10) / 10;
    consumedFat = Math.round(consumedFat * 10) / 10;
    consumedFiber = Math.round(consumedFiber * 10) / 10;

    const caloriesRemaining = Math.max(0, Math.round((profile.targetCalories - consumedCalories) * 10) / 10);
    const caloriesDonePercentage = profile.targetCalories > 0
      ? Math.min(100, Math.round((consumedCalories / profile.targetCalories) * 100))
      : 0;

    return {
      date,
      calories: {
        target: profile.targetCalories,
        consumed: consumedCalories,
        remaining: caloriesRemaining,
        percentageDone: caloriesDonePercentage,
      },
      macros: {
        protein: { consumed: consumedProtein, target: profile.targetProtein, unit: 'g' },
        carbohydrates: { consumed: consumedCarbs, target: profile.targetCarbs, unit: 'g' },
        fat: { consumed: consumedFat, target: profile.targetFat, unit: 'g' },
        fiber: { consumed: consumedFiber, target: profile.targetFiber, unit: 'g' },
      },
      totalMealsLogged: logs.length,
    };
  }

  static async getHeatmap(daysCount: number = 90) {
    const profile = await ProfileService.getProfile();
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - (daysCount - 1));

    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch all logs from startDateStr onwards
    const logs = await prisma.mealLog.findMany({
      where: {
        date: { gte: startDateStr },
      },
      select: {
        date: true,
        calories: true,
      },
    });

    // Map logs by date
    const dateMap = new Map<string, { count: number; totalCalories: number }>();
    for (const log of logs) {
      const existing = dateMap.get(log.date) || { count: 0, totalCalories: 0 };
      existing.count += 1;
      existing.totalCalories += log.calories;
      dateMap.set(log.date, existing);
    }

    // Build continuous array for the heatmap grid
    const heatmap = [];
    const curr = new Date(startDate);

    while (curr <= today) {
      const dateStr = curr.toISOString().split('T')[0];
      const entry = dateMap.get(dateStr) || { count: 0, totalCalories: 0 };

      // Calculate intensity level (0 to 4)
      let level = 0;
      if (entry.count > 0) {
        const ratio = entry.totalCalories / profile.targetCalories;
        if (ratio >= 0.9) level = 4;
        else if (ratio >= 0.6) level = 3;
        else if (ratio >= 0.3) level = 2;
        else level = 1;
      }

      heatmap.push({
        date: dateStr,
        count: entry.count,
        totalCalories: Math.round(entry.totalCalories),
        level,
      });

      curr.setDate(curr.getDate() + 1);
    }

    return {
      daysCount,
      targetCalories: profile.targetCalories,
      heatmap,
    };
  }
}
