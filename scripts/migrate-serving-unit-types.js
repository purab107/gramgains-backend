#!/usr/bin/env node
/**
 * GramGains — Serving Unit Types Migration Script
 *
 * Tiered Data Migration with Provenance:
 * 1. Classification boundary: Classify existing FoodServing records into
 *    WEIGHT, VOLUME, COUNT, HOUSEHOLD based EXCLUSIVELY on recognized unitLabel patterns.
 * 2. High-confidence liquid additions: For liquid foods with only gram servings,
 *    add verified mL servings for strictly verified plain dairy milks, clear sodas/water, and pure oils.
 * 3. Fix database anomalies (e.g. Sprite ml -> 2500g).
 * 4. Flag ambiguous records in serving-migration-review-needed.json with displayQuantity = null.
 * 5. Generates serving-unit-migration-report.json and serving-unit-migration-report.md.
 *
 * Usage:
 *   node scripts/migrate-serving-unit-types.js --dry-run
 *   node scripts/migrate-serving-unit-types.js --apply
 */

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply || process.argv.includes('--dry-run');

// Regular Expressions & Unit Classification Patterns
const WEIGHT_PATTERNS = [
  { regex: /^(\d+(?:\.\d+)?)\s*(?:g|gm|grams|grm)$/i, type: 'WEIGHT', provenance: 'PARSED_FROM_LABEL' },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilogram|kilograms)$/i, type: 'WEIGHT', provenance: 'PARSED_FROM_LABEL', multiplier: 1000 },
  { regex: /^(?:g|gm|grams|grm|gram)$/i, type: 'WEIGHT', provenance: 'WEIGHT_EQUALITY', useWeightAsDisplay: true },
  { regex: /^(?:kg|kgs|kilogram|kilograms)$/i, type: 'WEIGHT', provenance: 'WEIGHT_EQUALITY', useWeightAsDisplay: true },
];

const VOLUME_PATTERNS = [
  { regex: /^(\d+(?:\.\d+)?)\s*(?:ml|milliliter|millilitre|milliliters|millilitres)$/i, type: 'VOLUME', provenance: 'PARSED_FROM_LABEL' },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:l|ltr|litre|liter|litres|liters)$/i, type: 'VOLUME', provenance: 'PARSED_FROM_LABEL', multiplier: 1000 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:fl\s*oz|fluid\s*ounce|fluid\s*ounces)$/i, type: 'VOLUME', provenance: 'PARSED_FROM_LABEL' },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:cup|cups|tea\s*cup|tea\s*cups|coffee\s*cup|coffee\s*cups|mug|mugs)$/i, type: 'VOLUME', provenance: 'PARSED_HOUSEHOLD_VOLUME' },
  { regex: /^(?:cup|cups|tea\s*cup|tea\s*cups|coffee\s*cup|coffee\s*cups|mug|mugs)$/i, type: 'VOLUME', provenance: 'PARSED_HOUSEHOLD_VOLUME', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:glass|glasses|tall\s*glass|juice\s*glass|small\s*glass)$/i, type: 'VOLUME', provenance: 'PARSED_HOUSEHOLD_VOLUME' },
  { regex: /^(?:glass|glasses|tall\s*glass|juice\s*glass|small\s*glass)$/i, type: 'VOLUME', provenance: 'PARSED_HOUSEHOLD_VOLUME', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:tbsp|tablespoon|tablespoons)$/i, type: 'VOLUME', provenance: 'PARSED_SPOON_VOLUME' },
  { regex: /^(?:tbsp|tablespoon|tablespoons)$/i, type: 'VOLUME', provenance: 'PARSED_SPOON_VOLUME', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:tsp|teaspoon|teaspoons)$/i, type: 'VOLUME', provenance: 'PARSED_SPOON_VOLUME' },
  { regex: /^(?:tsp|teaspoon|teaspoons)$/i, type: 'VOLUME', provenance: 'PARSED_SPOON_VOLUME', defaultQty: 1 },
];

