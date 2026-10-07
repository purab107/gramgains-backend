/**
 * Flexible Macro Allocator
 *
 * Distributes daily calories into Protein, Carbohydrates, Fat, and Fiber
 * based on body weight, macro presets, and user customization.
 */

const PRESET_CONFIGS = {
  BALANCED: {
    proteinGramsPerKg: 1.8,
    fatPercent: 28.0,
  },
  HIGH_PROTEIN: {
    proteinGramsPerKg: 2.2,
    fatRatio: 0.25,
  },
  LOW_CARB: {
    proteinGramsPerKg: 2.0,
    fatRatio: 0.40,
  },
  KETO: {
    proteinGramsPerKg: 1.8,
    fatRatio: 0.75,
  },
  CUSTOM: null,
};

/**
 * Calculates macro grams from target calories and profile configuration.
 *
 * @param {Object} params
 * @param {number} params.targetCalories
 * @param {number} [params.bodyWeightKg=70]
 * @param {number} [params.referenceWeightKg]
 * @param {string} [params.macroPreset='BALANCED']
 * @param {number} [params.proteinGramsPerKg=1.8]
 * @param {number} [params.fatPercent=28.0]
 * @returns {{
 *   proteinGrams: number,
 *   carbsGrams: number,
 *   fatGrams: number,
 *   fiberGrams: number,
 *   macroRatios: { protein: number, carbs: number, fat: number }
 * }}
 */
function allocateMacros({
  targetCalories,
  bodyWeightKg = 70,
  referenceWeightKg,
  macroPreset = 'BALANCED',
  proteinGramsPerKg = 1.8,
  fatPercent = 28.0,
}) {
  const calories = Math.max(800, targetCalories);
  const normalizedPreset = String(macroPreset || 'BALANCED').toUpperCase();
  const refWeight = referenceWeightKg || bodyWeightKg || 70;

  let proteinGrams = 0;
  let fatFraction = 0.28;

  if (normalizedPreset === 'HIGH_PROTEIN') {
    proteinGrams = Math.round(refWeight * 2.2);
    fatFraction = 0.25;
  } else if (normalizedPreset === 'KETO') {
    proteinGrams = Math.round(refWeight * 1.8);
    fatFraction = 0.75;
  } else if (normalizedPreset === 'LOW_CARB') {
    proteinGrams = Math.round(refWeight * 2.0);
    fatFraction = 0.40;
  } else if (normalizedPreset === 'CUSTOM') {
    const clampedProteinPerKg = Math.min(2.2, Math.max(1.4, proteinGramsPerKg !== undefined && proteinGramsPerKg !== null ? proteinGramsPerKg : 1.8));
    proteinGrams = Math.round(refWeight * clampedProteinPerKg);
    fatFraction = Math.min(0.35, Math.max(0.20, (fatPercent !== undefined && fatPercent !== null ? fatPercent : 28.0) / 100));
  } else {
    // Default: BALANCED preset
    const clampedProteinPerKg = Math.min(2.2, Math.max(1.4, proteinGramsPerKg !== undefined && proteinGramsPerKg !== null ? proteinGramsPerKg : 1.8));
    proteinGrams = Math.round(refWeight * clampedProteinPerKg);
    fatFraction = Math.min(0.35, Math.max(0.20, (fatPercent !== undefined && fatPercent !== null ? fatPercent : 28.0) / 100));
  }

  const proteinCalories = proteinGrams * 4;

  let fatGrams = Math.round((calories * fatFraction) / 9);
  const fatMinGrams = Math.round(refWeight * 0.6);
  fatGrams = Math.max(fatGrams, fatMinGrams);
  const fatCalories = fatGrams * 9;

  const carbCalories = calories - proteinCalories - fatCalories;
  const carbsGrams = Math.round(Math.max(0, carbCalories) / 4);

  // Dietary fiber: 14g per 1000 kcal clamped between 20g and 38g
  const fiberGrams = Math.min(38, Math.max(20, Math.round((calories / 1000) * 14)));

  const totalCal = proteinCalories + fatCalories + (carbsGrams * 4) || calories;

  return {
    proteinGrams,
    carbsGrams,
    fatGrams,
    fiberGrams,
    macroRatios: {
      protein: Math.round((proteinCalories / totalCal) * 100),
      carbs: Math.round(((carbsGrams * 4) / totalCal) * 100),
      fat: Math.round((fatCalories / totalCal) * 100),
    },
  };
}

module.exports = {
  allocateMacros,
  PRESET_CONFIGS,
};
