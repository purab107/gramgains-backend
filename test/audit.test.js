/**
 * Unit tests for GramGains Food Database QA Audit Tool.
 *
 * Tests are fixture-driven — no database connection required.
 * Run with: node --test test/audit.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// We import the pure rule functions which take food fixtures as arguments
const { auditNutritionRules } = require('../src/audit/rules/nutrition-rules');
const { auditServingRules } = require('../src/audit/rules/serving-rules');
const { auditUsabilityRules } = require('../src/audit/rules/usability-rules');
const { auditSourceRules } = require('../src/audit/rules/source-rules');
const { DeduplicationAuditor } = require('../src/audit/deduplication');
const { normalizeText, extractTokens, calculateJaccardSimilarity, generateBlockingKey } = require('../src/audit/normalizer');
const { DEFAULT_AUDIT_CONFIG } = require('../src/audit/config');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a serving fixture with optional overrides
 * @param {Partial<import('../src/audit/types').FoodServingRecord>} overrides
 * @returns {import('../src/audit/types').FoodServingRecord}
 */
function makeServing(overrides = {}) {
  return {
    id: 'srv-default',
    foodId: 'food-test',
    unitLabel: 'g',
    weightGrams: 100,
    isDefault: true,
    ...overrides,
  };
}

/**
 * Creates a food fixture with optional overrides
 * @param {Partial<import('../src/audit/types').FoodRecord>} overrides
 * @returns {import('../src/audit/types').FoodRecord}
 */
function makeFood(overrides = {}) {
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
  const match = issues.find((i) => i.issueCode === 'WARN_CALORIE_MACRO_MISMATCH');
  assert.equal(match, undefined, 'Reasonable mismatch should not warn');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SERVING RULES
// ─────────────────────────────────────────────────────────────────────────────

test('serving: food with no servings flagged as ERR_FOOD_NO_SERVINGS', () => {
  const food = makeFood({ servings: [] });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_FOOD_NO_SERVINGS');
  assert.ok(match, 'Expected ERR_FOOD_NO_SERVINGS');
  assert.equal(match?.severity, 'ERROR');
});

test('serving: multiple default servings flagged as ERR_MULTIPLE_DEFAULT_SERVINGS', () => {
  const food = makeFood({
    servings: [
      makeServing({ id: 'srv-1', isDefault: true }),
      makeServing({ id: 'srv-2', isDefault: true }),
    ],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_MULTIPLE_DEFAULT_SERVINGS');
  assert.ok(match, 'Expected ERR_MULTIPLE_DEFAULT_SERVINGS');
});

test('serving: zero weight serving flagged as ERR_SERVING_ZERO_WEIGHT', () => {
  const food = makeFood({
    servings: [makeServing({ weightGrams: 0 })],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_SERVING_ZERO_WEIGHT');
  assert.ok(match, 'Expected ERR_SERVING_ZERO_WEIGHT');
});

test('serving: 100g label with 25g weight flagged as WARN_IMPLAUSIBLE_SERVING_WEIGHT', () => {
  const food = makeFood({
    servings: [makeServing({ unitLabel: '100g', weightGrams: 25 })],
  });
  const issues = auditServingRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_IMPLAUSIBLE_SERVING_WEIGHT');
  assert.ok(match, 'Expected WARN_IMPLAUSIBLE_SERVING_WEIGHT');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. USABILITY RULES
// ─────────────────────────────────────────────────────────────────────────────

test('usability: raw rice without prep state flagged as WARN_AMBIGUOUS_PREP_STATE', () => {
  const food = makeFood({
    name: 'Rice',
    aliases: [],
    category: 'Rice & Pulao',
  });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_AMBIGUOUS_PREP_STATE');
  assert.ok(match, 'Expected WARN_AMBIGUOUS_PREP_STATE for raw rice');
});

test('usability: generic name flagged as WARN_GENERIC_UNQUALIFIED_NAME', () => {
  const food = makeFood({
    name: 'Rice',
    brand: null,
    category: 'Rice & Pulao',
  });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_GENERIC_UNQUALIFIED_NAME');
  assert.ok(match, 'Expected WARN_GENERIC_UNQUALIFIED_NAME');
});

test('usability: ALL CAPS name flagged as WARN_SUSPICIOUS_NAME', () => {
  const food = makeFood({
    name: 'BOILED RICE',
    category: 'Rice & Pulao',
  });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_SUSPICIOUS_NAME');
  assert.ok(match, 'Expected WARN_SUSPICIOUS_NAME for ALL CAPS');
});

test('usability: empty aliases flagged as INFO_EMPTY_ALIASES', () => {
  const food = makeFood({ aliases: [] });
  const issues = auditUsabilityRules(food);
  const match = issues.find((i) => i.issueCode === 'INFO_EMPTY_ALIASES');
  assert.ok(match, 'Expected INFO_EMPTY_ALIASES');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SOURCE RULES
// ─────────────────────────────────────────────────────────────────────────────

test('source: soft-deleted record flagged as INFO_SOFT_DELETED_RECORD', () => {
  const food = makeFood({
    deletedAt: new Date('2024-01-01'),
  });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'INFO_SOFT_DELETED_RECORD');
  assert.ok(match, 'Expected INFO_SOFT_DELETED_RECORD');
});

test('source: invalid source-layer combination flagged as ERR_INVALID_SOURCE_LAYER', () => {
  const food = makeFood({
    source: 'INDB',
    layer: 1, // INDB should be layer 2
  });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'ERR_INVALID_SOURCE_LAYER');
  assert.ok(match, 'Expected ERR_INVALID_SOURCE_LAYER');
});

test('source: OpenFoodFacts without brand flagged as WARN_BRANDED_LACKS_MANUFACTURER', () => {
  const food = makeFood({
    source: 'OPEN_FOOD_FACTS',
    layer: 3,
    brand: null,
    brandOwner: null,
  });
  const issues = auditSourceRules(food);
  const match = issues.find((i) => i.issueCode === 'WARN_BRANDED_LACKS_MANUFACTURER');
  assert.ok(match, 'Expected WARN_BRANDED_LACKS_MANUFACTURER');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

test('deduplication: duplicate barcode detection', () => {
  const auditor = new DeduplicationAuditor();
  
  const food1 = makeFood({
    id: 'food-1',
    name: 'Amul Milk',
    barcode: '8901262120029',
  });
  
  const food2 = makeFood({
    id: 'food-2',
    name: 'Another Milk',
    barcode: '8901262120029', // Same barcode
  });
  
  auditor.registerFood(food1);
  auditor.registerFood(food2);
  
  const issues = auditor.generateIssues();
  const barcodeIssues = issues.filter((i) => i.issueCode === 'ERR_DUPLICATE_BARCODE');
  assert.ok(barcodeIssues.length > 0, 'Expected barcode collision issues');
});

test('deduplication: high similarity duplicate detection', () => {
  const auditor = new DeduplicationAuditor();
  
  const food1 = makeFood({
    id: 'food-1',
    name: 'Basmati Rice',
    category: 'Rice & Pulao',
  });
  
  const food2 = makeFood({
    id: 'food-2',
    name: 'Basmati Rice',
    category: 'Rice & Pulao',
  });
  
  auditor.registerFood(food1);
  auditor.registerFood(food2);
  
  const issues = auditor.generateIssues(0.85);
  const dupIssues = issues.filter((i) => i.issueCode === 'WARN_DUPLICATE_CANDIDATE');
  assert.ok(dupIssues.length > 0, 'Expected duplicate candidate issues');
});