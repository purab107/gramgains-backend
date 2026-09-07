const { prisma } = require('../../config/db');
const { getProfile } = require('../profile/profile.service');

async function getSummary(date) {
  const profile = await getProfile();

  const logs = await prisma.mealLog.findMany({
    where: { date },
    include: { food: true },
  });

  let consumedCalories = 0, consumedProtein = 0, consumedCarbs = 0, consumedFat = 0, consumedFiber = 0;

  for (const log of logs) {
    consumedCalories += log.calories;
    consumedProtein += log.protein;
    consumedCarbs += log.carbohydrates;
    consumedFat += log.fat;
    consumedFiber += log.fiber;
  }

  const r = (n) => Math.round(n * 10) / 10;

  return {
    date,
    calories: {
      target: profile.targetCalories,
      consumed: r(consumedCalories),
      remaining: Math.max(0, r(profile.targetCalories - consumedCalories)),
      percentageDone: profile.targetCalories > 0
        ? Math.min(100, Math.round((consumedCalories / profile.targetCalories) * 100))
        : 0,
    },
    macros: {
      protein:       { consumed: r(consumedProtein), target: profile.targetProtein,  unit: 'g' },
      carbohydrates: { consumed: r(consumedCarbs),   target: profile.targetCarbs,    unit: 'g' },
      fat:           { consumed: r(consumedFat),     target: profile.targetFat,      unit: 'g' },
      fiber:         { consumed: r(consumedFiber),   target: profile.targetFiber,    unit: 'g' },
    },
    totalMealsLogged: logs.length,
  };
}

async function getHeatmap(daysCount = 90) {
  const profile = await getProfile();
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(today.getDate() - (daysCount - 1));
  const startDateStr = startDate.toISOString().split('T')[0];

  const logs = await prisma.mealLog.findMany({
    where: { date: { gte: startDateStr } },
    select: { date: true, calories: true },
  });

  const dateMap = new Map();
  for (const log of logs) {
    const entry = dateMap.get(log.date) || { count: 0, totalCalories: 0 };
    entry.count += 1;
    entry.totalCalories += log.calories;
    dateMap.set(log.date, entry);
  }

  const heatmap = [];
  const curr = new Date(startDate);
  while (curr <= today) {
    const dateStr = curr.toISOString().split('T')[0];
    const entry = dateMap.get(dateStr) || { count: 0, totalCalories: 0 };
    const ratio = entry.totalCalories / profile.targetCalories;
    let level = 0;
    if (entry.count > 0) {
      if (ratio >= 0.9) level = 4;
      else if (ratio >= 0.6) level = 3;
      else if (ratio >= 0.3) level = 2;
      else level = 1;
    }
    heatmap.push({ date: dateStr, count: entry.count, totalCalories: Math.round(entry.totalCalories), level });
    curr.setDate(curr.getDate() + 1);
  }

  return { daysCount, targetCalories: profile.targetCalories, heatmap };
}

module.exports = { getSummary, getHeatmap };
