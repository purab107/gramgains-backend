const { prisma } = require('../../config/db');
const { getProfile, DEFAULT_USER_ID } = require('../profile/profile.service');
const { parseDateInput, formatDateOutput } = require('../tracker/tracker.service');

async function getSummary(date, userId = DEFAULT_USER_ID) {
  const profile = await getProfile(userId);
  const parsedDate = parseDateInput(date);
  const dateStr = formatDateOutput(parsedDate);

  const logs = await prisma.mealLog.findMany({
    where: {
      userId,
      date: parsedDate,
    },
    include: { food: true },
  });

  let consumedCalories = 0, consumedProtein = 0, consumedCarbs = 0, consumedFat = 0, consumedFiber = 0;

  for (const log of logs) {
    consumedCalories += log.calories || 0;
    consumedProtein += log.protein || 0;
    consumedCarbs += log.carbohydrates || 0;
    consumedFat += log.fat || 0;
    consumedFiber += log.fiber || 0;
  }

  const r = (n) => Math.round(n * 10) / 10;

  return {
    date: dateStr,
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

async function getHeatmap(daysCount = 90, userId = DEFAULT_USER_ID) {
  const profile = await getProfile(userId);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const startDate = new Date();
  startDate.setDate(today.getDate() - (daysCount - 1));
  startDate.setHours(0, 0, 0, 0);

  const logs = await prisma.mealLog.findMany({
    where: {
      userId,
      date: {
        gte: startDate,
        lte: today,
      },
    },
    select: { date: true, calories: true },
  });

  const dateMap = new Map();
  for (const log of logs) {
    const dStr = formatDateOutput(log.date);
    const entry = dateMap.get(dStr) || { count: 0, totalCalories: 0 };
    entry.count += 1;
    entry.totalCalories += log.calories;
    dateMap.set(dStr, entry);
  }

  const heatmap = [];
  const curr = new Date(startDate);
  const endIter = new Date(today);
  endIter.setHours(0, 0, 0, 0);

  while (curr <= endIter) {
    const dateStr = formatDateOutput(curr);
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
