/**
 * Centralised Calorie & Energy Expenditure Mathematics Service
 *
 * Single source of truth for:
 * - BMR (Mifflin-St Jeor formula)
 * - TDEE baseline (activity multiplier)
 * - Goal-based calorie delta
 * - Clinical safety floors
 * - Complete metric calculation and macro allocation delegation
 */

const { allocateMacros } = require('./macroAllocator');

const CALORIES_PER_KG = 7700;

const ACTIVITY_MULTIPLIERS = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  VERY_ACTIVE: 1.725,
  EXTRA_ACTIVE: 1.9,
};

const SAFETY_FLOORS = {
  MALE: 1500,
  FEMALE: 1200,
};

/**
 * Calculates Basal Metabolic Rate using Mifflin-St Jeor formula.
 *
 * Men:   BMR = 10 * weight(kg) + 6.25 * height(cm) - 5 * age + 5
 * Women: BMR = 10 * weight(kg) + 6.25 * height(cm) - 5 * age - 161
 */
function calculateBmr({ age, gender, heightCm, weightKg = 70 }) {
  let bmr = 10 * weightKg + 6.25 * heightCm - 5 * age;
  bmr += String(gender).toUpperCase() === 'FEMALE' ? -161 : 5;
  return Math.round(bmr);
}

/**
 * Calculates baseline TDEE using Mifflin-St Jeor BMR and activity multiplier.
 */
function calculateTdee({ bmr, activityLevel = 'MODERATE' }) {
  const normalizedActivity = String(activityLevel || 'MODERATE').toUpperCase();
  const multiplier = ACTIVITY_MULTIPLIERS[normalizedActivity] || ACTIVITY_MULTIPLIERS.MODERATE;
  return Math.round(bmr * multiplier);
}

/**
 * Calculates goal-based calorie delta from target weekly rate of change.
 * delta = (targetRateKgPerWeek * 7700) / 7
 */
function calculateGoalCalorieDelta({ targetRateKgPerWeek = 0 }) {
  return Math.round((targetRateKgPerWeek * CALORIES_PER_KG) / 7);
}

/**
 * Calculates goal calorie target from TDEE and target rate.
 */
function calculateGoalCalories({ tdee, targetRateKgPerWeek = 0 }) {
  const delta = calculateGoalCalorieDelta({ targetRateKgPerWeek });
  return Math.round(tdee + delta);
}

/**
 * Resolves clinical safety floor based on gender.
 */
function calculateSafetyFloor({ gender = 'MALE' }) {
  const isFemale = String(gender).toUpperCase() === 'FEMALE';
  return isFemale ? SAFETY_FLOORS.FEMALE : SAFETY_FLOORS.MALE;
}

/**
 * Comprehensive profile metrics calculation (BMR, TDEE, Target Calories, Macros).
 * Serves as direct implementation for profile.service.js calculateMetrics.
 */
function calculateProfileMetrics({
  age,
  gender,
  heightCm,
  weightKg = 70,
  activityLevel,
  goal,
  targetRateKgPerWeek,
  macroPreset = 'BALANCED',
  proteinGramsPerKg = 2.0,
  fatPercent = 25.0,
}) {
  const bmr = calculateBmr({ age, gender, heightCm, weightKg });
  const tdee = calculateTdee({ bmr, activityLevel });

  const normalizedGoal = String(goal || 'MAINTAIN').toUpperCase();
  let rate = typeof targetRateKgPerWeek === 'number' ? targetRateKgPerWeek : 0.0;
  if (targetRateKgPerWeek === undefined || targetRateKgPerWeek === null) {
    if (normalizedGoal === 'WEIGHT_LOSS') rate = -0.5;
    else if (normalizedGoal === 'BULK') rate = 0.35;
    else rate = 0.0;
  }

  const targetCalories = calculateGoalCalories({ tdee, targetRateKgPerWeek: rate });

  const macros = allocateMacros({
    targetCalories,
    bodyWeightKg: weightKg,
    macroPreset,
    proteinGramsPerKg,
    fatPercent,
  });

  return {
    bmr,
    tdee,
    targetCalories,
    targetProtein: macros.proteinGrams,
    targetCarbs: macros.carbsGrams,
    targetFat: macros.fatGrams,
    targetFiber: macros.fiberGrams,
    targetRateKgPerWeek: rate,
  };
}

module.exports = {
  CALORIES_PER_KG,
  ACTIVITY_MULTIPLIERS,
  SAFETY_FLOORS,
  calculateBmr,
  calculateTdee,
  calculateGoalCalorieDelta,
  calculateGoalCalories,
  calculateSafetyFloor,
  calculateProfileMetrics,
};
