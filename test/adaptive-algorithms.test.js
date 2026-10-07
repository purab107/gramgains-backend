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
    assert.equal(macros.proteinGrams, 126); // 70 * 1.8g
    assert.equal(macros.fatGrams, 62);      // (2000 * 0.28) / 9 = 62
    assert.equal(macros.carbsGrams, 235);   // (2000 - 504 - 558) / 4 = 235
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

const {
  calculateBmr,
  calculateTdee,
  calculateGoalCalorieDelta,
  calculateGoalCalories,
  calculateSafetyFloor,
  calculateReferenceWeightKg,
  calculateProfileMetrics,
  CALORIES_PER_KG,
  SAFETY_FLOORS,
} = require('../src/modules/adaptive/algorithms/calorieCalculator');

describe('Centralised Calorie Calculator Service', () => {
  it('calculates Mifflin-St Jeor BMR correctly for male and female', () => {
    const maleBmr = calculateBmr({ age: 25, gender: 'MALE', heightCm: 175, weightKg: 70 });
    // 10*70 + 6.25*175 - 5*25 + 5 = 700 + 1093.75 - 125 + 5 = 1673.75 -> 1674
    assert.equal(maleBmr, 1674);

    const femaleBmr = calculateBmr({ age: 25, gender: 'FEMALE', heightCm: 165, weightKg: 60 });
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25 -> 1345
    assert.equal(femaleBmr, 1345);
  });

  it('calculates baseline TDEE with activity multipliers', () => {
    const tdee = calculateTdee({ bmr: 1600, activityLevel: 'MODERATE' });
    // 1600 * 1.55 = 2480
    assert.equal(tdee, 2480);

    const sedentaryTdee = calculateTdee({ bmr: 1600, activityLevel: 'SEDENTARY' });
    // 1600 * 1.2 = 1920
    assert.equal(sedentaryTdee, 1920);
  });

  it('calculates goal calorie deltas and targets', () => {
    const lossDelta = calculateGoalCalorieDelta({ targetRateKgPerWeek: -0.5 });
    assert.equal(lossDelta, -550);

    const gainDelta = calculateGoalCalorieDelta({ targetRateKgPerWeek: 0.25 });
    assert.equal(gainDelta, 275);

    const target = calculateGoalCalories({ tdee: 2500, targetRateKgPerWeek: -0.5 });
    assert.equal(target, 1950);
  });

  it('enforces clinical safety floor constants', () => {
    assert.equal(calculateSafetyFloor({ gender: 'MALE' }), SAFETY_FLOORS.MALE);
    assert.equal(calculateSafetyFloor({ gender: 'FEMALE' }), SAFETY_FLOORS.FEMALE);
    assert.equal(calculateSafetyFloor({ gender: 'OTHER' }), SAFETY_FLOORS.OTHER);
    assert.equal(SAFETY_FLOORS.MALE, 1500);
    assert.equal(SAFETY_FLOORS.FEMALE, 1200);
    assert.equal(SAFETY_FLOORS.OTHER, 1350);
    assert.equal(CALORIES_PER_KG, 7700);
  });

  it('calculates complete profile metrics with macro distribution', () => {
    const metrics = calculateProfileMetrics({
      age: 26,
      gender: 'MALE',
      heightCm: 178,
      weightKg: 75,
      activityLevel: 'MODERATE',
      goal: 'WEIGHT_LOSS',
      targetRateKgPerWeek: -0.5,
      macroPreset: 'BALANCED',
    });

    assert.equal(typeof metrics.bmr, 'number');
    assert.equal(typeof metrics.tdee, 'number');
    assert.equal(typeof metrics.targetCalories, 'number');
    assert.equal(metrics.targetRateKgPerWeek, -0.5);
    assert.equal(metrics.targetCalories, metrics.tdee - 550);
    assert.ok(metrics.targetProtein > 0);
    assert.ok(metrics.targetCarbs > 0);
    assert.ok(metrics.targetFat > 0);
    assert.ok(metrics.targetFiber > 0);
  });
});

