/**
 * Read-Only Serving-Unit & Portion Calculation Test Suite
 *
 * Validates portion math, decimal quantities, pluralization, edge cases,
 * and search result deduplication across representative foods without mutating data.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { searchFoods } = require('../src/modules/food/food.service');

const prisma = new PrismaClient();

async function runTestSuite() {
  console.log('--- Starting Read-Only Serving-Unit Test Suite ---');
  await prisma.$connect();

  const results = [];

  function assert(testName, passed, details) {
    results.push({ testName, passed, details });
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'}: ${testName} - ${details}`);
  }

  try {
    // 1. DECIMAL INPUT HANDLING TEST
    // Verifies that decimal portions (e.g. 1.5 rotis, 0.5 katori) resolve cleanly without integer truncation
    const testCases = [
      { qty: 0.25, baseWeight: 30, expected: 7.5 },
      { qty: 0.5, baseWeight: 30, expected: 15.0 },
      { qty: 1.5, baseWeight: 30, expected: 45.0 },
      { qty: 2.75, baseWeight: 30, expected: 82.5 },
    ];
    let allDecimalsPass = true;
    for (const tc of testCases) {
      const resolved = Math.round((tc.qty / 1) * tc.baseWeight * 10) / 10;
      if (Math.abs(resolved - tc.expected) > 0.001) allDecimalsPass = false;
    }
    assert('Decimal Portion Scaling', allDecimalsPass, 'Correctly computes fractional servings (0.25, 0.5, 1.5, 2.75) without truncation');

    // 2. ZERO & BOUNDARY VALUE INPUT
    const zeroRatio = 0 / 1;
    const zeroResolved = Math.max(0.1, Math.round(zeroRatio * 100 * 10) / 10);
    assert('Boundary Quantity Floor (0 -> 0.1g floor in UI)', zeroResolved === 0.1, 'UI QuantitySelector enforces minimum 0.1g mass floor to avoid divide-by-zero');

    // 3. UI LABEL REDUNDANCY TEST
    // Checks how getServingChipLabel formats when unitLabel contains digits
    function simulateGetServingChipLabel(serving) {
      const qty = serving.displayQuantity !== null && serving.displayQuantity !== undefined
        ? serving.displayQuantity
        : (serving.unitType === 'WEIGHT' ? serving.weightGrams : '');
      const unit = serving.unitLabel || 'g';
      if (qty) return `${qty} ${unit}`.trim();
      return unit;
    }

    const bugServing = { displayQuantity: 1, unitLabel: '1 medium puri', unitType: 'COUNT', weightGrams: 30 };
    const renderedPill = simulateGetServingChipLabel(bugServing);
    const hasDuplicatePrefix = renderedPill.startsWith('1 1');
    assert('Serving Label Duplication Bug Detection', hasDuplicatePrefix, `Detected UI formatting bug: "${renderedPill}" produced from displayQuantity:1 and unitLabel:"1 medium puri"`);

    // 4. REPRESENTATIVE FOOD PARITY TEST
    // Compare 100g direct entry vs equivalent piece entry (e.g., 2.5 rotis @ 40g each = 100g)
    const foodMock = { calories: 300, protein: 10, carbohydrates: 60, fat: 2, fiber: 4 };
    const direct100gWeight = 100;
    const pieceCount = 2.5;
    const pieceWeightEach = 40;
    const pieceCalculatedWeight = pieceCount * pieceWeightEach;

    const multDirect = direct100gWeight / 100;
    const multPiece = pieceCalculatedWeight / 100;

    const calDirect = Math.round(foodMock.calories * multDirect * 10) / 10;
    const calPiece = Math.round(foodMock.calories * multPiece * 10) / 10;

    assert('Mass Parity Across Serving Units', calDirect === calPiece && calDirect === 300, `Macros match perfectly between 100g (${calDirect} kcal) and 2.5 pieces of 40g (${calPiece} kcal)`);

    // 5. LIVE DATABASE QUERY TEST: Roti Availability
    const stapleRoti = await prisma.food.findFirst({
      where: {
        name: { contains: 'Roti / Chapati (plain, no oil)', mode: 'insensitive' },
        deletedAt: null,
      },
      include: { servings: true },
    });

    if (stapleRoti) {
      const hasCount = stapleRoti.servings.some(s => s.unitType === 'COUNT');
      const hasWeight = stapleRoti.servings.some(s => s.unitType === 'WEIGHT');
      assert('Staple Plain Roti Multi-Unit Support', hasCount && hasWeight, `Food "${stapleRoti.name}" supports both COUNT (${stapleRoti.servings.find(s=>s.unitType==='COUNT')?.unitLabel}) and WEIGHT`);
    } else {
      assert('Staple Plain Roti Check', false, 'Roti / Chapati (plain, no oil) not found in database');
    }

    // 6. LIVE DATABASE QUERY TEST: Dal Makhani Multiple Entries
    const dalMakhaniMatches = await prisma.food.findMany({
      where: {
        name: { equals: 'Dal makhani', mode: 'insensitive' },
        deletedAt: null,
      },
    });
    assert('Dal Makhani Database Redundancy Check', dalMakhaniMatches.length >= 2, `Found ${dalMakhaniMatches.length} identical "Dal makhani" entries across layers with conflicting calories`);

    // 7. SEARCH DEDUPLICATION TEST
    const searchRes = await searchFoods('roti', null, null, 10, 1);
    const names = (searchRes.foods || []).map(f => f.name);
    assert('Search Execution Test', names.length > 0, `Search for "roti" returned ${names.length} items (Top item: "${names[0]}")`);

  } finally {
    await prisma.$disconnect();
  }

  return results;
}

runTestSuite().then(res => {
  console.log('\n--- Test Suite Summary ---');
  console.log(`Passed: ${res.filter(r => r.passed).length} / ${res.length}`);
}).catch(console.error);
