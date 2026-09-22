/**
 * Unit tests for GramGains Food Database QA Audit Tool.
 *
 * Tests are fixture-driven — no database connection required.
 * Run with: node --experimental-strip-types --test test/audit.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// We import the pure rule functions which take food fixtures as arguments
import { auditNutritionRules } from '../src/audit/rules/nutrition-rules.ts';
import { auditServingRules } from '../src/audit/rules/serving-rules.ts';
import { auditUsabilityRules } from '../src/audit/rules/usability-rules.ts';
import { auditSourceRules } from '../src/audit/rules/source-rules.ts';
import { DeduplicationAuditor } from '../src/audit/deduplication.ts';
import { normalizeText, extractTokens, calculateJaccardSimilarity, generateBlockingKey } from '../src/audit/normalizer.ts';
import { DEFAULT_AUDIT_CONFIG } from '../src/audit/config.ts';
import type { FoodRecord, FoodServingRecord } from '../src/audit/types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

function makeServing(overrides: Partial<FoodServingRecord> = {}): FoodServingRecord {
  return {
    id: 'srv-default',
    foodId: 'food-test',
    unitLabel: 'g',
    weightGrams: 100,
    isDefault: true,
    ...overrides,
  };
}

function makeFood(overrides: Partial<FoodRecord> = {}): FoodRecord {
  return {
    id: 'food-test',
    name: 'Steamed Basmati Rice (Cooked)',
    aliases: ['Paka Chawal', 'Boiled Rice'],
    category: 'Rice & Pulao',
    brand: null,
    brandOwner: null,
    genericName: null,
    barcode: null,
    calories: 130,
    protein: 2.7,
    carbohydrates: 28.0,
    fat: 0.3,
    fiber: 0.4,
    source: 'INDB',
    layer: 2,
    deletedAt: null,
    servings: [makeServing()],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. NORMALIZER
// ─────────────────────────────────────────────────────────────────────────────

test('normalizeText: strips accents, lowercases, removes special chars', () => {
  const result = normalizeText('Café Rösti & Crème Brûlée!');
  assert.match(result, /cafe rosti creme brulee/);
});

test('normalizeText: handles null/undefined gracefully', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

test('extractTokens: filters stopwords and short tokens', () => {
  const tokens = extractTokens('Boiled Rice with Fresh Spinach');
  assert.ok(tokens.includes('boiled'));
  assert.ok(tokens.includes('rice'));
  assert.ok(tokens.includes('spinach'));
  assert.ok(!tokens.includes('with'));
  assert.ok(!tokens.includes('a'));
});

test('Jaccard similarity: identical token sets = 1.0', () => {
  const a = ['rice', 'cooked', 'basmati'];
  const b = ['rice', 'cooked', 'basmati'];
  assert.equal(calculateJaccardSimilarity(a, b), 1.0);
});

test('Jaccard similarity: no common tokens = 0.0', () => {
  const a = ['apple', 'fruit'];
  const b = ['chicken', 'curry'];
  assert.equal(calculateJaccardSimilarity(a, b), 0.0);
});

test('Jaccard similarity: partial overlap', () => {
  const a = ['rice', 'boiled', 'basmati'];
  const b = ['rice', 'basmati', 'biryani'];
  const sim = calculateJaccardSimilarity(a, b);
  // Intersection: rice, basmati = 2; Union: rice, boiled, basmati, biryani = 4; sim = 0.5
  assert.ok(Math.abs(sim - 0.5) < 0.001);
});

test('Jaccard similarity: empty arrays edge case', () => {
  assert.equal(calculateJaccardSimilarity([], []), 1.0);
  assert.equal(calculateJaccardSimilarity(['rice'], []), 0.0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. NUTRITION RULES
// ─────────────────────────────────────────────────────────────────────────────

test('nutrition: clean food with valid per-100g values passes all checks', () => {
  const food = makeFood();
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const errors = issues.filter((i) => i.severity === 'ERROR');
  assert.equal(errors.length, 0);
});

test('nutrition: negative protein detected as ERR_NUTRITION_NEGATIVE', () => {
  const food = makeFood({ protein: -5.0 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_NUTRITION_NEGATIVE' && i.field === 'protein');
  assert.ok(match, 'Expected ERR_NUTRITION_NEGATIVE for protein');
  assert.equal(match?.severity, 'ERROR');
});

test('nutrition: negative calories detected as ERR_NUTRITION_NEGATIVE', () => {
  const food = makeFood({ calories: -100 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_NUTRITION_NEGATIVE' && i.field === 'calories');
  assert.ok(match, 'Expected ERR_NUTRITION_NEGATIVE for calories');
});

test('nutrition: fat > 100g/100g detected as ERR_NUTRITION_EXTREME', () => {
  const food = makeFood({ fat: 110, calories: 1000 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_NUTRITION_EXTREME' && i.field === 'fat');
  assert.ok(match, 'Expected ERR_NUTRITION_EXTREME for fat > 100g');
});

test('nutrition: calories > 1000 kcal/100g flagged as ERR_NUTRITION_EXTREME', () => {
  const food = makeFood({ calories: 1050 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_NUTRITION_EXTREME' && i.field === 'calories');
  assert.ok(match, 'Expected ERR_NUTRITION_EXTREME for calories > 1000');
});

test('nutrition: macro sum > 102g flagged as ERR_MACRO_SUM_EXCEEDS_100', () => {
  const food = makeFood({ protein: 50, carbohydrates: 55, fat: 10 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_MACRO_SUM_EXCEEDS_100');
  assert.ok(match, 'Expected ERR_MACRO_SUM_EXCEEDS_100 when P+C+F=115');
});

test('nutrition: macro sum exactly at 100g passes', () => {
  const food = makeFood({ protein: 30, carbohydrates: 50, fat: 20, calories: 500, fiber: 5 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_MACRO_SUM_EXCEEDS_100');
  assert.equal(match, undefined, 'Exactly 100g total should pass');
});

test('nutrition: fiber exceeding carbs flagged as ERR_FIBER_EXCEEDS_CARBS', () => {
  const food = makeFood({ carbohydrates: 3.0, fiber: 8.0 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) => i.issueCode === 'ERR_FIBER_EXCEEDS_CARBS');
  assert.ok(match, 'Expected ERR_FIBER_EXCEEDS_CARBS when fiber > carbs');
});

test('nutrition: calorie-macro mismatch ≥20%+25kcal flagged as WARN_CALORIE_MACRO_MISMATCH', () => {
  // Stored: 300 kcal; Calculated: 10*4 + 20*4 + 5*9 = 40+80+45 = 165 kcal → diff = 135, 45%
  const food = makeFood({ calories: 300, protein: 10, carbohydrates: 20, fat: 5, fiber: 2 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) =>
    i.issueCode === 'WARN_CALORIE_MACRO_MISMATCH' || i.issueCode === 'ERR_CONVENTION_UNCERTAIN'
  );
  assert.ok(match, 'Expected WARN_CALORIE_MACRO_MISMATCH for large discrepancy');
});

test('nutrition: reasonable mismatch within 20% does NOT warn', () => {
  // Stored: 135 kcal; Calculated: 2.7*4 + 28*4 + 0.3*9 = 10.8+112+2.7 = 125.5 kcal → ~7%
  const food = makeFood({ calories: 135, protein: 2.7, carbohydrates: 28, fat: 0.3, fiber: 0.4 });
  const issues = auditNutritionRules(food, DEFAULT_AUDIT_CONFIG);
  const match = issues.find((i) =>
    i.issueCode === 'WARN_CALORIE_MACRO_MISMATCH' || i.issueCode === 'ERR_CONVENTION_UNCERTAIN'
  );
  assert.equal(match, undefined, 'Small discrepancy within 20% should not warn');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SERVING RULES
// ─────────────────────────────────────────────────────────────────────────────

test('serving: clean food with single valid serving passes', () => {
  const food = makeFood({ servings: [makeServing({ unitLabel: 'g', weightGrams: 100, isDefault: true })] });
  const issues = auditServingRules(food);
  const errors = issues.filter((i) => i.severity === 'ERROR');
  assert.equal(errors.length, 0);
});

test('serving: food with zero servings flagged as ERR_FOOD_NO_SERVINGS', () => {
  const food = makeFood({ servings: [] });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_FOOD_NO_SERVINGS');
  assert.ok(match, 'Expected ERR_FOOD_NO_SERVINGS for empty servings');
  assert.equal(match?.severity, 'ERROR');
});

test('serving: multiple isDefault=true flagged as ERR_MULTIPLE_DEFAULT_SERVINGS', () => {
  const food = makeFood({
    servings: [
      makeServing({ id: 's1', unitLabel: 'g', weightGrams: 100, isDefault: true }),
      makeServing({ id: 's2', unitLabel: 'bowl', weightGrams: 200, isDefault: true }),
    ],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_MULTIPLE_DEFAULT_SERVINGS');
  assert.ok(match, 'Expected ERR_MULTIPLE_DEFAULT_SERVINGS');
});

test('serving: zero weight flagged as ERR_SERVING_ZERO_WEIGHT', () => {
  const food = makeFood({
    servings: [makeServing({ weightGrams: 0, isDefault: true })],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_SERVING_ZERO_WEIGHT');
  assert.ok(match, 'Expected ERR_SERVING_ZERO_WEIGHT for 0g weight');
});

test('serving: negative weight flagged as ERR_SERVING_ZERO_WEIGHT', () => {
  const food = makeFood({
    servings: [makeServing({ weightGrams: -50, isDefault: true })],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_SERVING_ZERO_WEIGHT');
  assert.ok(match, 'Expected ERR_SERVING_ZERO_WEIGHT for negative weight');
});

test('serving: label "100g" with weight 25 is flagged as WARN_IMPLAUSIBLE_SERVING_WEIGHT', () => {
  const food = makeFood({
    servings: [makeServing({ unitLabel: '100g', weightGrams: 25, isDefault: true })],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_IMPLAUSIBLE_SERVING_WEIGHT');
  assert.ok(match, 'Expected WARN_IMPLAUSIBLE_SERVING_WEIGHT for 100g label with 25g weight');
});

test('serving: duplicate servings on same food flagged as WARN_DUPLICATE_SERVING', () => {
  const food = makeFood({
    servings: [
      makeServing({ id: 's1', unitLabel: 'g', weightGrams: 100, isDefault: true }),
      makeServing({ id: 's2', unitLabel: 'g', weightGrams: 100, isDefault: false }),
    ],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_DUPLICATE_SERVING');
  assert.ok(match, 'Expected WARN_DUPLICATE_SERVING for exact duplicate');
});

test('serving: no default serving flagged as WARN_NO_DEFAULT_SERVING', () => {
  const food = makeFood({
    servings: [makeServing({ isDefault: false })],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_NO_DEFAULT_SERVING');
  assert.ok(match, 'Expected WARN_NO_DEFAULT_SERVING');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. USABILITY RULES — RAW VS COOKED
// ─────────────────────────────────────────────────────────────────────────────

test('usability: rice without preparation state flagged as WARN_AMBIGUOUS_PREP_STATE', () => {
  const food = makeFood({ name: 'Basmati Rice', category: 'Rice & Pulao' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_AMBIGUOUS_PREP_STATE');
  assert.ok(match, 'Expected WARN_AMBIGUOUS_PREP_STATE for "Basmati Rice" without state');
});

test('usability: "Cooked Basmati Rice" does NOT flag WARN_AMBIGUOUS_PREP_STATE', () => {
  const food = makeFood({ name: 'Cooked Basmati Rice', category: 'Rice & Pulao' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_AMBIGUOUS_PREP_STATE');
  assert.equal(match, undefined, '"Cooked Basmati Rice" should not be ambiguous');
});

test('usability: "Dal" flagged as WARN_AMBIGUOUS_PREP_STATE', () => {
  const food = makeFood({ name: 'Moong Dal', category: 'Dal & Legumes', aliases: [] });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_AMBIGUOUS_PREP_STATE');
  assert.ok(match, 'Expected WARN_AMBIGUOUS_PREP_STATE for raw/cooked ambiguous dal');
});

test('usability: soya chunks without state flagged', () => {
  const food = makeFood({ name: 'Soya Chunks', category: 'Dal & Legumes' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_AMBIGUOUS_PREP_STATE');
  assert.ok(match, 'Expected WARN_AMBIGUOUS_PREP_STATE for "Soya Chunks" without state');
});

test('usability: generic single-word "rice" flagged as WARN_GENERIC_UNQUALIFIED_NAME', () => {
  const food = makeFood({ name: 'rice', category: 'Rice & Pulao' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_GENERIC_UNQUALIFIED_NAME');
  assert.ok(match, 'Expected WARN_GENERIC_UNQUALIFIED_NAME for generic "rice"');
});

test('usability: generic "milk" flagged as WARN_GENERIC_UNQUALIFIED_NAME', () => {
  const food = makeFood({ name: 'milk', category: 'Dairy', brand: null });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_GENERIC_UNQUALIFIED_NAME');
  assert.ok(match, 'Expected WARN_GENERIC_UNQUALIFIED_NAME for generic "milk"');
});

test('usability: branded generic name is NOT flagged (brand is set)', () => {
  const food = makeFood({ name: 'milk', category: 'Dairy', brand: 'Amul' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_GENERIC_UNQUALIFIED_NAME');
  assert.equal(match, undefined, 'Branded "milk" should not be flagged generic');
});

test('usability: ALL CAPS name flagged as WARN_SUSPICIOUS_NAME', () => {
  const food = makeFood({ name: 'CADBURY CHOCOLATE BAR' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_SUSPICIOUS_NAME');
  assert.ok(match, 'Expected WARN_SUSPICIOUS_NAME for ALL CAPS name');
});

test('usability: name with HTML entity flagged as WARN_SUSPICIOUS_NAME', () => {
  const food = makeFood({ name: 'Bread &amp; Butter' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_SUSPICIOUS_NAME');
  assert.ok(match, 'Expected WARN_SUSPICIOUS_NAME for HTML entity in name');
});

test('usability: spinach lacks palak alias flagged as INFO_MISSING_INDIAN_ALIAS', () => {
  const food = makeFood({ name: 'Spinach', aliases: [], category: 'Vegetables' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'INFO_MISSING_INDIAN_ALIAS');
  assert.ok(match, 'Expected INFO_MISSING_INDIAN_ALIAS for spinach without palak alias');
});

test('usability: spinach WITH palak alias does NOT flag INFO_MISSING_INDIAN_ALIAS', () => {
  const food = makeFood({ name: 'Spinach', aliases: ['Palak'], category: 'Vegetables' });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'INFO_MISSING_INDIAN_ALIAS');
  assert.equal(match, undefined, 'Spinach with "Palak" alias should not flag');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SOURCE RULES
// ─────────────────────────────────────────────────────────────────────────────

test('source: valid IFCT_2017 layer 1 combination passes', () => {
  const food = makeFood({ source: 'IFCT_2017', layer: 1 });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_INVALID_SOURCE_LAYER');
  assert.equal(match, undefined, 'IFCT_2017 on layer 1 should pass');
});

test('source: IFCT_2017 on layer 3 flagged as ERR_INVALID_SOURCE_LAYER', () => {
  const food = makeFood({ source: 'IFCT_2017', layer: 3 });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_INVALID_SOURCE_LAYER');
  assert.ok(match, 'Expected ERR_INVALID_SOURCE_LAYER for IFCT_2017 on layer 3');
});

test('source: OPEN_FOOD_FACTS on layer 3 passes', () => {
  const food = makeFood({ source: 'OPEN_FOOD_FACTS', layer: 3, brand: 'Nestle' });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_INVALID_SOURCE_LAYER');
  assert.equal(match, undefined, 'OPEN_FOOD_FACTS on layer 3 should be valid');
});

test('source: OPEN_FOOD_FACTS on layer 1 flagged as ERR_INVALID_SOURCE_LAYER', () => {
  const food = makeFood({ source: 'OPEN_FOOD_FACTS', layer: 1, brand: 'Nestle' });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_INVALID_SOURCE_LAYER');
  assert.ok(match, 'Expected ERR_INVALID_SOURCE_LAYER for OPEN_FOOD_FACTS on layer 1');
});

test('source: OPEN_FOOD_FACTS food without brand flagged as WARN_BRANDED_LACKS_MANUFACTURER', () => {
  const food = makeFood({ source: 'OPEN_FOOD_FACTS', layer: 3, brand: null, brandOwner: null });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_BRANDED_LACKS_MANUFACTURER');
  assert.ok(match, 'Expected WARN_BRANDED_LACKS_MANUFACTURER for OFf food without brand');
});

test('source: soft-deleted record flagged as INFO_SOFT_DELETED_RECORD', () => {
  const food = makeFood({ deletedAt: new Date('2024-01-01') });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'INFO_SOFT_DELETED_RECORD');
  assert.ok(match, 'Expected INFO_SOFT_DELETED_RECORD for food with deletedAt set');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

test('dedup: distinct foods in different categories yield zero duplicates', () => {
  const auditor = new DeduplicationAuditor();
  auditor.registerFood(makeFood({ id: 'f1', name: 'Palak Paneer', category: 'Prepared Curries', barcode: null }));
  auditor.registerFood(makeFood({ id: 'f2', name: 'Chicken Biryani', category: 'Rice & Pulao', barcode: null }));
  const issues = auditor.generateIssues(0.85);
  const dupIssues = issues.filter((i) => i.issueCode === 'WARN_DUPLICATE_CANDIDATE');
  assert.equal(dupIssues.length, 0, 'Different foods should produce zero duplicates');
});

test('dedup: highly similar names in same category flagged as WARN_DUPLICATE_CANDIDATE', () => {
  const auditor = new DeduplicationAuditor();
  auditor.registerFood(makeFood({ id: 'f1', name: 'Steamed Basmati Rice', category: 'Rice & Pulao', barcode: null }));
  auditor.registerFood(makeFood({ id: 'f2', name: 'Steamed Basmati Rice Cooked', category: 'Rice & Pulao', barcode: null }));
  const issues = auditor.generateIssues(0.7); // lower threshold to catch this
  const dupIssues = issues.filter((i) => i.issueCode === 'WARN_DUPLICATE_CANDIDATE');
  assert.ok(dupIssues.length > 0, 'Very similar names should be flagged as duplicate candidates');
});

test('dedup: duplicate barcode across two foods flagged as ERR_DUPLICATE_BARCODE', () => {
  const auditor = new DeduplicationAuditor();
  auditor.registerFood(makeFood({ id: 'f1', name: 'Chocolate Bar A', barcode: '1234567890', source: 'OPEN_FOOD_FACTS', layer: 3, brand: 'Brand A', category: 'Snacks' }));
  auditor.registerFood(makeFood({ id: 'f2', name: 'Chocolate Bar B', barcode: '1234567890', source: 'OPEN_FOOD_FACTS', layer: 3, brand: 'Brand B', category: 'Snacks' }));
  const issues = auditor.generateIssues(0.85);
  const dupBarcode = issues.filter((i) => i.issueCode === 'ERR_DUPLICATE_BARCODE');
  assert.ok(dupBarcode.length >= 2, 'Expected at least 2 ERR_DUPLICATE_BARCODE issues (one per food)');
});

test('dedup: unique barcodes produce no barcode collision issues', () => {
  const auditor = new DeduplicationAuditor();
  auditor.registerFood(makeFood({ id: 'f1', name: 'Product A', barcode: '111', category: 'Snacks', brand: 'Brand X', source: 'OPEN_FOOD_FACTS', layer: 3 }));
  auditor.registerFood(makeFood({ id: 'f2', name: 'Product B', barcode: '222', category: 'Snacks', brand: 'Brand Y', source: 'OPEN_FOOD_FACTS', layer: 3 }));
  const issues = auditor.generateIssues(0.85);
  const barcodeIssues = issues.filter((i) => i.issueCode === 'ERR_DUPLICATE_BARCODE');
  assert.equal(barcodeIssues.length, 0, 'Unique barcodes should not flag collisions');
});

console.log('\n✅ All unit tests defined. Running tests...\n');
