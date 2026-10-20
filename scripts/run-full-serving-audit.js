const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runComprehensiveAudit() {
  console.log('Connecting to database...');
  await prisma.$connect();
  console.log('Connected successfully. Fetching all foods and servings...');

  const startTime = Date.now();

  // Query all active foods with their servings
  const foods = await prisma.food.findMany({
    where: { deletedAt: null },
    include: {
      servings: true,
    },
    orderBy: { name: 'asc' },
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Fetched ${foods.length} foods with servings in ${durationSec}s`);

  // Also query deleted count if any
  const deletedCount = await prisma.food.count({ where: { NOT: { deletedAt: null } } });
  const totalServingsCount = await prisma.foodServing.count();

  console.log(`Total active foods: ${foods.length}, Deleted foods: ${deletedCount}, Total FoodServings in DB: ${totalServingsCount}`);

  // 1. UNIT NORMALIZATION & CATEGORIZATION
  // Helper to categorize unit strings
  function classifyUnit(unitLabelRaw, unitTypeRaw) {
    if (!unitLabelRaw) return 'MISSING_LABEL';
    const label = unitLabelRaw.trim().toLowerCase();

    // Mass
    if (label === 'g' || label === 'gram' || label === 'grams' || label === '100g' || label.endsWith(' g') || label.endsWith('g')) {
      if (!label.includes('kg') && !label.includes('cup') && !label.includes('tbsp') && !label.includes('tsp')) {
        return 'GRAMS';
      }
    }
    if (label === 'kg' || label === 'kilogram' || label === 'kilograms' || label.endsWith(' kg')) {
      return 'KILOGRAMS';
    }

    // Volume
    if (label === 'ml' || label === 'millilitre' || label === 'milliliter' || label === 'millilitres' || label === 'milliliters' || label.endsWith(' ml') || label.endsWith('ml')) {
      return 'MILLILITRES';
    }
    if (label === 'l' || label === 'liter' || label === 'litre' || label === 'liters' || label === 'litres' || label.endsWith(' l')) {
      return 'LITRES';
    }

    // Household
    if (label.includes('katori')) return 'KATORI';
    if (label.includes('cup')) return 'CUP';
    if (label.includes('bowl')) return 'BOWL';
    if (label.includes('tbsp') || label.includes('tablespoon')) return 'TABLESPOON';
    if (label.includes('tsp') || label.includes('teaspoon')) return 'TEASPOON';
    if (label.includes('glass')) return 'GLASS';
    if (label.includes('plate') || label.includes('thali')) return 'PLATE';
    if (label.includes('ladle')) return 'LADLE';

    // Count / Pieces
    if (label.includes('piece') || label.includes('pc') || label === 'pieces' || label.endsWith(' pcs')) return 'PIECE';
    if (label.includes('slice')) return 'SLICE';
    if (label.includes('roti') || label.includes('chapati') || label.includes('phulka')) return 'ROTI';
    if (label.includes('puri') || label.includes('poori')) return 'PURI';
    if (label.includes('idli')) return 'IDLI';
    if (label.includes('dosa')) return 'DOSA';
    if (label.includes('paratha')) return 'PARATHA';
    if (label.includes('banana')) return 'BANANA';
    if (label.includes('egg') || label.includes('scoop') || label.includes('bar') || label.includes('pack') || label.includes('biscuit') || label.includes('cookie')) return 'COUNT_ITEM';
    if (label.includes('serving') || label.includes('portion')) return 'SERVING';

    return 'CUSTOM_OTHER';
  }

  // 2. STATISTICS ACCUMULATORS
  const unitFrequency = {}; // unitLabel -> count of servings
  const unitCategoryCounts = {}; // category -> count of servings
  const foodUnitCategorySupport = {}; // category -> count of distinct foods supporting it
  const foodsByServingCount = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 };

  const missingDefaultCount = [];
  const multipleDefaultCount = [];
  const invalidWeights = []; // weightGrams <= 0 or NaN or null
  const missingDisplayQty = [];
  const potentialLabelPrefixDupes = []; // e.g. "1 1 medium puri" or "100 100g"

  // Source & Category breakdowns
  const sourceStats = {};
  const categoryStats = {};
  const brandVsGenericStats = { branded: 0, generic: 0 };
  const preparationStateStats = { raw: 0, cooked: 0, fried: 0, boiled: 0, roasted: 0, baked: 0, unspecified: 0 };

  // Nutrition plausibility accumulators
  const atwaterViolations = [];
  const macroSumViolations = [];
  const extremeCalories = [];

  // Duplication analysis
  const normalizedNameGroups = new Map();

  for (const food of foods) {
    // Brand vs generic
    const isBranded = Boolean(food.brand && food.brand.trim() !== '');
    if (isBranded) brandVsGenericStats.branded++;
    else brandVsGenericStats.generic++;

    // Source stats
    const src = food.source || 'UNKNOWN';
    if (!sourceStats[src]) {
      sourceStats[src] = { count: 0, withServings: 0, multiServing: 0, totalServings: 0 };
    }
    sourceStats[src].count++;
    sourceStats[src].totalServings += food.servings.length;
    if (food.servings.length > 0) sourceStats[src].withServings++;
    if (food.servings.length > 1) sourceStats[src].multiServing++;

    // Category stats
    const cat = food.category || 'Uncategorized';
    if (!categoryStats[cat]) {
      categoryStats[cat] = { count: 0, singleServing: 0, multiServing: 0, unitTypes: new Set(), units: new Set() };
    }
    categoryStats[cat].count++;
    if (food.servings.length === 1) categoryStats[cat].singleServing++;
    if (food.servings.length > 1) categoryStats[cat].multiServing++;

    // Preparation state heuristic
    const nameLower = food.name.toLowerCase();
    if (nameLower.includes('raw')) preparationStateStats.raw++;
    else if (nameLower.includes('cooked')) preparationStateStats.cooked++;
    else if (nameLower.includes('fried') || nameLower.includes('deep fried')) preparationStateStats.fried++;
    else if (nameLower.includes('boiled')) preparationStateStats.boiled++;
    else if (nameLower.includes('roasted')) preparationStateStats.roasted++;
    else if (nameLower.includes('baked')) preparationStateStats.baked++;
    else preparationStateStats.unspecified++;

    // Serving count breakdown
    const numServings = food.servings.length;
    if (numServings === 0) foodsByServingCount[0]++;
    else if (numServings === 1) foodsByServingCount[1]++;
    else if (numServings === 2) foodsByServingCount[2]++;
    else if (numServings === 3) foodsByServingCount[3]++;
    else foodsByServingCount['4+']++;

    // Servings integrity checks
    const defaultServings = food.servings.filter(s => s.isDefault);
    if (food.servings.length > 0 && defaultServings.length === 0) {
      missingDefaultCount.push({ foodId: food.id, name: food.name, servingsCount: food.servings.length });
    } else if (defaultServings.length > 1) {
      multipleDefaultCount.push({ foodId: food.id, name: food.name, defaultCount: defaultServings.length });
    }

    // Distinct units supported by this food
    const foodSupportedUnitCategories = new Set();

    for (const serving of food.servings) {
      const rawLabel = serving.unitLabel || '';
      unitFrequency[rawLabel] = (unitFrequency[rawLabel] || 0) + 1;

      const unitCat = classifyUnit(rawLabel, serving.unitType);
      unitCategoryCounts[unitCat] = (unitCategoryCounts[unitCat] || 0) + 1;
      foodSupportedUnitCategories.add(unitCat);
      categoryStats[cat].units.add(rawLabel);
      categoryStats[cat].unitTypes.add(serving.unitType);

      // Check invalid weight
      if (serving.weightGrams === null || serving.weightGrams === undefined || isNaN(serving.weightGrams) || serving.weightGrams <= 0) {
        invalidWeights.push({
          foodId: food.id,
          foodName: food.name,
          servingId: serving.id,
          unitLabel: serving.unitLabel,
          weightGrams: serving.weightGrams,
        });
      }

      // Check missing display quantity on non-WEIGHT units
      if (serving.unitType !== 'WEIGHT' && (serving.displayQuantity === null || serving.displayQuantity === undefined)) {
        missingDisplayQty.push({
          foodId: food.id,
          foodName: food.name,
          servingId: serving.id,
          unitLabel: serving.unitLabel,
          unitType: serving.unitType,
        });
      }

      // Check potential label redundancy like "1 1 medium puri" or "100 100g"
      // If label starts with a number e.g. "1 medium puri" or "100g" or "1 piece"
      const numberPrefixMatch = rawLabel.match(/^(\d+(\.\d+)?)\s*(.+)$/);
      if (numberPrefixMatch) {
        potentialLabelPrefixDupes.push({
          foodId: food.id,
          foodName: food.name,
          servingId: serving.id,
          unitLabel: rawLabel,
          parsedNumber: numberPrefixMatch[1],
          remainder: numberPrefixMatch[3],
          displayQuantity: serving.displayQuantity,
        });
      }
    }

    for (const unitCat of foodSupportedUnitCategories) {
      foodUnitCategorySupport[unitCat] = (foodUnitCategorySupport[unitCat] || 0) + 1;
    }

    // 3. NUTRITION INVARIANT CHECKS (Per 100g)
    // Macro sum: protein + fat + carbs + fiber
    const macroSum = (food.protein || 0) + (food.fat || 0) + (food.carbohydrates || 0) + (food.fiber || 0);
    if (macroSum > 105) {
      macroSumViolations.push({
        foodId: food.id,
        name: food.name,
        macroSum: parseFloat(macroSum.toFixed(2)),
        protein: food.protein,
        fat: food.fat,
        carbs: food.carbohydrates,
        fiber: food.fiber,
        source: food.source,
      });
    }

    // Atwater Energy Invariant: 4 * P + 4 * C + 9 * F
    const atwaterCal = (food.protein || 0) * 4 + (food.carbohydrates || 0) * 4 + (food.fat || 0) * 9;
    const diff = Math.abs((food.calories || 0) - atwaterCal);
    if (food.calories > 10 && diff > 50 && (diff / food.calories) > 0.3) {
      atwaterViolations.push({
        foodId: food.id,
        name: food.name,
        calories: food.calories,
        atwaterCalculated: Math.round(atwaterCal),
        diff: Math.round(diff),
        source: food.source,
      });
    }

    if (food.calories > 950 || (food.calories <= 0 && food.category !== 'Beverages' && food.category !== 'Water')) {
      extremeCalories.push({
        foodId: food.id,
        name: food.name,
        calories: food.calories,
        category: food.category,
      });
    }

    // 4. DUPLICATION CANDIDATE DETECTION
    // Normalize name: remove punctuation, brackets, unit patterns like "100g", "1 cup", etc.
    const cleanName = food.name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\b(100g|100\s*g|1\s*cup|1\s*katori|1\s*piece|1\s*serving|medium|large|small|raw|cooked)\b/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanName.length > 2) {
      const groupKey = `${cleanName}:::${food.category || ''}`;
      if (!normalizedNameGroups.has(groupKey)) {
        normalizedNameGroups.set(groupKey, []);
      }
      normalizedNameGroups.get(groupKey).push({
        id: food.id,
        rawName: food.name,
        brand: food.brand,
        source: food.source,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbohydrates,
        fat: food.fat,
        servings: food.servings.map(s => ({
          unit: s.unitLabel,
          weightGrams: s.weightGrams,
          unitType: s.unitType,
        })),
      });
    }
  }

  // 5. ANALYZE DUPLICATES
  const duplicateGroupsWithDiffServings = [];
  const duplicateGroupsWithConflictingMacros = [];

  for (const [key, items] of normalizedNameGroups.entries()) {
    if (items.length > 1) {
      // Check if they differ in servings
      const allUnits = new Set();
      let hasConflictingCal = false;
      const minCal = Math.min(...items.map(i => i.calories));
      const maxCal = Math.max(...items.map(i => i.calories));

      if (maxCal > 0 && (maxCal - minCal) > 30 && (maxCal - minCal) / maxCal > 0.25) {
        hasConflictingCal = true;
      }

      items.forEach(i => i.servings.forEach(s => allUnits.add(s.unit)));

      // If items have different serving labels or multiple entries for same clean name
      if (allUnits.size > 1 || items.length >= 2) {
        duplicateGroupsWithDiffServings.push({
          normalizedKey: key,
          count: items.length,
          items: items.slice(0, 5), // top 5
        });
      }

      if (hasConflictingCal) {
        duplicateGroupsWithConflictingMacros.push({
          normalizedKey: key,
          minCal,
          maxCal,
          items: items.slice(0, 5),
        });
      }
    }
  }

  // 6. SPECIFIC INVESTIGATION TARGETS
  // A. Countable Foods requiring gram-based entry
  const countableKeywords = ['roti', 'chapati', 'phulka', 'puri', 'poori', 'idli', 'dosa', 'paratha', 'banana', 'egg', 'samosa', 'vada'];
  const countableStaplesWithoutCountServing = [];
  const countableStaplesWithCountServing = [];

  for (const food of foods) {
    const nameLow = food.name.toLowerCase();
    const matchedKeyword = countableKeywords.find(k => nameLow.includes(k));
    if (matchedKeyword) {
      // Check if food has count or piece serving
      const hasCountServing = food.servings.some(s => {
        const u = classifyUnit(s.unitLabel, s.unitType);
        return ['PIECE', 'SLICE', 'ROTI', 'PURI', 'IDLI', 'DOSA', 'PARATHA', 'BANANA', 'COUNT_ITEM'].includes(u);
      });

      if (hasCountServing) {
        countableStaplesWithCountServing.push({
          id: food.id,
          name: food.name,
          keyword: matchedKeyword,
          servings: food.servings.map(s => `${s.unitLabel} (${s.weightGrams}g)`),
        });
      } else {
        countableStaplesWithoutCountServing.push({
          id: food.id,
          name: food.name,
          keyword: matchedKeyword,
          servings: food.servings.map(s => `${s.unitLabel} (${s.weightGrams}g)`),
        });
      }
    }
  }

  // B. Liquid/Gravy Foods (Dal, Rice, Sabzi, Curries) Unit Analysis
  const liquidKeywords = ['dal', 'daal', 'sambar', 'rasam', 'curry', 'sabzi', 'gravy', 'milk', 'soup', 'khichdi', 'rice'];
  const liquidUnitBreakdown = {
    total: 0,
    hasKatori: 0,
    hasBowl: 0,
    hasCup: 0,
    hasMl: 0,
    gramsOnly: 0,
    examplesGramsOnly: [],
    examplesWithHousehold: [],
  };

  for (const food of foods) {
    const nameLow = food.name.toLowerCase();
    const matched = liquidKeywords.some(k => nameLow.includes(k));
    if (matched) {
      liquidUnitBreakdown.total++;
      let hasKatori = false;
      let hasBowl = false;
      let hasCup = false;
      let hasMl = false;
      let hasGrams = false;

      for (const s of food.servings) {
        const u = classifyUnit(s.unitLabel, s.unitType);
        if (u === 'KATORI') hasKatori = true;
        if (u === 'BOWL') hasBowl = true;
        if (u === 'CUP') hasCup = true;
        if (u === 'MILLILITRES' || u === 'LITRES') hasMl = true;
        if (u === 'GRAMS') hasGrams = true;
      }

      if (hasKatori) liquidUnitBreakdown.hasKatori++;
      if (hasBowl) liquidUnitBreakdown.hasBowl++;
      if (hasCup) liquidUnitBreakdown.hasCup++;
      if (hasMl) liquidUnitBreakdown.hasMl++;

      if (hasGrams && !hasKatori && !hasBowl && !hasCup && !hasMl) {
        liquidUnitBreakdown.gramsOnly++;
        if (liquidUnitBreakdown.examplesGramsOnly.length < 15) {
          liquidUnitBreakdown.examplesGramsOnly.push({
            id: food.id,
            name: food.name,
            servings: food.servings.map(s => s.unitLabel),
          });
        }
      } else if (hasKatori || hasBowl || hasCup || hasMl) {
        if (liquidUnitBreakdown.examplesWithHousehold.length < 15) {
          liquidUnitBreakdown.examplesWithHousehold.push({
            id: food.id,
            name: food.name,
            servings: food.servings.map(s => `${s.unitLabel} (${s.weightGrams}g)`),
          });
        }
      }
    }
  }

  // 7. COMPILATION OF TEST / SIMULATION RESULTS
  // We simulate real conversions & decimal portion inputs across units to detect defects
  const calculationTests = [
    {
      testName: 'Piece Scaling (1.5 Roti)',
      unitType: 'COUNT',
      baseServing: { unitLabel: 'roti', weightGrams: 35, displayQuantity: 1 },
      inputQuantity: 1.5,
      expectedWeightGrams: 52.5,
      food100gMacros: { calories: 297, protein: 9.6, carbs: 55.8, fat: 3.5, fiber: 4.2 },
    },
    {
      testName: 'Katori Scaling (0.75 Medium Katori Dal)',
      unitType: 'HOUSEHOLD',
      baseServing: { unitLabel: 'katori', weightGrams: 150, displayQuantity: 1 },
      inputQuantity: 0.75,
      expectedWeightGrams: 112.5,
      food100gMacros: { calories: 104, protein: 6.8, carbs: 15.2, fat: 1.2, fiber: 3.1 },
    },
    {
      testName: 'Volume Scaling (250 ml Milk from 200 ml serving of 206g)',
      unitType: 'VOLUME',
      baseServing: { unitLabel: 'ml', weightGrams: 206, displayQuantity: 200 },
      inputQuantity: 250,
      expectedWeightGrams: 257.5,
      food100gMacros: { calories: 65, protein: 3.2, carbs: 4.8, fat: 3.7, fiber: 0 },
    },
    {
      testName: 'Gram Direct Input (75 g)',
      unitType: 'WEIGHT',
      baseServing: { unitLabel: 'g', weightGrams: 100, displayQuantity: 100 },
      inputQuantity: 75,
      expectedWeightGrams: 75,
      food100gMacros: { calories: 250, protein: 10, carbs: 40, fat: 5, fiber: 2 },
    },
  ];

  const testResults = calculationTests.map(t => {
    // Formula from QuantitySelector & tracker.service
    const baseDisplay = t.baseServing.displayQuantity || (t.unitType === 'WEIGHT' ? t.baseServing.weightGrams : 1);
    const ratio = t.inputQuantity / baseDisplay;
    const resolvedWeight = Math.round(ratio * t.baseServing.weightGrams * 10) / 10;
    const multiplier = resolvedWeight / 100;

    const calcCalories = Math.round(t.food100gMacros.calories * multiplier * 10) / 10;
    const calcProtein = Math.round(t.food100gMacros.protein * multiplier * 10) / 10;
    const calcCarbs = Math.round(t.food100gMacros.carbs * multiplier * 10) / 10;
    const calcFat = Math.round(t.food100gMacros.fat * multiplier * 10) / 10;

    const passWeight = Math.abs(resolvedWeight - t.expectedWeightGrams) < 0.01;

    return {
      testName: t.testName,
      inputQuantity: t.inputQuantity,
      unit: t.baseServing.unitLabel,
      resolvedWeight,
      expectedWeight: t.expectedWeightGrams,
      pass: passWeight,
      calculatedMacros: {
        calories: calcCalories,
        protein: calcProtein,
        carbs: calcCarbs,
        fat: calcFat,
      },
    };
  });

  const summary = {
    totalFoods: foods.length,
    deletedFoods: deletedCount,
    totalServings: totalServingsCount,
    foodsByServingCount,
    brandVsGenericStats,
    sourceStats,
    preparationStateStats,
    unitFrequencyTop50: Object.entries(unitFrequency).sort((a, b) => b[1] - a[1]).slice(0, 50),
    unitCategoryCounts,
    foodUnitCategorySupport,
    missingDefaultCount: missingDefaultCount.length,
    missingDefaultSample: missingDefaultCount.slice(0, 10),
    multipleDefaultCount: multipleDefaultCount.length,
    multipleDefaultSample: multipleDefaultCount.slice(0, 10),
    invalidWeightsCount: invalidWeights.length,
    invalidWeightsSample: invalidWeights.slice(0, 10),
    missingDisplayQtyCount: missingDisplayQty.length,
    missingDisplayQtySample: missingDisplayQty.slice(0, 10),
    potentialLabelPrefixDupesCount: potentialLabelPrefixDupes.length,
    potentialLabelPrefixDupesSample: potentialLabelPrefixDupes.slice(0, 15),
    macroSumViolationsCount: macroSumViolations.length,
    macroSumViolationsSample: macroSumViolations.slice(0, 10),
    atwaterViolationsCount: atwaterViolations.length,
    atwaterViolationsSample: atwaterViolations.slice(0, 10),
    extremeCaloriesCount: extremeCalories.length,
    duplicateGroupsCount: duplicateGroupsWithDiffServings.length,
    duplicateGroupsSample: duplicateGroupsWithDiffServings.slice(0, 15),
    conflictingMacroGroupsCount: duplicateGroupsWithConflictingMacros.length,
    conflictingMacroGroupsSample: duplicateGroupsWithConflictingMacros.slice(0, 15),
    countableStaples: {
      withCountServingCount: countableStaplesWithCountServing.length,
      withCountServingSample: countableStaplesWithCountServing.slice(0, 10),
      withoutCountServingCount: countableStaplesWithoutCountServing.length,
      withoutCountServingSample: countableStaplesWithoutCountServing.slice(0, 15),
    },
    liquidUnitBreakdown,
    testResults,
  };

  const outputPath = path.join(__dirname, 'audit-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\nAudit successfully completed! Results saved to: ${outputPath}`);

  await prisma.$disconnect();
  return summary;
}

runComprehensiveAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
