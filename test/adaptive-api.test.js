const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../src/config/db');
const { getAdaptiveStatus, getCheckIn, applyCheckIn } = require('../src/modules/adaptive/adaptive.service');
const { getOverview, getTrends, getPatterns } = require('../src/modules/analytics/analytics.service');
const { logWeight, getWeightLogs, toggleWeightExclusion, deleteWeightLog } = require('../src/modules/tracker/tracker.service');
const { ensureDefaultUser } = require('../src/modules/profile/profile.service');

const TEST_USER_ID = 'test-adaptive-athlete';

describe('Adaptive Metabolic & Analytics End-to-End Test', () => {
  before(async () => {
    // Ensure test user exists
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: {
        id: TEST_USER_ID,
        name: 'Test Athlete',
        email: 'test-adaptive@gramgains.app',
        profile: {
          create: {
            age: 26,
            gender: 'MALE',
            heightCm: 178,
            activityLevel: 'MODERATE',
            goal: 'WEIGHT_LOSS',
            targetRateKgPerWeek: -0.5,
            bmr: 1700,
            tdee: 2350,
            targetCalories: 1800,
            targetProtein: 150,
            targetCarbs: 180,
            targetFat: 53,
            targetFiber: 25,
          },
        },
      },
    });

    // Clean previous logs for test user
    await prisma.weightLog.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: TEST_USER_ID } });
  });

  after(async () => {
    // Cleanup
    await prisma.weightLog.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  it('logs weight and computes smoothed trend', async () => {
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 3);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 2);
    const d3 = new Date(today);
    d3.setDate(d3.getDate() - 1);

    await logWeight({ date: d1.toISOString().split('T')[0], weightKg: 80.0 }, TEST_USER_ID);
    await logWeight({ date: d2.toISOString().split('T')[0], weightKg: 79.8 }, TEST_USER_ID);
    await logWeight({ date: d3.toISOString().split('T')[0], weightKg: 79.6 }, TEST_USER_ID);

    const history = await getWeightLogs(30, TEST_USER_ID);
    assert.equal(history.logs.length, 3);
    assert.equal(history.latestRawKg, 79.6);
    assert.ok(history.latestTrendKg <= 80.0 && history.latestTrendKg >= 79.5);
  });

  it('returns valid adaptive status with confidence metrics', async () => {
    const status = await getAdaptiveStatus(TEST_USER_ID);
    assert.ok(status.confidence !== undefined);
    assert.ok(status.expenditure !== undefined);
    assert.ok(status.weightTrend !== undefined);
    assert.ok(status.targets !== undefined);
    assert.equal(typeof status.targets.recommendedCalories, 'number');
  });

  it('generates a weekly check-in proposal and applies recommendation', async () => {
    const checkIn = await getCheckIn(TEST_USER_ID);
    assert.ok(checkIn.id);
    assert.equal(checkIn.status, 'PENDING');
    assert.ok(checkIn.suggestedCalories > 0);

    const applyResult = await applyCheckIn({
      checkInId: checkIn.id,
      action: 'ACCEPT',
    }, TEST_USER_ID);

    assert.equal(applyResult.success, true);
    assert.equal(applyResult.action, 'ACCEPT');
    assert.equal(applyResult.profile.targetCalories, checkIn.suggestedCalories);
  });

  it('computes user analytics overview, trends, and patterns', async () => {
    const overview = await getOverview(30, TEST_USER_ID);
    assert.ok(overview.adherence !== undefined);
    assert.ok(overview.energyBalance !== undefined);

    const trends = await getTrends(30, TEST_USER_ID);
    assert.ok(Array.isArray(trends.series));

    const patterns = await getPatterns(14, TEST_USER_ID);
    assert.ok(patterns.mealDistribution !== undefined);
    assert.ok(Array.isArray(patterns.activeInsights));
  });
});