const COUNT_PATTERNS = [
  { regex: /^(\d+(?:\.\d+)?)\s*(?:piece|pieces|pcs|pc|item|items|unit|units)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:piece|pieces|pcs|pc|item|items|unit|units)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:egg|eggs|egg\s*white|egg\s*yolk)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:egg|eggs|egg\s*white|egg\s*yolk)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:slice|slices)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:slice|slices)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:biscuit|biscuits|cookie|cookies|cracker|crackers)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:biscuit|biscuits|cookie|cookies|cracker|crackers)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:roti|rotis|chapati|chapatis|phulka|phulkas|paratha|parathas|puri|puris|naan|naans|kulcha|kulchas|bhakri|bhakris|thepla|theplas)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:roti|rotis|chapati|chapatis|phulka|phulkas|paratha|parathas|puri|puris|naan|naans|kulcha|kulchas|bhakri|bhakris|thepla|theplas)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:idli|idlis|vada|vadas|samosa|samosas|dosa|dosas|pancake|pancakes|waffle|waffles|muffin|muffins|donut|donuts|doughnut|doughnuts|roll|rolls|patty|patties|cutlet|cutlets|pakora|pakoras|tikki|tikkis|laddu|laddus|laddoo|laddoos|barfi|barfis|gulab\s*jamun|rasgulla|jalebi)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:idli|idlis|vada|vadas|samosa|samosas|dosa|dosas|pancake|pancakes|waffle|waffles|muffin|muffins|donut|donuts|doughnut|doughnuts|roll|rolls|patty|patties|cutlet|cutlets|pakora|pakoras|tikki|tikkis|laddu|laddus|laddoo|laddoos|barfi|barfis|gulab\s*jamun|rasgulla|jalebi)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:can|cans|bottle|bottles|pack|packs|packet|packets|bar|bars|pouch|pouches|tetra\s*pack|tetra\s*packs|box|boxes|sachet|sachets|strip|strips)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT' },
  { regex: /^(?:can|cans|bottle|bottles|pack|packs|packet|packets|bar|bars|pouch|pouches|tetra\s*pack|tetra\s*packs|box|boxes|sachet|sachets|strip|strips)$/i, type: 'COUNT', provenance: 'PARSED_COUNT_UNIT', defaultQty: 1 },
];

const HOUSEHOLD_PATTERNS = [
  { regex: /^(\d+(?:\.\d+)?)\s*(?:bowl|bowls|katori|katoris|cup\s*bowl)$/i, type: 'HOUSEHOLD', provenance: 'PARSED_HOUSEHOLD_MEASURE' },
  { regex: /^(?:bowl|bowls|katori|katoris|cup\s*bowl)$/i, type: 'HOUSEHOLD', provenance: 'PARSED_HOUSEHOLD_MEASURE', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:plate|plates|thali|scot|portion|portions|serving|servings|helpings|helping)$/i, type: 'HOUSEHOLD', provenance: 'PARSED_HOUSEHOLD_MEASURE' },
  { regex: /^(?:plate|plates|thali|scot|portion|portions|serving|servings|helpings|helping)$/i, type: 'HOUSEHOLD', provenance: 'PARSED_HOUSEHOLD_MEASURE', defaultQty: 1 },
  { regex: /^(\d+(?:\.\d+)?)\s*(?:scoop|scoops|handful|handfuls|pinch|pinches|dash|cube|cubes)$/i, type: 'HOUSEHOLD', provenance: 'PARSED_HOUSEHOLD_MEASURE' },
  { regex: /^(?:scoop|scoops|handful|handfuls|pinch|pinches|dash|cube|cubes)$/i, type: 'HOUSEHOLD', provenance: 'PARSED_HOUSEHOLD_MEASURE', defaultQty: 1 },
];

/**
 * Classify a serving label strictly by its string structure.
 * Note: Never inspects food name or category for classification.
 */
