const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../../src/config/db');
const { getCheckIn, applyCheckIn, getAdaptiveStatus } = require('../../src/modules/adaptive/adaptive.service');
const { logWeight } = require('../../src/modules/tracker/tracker.service');

const PHASE5_USER_ID = 'test-phase5-cooldown-user';

describe('Phase 5: Adjustment Cooldown & Safety Override', () => {
  before(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE5_USER_ID } });

    // Seed test user
    await prisma.user.create({
      data: {
        id: PHASE5_USER_ID,
        name: 'Phase 5 Athlete',
        email: 'phase5-test@gramgains.app',
        profile: {
          create: {
            age: 27,
            gender: 'MALE',
            heightCm: 178,
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
            checkInDayOfWeek: new Date().getDay(), // Check-in day is today
          },
        },
      },
    });

    let testFood = await prisma.food.findFirst();
    if (!testFood) {
      testFood = await prisma.food.create({
        data: {
          name: 'Phase 5 Test Food',
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

    // Seed 22 days of consistent food and weight data to reach READY state
    const today = new Date();
    for (let i = 22; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      await logWeight(
        { date: dateStr, weightKg: 85.0 - (22 - i) * 0.12 },
        PHASE5_USER_ID
      );

      await prisma.mealLog.create({
        data: {
          userId: PHASE5_USER_ID,
          mealType: 'LUNCH',
          foodId: testFood.id,
          weightGrams: 500,
          servings: 1,
          date: d,
          calories: 1850,
          protein: 160,
          carbohydrates: 180,
          fat: 55,
          fiber: 30,
        },
      });
    }
  });

  after(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE5_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE5_USER_ID } });
    await prisma.$disconnect();
  });

  it('1. applyCheckIn ACCEPT updates lastAdjustmentAppliedAt on user profile', async () => {
    const checkIn = await getCheckIn(PHASE5_USER_ID);
    assert.ok(checkIn.id);

    const applyResult = await applyCheckIn(
      { checkInId: checkIn.id, action: 'ACCEPT' },
      PHASE5_USER_ID
    );

    assert.equal(applyResult.success, true);
    assert.ok(applyResult.profile.lastAdjustmentAppliedAt instanceof Date);

    const profile = await prisma.userProfile.findUnique({
      where: { userId: PHASE5_USER_ID },
    });
    assert.ok(profile.lastAdjustmentAppliedAt instanceof Date);
  });

  it('2. getCheckIn returns COOLDOWN_ACTIVE with 0 adjustment when within 14-day window', async () => {
    // Generate fresh proposal while cooldown is active (adjustment was applied today, 0 days ago)
    const nextCheckIn = await getCheckIn(PHASE5_USER_ID, { forceGenerate: true });
    assert.ok(nextCheckIn.id);
    assert.equal(nextCheckIn.reasonCode, 'COOLDOWN_ACTIVE');
    assert.equal(nextCheckIn.suggestedCalories, nextCheckIn.currentCalories);
    assert.equal(nextCheckIn.adjustmentKcal, 0);
    assert.equal(nextCheckIn.headline, 'Recent Adjustment Active');
    assert.ok(nextCheckIn.rationaleText.includes('Maintaining current targets'));
  });

  it('3. cooldown expires after 14 days and allows new calorie adjustment', async () => {
    // Simulate last adjustment occurred 15 days ago
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    await prisma.userProfile.update({
      where: { userId: PHASE5_USER_ID },
      data: { lastAdjustmentAppliedAt: fifteenDaysAgo },
    });

    const checkInAfterCooldown = await getCheckIn(PHASE5_USER_ID, { forceGenerate: true });
    assert.ok(checkInAfterCooldown.id);
    assert.notEqual(checkInAfterCooldown.reasonCode, 'COOLDOWN_ACTIVE', 'Cooldown should be expired');
  });

  it('4. clinical safety floor breach overrides active cooldown', async () => {
    // Reset lastAdjustmentAppliedAt to today (cooldown active)
    await prisma.userProfile.update({
      where: { userId: PHASE5_USER_ID },
      data: {
        lastAdjustmentAppliedAt: new Date(),
        targetCalories: 1300, // Below male safety floor (1500 kcal)
      },
    });

    const safetyCheckIn = await getCheckIn(PHASE5_USER_ID, { forceGenerate: true });
    assert.ok(safetyCheckIn.id);
    assert.equal(safetyCheckIn.reasonCode, 'TREND_BELOW_TARGET');
    assert.equal(safetyCheckIn.headline, 'Safety Floor Adjustment');
    assert.ok(safetyCheckIn.suggestedCalories >= 1500, 'Must be raised to at least the male safety floor');
    assert.ok(safetyCheckIn.adjustmentKcal > 0, 'Adjustment must be positive to restore safety floor');
  });

  it('5. applyCheckIn DISMISS does not update lastAdjustmentAppliedAt', async () => {
    const fixedDate = new Date('2026-01-01T00:00:00.000Z');
    await prisma.userProfile.update({
      where: { userId: PHASE5_USER_ID },
      data: {
        lastAdjustmentAppliedAt: fixedDate,
        targetCalories: 1850,
      },
    });

    const checkIn = await getCheckIn(PHASE5_USER_ID, { forceGenerate: true });
    const dismissResult = await applyCheckIn(
      { checkInId: checkIn.id, action: 'DISMISS' },
      PHASE5_USER_ID
    );

    assert.equal(dismissResult.status, 'DISMISSED');

    const profile = await prisma.userProfile.findUnique({
      where: { userId: PHASE5_USER_ID },
    });
    assert.equal(profile.lastAdjustmentAppliedAt.toISOString(), fixedDate.toISOString());
  });
});
