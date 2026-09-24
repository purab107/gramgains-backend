/**
 * Flexible Macro Allocator
 *
 * Distributes daily calories into Protein, Carbohydrates, Fat, and Fiber
 * based on body weight, macro presets, and user customization.
 */

const PRESET_CONFIGS = {
  BALANCED: {
    proteinRatio: 0.25, // 25% calories
    fatRatio: 0.25,     // 25% calories
    carbsRatio: 0.50,   // 50% calories
  },
  HIGH_PROTEIN: {
    proteinGramsPerKg: 2.2,
    fatRatio: 0.25,
  },
  LOW_CARB: {
    proteinRatio: 0.35,
    fatRatio: 0.40,
    carbsRatio: 0.25,
  },
  KETO: {
    proteinRatio: 0.20,
    fatRatio: 0.75,
    carbsRatio: 0.05,
  },
  CUSTOM: null,
};

/**
 * Calculates macro grams from target calories and profile configuration.
 *
 * @param {Object} params
 * @param {number} params.targetCalories
 * @param {number} params.bodyWeightKg
 * @param {string} [params.macroPreset='BALANCED']
 * @param {number} [params.proteinGramsPerKg=2.0]
 * @param {number} [params.fatPercent=25.0]
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
  macroPreset = 'BALANCED',
  proteinGramsPerKg = 2.0,
  fatPercent = 25.0,
}) {
  const calories = Math.max(800, targetCalories);
  const normalizedPreset = String(macroPreset || 'BALANCED').toUpperCase();

  let proteinGrams = 0;
  let fatGrams = 0;
  let carbsGrams = 0;

  if (normalizedPreset === 'HIGH_PROTEIN') {
    proteinGrams = Math.round(bodyWeightKg * 2.2);
    const fatCalories = calories * 0.25;
    fatGrams = Math.round(fatCalories / 9);
    const remainingCalories = calories - (proteinGrams * 4) - fatCalories;
    carbsGrams = Math.round(Math.max(0, remainingCalories) / 4);
  } else if (normalizedPreset === 'KETO') {
    const proteinCalories = calories * 0.20;
    const fatCalories = calories * 0.75;
    proteinGrams = Math.round(proteinCalories / 4);
    fatGrams = Math.round(fatCalories / 9);
    carbsGrams = Math.round(Math.max(0, calories - proteinCalories - fatCalories) / 4);
  } else if (normalizedPreset === 'LOW_CARB') {
    const proteinCalories = calories * 0.35;
    const fatCalories = calories * 0.40;
    proteinGrams = Math.round(proteinCalories / 4);
    fatGrams = Math.round(fatCalories / 9);
    carbsGrams = Math.round(Math.max(0, calories - proteinCalories - fatCalories) / 4);
  } else if (normalizedPreset === 'CUSTOM') {
    // Custom: explicit protein per kg and fat percent
    proteinGrams = Math.round(bodyWeightKg * (proteinGramsPerKg || 2.0));
    const fatCalories = calories * ((fatPercent || 25.0) / 100);
    fatGrams = Math.round(fatCalories / 9);
    const remainingCalories = calories - (proteinGrams * 4) - fatCalories;
    carbsGrams = Math.round(Math.max(0, remainingCalories) / 4);
  } else {
    // Default: BALANCED preset
    proteinGrams = Math.round(bodyWeightKg * (proteinGramsPerKg || 2.0));
    const fatCalories = calories * 0.25;
    fatGrams = Math.round(fatCalories / 9);
    const remainingCalories = calories - (proteinGrams * 4) - fatCalories;
    carbsGrams = Math.round(Math.max(0, remainingCalories) / 4);
  }

  // Dietary fiber: 14g per 1000 kcal
  const fiberGrams = Math.round((calories / 1000) * 14);

  // Calculate actual caloric percentages
  const proteinCal = proteinGrams * 4;
  const fatCal = fatGrams * 9;
  const carbsCal = carbsGrams * 4;
  const totalCal = proteinCal + fatCal + carbsCal || calories;

  return {
    proteinGrams,
    carbsGrams,
    fatGrams,
    fiberGrams,
    macroRatios: {
      protein: Math.round((proteinCal / totalCal) * 100),
      carbs: Math.round((carbsCal / totalCal) * 100),
      fat: Math.round((fatCal / totalCal) * 100),
    },
  };
}

module.exports = {
  allocateMacros,
  PRESET_CONFIGS,
};
