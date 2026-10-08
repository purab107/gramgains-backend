/**
 * Fruit Macro Accuracy and Usability Evaluator
 * Evaluates matched database foods against gold-standard fruit benchmarks.
 */

/**
 * Calculates absolute delta and percentage relative variance
 * @param {number} dbVal 
 * @param {number} refVal 
 * @returns {{ delta: number, relPercent: number }}
 */
function calculateVariance(dbVal, refVal) {
  const delta = Math.abs(dbVal - refVal);
  const relPercent = refVal > 0 ? (delta / refVal) * 100 : (dbVal > 0 ? 100 : 0);
  return {
    delta: Math.round(delta * 100) / 100,
    relPercent: Math.round(relPercent * 10) / 10
  };
}

/**
 * Evaluates a database food item against reference fruit nutrition
 * 
 * @param {Object} refFruit - Reference fruit specification
 * @param {Object|null} matchedFood - Matched DB Food record with servings
 * @returns {Object} Evaluation report
 */
function evaluateFruitAccuracy(refFruit, matchedFood) {
  if (!matchedFood) {
    return {
      fruitId: refFruit.id,
      canonicalName: refFruit.canonicalName,
      status: 'MISSING',
      accuracyTier: 'MISSING',
      dbFood: null,
      deltas: null,
      atwaterCheck: null,
      servingCheck: null,
      issues: ['Fruit not found in database']
    };
  }

  const ref = refFruit.standard100g;
  const db = {
    calories: matchedFood.calories || 0,
    carbohydrates: matchedFood.carbohydrates || 0,
    protein: matchedFood.protein || 0,
    fat: matchedFood.fat || 0,
    fiber: matchedFood.fiber || 0
  };

  // 1. Calculate macro variances
  const calVar = calculateVariance(db.calories, ref.calories);
  const carbVar = calculateVariance(db.carbohydrates, ref.carbohydrates);
  const protVar = calculateVariance(db.protein, ref.protein);
  const fatVar = calculateVariance(db.fat, ref.fat);
  const fiberVar = calculateVariance(db.fiber, ref.fiber);

  // 2. Physical Invariant & Atwater check
  const macroMassSum = Math.round((db.carbohydrates + db.protein + db.fat + db.fiber) * 100) / 100;
  const isMassPlausible = macroMassSum <= 100.5; // allowance for rounding

  const atwaterExpectedCal = Math.round(((db.protein * 4) + (db.carbohydrates * 4) + (db.fat * 9) + (db.fiber * 2)) * 10) / 10;
  const atwaterResidual = Math.round(Math.abs(db.calories - atwaterExpectedCal) * 10) / 10;
  const isAtwaterConsistent = atwaterResidual <= Math.max(15, db.calories * 0.15);

  // 3. Serving Units Plausibility Check
  const servings = matchedFood.servings || [];
  const hasCountServing = servings.some(s => s.unitType === 'COUNT' || s.unitLabel.toLowerCase().includes('piece') || s.unitLabel.toLowerCase().includes('medium') || s.unitLabel.toLowerCase().includes('small'));
  const hasVolumeServing = servings.some(s => s.unitType === 'VOLUME' || s.unitLabel.toLowerCase().includes('cup') || s.unitLabel.toLowerCase().includes('tbsp') || s.unitLabel.toLowerCase().includes('slice'));
  
  const servingIssues = [];
  if (servings.length === 0) {
    servingIssues.push('No serving units defined (only raw 100g logging)');
  } else if (!hasCountServing && !hasVolumeServing) {
    servingIssues.push('Missing practical piece / cup serving sizes');
  }

  // 4. Identify specific issues & anomalies
  const issues = [];
  if (!isMassPlausible) {
    issues.push(`Macro mass sum (${macroMassSum}g) exceeds 100g`);
  }
  if (!isAtwaterConsistent) {
    issues.push(`Atwater energy mismatch (Reported: ${db.calories} kcal, Computed: ${atwaterExpectedCal} kcal)`);
  }
  if (ref.fiber > 1.0 && db.fiber === 0) {
    issues.push(`Missing dietary fiber (Ref: ${ref.fiber}g, DB: 0g)`);
  }
  if (calVar.relPercent > 70 && db.calories > ref.calories * 1.7) {
    issues.push(`Suspicious high calorie scaling (Possible whole-piece base scaling error)`);
  }
  if (carbVar.delta > 10) {
    issues.push(`Carbohydrate divergence: Ref ${ref.carbohydrates}g vs DB ${db.carbohydrates}g`);
  }
  if (fatVar.delta > 5 && ref.fat < 2) {
    issues.push(`Excess fat reported: Ref ${ref.fat}g vs DB ${db.fat}g`);
  }

  // 5. Determine Accuracy Tier
  let accuracyTier = 'EXACT';

  if (calVar.relPercent > 80 || calVar.delta > 50 || macroMassSum > 105) {
    accuracyTier = 'CRITICAL_ANOMALY';
  } else if (calVar.relPercent > 25 || calVar.delta > 20 || carbVar.delta > 6.0) {
    accuracyTier = 'HIGH_DIVERGENCE';
  } else if (calVar.relPercent > 10 || calVar.delta > 8 || carbVar.delta > 2.5 || fiberVar.delta > 1.5) {
    accuracyTier = 'ACCEPTABLE';
  } else {
    accuracyTier = 'EXACT';
  }

  return {
    fruitId: refFruit.id,
    canonicalName: refFruit.canonicalName,
    status: 'FOUND',
    accuracyTier,
    matchScore: matchedFood.matchScore,
    dbFood: {
      id: matchedFood.id,
      name: matchedFood.name,
      source: matchedFood.source,
      category: matchedFood.category,
      brand: matchedFood.brand,
      calories: db.calories,
      carbohydrates: db.carbohydrates,
      protein: db.protein,
      fat: db.fat,
      fiber: db.fiber
    },
    reference: ref,
    deltas: {
      calories: calVar,
      carbohydrates: carbVar,
      protein: protVar,
      fat: fatVar,
      fiber: fiberVar
    },
    atwaterCheck: {
      expectedCal: atwaterExpectedCal,
      residual: atwaterResidual,
      isConsistent: isAtwaterConsistent,
      macroMassSum,
      isMassPlausible
    },
    servingCheck: {
      servingCount: servings.length,
      servings: servings.map(s => ({
        unitLabel: s.unitLabel,
        unitType: s.unitType,
        weightGrams: s.weightGrams,
        isDefault: s.isDefault
      })),
      hasCountServing,
      hasVolumeServing,
      issues: servingIssues
    },
    issues: [...issues, ...servingIssues]
  };
}

module.exports = {
  calculateVariance,
  evaluateFruitAccuracy
};
