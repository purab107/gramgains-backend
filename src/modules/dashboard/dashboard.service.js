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

// Helper to get YYYY-MM-DD date string in Indian Standard Time (Asia/Kolkata)
function getISTDateString(d = new Date()) {
  const dateObj = new Date(d);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(dateObj);
}

// Helper to add N days to a YYYY-MM-DD date string
function addDaysIST(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  dateObj.setUTCDate(dateObj.getUTCDate() + days);
  return dateObj.toISOString().split('T')[0];
}

// Helper to calculate days between two YYYY-MM-DD date strings (inclusive)
function getDaysBetweenIST(startDateStr, endDateStr) {
  const [sY, sM, sD] = startDateStr.split('-').map(Number);
  const [eY, eM, eD] = endDateStr.split('-').map(Number);
  const startObj = new Date(Date.UTC(sY, sM - 1, sD));
  const endObj = new Date(Date.UTC(eY, eM - 1, eD));
  const diffTime = endObj.getTime() - startObj.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

async function getHeatmap(daysCount = 90, userId = DEFAULT_USER_ID) {
  const profile = await getProfile(userId);

  // Today in IST
  const todayISTStr = getISTDateString(new Date());

  // Account creation date in IST
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  const accountCreatedISTStr = userRow?.createdAt
    ? getISTDateString(userRow.createdAt)
    : todayISTStr;

  // Account age in days (inclusive, e.g. created today -> 1 day)
  const accountAgeDays = Math.max(1, getDaysBetweenIST(accountCreatedISTStr, todayISTStr));

  // Determine starting date for Pill 1:
  // If accountAgeDays <= daysCount: Pill 1 starts on accountCreatedISTStr
  // If accountAgeDays > daysCount: Pill 1 starts on todayISTStr - (daysCount - 1)
  let startDateStr;
  if (accountAgeDays <= daysCount) {
    startDateStr = accountCreatedISTStr;
  } else {
    startDateStr = addDaysIST(todayISTStr, -(daysCount - 1));
  }

  // Query logs from startDateStr up to todayISTStr
  const [sY, sM, sD] = startDateStr.split('-').map(Number);
  const [tY, tM, tD] = todayISTStr.split('-').map(Number);
  const queryStartDate = new Date(Date.UTC(sY, sM - 1, sD, 0, 0, 0, 0));
  const queryEndDate = new Date(Date.UTC(tY, tM - 1, tD, 23, 59, 59, 999));

  const logs = await prisma.mealLog.findMany({
    where: {
      userId,
      date: {
        gte: queryStartDate,
        lte: queryEndDate,
      },
    },
    select: { date: true, calories: true },
  });

  const dateMap = new Map();
  for (const log of logs) {
    const dStr = getISTDateString(log.date);
    const entry = dateMap.get(dStr) || { count: 0, totalCalories: 0 };
    entry.count += 1;
    entry.totalCalories += log.calories;
    dateMap.set(dStr, entry);
  }

  // Build exactly daysCount pills
  const heatmap = [];
  for (let i = 0; i < daysCount; i++) {
    const currDateStr = addDaysIST(startDateStr, i);
    const isFuture = currDateStr > todayISTStr;

    if (isFuture) {
      heatmap.push({
        date: currDateStr,
        count: 0,
        totalCalories: 0,
        level: 0,
        isFuture: true,
      });
    } else {
      const entry = dateMap.get(currDateStr) || { count: 0, totalCalories: 0 };
      const ratio = profile.targetCalories > 0 ? entry.totalCalories / profile.targetCalories : 0;
      let level = 0;
      if (entry.count > 0) {
        if (ratio >= 0.9) level = 4;
        else if (ratio >= 0.6) level = 3;
        else if (ratio >= 0.3) level = 2;
        else level = 1;
      }
      heatmap.push({
        date: currDateStr,
        count: entry.count,
        totalCalories: Math.round(entry.totalCalories),
        level,
        isFuture: false,
      });
    }
  }

  return {
    daysCount,
    targetCalories: profile.targetCalories,
    accountCreatedAt: accountCreatedISTStr,
    accountAgeDays,
    heatmap,
  };
}

module.exports = { getSummary, getHeatmap };
