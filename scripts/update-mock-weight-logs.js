/**
 * scripts/update-mock-weight-logs.js
 *
 * Updates weight logs for mock user 'purabtest@email.com':
 * - Starts at 60kg, followed by 60.4, 60.8, 61.0, 59.8, etc.
 * - Recalculates smoothed trend weights using Holt's Linear Exponential Smoothing.
 * - Syncs matching MetabolicSnapshots so all analytics stay consistent.
 */

const { prisma } = require('../src/config/db');
const { syncWeightTrends } = require('../src/modules/tracker/tracker.service');

const TARGET_EMAIL = 'purabtest@email.com';

const WEIGHT_SEQUENCE = [
  60.0, // Day 1:  2026-10-11
  60.4, // Day 2:  2026-10-12
  60.8, // Day 3:  2026-10-13
  61.0, // Day 4:  2026-10-14
  59.8, // Day 5:  2026-10-15
  60.1, // Day 6:  2026-10-16
  60.3, // Day 7:  2026-10-17
  60.0, // Day 8:  2026-10-18
  60.5, // Day 9:  2026-10-19
  60.7, // Day 10: 2026-10-20
  60.4, // Day 11: 2026-10-21
  60.6, // Day 12: 2026-10-22
  60.9, // Day 13: 2026-10-23
  60.7, // Day 14: 2026-10-24
  61.1, // Day 15: 2026-10-25
  60.8, // Day 16: 2026-10-26
  61.0, // Day 17: 2026-10-29
  60.6, // Day 18: 2026-10-30
  60.9, // Day 19: 2026-10-31
  61.2, // Day 20: 2026-11-01
  61.0, // Day 21: 2026-11-02
  60.7, // Day 22: 2026-11-03
  61.1, // Day 23: 2026-11-04
  61.3, // Day 24: 2026-11-05
  60.9, // Day 25: 2026-11-07
  61.2, // Day 26: 2026-11-08
  61.4, // Day 27: 2026-11-09
  61.1, // Day 28: 2026-11-11
  61.3, // Day 29: 2026-11-14
  61.5, // Day 30: 2026-11-15
  61.2, // Day 31: 2026-11-16
  61.4, // Day 32: 2026-11-18
  61.6, // Day 33: 2026-11-20
  61.3, // Day 34: 2026-11-21
];

async function updateMockWeightLogs() {
  console.log('====================================================');
  console.log(`🚀 Updating Weight Logs for: ${TARGET_EMAIL}`);
  console.log('====================================================\n');

  // 1. Find user
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
  });

  if (!user) {
    throw new Error(`User with email "${TARGET_EMAIL}" not found.`);
  }

  // 2. Fetch existing weight logs in chronological order
  const logs = await prisma.weightLog.findMany({
    where: { userId: user.id },
    orderBy: { date: 'asc' },
  });

  console.log(`Found ${logs.length} weight logs for user ${user.id}.`);

  if (logs.length !== WEIGHT_SEQUENCE.length) {
    console.warn(`⚠️ Warning: Expected ${WEIGHT_SEQUENCE.length} logs, found ${logs.length}.`);
  }

  // 3. Update raw weightKg for each log
  console.log('Updating raw weight values...');
  const updatedLogs = [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const newWeight = WEIGHT_SEQUENCE[i] !== undefined
      ? WEIGHT_SEQUENCE[i]
      : (WEIGHT_SEQUENCE[WEIGHT_SEQUENCE.length - 1] + (i % 2 === 0 ? 0.2 : -0.2));

    const updated = await prisma.weightLog.update({
      where: { id: log.id },
      data: { weightKg: newWeight },
    });

    const dateStr = updated.date.toISOString().split('T')[0];
    updatedLogs.push({ id: updated.id, date: dateStr, weightKg: updated.weightKg });
    console.log(`  [Day ${i + 1}] ${dateStr}: ${log.weightKg} kg -> ${newWeight} kg`);
  }

  // 4. Recalculate trend weights via Holt's Exponential Smoothing
  console.log('\n🔄 Recalculating trend weights using syncWeightTrends...');
  await syncWeightTrends(user.id);

  // 5. Fetch updated logs with trend weights to display and to update snapshots
  const refreshedLogs = await prisma.weightLog.findMany({
    where: { userId: user.id },
    orderBy: { date: 'asc' },
  });

  const weightByDateMap = new Map();
  for (const log of refreshedLogs) {
    const dateStr = log.date.toISOString().split('T')[0];
    weightByDateMap.set(dateStr, { raw: log.weightKg, trend: log.trendWeightKg });
  }

  // 6. Update MetabolicSnapshots to match
  console.log('\n🔄 Updating corresponding MetabolicSnapshots...');
  const snapshots = await prisma.metabolicSnapshot.findMany({
    where: { userId: user.id },
  });

  let snapshotsUpdated = 0;
  for (const snap of snapshots) {
    const dateStr = snap.date.toISOString().split('T')[0];
    const match = weightByDateMap.get(dateStr);
    if (match) {
      await prisma.metabolicSnapshot.update({
        where: { id: snap.id },
        data: {
          rawWeightKg: match.raw,
          trendWeightKg: match.trend,
        },
      });
      snapshotsUpdated++;
    }
  }
  console.log(`  ✓ Updated ${snapshotsUpdated} MetabolicSnapshot entries.`);

  console.log('\n====================================================');
  console.log('🎉 WEIGHT LOGS UPDATED SUCCESSFULLY!');
  console.log('====================================================');
  console.log('Summary of first 7 days:');
  refreshedLogs.slice(0, 7).forEach((l, idx) => {
    console.log(`  Day ${idx + 1} (${l.date.toISOString().split('T')[0]}): Raw = ${l.weightKg} kg, Trend = ${l.trendWeightKg} kg`);
  });
  console.log('...');
  console.log('Summary of last 5 days:');
  refreshedLogs.slice(-5).forEach((l, idx) => {
    console.log(`  Day ${refreshedLogs.length - 5 + idx + 1} (${l.date.toISOString().split('T')[0]}): Raw = ${l.weightKg} kg, Trend = ${l.trendWeightKg} kg`);
  });
  console.log('====================================================');
}

updateMockWeightLogs()
  .catch((err) => {
    console.error('❌ Error updating weight logs:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
