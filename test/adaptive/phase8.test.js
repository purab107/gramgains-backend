const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../../src/config/db');
const { getCheckIn, applyCheckIn } = require('../../src/modules/adaptive/adaptive.service');
const { updateProfile } = require('../../src/modules/profile/profile.service');

const PHASE8_USER_ID = 'test-phase8-transaction-user';

describe('Phase 8: Transactional Target Updates & GoalHistory (Improvements 20, 21)', () => {
  before(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE8_USER_ID } });

    await prisma.user.create({
      data: {
        id: PHASE8_USER_ID,
        name: 'Phase 8 Transaction Athlete',
        email: 'phase8-test@gramgains.app',
        profile: {
          create: {
            age: 27,
            gender: 'MALE',
            heightCm: 175,
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
            checkInDayOfWeek: new Date().getDay(),
          },
        },
      },
    });
  });

  after(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE8_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE8_USER_ID } });
    await prisma.$disconnect();
  });

  it('1. applyCheckIn ACCEPT creates a GoalHistory record with rich context', async () => {
    const checkIn = await getCheckIn(PHASE8_USER_ID, { forceGenerate: true });
    assert.ok(checkIn.id);

    const result = await applyCheckIn(
      { checkInId: checkIn.id, action: 'ACCEPT' },
      PHASE8_USER_ID
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'ACCEPT');
    assert.equal(typeof result.newCalories, 'number');

    const history = await prisma.goalHistory.findMany({
      where: { userId: PHASE8_USER_ID },
      orderBy: { createdAt: 'desc' },
    });

    assert.equal(history.length, 1);
    const entry = history[0];
    assert.equal(entry.checkInId, checkIn.id);
    assert.equal(entry.isSystemRecommended, true);
    assert.equal(entry.isUserConfirmed, true);
    assert.equal(entry.targetCalories, checkIn.suggestedCalories);
    assert.equal(entry.previousCalories, 1800);
    assert.equal(entry.effectiveTo, null, 'Active goal record must have effectiveTo = null');
  });

  it('2. consecutive applyCheckIn closes previous GoalHistory and opens new one', async () => {
    // Generate another check-in with forceGenerate
    const checkIn2 = await getCheckIn(PHASE8_USER_ID, { forceGenerate: true });
    const customCalories = 1950;

    const result = await applyCheckIn(
      { checkInId: checkIn2.id, action: 'ADJUST', customCalories },
      PHASE8_USER_ID
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'ADJUST');
    assert.equal(result.newCalories, customCalories);

    const history = await prisma.goalHistory.findMany({
      where: { userId: PHASE8_USER_ID },
      orderBy: { createdAt: 'asc' },
    });

    assert.equal(history.length, 2);
    // First record should now be closed
    assert.ok(history[0].effectiveTo instanceof Date, 'Previous history entry must have effectiveTo populated');
    // Second record should be open
    assert.equal(history[1].effectiveTo, null, 'Latest history entry must be active with null effectiveTo');
    assert.equal(history[1].targetCalories, customCalories);
  });

  it('3. manual profile update also closes previous GoalHistory and tracks user-initiated change', async () => {
    await updateProfile({ customTargetCalories: 2100 }, PHASE8_USER_ID);

    const history = await prisma.goalHistory.findMany({
      where: { userId: PHASE8_USER_ID },
      orderBy: { createdAt: 'asc' },
    });

    assert.equal(history.length, 3);
    assert.ok(history[1].effectiveTo instanceof Date, 'Check-in entry should now be closed');
    assert.equal(history[2].isSystemRecommended, false, 'Manual profile update should be isSystemRecommended = false');
    assert.equal(history[2].targetCalories, 2100);
    assert.equal(history[2].effectiveTo, null);
  });
});