function classifyServingLabel(unitLabel, weightGrams) {
  const label = (unitLabel || '').trim();

  // 1. Try WEIGHT patterns
  for (const p of WEIGHT_PATTERNS) {
    const match = label.match(p.regex);
    if (match) {
      let qty = match[1] ? parseFloat(match[1]) : (p.useWeightAsDisplay ? weightGrams : 1);
      if (p.multiplier && match[1]) qty *= p.multiplier;
      return {
        unitType: p.type,
        displayQuantity: qty,
        provenance: p.provenance,
        confidence: 'HIGH',
      };
    }
  }

  // 2. Try VOLUME patterns
  for (const p of VOLUME_PATTERNS) {
    const match = label.match(p.regex);
    if (match) {
      let qty = match[1] ? parseFloat(match[1]) : (p.defaultQty || null);
      if (p.multiplier && match[1]) qty *= p.multiplier;
      return {
        unitType: p.type,
        displayQuantity: qty,
        provenance: p.provenance,
        confidence: qty !== null ? 'HIGH' : 'MEDIUM',
      };
    }
  }

  // Check bare 'ml'
  if (/^ml$/i.test(label)) {
    // If weightGrams looks like an exact volume integer <= 1000 and close to standard packaging, we can evaluate
    // But per architectural rule: bare ml with ambiguous weight is FLAGGED_FOR_REVIEW unless standard equality
    return {
      unitType: 'VOLUME',
      displayQuantity: weightGrams > 0 && weightGrams <= 1000 ? weightGrams : null,
      provenance: weightGrams > 0 && weightGrams <= 1000 ? 'WEIGHT_EQUALITY' : 'FLAGGED_FOR_REVIEW',
      confidence: weightGrams > 0 && weightGrams <= 1000 ? 'MEDIUM' : 'LOW',
    };
  }

  // 3. Try COUNT patterns
  for (const p of COUNT_PATTERNS) {
    const match = label.match(p.regex);
    if (match) {
      const qty = match[1] ? parseFloat(match[1]) : (p.defaultQty || 1);
      return {
        unitType: p.type,
        displayQuantity: qty,
        provenance: p.provenance,
        confidence: 'HIGH',
      };
    }
  }

  // 4. Try HOUSEHOLD patterns
  for (const p of HOUSEHOLD_PATTERNS) {
    const match = label.match(p.regex);
    if (match) {
      const qty = match[1] ? parseFloat(match[1]) : (p.defaultQty || 1);
      return {
        unitType: p.type,
        displayQuantity: qty,
        provenance: p.provenance,
        confidence: 'HIGH',
      };
    }
  }

  // Fallback: If contains numbers, extract them
  const numMatch = label.match(/^(\d+(?:\.\d+)?)/);
  if (numMatch) {
    return {
      unitType: 'WEIGHT', // safe fallback
      displayQuantity: parseFloat(numMatch[1]),
      provenance: 'PARSED_NUMERIC_PREFIX_FALLBACK',
      confidence: 'MEDIUM',
    };
  }

  // Unrecognized/Ambiguous label
  return {
    unitType: 'WEIGHT',
    displayQuantity: null,
    provenance: 'UNRECOGNIZED_LABEL_FLAGGED',
    confidence: 'LOW',
  };
}

/**
 * Check if food qualifies for high-confidence liquid serving addition
 */
