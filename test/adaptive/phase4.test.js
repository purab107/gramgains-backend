const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../../src/config/db');
const { getCheckIn, applyCheckIn, getAdaptiveStatus } = require('../../src/modules/adaptive/adaptive.service');
const { getCheckIn: controllerGetCheckIn } = require('../../src/modules/adaptive/adaptive.controller');
const { logWeight } = require('../../src/modules/tracker/tracker.service');

const PHASE4_USER_ID = 'test-phase4-adaptive-user';

describe('Phase 4: Decoupling Check-ins from Calorie Adjustments', () => {
  before(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE4_USER_ID } });

    // Seed test user whose checkInDayOfWeek is set to tomorrow (to test cadence guard)
    const todayDow = new Date().getDay();
    const nonCheckInDow = (todayDow + 3) % 7;

    await prisma.user.create({
      data: {
        id: PHASE4_USER_ID,
        name: 'Phase 4 Athlete',
        email: 'phase4-test@gramgains.app',
        profile: {
          create: {
            age: 30,
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
            checkInDayOfWeek: nonCheckInDow, // Non-check-in day
          },
        },
      },
    });

    let testFood = await prisma.food.findFirst();
    if (!testFood) {
      testFood = await prisma.food.create({
        data: {
          name: 'Phase 4 Test Food',
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

    // Seed 5 days of weight logs (insufficient data for full 21-day calibration)
    const today = new Date();
    for (let i = 5; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      await logWeight(
        { date: d.toISOString().split('T')[0], weightKg: 82.0 - (5 - i) * 0.1 },
        PHASE4_USER_ID
      );
    }
  });

  after(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE4_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE4_USER_ID } });
    await prisma.$disconnect();
  });

  it('1. returns null when today is not the configured checkInDayOfWeek and forceGenerate is false', async () => {
    const checkIn = await getCheckIn(PHASE4_USER_ID, { forceGenerate: false });
    assert.equal(checkIn, null, 'Should return null on non-check-in day');
  });

  it('2. bypasses cadence guard and generates check-in when forceGenerate is true', async () => {
    const checkIn = await getCheckIn(PHASE4_USER_ID, { forceGenerate: true });
    assert.ok(checkIn, 'Should generate check-in when forced');
    assert.ok(checkIn.id);
    assert.equal(checkIn.status, 'PENDING');
  });

  it('3. enforces idempotency for the current observation period', async () => {
    const existing = await getCheckIn(PHASE4_USER_ID);
    assert.ok(existing);

    // Call again - should return the exact same check-in without creating a duplicate
    const secondCall = await getCheckIn(PHASE4_USER_ID);
    assert.equal(secondCall.id, existing.id, 'Should return identical check-in record');

    const totalCheckIns = await prisma.adaptiveCheckIn.count({
      where: { userId: PHASE4_USER_ID },
    });
    assert.equal(totalCheckIns, 1, 'Only 1 check-in should exist in database');
  });

  it('4. applies KEEP_CURRENT_TARGET with adjustmentKcal = 0 when evidence is INSUFFICIENT', async () => {
    const checkIn = await getCheckIn(PHASE4_USER_ID);
    // Since only 5 weight logs and 0 food logs exist, evidence is INSUFFICIENT
    assert.equal(checkIn.reasonCode, 'INSUFFICIENT_DATA');
    assert.equal(checkIn.suggestedCalories, checkIn.currentCalories, 'Suggested calories must match current calories');
    assert.equal(checkIn.adjustmentKcal, 0, 'Adjustment must be 0 kcal when keeping current target');
    assert.equal(checkIn.evidenceStatus, 'INSUFFICIENT');
  });

  it('5. stores explicit observation window and supporting metrics on AdaptiveCheckIn', async () => {
    const checkIn = await getCheckIn(PHASE4_USER_ID);
    assert.ok(checkIn.observationStart instanceof Date, 'observationStart must be a Date');
    assert.ok(checkIn.observationEnd instanceof Date, 'observationEnd must be a Date');
    assert.equal(typeof checkIn.targetRateKgPerWeek, 'number');
    assert.equal(typeof checkIn.metabolicModelVersion, 'number');
    assert.equal(checkIn.metabolicModelVersion, 1);
  });

  it('6. controller returns available: false when not check-in day and no pending check-in', async () => {
    // Delete the pending check-in to test the controller's empty response
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE4_USER_ID } });

    let responseData = null;
    let statusCode = 200;
    const mockReq = { userId: PHASE4_USER_ID, query: {} };
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        responseData = payload;
        return payload;
      },
    };

    await controllerGetCheckIn(mockReq, mockRes);
    assert.equal(statusCode, 200);
    assert.equal(responseData.success, true);
    assert.equal(responseData.available, false);
    assert.equal(responseData.data, null);
  });
});
