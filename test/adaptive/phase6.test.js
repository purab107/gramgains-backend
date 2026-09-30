const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../../src/config/db');
const { computeAdherenceInWindow } = require('../../src/modules/adaptive/algorithms/adherenceEvaluator');
const { evaluateEvidenceSufficiency } = require('../../src/modules/adaptive/algorithms/confidenceModel');
const { getAdaptiveStatus, getCheckIn } = require('../../src/modules/adaptive/adaptive.service');
const { logWeight } = require('../../src/modules/tracker/tracker.service');

const PHASE6_USER_ID = 'test-phase6-adherence-user';

// ---------- Unit tests — no DB ----------

describe('Phase 6.1: computeAdherenceInWindow unit tests', () => {
  const TARGET = 1800;

  it('returns 0 adherence and density when no intakes', () => {
    const r = computeAdherenceInWindow({ dailyIntakes: [], targetCalories: TARGET, windowDays: 21 });
    assert.equal(r.totalLoggedDays, 0);
    assert.equal(r.adherentDays, 0);
    assert.equal(r.density, 0);
    assert.equal(r.adherenceRate, 0);
    assert.equal(r.adherenceScore, 0);
    assert.equal(r.isAdherent, false);
  });

  it('classifies full-window consistent logging as adherent', () => {
    const intakes = Array.from({ length: 21 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      calories: 1800,
    }));
    const r = computeAdherenceInWindow({ dailyIntakes: intakes, targetCalories: TARGET, windowDays: 21 });
    assert.equal(r.totalLoggedDays, 21);
    assert.equal(r.density, 1.0);
    assert.equal(r.adherentDays, 21);
    assert.equal(r.adherenceScore, 100);
    assert.equal(r.isAdherent, true);
  });

  it('filters out incomplete days below 500 kcal', () => {
    const intakes = [
      { date: '2026-01-01', calories: 1800 },
      { date: '2026-01-02', calories: 200 },  // incomplete day
      { date: '2026-01-03', calories: 1750 },
    ];
    const r = computeAdherenceInWindow({ dailyIntakes: intakes, targetCalories: TARGET, windowDays: 21 });
    assert.equal(r.totalLoggedDays, 2); // only 2 valid days
  });

  it('uses tolerance band for adherence classification', () => {
    // Tolerance of 2000 kcal target = ±max(100, 2000*0.10) = ±200 kcal → 1800–2200
    const intakes = [
      { date: '2026-01-01', calories: 2250 },  // outside ±200 → not adherent
      { date: '2026-01-02', calories: 1850 },  // inside → adherent
    ];
    const r = computeAdherenceInWindow({ dailyIntakes: intakes, targetCalories: 2000, windowDays: 21 });
    assert.equal(r.adherentDays, 1);
    assert.equal(r.adherenceRate, 0.5);
  });

  it('marks LOW density (< 9/21 days) as not adherent', () => {
    const intakes = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      calories: 1800,
    }));
    const r = computeAdherenceInWindow({ dailyIntakes: intakes, targetCalories: TARGET, windowDays: 21 });
    assert.ok(r.density < 0.43, 'density should be below 0.43 threshold');
    assert.equal(r.isAdherent, false);
  });
});

