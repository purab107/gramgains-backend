const {
  HOUSEHOLD_UNIT_CATEGORY_MAP,
  SERVING_UNIT_PLAUSIBLE_RANGES,
} = require('../config');
const { normalizeText } = require('../normalizer');

/**
 * Audits FoodServing records for schema integrity, positive weights, plausible units,
 * and household serving availability for real-world Indian logging.
 * @param {import('../types').FoodRecord} food - The food record to audit
 * @returns {import('../types').AuditIssue[]} Array of audit issues found
 */
function auditServingRules(food) {
  const issues = [];
  const servings = food.servings || [];

  // 1. Check if food has at least one serving
  if (servings.length === 0) {
    issues.push({
      id: `serving-empty-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'ERROR',
      issueCategory: 'SERVING',
      issueCode: 'ERR_FOOD_NO_SERVINGS',
      field: 'servings',
      storedValue: 0,
      expectedValue: '>= 1 serving',
      explanation: `Food "${food.name}" has no FoodServing records defined. Users cannot log portions.`,
    });
    return issues;
  }

  // 2. Default serving count checks
  const defaultServings = servings.filter((s) => s.isDefault);
  if (defaultServings.length > 1) {
    issues.push({
      id: `serving-multi-default-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'ERROR',
      issueCategory: 'SERVING',
      issueCode: 'ERR_MULTIPLE_DEFAULT_SERVINGS',
      field: 'servings.isDefault',
      storedValue: `${defaultServings.length} defaults`,
      expectedValue: 'Exactly 1 default serving',
      explanation: `Food "${food.name}" has ${defaultServings.length} servings flagged as isDefault: true. Expected exactly one default.`,
    });
  } else if (defaultServings.length === 0) {
    issues.push({
      id: `serving-no-default-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'WARNING',
      issueCategory: 'SERVING',
      issueCode: 'WARN_NO_DEFAULT_SERVING',
      field: 'servings.isDefault',
      storedValue: '0 defaults',
      expectedValue: '1 default serving',
      explanation: `Food "${food.name}" has no default serving flagged. UI may select an arbitrary serving.`,
    });
  }

  // 3. Individual serving validations: weights, duplicates, plausibility
  const seenServingKeys = new Set();
  let hasGramOrStandardServing = false;
  const unitLabelsPresent = [];

  for (const s of servings) {
    const normUnit = normalizeText(s.unitLabel);
    unitLabelsPresent.push(normUnit);

    // Negative or zero serving weight
    if (s.weightGrams <= 0) {
      issues.push({
        id: `serving-zero-${s.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'ERROR',
        issueCategory: 'SERVING',
        issueCode: 'ERR_SERVING_ZERO_WEIGHT',
        field: 'servings.weightGrams',
        storedValue: s.weightGrams,
        expectedValue: '> 0 g',
        explanation: `Serving unit "${s.unitLabel}" has invalid non-positive weight (${s.weightGrams} g).`,
      });
    }

    // Duplicate serving detection on same food
    const servingKey = `${normUnit}:::${s.weightGrams}`;
    if (seenServingKeys.has(servingKey)) {
      issues.push({
        id: `serving-dup-${s.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'WARNING',
        issueCategory: 'SERVING',
        issueCode: 'WARN_DUPLICATE_SERVING',
        field: 'servings',
        storedValue: `"${s.unitLabel}" (${s.weightGrams}g)`,
        expectedValue: 'Distinct serving units and weights',
        explanation: `Duplicate serving entry "${s.unitLabel}" with weight ${s.weightGrams}g for "${food.name}".`,
      });
    } else {
      seenServingKeys.add(servingKey);
    }

    // Standard gram serving check
    if (normUnit === 'g' || normUnit === 'gram' || normUnit === 'grams' || normUnit === '100g' || normUnit === '100 g') {
      hasGramOrStandardServing = true;
    }

    // Check specific label vs weight plausibility (e.g. label "100g" but weight is 25g)
    if ((normUnit === '100g' || normUnit === '100 g') && Math.abs(s.weightGrams - 100) > 1.0) {
      issues.push({
        id: `serving-100g-mismatch-${s.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'WARNING',
        issueCategory: 'SERVING',
        issueCode: 'WARN_IMPLAUSIBLE_SERVING_WEIGHT',
        field: 'servings.weightGrams',
        storedValue: `${s.weightGrams} g for label "${s.unitLabel}"`,
        expectedValue: '100 g',
        discrepancy: `${s.weightGrams - 100 > 0 ? '+' : ''}${(s.weightGrams - 100).toFixed(1)} g`,
        explanation: `Serving label "${s.unitLabel}" indicates 100g but stored weight is ${s.weightGrams}g.`,
      });
    }

    // Check plausibility range for common unit types
    for (const [unitPattern, range] of Object.entries(SERVING_UNIT_PLAUSIBLE_RANGES)) {
      if (normUnit === unitPattern || normUnit.includes(unitPattern)) {
        if (s.weightGrams < range.min || s.weightGrams > range.max) {
          issues.push({
            id: `serving-implausible-${s.id}`,
            foodId: food.id,
            foodName: food.name,
            source: food.source,
            layer: food.layer,
            category: food.category,
            brand: food.brand,
            severity: 'WARNING',
            issueCategory: 'SERVING',
            issueCode: 'WARN_IMPLAUSIBLE_SERVING_WEIGHT',
            field: 'servings.weightGrams',
            storedValue: `${s.weightGrams} g for "${s.unitLabel}"`,
            expectedValue: `${range.min}g - ${range.max}g`,
            explanation: `Implausible serving weight (${s.weightGrams}g) for unit "${s.unitLabel}". Expected between ${range.min}g and ${range.max}g.`,
          });
        }
        break;
      }
    }
  }

  // 4. Check if standard gram/ml serving is available
  if (!hasGramOrStandardServing) {
    issues.push({
      id: `serving-no-gram-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'INFO',
      issueCategory: 'SERVING',
      issueCode: 'INFO_MISSING_GRAM_SERVING',
      field: 'servings',
      storedValue: unitLabelsPresent.join(', '),
      expectedValue: 'At least one gram-based serving ("g" or "100g")',
      explanation: `Food "${food.name}" lacks a standard gram serving ("g" or "100g"). Available: ${unitLabelsPresent.join(', ')}.`,
    });
  }

  // 5. Household unit coverage check for Indian food logging
  const expectedHouseholdUnits = HOUSEHOLD_UNIT_CATEGORY_MAP[food.category];
  if (expectedHouseholdUnits) {
    const hasHouseholdUnit = unitLabelsPresent.some((u) =>
      expectedHouseholdUnits.some((e) => u.includes(e))
    );
    if (!hasHouseholdUnit) {
      issues.push({
        id: `serving-household-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        severity: 'INFO',
        issueCategory: 'USABILITY_INDIAN',
        issueCode: 'INFO_LACKS_HOUSEHOLD_SERVING',
        field: 'servings',
        storedValue: unitLabelsPresent.join(', '),
        expectedValue: `Household unit such as: ${expectedHouseholdUnits.join(', ')}`,
        explanation: `Category "${food.category}" foods typically benefit from household portion units (${expectedHouseholdUnits.join(', ')}). Only has: ${unitLabelsPresent.join(', ')}.`,
      });
    }
  }

  return issues;
}

module.exports = { auditServingRules };