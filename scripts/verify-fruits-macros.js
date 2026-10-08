const { prisma } = require('../src/config/db');
const { searchFoods } = require('../src/modules/food/food.service');

async function verify() {
  console.log('🔍 Running Fruits Macros Verification...\n');

  // 1. Check total high-priority foods in DB
  const priorityCount = await prisma.food.count({
    where: { isHighPriority: true, deletedAt: null },
  });
  console.log(`📊 Total High Priority Foods in DB: ${priorityCount} (Expected: 90)`);

  // 2. Sample key fruit items
  const sampleFruitNames = [
    'Apple (with skin)',
    'Banana',
    'Mango',
    'Papaya',
    'Guava',
    'Pomegranate (arils)',
    'Watermelon',
    'Medjool dates',
  ];

  console.log('\n--- Checking Sample Fruit Records ---');
  for (const name of sampleFruitNames) {
    const food = await prisma.food.findFirst({
      where: { name, deletedAt: null },
      include: { servings: true },
    });
    if (food) {
      console.log(`✅ Found: "${food.name}"`);
      console.log(`   - Priority: ${food.isHighPriority} | Layer: ${food.layer}`);
      console.log(`   - Macros / 100g: ${food.calories} kcal | P: ${food.protein}g | C: ${food.carbohydrates}g | F: ${food.fat}g | Fiber: ${food.fiber}g`);
      console.log(`   - Servings:`, food.servings.map(s => `${s.unitLabel} (${s.weightGrams}g, default: ${s.isDefault}, type: ${s.unitType})`).join(', '));
    } else {
      console.log(`❌ Not found: "${name}"`);
    }
  }

  // 3. Test Search Rankings for English & Hindi queries
  const testQueries = [
    'kela',
    'banana',
    'apple',
    'seb',
    'aam',
    'mango',
    'anar',
    'amrud',
    'tarbooz',
    'papita',
    'khajoor',
    'sitaphal'
  ];

  console.log('\n--- Testing Search Ranking for Fruit Queries ---');
  for (const q of testQueries) {
    const res = await searchFoods(q, null, null, 3, 1);
    console.log(`\n🔎 Query: "${q}" -> ${res.foods.length} top results:`);
    res.foods.forEach((f, idx) => {
      console.log(`   ${idx + 1}. ${f.name} [Priority: ${f.isHighPriority}] (Serving: ${f.servingUnit} / ${f.servingWeight}g, ${f.calories} kcal/100g)`);
    });
  }
}

verify()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