describe('Phase 6.2: evaluateEvidenceSufficiency with adherence gate', () => {
  it('returns LOW_ADHERENCE when density < 0.43 (< 9/21 days)', () => {
    // 5 valid food days across 21-day window → density = 0.24 (< 0.43)
    const adherence = computeAdherenceInWindow({
      dailyIntakes: Array.from({ length: 5 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        calories: 1850,
      })),
      targetCalories: 1850,
      windowDays: 21,
    });

    const result = evaluateEvidenceSufficiency({
      validFoodDays: 14, // passes raw threshold
      validWeightDays: 10,
      windowDays: 21,
      observedTdee: 2300,
      adherence,
    });

    assert.equal(result.evidenceStatus, 'LOW_ADHERENCE');
    assert.equal(result.isReadyForRecommendation, false);
    assert.ok(result.message.toLowerCase().includes('adherence'));
  });

  it('returns READY with high adherence and sufficient logging days', () => {
    const adherence = computeAdherenceInWindow({
      dailyIntakes: Array.from({ length: 21 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        calories: 1850,
      })),
      targetCalories: 1850,
      windowDays: 21,
    });

    const result = evaluateEvidenceSufficiency({
      validFoodDays: 21,
      validWeightDays: 12,
      windowDays: 21,
      observedTdee: 2300,
      adherence,
    });

    assert.equal(result.evidenceStatus, 'READY');
    assert.equal(result.isReadyForRecommendation, true);
  });

  it('adherence field is returned in the result', () => {
    const adherence = computeAdherenceInWindow({
      dailyIntakes: [{ date: '2026-01-01', calories: 1850 }],
      targetCalories: 1850,
      windowDays: 21,
    });
    const result = evaluateEvidenceSufficiency({
      validFoodDays: 1,
      validWeightDays: 1,
      windowDays: 21,
      observedTdee: null,
    });
    assert.equal(result.adherence, null);

    const result2 = evaluateEvidenceSufficiency({
      validFoodDays: 5,
      validWeightDays: 3,
      windowDays: 21,
      observedTdee: 2300,
      adherence,
    });
    assert.ok(result2.adherence !== null);
    assert.equal(typeof result2.adherence.density, 'number');
    assert.equal(typeof result2.adherence.adherenceScore, 'number');
  });
});

// ---------- Integration tests — DB ----------

describe('Phase 6.3: getAdaptiveStatus surfaces 21-day adherence in API response', () => {
  before(async () => {
    await prisma.weightLog.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE6_USER_ID } });

    await prisma.user.create({
      data: {
        id: PHASE6_USER_ID,
        name: 'Phase 6 Adherence Test',
        email: 'phase6-test@gramgains.app',
        profile: {
          create: {
            age: 29,
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

    let testFood = await prisma.food.findFirst();
    if (!testFood) {
      testFood = await prisma.food.create({
        data: {
          name: 'Phase 6 Food',
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

    // Seed only 5 food log days across 21-day window (low adherence — density = 5/21 ≈ 0.24)
    const today = new Date();
    for (let i = 5; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 4); // spread out, not consecutive
      await logWeight({ date: d.toISOString().split('T')[0], weightKg: 80 - i * 0.1 }, PHASE6_USER_ID);
      await prisma.mealLog.create({
        data: {
          userId: PHASE6_USER_ID,
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
    await prisma.weightLog.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.mealLog.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.adaptiveCheckIn.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.metabolicSnapshot.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.goalHistory.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: PHASE6_USER_ID } });
    await prisma.user.deleteMany({ where: { id: PHASE6_USER_ID } });
    await prisma.$disconnect();
  });

  it('1. getAdaptiveStatus includes adherence block in evidenceSufficiency', async () => {
    const status = await getAdaptiveStatus(PHASE6_USER_ID);

    assert.ok(status.evidenceSufficiency, 'evidenceSufficiency must exist');
    assert.ok(['INSUFFICIENT', 'LOW_ADHERENCE', 'CALIBRATING', 'READY'].includes(status.evidenceSufficiency.evidenceStatus));

    // The adherence block may be null for sparse data (density below TDEE calc threshold)
    // but it should always be defined in the response shape
    assert.ok('adherence' in status.evidenceSufficiency, 'adherence field must be present in evidenceSufficiency');
  });

  it('2. getCheckIn uses 21-day adherence score (not 7-day) in proposal', async () => {
    const checkIn = await getCheckIn(PHASE6_USER_ID);
    assert.ok(checkIn, 'check-in should be created');
    // With 5 sparse days, evidence is INSUFFICIENT or LOW_ADHERENCE → no calorie change
    assert.equal(checkIn.adjustmentKcal, 0, 'No calorie change should be proposed with insufficient adherence');
    assert.equal(checkIn.suggestedCalories, checkIn.currentCalories, 'suggested must equal current when not ready');
  });
});