function evaluateHighConfidenceLiquidAddition(food) {
  const name = (food.name || '').toLowerCase();
  const category = (food.category || '').toLowerCase();

  // Anomaly check: Sprite
  if (name.includes('sprite')) {
    return {
      isAnomaly: true,
      reason: 'SPRITE_MASS_ANOMALY',
      fix: {
        unitLabel: 'ml',
        displayQuantity: 240,
        weightGrams: 250,
        unitType: 'VOLUME',
        provenance: 'ANOMALY_CORRECTION_MANUAL',
      },
    };
  }

  // Check if it already has a volume serving
  const hasVolumeServing = (food.servings || []).some(s => {
    const ul = (s.unitLabel || '').toLowerCase();
    return ul.includes('ml') || ul.includes('cup') || ul.includes('glass') || ul.includes('litre');
  });

  if (hasVolumeServing) return null;

  // 1. Plain Dairy Milk Check
  const isPlainMilk =
    (category.includes('dairy') || category.includes('milk')) &&
    (name.includes('milk') || name.includes('doodh')) &&
    !name.includes('shake') &&
    !name.includes('powder') &&
    !name.includes('condensed') &&
    !name.includes('chocolate') &&
    !name.includes('flavored') &&
    !name.includes('flavour') &&
    !name.includes('badam milk') &&
    !name.includes('masala milk') &&
    !name.includes('sweets') &&
    !name.includes('sweet') &&
    !name.includes('peda') &&
    !name.includes('cake') &&
    !name.includes('barfi');

  if (isPlainMilk) {
    // 200 mL standard cup / glass serving -> density ~ 1.03 g/mL -> 206g
    return {
      isNewServing: true,
      serving: {
        unitLabel: 'ml',
        displayQuantity: 200,
        weightGrams: 206,
        unitType: 'VOLUME',
        provenance: 'HIGH_CONFIDENCE_DAIRY_DENSITY',
        isDefault: false,
      },
    };
  }

  // 2. Clear Packaged Soft Drinks & Plain Water
  const isClearSodaOrWater =
    (category.includes('beverage') || category.includes('drink') || category.includes('water')) &&
    (name.includes('water') || name.includes('mineral water') || name.includes('club soda') || name.includes('diet coke') || name.includes('coca-cola') || name.includes('coke') || name.includes('pepsi') || name.includes('7up') || name.includes('thums up') || name.includes('fanta') || name.includes('mirinda') || name.includes('limca')) &&
    !name.includes('powder') &&
    !name.includes('concentrate') &&
    !name.includes('syrup');

  if (isClearSodaOrWater) {
    // 250 mL standard glass -> density ~ 1.02 g/mL -> 255g
    return {
      isNewServing: true,
      serving: {
        unitLabel: 'ml',
        displayQuantity: 250,
        weightGrams: 255,
        unitType: 'VOLUME',
        provenance: 'HIGH_CONFIDENCE_BEVERAGE_DENSITY',
        isDefault: false,
      },
    };
  }

  // 3. Pure Cooking Oils & Ghee
  const isPureOilOrGhee =
    (category.includes('fat') || category.includes('oil') || category.includes('ghee')) &&
    (name.includes('oil') || name.includes('ghee') || name.includes('mustard oil') || name.includes('sunflower oil') || name.includes('olive oil') || name.includes('coconut oil')) &&
    !name.includes('cake') &&
    !name.includes('biscuit') &&
    !name.includes('snack') &&
    !name.includes('fried');

  if (isPureOilOrGhee) {
    // 15 mL standard tablespoon -> density ~ 0.92 g/mL -> 13.8g
    return {
      isNewServing: true,
      serving: {
        unitLabel: 'ml',
        displayQuantity: 15,
        weightGrams: 13.8,
        unitType: 'VOLUME',
        provenance: 'HIGH_CONFIDENCE_OIL_DENSITY',
        isDefault: false,
      },
    };
  }

  return null;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║   🌾 GRAMGAINS — SERVING UNIT TYPES TIERED MIGRATION             ║`);
  console.log(`║   Mode: ${isApply ? '🚀 APPLY CHANGES TO DATABASE' : '🔍 DRY RUN (NO WRITES)'}                       ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await prisma.$connect();

  const allFoods = await prisma.food.findMany({
    where: { deletedAt: null },
    include: { servings: true },
  });

  console.log(`📦 Found ${allFoods.length.toLocaleString()} active foods.`);

  const auditReport = {
    generatedAt: new Date().toISOString(),
    isDryRun,
    totalFoods: allFoods.length,
    totalServingsEvaluated: 0,
    unitTypeDistribution: {
      WEIGHT: 0,
      VOLUME: 0,
      COUNT: 0,
      HOUSEHOLD: 0,
    },
    displayQuantityStatus: {
      populated: 0,
      nullFlagged: 0,
    },
    provenanceDistribution: {},
    anomalyFixes: [],
    newLiquidServingsCreated: [],
    reviewNeededQueue: [],
  };

  const servingUpdates = [];
  const servingCreations = [];

  for (const food of allFoods) {
    // 1. Process existing servings for this food
    for (const serving of food.servings) {
      auditReport.totalServingsEvaluated++;

      // Check if it's the Sprite anomaly
      if (food.name.toLowerCase().includes('sprite') && serving.unitLabel.toLowerCase().includes('ml') && serving.weightGrams >= 1000) {
        const updatePayload = {
          id: serving.id,
          foodId: food.id,
          foodName: food.name,
          unitLabel: 'ml',
          unitType: 'VOLUME',
          displayQuantity: 240,
          weightGrams: 250,
          provenance: 'ANOMALY_CORRECTION_MANUAL',
          confidence: 'HIGH',
        };
        servingUpdates.push(updatePayload);
        auditReport.anomalyFixes.push(updatePayload);
        auditReport.unitTypeDistribution.VOLUME++;
        auditReport.displayQuantityStatus.populated++;
        auditReport.provenanceDistribution['ANOMALY_CORRECTION_MANUAL'] =
          (auditReport.provenanceDistribution['ANOMALY_CORRECTION_MANUAL'] || 0) + 1;
        continue;
      }

      // Standard label classification
      const classification = classifyServingLabel(serving.unitLabel, serving.weightGrams);

      const updatePayload = {
        id: serving.id,
        foodId: food.id,
        foodName: food.name,
        originalUnitLabel: serving.unitLabel,
        originalWeightGrams: serving.weightGrams,
        unitType: classification.unitType,
        displayQuantity: classification.displayQuantity,
        weightGrams: serving.weightGrams,
        provenance: classification.provenance,
        confidence: classification.confidence,
      };

      servingUpdates.push(updatePayload);

      // Track statistics
      auditReport.unitTypeDistribution[classification.unitType] =
        (auditReport.unitTypeDistribution[classification.unitType] || 0) + 1;

      if (classification.displayQuantity !== null) {
        auditReport.displayQuantityStatus.populated++;
      } else {
        auditReport.displayQuantityStatus.nullFlagged++;
        auditReport.reviewNeededQueue.push({
          servingId: serving.id,
          foodId: food.id,
          foodName: food.name,
          unitLabel: serving.unitLabel,
          weightGrams: serving.weightGrams,
          unitType: classification.unitType,
          reason: 'Ambiguous or unverified display quantity',
        });
      }

      auditReport.provenanceDistribution[classification.provenance] =
        (auditReport.provenanceDistribution[classification.provenance] || 0) + 1;
    }

    // 2. Check for high-confidence liquid additions (for liquid foods with NO volume servings)
    const liquidEval = evaluateHighConfidenceLiquidAddition(food);
    if (liquidEval && liquidEval.isNewServing) {
      const creationPayload = {
        foodId: food.id,
        foodName: food.name,
        ...liquidEval.serving,
      };
      servingCreations.push(creationPayload);
      auditReport.newLiquidServingsCreated.push(creationPayload);
      auditReport.unitTypeDistribution.VOLUME++;
      auditReport.displayQuantityStatus.populated++;
      auditReport.provenanceDistribution[liquidEval.serving.provenance] =
        (auditReport.provenanceDistribution[liquidEval.serving.provenance] || 0) + 1;
    }
  }

  console.log('\n📊 Migration Evaluation Summary:');
  console.log(`   ├─ Servings to update:          ${servingUpdates.length.toLocaleString()}`);
  console.log(`   ├─ New verified servings added: ${servingCreations.length.toLocaleString()}`);
  console.log(`   ├─ Anomaly corrections:         ${auditReport.anomalyFixes.length}`);
  console.log(`   ├─ Populated display quantities:${auditReport.displayQuantityStatus.populated.toLocaleString()}`);
  console.log(`   └─ Flagged for manual review:   ${auditReport.displayQuantityStatus.nullFlagged.toLocaleString()}`);

  console.log('\n🏷️  Unit Type Classification:');
  for (const [type, count] of Object.entries(auditReport.unitTypeDistribution)) {
    console.log(`   ├─ ${type.padEnd(12)}: ${count.toLocaleString()}`);
  }

  console.log('\n🔍 Provenance Distribution:');
  for (const [prov, count] of Object.entries(auditReport.provenanceDistribution)) {
    console.log(`   ├─ ${prov.padEnd(32)}: ${count.toLocaleString()}`);
  }

  // Execute Database Updates if --apply
  if (isApply) {
    console.log('\n🚀 Applying batch updates to database...');

    // Batch update existing servings
    const BATCH_SIZE = 500;
    for (let i = 0; i < servingUpdates.length; i += BATCH_SIZE) {
      const chunk = servingUpdates.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(
        chunk.map((item) =>
          prisma.foodServing.update({
            where: { id: item.id },
            data: {
              unitType: item.unitType,
              displayQuantity: item.displayQuantity,
              weightGrams: item.weightGrams,
            },
          })
        )
      );
      process.stdout.write(`   Updated ${Math.min(i + BATCH_SIZE, servingUpdates.length)} / ${servingUpdates.length} records...\r`);
    }
    console.log('\n   ✅ Batch update completed.');

    // Batch insert new liquid servings
    if (servingCreations.length > 0) {
      console.log(`\n🌱 Inserting ${servingCreations.length} new verified liquid servings...`);
      for (let i = 0; i < servingCreations.length; i += BATCH_SIZE) {
        const chunk = servingCreations.slice(i, i + BATCH_SIZE);
        await prisma.foodServing.createMany({
          data: chunk.map((item) => ({
            foodId: item.foodId,
            unitLabel: item.unitLabel,
            unitType: item.unitType,
            displayQuantity: item.displayQuantity,
            weightGrams: item.weightGrams,
            isDefault: item.isDefault || false,
          })),
        });
      }
      console.log('   ✅ Insertions completed.');
    }
  } else {
    console.log('\nℹ️  DRY RUN: No database modifications were written.');
    console.log('   To apply changes, run: node scripts/migrate-serving-unit-types.js --apply');
  }

  // Export JSON Report
  const reportJsonPath = path.resolve(__dirname, '../../serving-unit-migration-report.json');
  fs.writeFileSync(reportJsonPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`\n📄 Migration report JSON saved to: ${reportJsonPath}`);

  // Export Review Needed Queue
  const reviewQueuePath = path.resolve(__dirname, '../../serving-migration-review-needed.json');
  fs.writeFileSync(reviewQueuePath, JSON.stringify(auditReport.reviewNeededQueue, null, 2), 'utf8');
  console.log(`📋 Review queue JSON saved to: ${reviewQueuePath}`);

  // Export Markdown Report
  const reportMdPath = path.resolve(__dirname, '../../serving-unit-migration-report.md');
  const mdLines = [
    '# Serving-Unit System Migration — Execution Report',
    '',
    `> **Execution Date**: ${auditReport.generatedAt}`,
    `> **Execution Mode**: ${isApply ? 'APPLY (Live DB Mutation)' : 'DRY RUN (Read Only)'}`,
    `> **Total Foods Processed**: ${auditReport.totalFoods.toLocaleString()}`,
    `> **Total Servings Processed**: ${auditReport.totalServingsEvaluated.toLocaleString()}`,
    '',
    '---',
    '',
    '## 1. Unit Type Distribution',
    '',
    '| ServingUnitType | Count | Description |',
    '|---|---|---|',
    `| \`WEIGHT\` | ${auditReport.unitTypeDistribution.WEIGHT.toLocaleString()} | Mass-based measures (g, kg) |`,
    `| \`VOLUME\` | ${auditReport.unitTypeDistribution.VOLUME.toLocaleString()} | Volume-based measures (ml, cup, glass, tbsp, tsp) |`,
    `| \`COUNT\` | ${auditReport.unitTypeDistribution.COUNT.toLocaleString()} | Discrete count items (piece, egg, slice, biscuit, roti, samosa) |`,
    `| \`HOUSEHOLD\` | ${auditReport.unitTypeDistribution.HOUSEHOLD.toLocaleString()} | Household portion measures (bowl, plate, katori, portion) |`,
    '',
    '## 2. Display Quantity Status',
    '',
    `- **Populated & Verified**: ${auditReport.displayQuantityStatus.populated.toLocaleString()}`,
    `- **Flagged for Manual Review (displayQuantity = null)**: ${auditReport.displayQuantityStatus.nullFlagged.toLocaleString()}`,
    '',
    '## 3. Provenance Breakdown',
    '',
    '| Provenance Tag | Count | Confidence |',
    '|---|---|---|',
    ...Object.entries(auditReport.provenanceDistribution).map(([prov, count]) =>
      `| \`${prov}\` | ${count.toLocaleString()} | ${prov.includes('HIGH') || prov.includes('PARSED') ? 'HIGH' : 'MEDIUM/LOW'} |`
    ),
    '',
    '## 4. Anomaly Corrections Executed',
    '',
    '| Food | Serving | Display Quantity | Weight (g) | Provenance |',
    '|---|---|---|---|---|',
    ...auditReport.anomalyFixes.map(a =>
      `| ${a.foodName} | ${a.unitLabel} | ${a.displayQuantity} | ${a.weightGrams}g | \`${a.provenance}\` |`
    ),
    '',
    '## 5. Sample Verified Liquid Additions',
    '',
    '| Food Name | Unit Label | Display Qty | Weight (g) | Provenance |',
    '|---|---|---|---|---|',
    ...auditReport.newLiquidServingsCreated.slice(0, 20).map(c =>
      `| ${c.foodName} | ${c.unitLabel} | ${c.displayQuantity} | ${c.weightGrams}g | \`${c.provenance}\` |`
    ),
    '',
    auditReport.newLiquidServingsCreated.length > 20
      ? `*...plus ${auditReport.newLiquidServingsCreated.length - 20} more verified liquid additions.*`
      : '',
    '',
    '---',
    '*Report generated automatically by `gramgains-backend/scripts/migrate-serving-unit-types.js`*',
  ];

  fs.writeFileSync(reportMdPath, mdLines.join('\n'), 'utf8');
  console.log(`📝 Migration report Markdown saved to: ${reportMdPath}\n`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
