/**
 * Metabolic Snapshot Recalculation Utility (Improvement 23 — Phase 12)
 *
 * Re-runs the full TDEE pipeline from raw stored data without touching rawWeightKg or rawIntake fields.
 * This ensures derived fields (trendWeightKg, observedTdee, effectiveTdee, confidenceScore) can be
 * recalculated after algorithm updates while preserving data integrity of primary observations.
 *
 * Usage:
 *   node src/scripts/recalculateSnapshots.js [--userId <id>] [--days <n>]
 */

'use strict';

const { prisma } = require('../config/db');
const { calculateWeightTrend } = require('../modules/adaptive/algorithms/weightSmoothing');
const { solveObservedTdee, filterValidIntakeDays } = require('../modules/adaptive/algorithms/expenditureSolver');
const { evaluateExpenditureConfidence } = require('../modules/adaptive/algorithms/confidenceModel');
const { METABOLIC_MODEL_VERSION } = require('../config/metabolicModelVersion');

async function recalculateSnapshots({ userId = null, days = 90 } = {}) {
  const userFilter = userId ? { id: userId } : {};
  const users = await prisma.user.findMany({
    where: userFilter,
    select: { id: true },
  });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    // Fetch raw weight logs for the window
    const weightLogs = await prisma.weightLog.findMany({
      where: { userId: user.id, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    });

    // Fetch raw meal logs for the window
    const mealLogs = await prisma.mealLog.findMany({
      where: { userId: user.id, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    });

    // Fetch existing snapshots
    const snapshots = await prisma.metabolicSnapshot.findMany({
      where: { userId: user.id, date: { gte: cutoff } },
      orderBy: { date: 'asc' },
    });

    if (snapshots.length === 0) {
      skipped++;
      continue;
    }

    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) { skipped++; continue; }

    // Compute weight trend from raw logs
    const trendResult = calculateWeightTrend(
      weightLogs.map((w) => ({ date: w.date.toISOString().split('T')[0], weightKg: w.weightKg })),
    );

    // Aggregate daily intake from raw meal logs
    const intakeByDay = {};
    for (const log of mealLogs) {
      const dateStr = log.date instanceof Date ? log.date.toISOString().split('T')[0] : String(log.date).split('T')[0];
      if (!intakeByDay[dateStr]) intakeByDay[dateStr] = 0;
      intakeByDay[dateStr] += log.calories || 0;
    }
    const dailyIntakes = Object.entries(intakeByDay).map(([date, calories]) => ({ date, calories }));
    const validIntakeDays = filterValidIntakeDays(dailyIntakes);
    const avgDailyIntake = validIntakeDays.length > 0
      ? validIntakeDays.reduce((s, d) => s + d.calories, 0) / validIntakeDays.length
      : 0;

    const velocityKgPerDay = trendResult.velocityKgPerWeek ? trendResult.velocityKgPerWeek / 7 : 0;
    const observedTdee = avgDailyIntake > 0 ? solveObservedTdee({
      avgDailyIntake,
      velocityKgPerDay,
      bmr: profile.bmr,
    }) : null;

    const confidence = evaluateExpenditureConfidence({
      validFoodDays: validIntakeDays.length,
      validWeightDays: weightLogs.filter((w) => !w.isExcluded).length,
      observedTdee,
      formulaTdee: profile.tdee,
    });

    // Update each snapshot's derived fields only (preserve rawWeightKg)
    for (const snapshot of snapshots) {
      const trendOnDay = trendResult.logs?.find((l) => {
        const ls = l.date instanceof Date ? l.date.toISOString().split('T')[0] : String(l.date).split('T')[0];
        const ss = snapshot.date instanceof Date ? snapshot.date.toISOString().split('T')[0] : String(snapshot.date).split('T')[0];
        return ls === ss;
      });

      await prisma.metabolicSnapshot.update({
        where: { id: snapshot.id },
        data: {
          trendWeightKg: trendOnDay?.trendWeightKg ?? snapshot.trendWeightKg,
          observedTdee: observedTdee ?? snapshot.observedTdee,
          effectiveTdee: confidence.effectiveTdee,
          confidenceLevel: confidence.level,
          confidenceScore: confidence.score,
          metabolicModelVersion: METABOLIC_MODEL_VERSION,
          // rawWeightKg is intentionally NOT updated — raw data is immutable
        },
      });
      updated++;
    }
  }

  console.log(`[recalculateSnapshots] Done. Updated: ${updated} snapshots, Skipped: ${skipped} users.`);
  await prisma.$disconnect();
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const userIdArg = args.indexOf('--userId');
  const daysArg = args.indexOf('--days');
  const userId = userIdArg >= 0 ? args[userIdArg + 1] : null;
  const days = daysArg >= 0 ? parseInt(args[daysArg + 1], 10) : 90;
  recalculateSnapshots({ userId, days }).catch(console.error);
}

module.exports = { recalculateSnapshots };
