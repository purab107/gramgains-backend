import type { FoodRecord, AuditIssue, AuditConfig } from '../types.ts';

/**
 * Audits nutritional fields against the fundamental per-100g invariant and physical laws.
 *
 * Invariant:
 * calories, protein, carbohydrates, fat, and fiber MUST represent values per 100 g edible food.
 */
export function auditNutritionRules(food: FoodRecord, config: AuditConfig): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const { calories, protein, carbohydrates, fat, fiber } = food;

  // 1. Negative nutrient checks
  const nutrients: Array<{ field: string; val: number }> = [
    { field: 'calories', val: calories },
    { field: 'protein', val: protein },
    { field: 'carbohydrates', val: carbohydrates },
    { field: 'fat', val: fat },
    { field: 'fiber', val: fiber },
  ];

  for (const n of nutrients) {
    if (n.val < 0) {
      issues.push({
        id: `nutr-neg-${food.id}-${n.field}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'ERROR',
        issueCategory: 'PHYSICAL_BOUNDS',
        issueCode: 'ERR_NUTRITION_NEGATIVE',
        field: n.field,
        storedValue: n.val,
        expectedValue: '>= 0',
        explanation: `Negative nutrient value for ${n.field} (${n.val}) violates physical reality.`,
      });
    }
  }

  // 2. Extreme / impossible nutrient values (> 100g per 100g food, or > 1000 kcal/100g)
  for (const n of [
    { field: 'protein', val: protein },
    { field: 'carbohydrates', val: carbohydrates },
    { field: 'fat', val: fat },
    { field: 'fiber', val: fiber },
  ]) {
    if (n.val > config.maxMacroGramsPer100g) {
      issues.push({
        id: `nutr-extreme-${food.id}-${n.field}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'ERROR',
        issueCategory: 'PHYSICAL_BOUNDS',
        issueCode: 'ERR_NUTRITION_EXTREME',
        field: n.field,
        storedValue: n.val,
        expectedValue: `<= ${config.maxMacroGramsPer100g} g`,
        explanation: `${n.field} (${n.val} g) exceeds 100 g per 100 g edible food.`,
      });
    }
  }

  if (calories > config.extremeKcalThreshold) {
    issues.push({
      id: `nutr-extreme-${food.id}-calories`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'ERROR',
      issueCategory: 'PHYSICAL_BOUNDS',
      issueCode: 'ERR_NUTRITION_EXTREME',
      field: 'calories',
      storedValue: calories,
      expectedValue: `<= ${config.maxPlausibleKcalPer100g} kcal`,
      explanation: `Calories (${calories} kcal/100g) exceed theoretical maximum (pure fat is ~900 kcal/100g).`,
    });
  } else if (calories > config.maxPlausibleKcalPer100g) {
    issues.push({
      id: `nutr-warn-kcal-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'WARNING',
      issueCategory: 'PHYSICAL_BOUNDS',
      issueCode: 'WARN_CALORIE_MACRO_MISMATCH',
      field: 'calories',
      storedValue: calories,
      expectedValue: `<= 900 kcal`,
      explanation: `Calories (${calories} kcal/100g) are unusually high, close to or exceeding pure fat limit.`,
    });
  }

  // 3. Macro sum bounds (protein + carbohydrates + fat <= tolerance)
  const macroSum = protein + carbohydrates + fat;
  if (macroSum > config.macroSumToleranceGrams) {
    issues.push({
      id: `macro-sum-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'ERROR',
      issueCategory: 'PHYSICAL_BOUNDS',
      issueCode: 'ERR_MACRO_SUM_EXCEEDS_100',
      field: 'protein+carbohydrates+fat',
      storedValue: `${macroSum.toFixed(1)} g`,
      expectedValue: `<= ${config.macroSumToleranceGrams} g`,
      discrepancy: `+${(macroSum - 100).toFixed(1)} g`,
      explanation: `Sum of macronutrients (${protein}g P + ${carbohydrates}g C + ${fat}g F = ${macroSum.toFixed(1)}g) exceeds 100g per 100g food.`,
    });
  }

  // 4. Fiber vs Carbohydrates check (fiber is a carbohydrate fraction)
  // Allow a small 0.5g tolerance for independent rounding in source datasets
  if (fiber > carbohydrates + 0.5 && carbohydrates > 0) {
    issues.push({
      id: `fiber-gt-carbs-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'ERROR',
      issueCategory: 'PHYSICAL_BOUNDS',
      issueCode: 'ERR_FIBER_EXCEEDS_CARBS',
      field: 'fiber',
      storedValue: `${fiber} g (Carbs: ${carbohydrates} g)`,
      expectedValue: `<= carbohydrates (${carbohydrates} g)`,
      explanation: `Fiber (${fiber} g) cannot exceed total carbohydrates (${carbohydrates} g) per 100g food. Possible net carbs confusion.`,
    });
  }

  // 5. Macro-derived energy check (Atwater factors: 4P + 4C + 9F vs stored calories)
  // Food composition tables use Atwater, specific coefficients, rounding, and moisture.
  // We do NOT require exact equality, but flag significant discrepancies.
  const estimatedKcal = protein * 4 + carbohydrates * 4 + fat * 9;
  const maxRef = Math.max(calories, estimatedKcal, 1);
  const absDiff = Math.abs(calories - estimatedKcal);
  const relDiff = absDiff / maxRef;

  // We only flag when BOTH relative and absolute thresholds are exceeded to avoid false positives on low-calorie foods
  if (calories > 20 || estimatedKcal > 20) {
    if (relDiff > config.calorieRelErrorThreshold && absDiff > config.calorieAbsErrorThreshold) {
      issues.push({
        id: `atwater-err-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'ERROR',
        issueCategory: 'CONSISTENCY',
        issueCode: 'ERR_CONVENTION_UNCERTAIN',
        field: 'calories',
        storedValue: calories,
        expectedValue: `~${estimatedKcal.toFixed(1)} kcal (from 4P+4C+9F)`,
        discrepancy: `${absDiff > 0 ? (calories > estimatedKcal ? '+' : '-') : ''}${absDiff.toFixed(1)} kcal (${(relDiff * 100).toFixed(1)}%)`,
        explanation: `Extreme energy discrepancy: stored ${calories} kcal vs macro-derived ${estimatedKcal.toFixed(1)} kcal (${(relDiff * 100).toFixed(1)}% diff). Convention or data scale uncertain.`,
      });
    } else if (relDiff > config.calorieRelThreshold && absDiff > config.calorieAbsThreshold) {
      issues.push({
        id: `atwater-warn-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'WARNING',
        issueCategory: 'CONSISTENCY',
        issueCode: 'WARN_CALORIE_MACRO_MISMATCH',
        field: 'calories',
        storedValue: calories,
        expectedValue: `~${estimatedKcal.toFixed(1)} kcal (from 4P+4C+9F)`,
        discrepancy: `${calories > estimatedKcal ? '+' : '-'}${absDiff.toFixed(1)} kcal (${(relDiff * 100).toFixed(1)}%)`,
        explanation: `Calorie-macro mismatch: stored ${calories} kcal vs calculated ${estimatedKcal.toFixed(1)} kcal (${(relDiff * 100).toFixed(1)}% diff). Likely rounding, fiber factor, or broth dilution.`,
      });
    }
  }

  return issues;
}
