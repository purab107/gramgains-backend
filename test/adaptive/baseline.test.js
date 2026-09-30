const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../../src/config/db');
const { getAdaptiveStatus, getCheckIn, applyCheckIn } = require('../../src/modules/adaptive/adaptive.service');
const { logWeight } = require('../../src/modules/tracker/tracker.service');

const BASELINE_TEST_USER_ID = 'test-baseline-adaptive-user';

describe('Phase 0: Adaptive System Baseline API Contract Tests', () => {
  before(async () => {
    // Clean up any stale records from previous runs
    await prisma.weightLog.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: BASELINE_TEST_USER_ID } });

    // Seed baseline user with defined profile
    await prisma.user.create({
      data: {
        id: BASELINE_TEST_USER_ID,
        name: 'Baseline Athlete',
        email: 'baseline-test@gramgains.app',
        profile: {
          create: {
            age: 28,
            gender: 'MALE',
            heightCm: 180,
            activityLevel: 'MODERATE',
            goal: 'WEIGHT_LOSS',
            targetRateKgPerWeek: -0.5,
            bmr: 1750,
            tdee: 2400,
            targetCalories: 1850,
            targetProtein: 160,
            targetCarbs: 180,
            targetFat: 55,
            targetFiber: 30,
            checkInDayOfWeek: new Date().getDay(),
          },
        },
      },
    });

    // Ensure test food exists for meal logs
    let testFood = await prisma.food.findFirst();
    if (!testFood) {
      testFood = await prisma.food.create({
        data: {
          name: 'Baseline Test Food',
          source: 'CUSTOM',
          calories: 100,
          protein: 10,
          carbohydrates: 10,
          fat: 2,
          fiber: 2,
          servingWeightGrams: 100,
        },
      });
    }

    // Seed 10 days of weight logs (steady -0.1 kg/day loss)
    const today = new Date();
    for (let i = 10; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      await logWeight(
        {
          date: dateStr,
          weightKg: 82.0 - (10 - i) * 0.1,
        },
        BASELINE_TEST_USER_ID
      );
    }

    // Seed 10 days of meal logs (average 1900 kcal/day)
    for (let i = 10; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      await prisma.mealLog.create({
        data: {
          userId: BASELINE_TEST_USER_ID,
          mealType: 'LUNCH',
          foodId: testFood.id,
          weightGrams: 500,
          servings: 1,
          date: d,
          calories: 1900,
          protein: 150,
          carbohydrates: 180,
          fat: 60,
          fiber: 25,
        },
      });
    }
  });

  after(async () => {
    // Teardown
    await prisma.weightLog.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: BASELINE_TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: BASELINE_TEST_USER_ID } });
    await prisma.$disconnect();
  });

  it('1. getAdaptiveStatus returns full contract structure and writes snapshot', async () => {
    const status = await getAdaptiveStatus(BASELINE_TEST_USER_ID);

    // Verify top-level structure
    assert.equal(typeof status.isAdaptiveEnabled, 'boolean');
    assert.ok(status.confidence, 'confidence missing');
    assert.ok(status.expenditure, 'expenditure missing');
    assert.ok(status.weightTrend, 'weightTrend missing');
    assert.ok(status.targets, 'targets missing');

    // Verify confidence contract
    assert.ok(['INSUFFICIENT', 'CALIBRATING', 'MODERATE', 'HIGH'].includes(status.confidence.level));
    assert.equal(typeof status.confidence.score, 'number');
    assert.equal(typeof status.confidence.validFoodDays, 'number');
    assert.equal(typeof status.confidence.validWeightDays, 'number');
    assert.equal(status.confidence.evaluationWindowDays, 28);
    assert.equal(typeof status.confidence.message, 'string');

    // Verify expenditure contract
    assert.equal(typeof status.expenditure.formulaBaselineTdee, 'number');
    assert.equal(typeof status.expenditure.effectiveTdee, 'number');
    assert.equal(typeof status.expenditure.dailyEnergySurplusKcal, 'number');
    assert.equal(status.expenditure.unit, 'kcal');

    // Verify weight trend contract
    assert.equal(typeof status.weightTrend.latestRawKg, 'number');
    assert.equal(typeof status.weightTrend.latestTrendKg, 'number');
    assert.equal(typeof status.weightTrend.velocityKgPerDay, 'number');
    assert.equal(typeof status.weightTrend.velocityKgPerWeek, 'number');
    assert.equal(status.weightTrend.targetVelocityKgPerWeek, -0.5);

    // Verify targets contract
    assert.equal(typeof status.targets.currentCalories, 'number');
    assert.equal(typeof status.targets.recommendedCalories, 'number');
    assert.equal(typeof status.targets.adjustmentKcal, 'number');
    assert.equal(typeof status.targets.isBelowSafetyFloor, 'boolean');
    assert.equal(typeof status.targets.safetyFloorKcal, 'number');
    assert.equal(typeof status.targets.isAggressiveRate, 'boolean');
    assert.equal(typeof status.targets.recommendedMacros.proteinGrams, 'number');
    assert.equal(typeof status.targets.recommendedMacros.carbsGrams, 'number');
    assert.equal(typeof status.targets.recommendedMacros.fatGrams, 'number');
    assert.equal(typeof status.targets.recommendedMacros.fiberGrams, 'number');
    assert.equal(typeof status.targets.isCheckInAvailable, 'boolean');

    // Verify MetabolicSnapshot was created for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const snapshot = await prisma.metabolicSnapshot.findUnique({
      where: {
        userId_date: {
          userId: BASELINE_TEST_USER_ID,
          date: today,
        },
      },
    });
    assert.ok(snapshot, 'Metabolic snapshot should be persisted');
    assert.equal(snapshot.confidenceLevel, status.confidence.level);
    assert.equal(snapshot.effectiveTdee, status.expenditure.effectiveTdee);
  });

  it('2. getCheckIn returns pending proposal and reuses existing pending record', async () => {
    // First invocation generates check-in proposal
    const checkIn1 = await getCheckIn(BASELINE_TEST_USER_ID);
    assert.ok(checkIn1.id);
    assert.equal(checkIn1.status, 'PENDING');
    assert.equal(typeof checkIn1.suggestedCalories, 'number');
    assert.ok(checkIn1.suggestedCalories > 0);
    assert.equal(typeof checkIn1.adherenceScore, 'number');
    assert.equal(typeof checkIn1.headline, 'string');
    assert.equal(typeof checkIn1.rationaleText, 'string');

    // Second invocation returns the SAME pending check-in (pending idempotency)
    const checkIn2 = await getCheckIn(BASELINE_TEST_USER_ID);
    assert.equal(checkIn2.id, checkIn1.id, 'Should reuse existing pending check-in');
  });

  it('3. applyCheckIn ACCEPT updates profile targets and check-in status (documents GoalHistory gap)', async () => {
    const pendingCheckIn = await getCheckIn(BASELINE_TEST_USER_ID);

    const result = await applyCheckIn(
      {
        checkInId: pendingCheckIn.id,
        action: 'ACCEPT',
      },
      BASELINE_TEST_USER_ID
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'ACCEPT');
    assert.equal(result.profile.targetCalories, pendingCheckIn.suggestedCalories);

    // Verify check-in record in DB
    const updatedCheckIn = await prisma.adaptiveCheckIn.findUnique({
      where: { id: pendingCheckIn.id },
    });
    assert.equal(updatedCheckIn.status, 'ACCEPTED');
    assert.ok(updatedCheckIn.appliedAt instanceof Date);

    // Phase 8 GoalHistory Assertion: GoalHistory is now recorded on applyCheckIn
    const historyCount = await prisma.goalHistory.count({
      where: { userId: BASELINE_TEST_USER_ID },
    });
    assert.equal(historyCount, 1, 'Phase 8: GoalHistory should record the accepted recommendation');
  });

  it('4. getCheckIn returns existing check-in for the period instead of generating duplicate (closes Gap 1)', async () => {
    // Gap 1 resolved in Phase 4: getCheckIn is now idempotent and reuses existing record for the period
    const existingCheckIn = await getCheckIn(BASELINE_TEST_USER_ID);
    assert.ok(existingCheckIn.id);
    assert.equal(existingCheckIn.status, 'ACCEPTED');
  });

  it('5. applyCheckIn ADJUST applies custom calorie override and recalculates macros', async () => {
    const checkIn = await getCheckIn(BASELINE_TEST_USER_ID, { forceGenerate: true });
    const customKcal = 2050;

    const result = await applyCheckIn(
      {
        checkInId: checkIn.id,
        action: 'ADJUST',
        customCalories: customKcal,
      },
      BASELINE_TEST_USER_ID
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'ADJUST');
    assert.equal(result.profile.targetCalories, customKcal);

    const dbRecord = await prisma.adaptiveCheckIn.findUnique({
      where: { id: checkIn.id },
    });
    assert.equal(dbRecord.status, 'ADJUSTED');
  });

  it('6. applyCheckIn DISMISS marks check-in as DISMISSED without altering profile targets', async () => {
    const profileBefore = await prisma.userProfile.findUnique({
      where: { userId: BASELINE_TEST_USER_ID },
    });

    const checkIn = await getCheckIn(BASELINE_TEST_USER_ID, { forceGenerate: true });

    const result = await applyCheckIn(
      {
        checkInId: checkIn.id,
        action: 'DISMISS',
      },
      BASELINE_TEST_USER_ID
    );

    assert.equal(result.status, 'DISMISSED');

    const profileAfter = await prisma.userProfile.findUnique({
      where: { userId: BASELINE_TEST_USER_ID },
    });

    assert.equal(profileAfter.targetCalories, profileBefore.targetCalories);
    assert.equal(profileAfter.targetProtein, profileBefore.targetProtein);
  });
});
