const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  solveObservedTdee,
  calculateRecommendedCalories,
  filterValidIntakeDays,
} = require('../src/modules/adaptive/algorithms/expenditureSolver');
const {
  evaluateExpenditureConfidence,
} = require('../src/modules/adaptive/algorithms/confidenceModel');
const {
  allocateMacros,
} = require('../src/modules/adaptive/algorithms/macroAllocator');

describe('Adaptive TDEE & Expenditure Solver', () => {
  it('correctly calculates observed TDEE when weight is stable', () => {
    // 2700 kcal intake with 0 weight velocity -> TDEE = 2700
    const result = solveObservedTdee({
      avgDailyIntake: 2700,
      velocityKgPerDay: 0,
      bmr: 1650,
    });
    assert.equal(result.observedTdee, 2700);
    assert.equal(result.dailyEnergySurplusKcal, 0);
  });

  it('correctly calculates observed TDEE when gaining weight at surplus', () => {
    // User eats 2700 kcal, gaining 0.25 kg/week = +0.0357 kg/day = +275 kcal/day surplus
    // TDEE should be 2700 - 275 = 2425
    const velocityPerDay = 0.25 / 7;
    const result = solveObservedTdee({
      avgDailyIntake: 2700,
      velocityKgPerDay: velocityPerDay,
      bmr: 1600,
    });
    assert.ok(result.observedTdee >= 2420 && result.observedTdee <= 2430);
  });

  it('correctly infers higher TDEE when user eats more than expected while losing weight', () => {
    // User eats 2500 kcal, losing 0.5 kg/week = -0.0714 kg/day = -550 kcal/day deficit
    // Observed TDEE = 2500 - (-550) = 3050 kcal!
    const velocityPerDay = -0.5 / 7;
    const result = solveObservedTdee({
      avgDailyIntake: 2500,
      velocityKgPerDay: velocityPerDay,
      bmr: 1700,
    });
    assert.ok(result.observedTdee >= 3045 && result.observedTdee <= 3055);
  });

  it('filters out incomplete logging days (<500 kcal)', () => {
    const rawDays = [
      { date: '2026-09-01', calories: 2200 },
      { date: '2026-09-02', calories: 350 }, // Incomplete
      { date: '2026-09-03', calories: 0, isFastingDay: true }, // Explicit fast
      { date: '2026-09-04', calories: 2400 },
    ];
    const filtered = filterValidIntakeDays(rawDays);
    assert.equal(filtered.length, 3);
    assert.equal(filtered[0].calories, 2200);
    assert.equal(filtered[1].calories, 0);
    assert.equal(filtered[2].calories, 2400);
  });

  it('enforces anti-whiplash weekly calorie adjustment limit (150 kcal)', () => {
    const rec = calculateRecommendedCalories({
      effectiveTdee: 2500,
      targetRateKgPerWeek: -0.5, // 2500 - 550 = 1950 target
      currentCalories: 2300,     // 2300 down to 1950 is -350 delta
      gender: 'MALE',
      bodyWeightKg: 75,
    });
    // Adjustment must be clamped to -150 kcal -> recommendedCalories = 2150
    assert.equal(rec.rawTargetCalories, 1950);
    assert.equal(rec.adjustmentKcal, -150);
    assert.equal(rec.recommendedCalories, 2150);
  });

  it('flags clinical low-calorie safety floor violations', () => {
    const femaleRec = calculateRecommendedCalories({
      effectiveTdee: 1400,
      targetRateKgPerWeek: -0.5,
      gender: 'FEMALE',
      bodyWeightKg: 50,
    });
    // 1400 - 550 = 850 kcal (< 1200 kcal floor)
    assert.equal(femaleRec.isBelowSafetyFloor, true);
    assert.equal(femaleRec.safetyFloorKcal, 1200);
  });
});

describe('Confidence & Bayesian Blending Model', () => {
  it('returns INSUFFICIENT for < 7 logged days', () => {
    const res = evaluateExpenditureConfidence({
      validFoodDays: 4,
      validWeightDays: 4,
      formulaTdee: 2400,
      observedTdee: 2800,
    });
    assert.equal(res.level, 'INSUFFICIENT');
    assert.equal(res.effectiveTdee, 2400);
    assert.equal(res.blendWeights.observed, 0);
  });

  it('blends formula and observed for CALIBRATING (7-13 days)', () => {
    const res = evaluateExpenditureConfidence({
      validFoodDays: 10,
      validWeightDays: 10,
      formulaTdee: 2400,
      observedTdee: 2800,
    });
    assert.equal(res.level, 'CALIBRATING');
    assert.ok(res.effectiveTdee > 2400 && res.effectiveTdee < 2800);
    assert.ok(res.blendWeights.observed > 0.20 && res.blendWeights.observed < 0.50);
  });

  it('gives primary weight to observed TDEE for HIGH (21+ days)', () => {
    const res = evaluateExpenditureConfidence({
      validFoodDays: 25,
      validWeightDays: 20,
      formulaTdee: 2200,
      observedTdee: 2600,
    });
    assert.equal(res.level, 'HIGH');
    assert.ok(res.blendWeights.observed >= 0.80);
    assert.ok(res.effectiveTdee >= 2500);
  });
});

describe('Flexible Macro Allocator', () => {
  it('allocates BALANCED preset accurately', () => {
    const macros = allocateMacros({
      targetCalories: 2000,
      bodyWeightKg: 70,
      macroPreset: 'BALANCED',
    });
    assert.equal(macros.proteinGrams, 140); // 70 * 2.0g
    assert.equal(macros.fatGrams, 56);      // (2000 * 0.25) / 9
    assert.ok(macros.carbsGrams > 0);
    assert.equal(macros.fiberGrams, 28);    // (2000 / 1000) * 14
  });

  it('allocates KETO preset with high fat and low carbs', () => {
    const macros = allocateMacros({
      targetCalories: 2000,
      bodyWeightKg: 70,
      macroPreset: 'KETO',
    });
    assert.ok(macros.macroRatios.fat >= 70);
    assert.ok(macros.carbsGrams <= 30);
  });
});