describe('Canonical Macro Algorithm & Reference Weight', () => {
  it('matches normative worked example (§1.6)', () => {
    const metrics = calculateProfileMetrics({
      age: 30,
      gender: 'MALE',
      heightCm: 180,
      weightKg: 95,
      activityLevel: 'MODERATE',
      goal: 'WEIGHT_LOSS',
      targetRateKgPerWeek: -0.5,
      macroPreset: 'BALANCED',
    });

    // Reference weight: BMI = 95 / 1.8^2 = 29.3 > 25 -> 23.0 * 1.8^2 = 74.5 kg
    assert.equal(metrics.referenceWeightKg, 74.5);
    assert.equal(metrics.bmr, 1930);
    assert.equal(metrics.tdee, 2992);
    assert.equal(metrics.targetCalories, 2442); // 2992 - 550 = 2442
    assert.equal(metrics.isFloorApplied, false);
    assert.equal(metrics.effectiveRateKgPerWeek, -0.5);

    // Protein: round(74.5 * 1.8) = 134 g (vs old 190 g with 2g * total weight)
    assert.equal(metrics.targetProtein, 134);
    // Fat: round(2442 * 0.28 / 9) = 76 g
    assert.equal(metrics.targetFat, 76);
    // Carbs: round((2442 - 134*4 - 76*9) / 4) = 306 g
    assert.ok(Math.abs(metrics.targetCarbs - 305) <= 1);
    // Fiber: clamp(round(2442/1000 * 14), 20, 38) = 34 g
    assert.equal(metrics.targetFiber, 34);

    // Caloric sum check
    const totalMacroKcal = metrics.targetProtein * 4 + metrics.targetFat * 9 + metrics.targetCarbs * 4;
    assert.ok(Math.abs(totalMacroKcal - metrics.targetCalories) <= 4);
  });

  it('uses targetWeightKg for reference weight when within normal BMI (18.5-25)', () => {
    // 95 kg, 180 cm, target 75 kg (BMI = 75 / 1.8^2 = 23.15, normal)
    const refWeight = calculateReferenceWeightKg({ heightCm: 180, weightKg: 95, targetWeightKg: 75 });
    assert.equal(refWeight, 75);

    const metrics = calculateProfileMetrics({
      age: 30,
      gender: 'MALE',
      heightCm: 180,
      weightKg: 95,
      targetWeightKg: 75,
      activityLevel: 'MODERATE',
      goal: 'WEIGHT_LOSS',
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(metrics.referenceWeightKg, 75);
    assert.equal(metrics.targetProtein, Math.round(75 * 1.8)); // 135 g
  });

  it('enforces clinical safety floor and updates effectiveRateKgPerWeek', () => {
    const metrics = calculateProfileMetrics({
      age: 40,
      gender: 'FEMALE',
      heightCm: 150,
      weightKg: 45,
      activityLevel: 'SEDENTARY',
      goal: 'WEIGHT_LOSS',
      targetRateKgPerWeek: -1.0,
    });

    assert.equal(metrics.isFloorApplied, true);
    assert.equal(metrics.targetCalories, 1200);
    assert.ok(metrics.effectiveRateKgPerWeek > -1.0);
    assert.equal(metrics.effectiveRateKgPerWeek, -0.03);
  });

  it('enforces fiber clamp bounds (20g to 38g)', () => {
    // Low calorie (1000 kcal) -> raw fiber 14g -> clamped to 20g
    const lowMacros = allocateMacros({ targetCalories: 1000, bodyWeightKg: 60 });
    assert.equal(lowMacros.fiberGrams, 20);

    // High calorie (4000 kcal) -> raw fiber 56g -> clamped to 38g
    const highMacros = allocateMacros({ targetCalories: 4000, bodyWeightKg: 90 });
    assert.equal(highMacros.fiberGrams, 38);
  });

  it('enforces absolute minimum fat floor (0.6 g/kg of reference weight)', () => {
    const macros = allocateMacros({
      targetCalories: 1000,
      bodyWeightKg: 80,
      referenceWeightKg: 80,
      fatPercent: 20.0,
    });
    assert.equal(macros.fatGrams, 48);
  });
});

