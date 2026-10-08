const { prisma } = require('../src/config/db');
const { searchFoods } = require('../src/modules/food/food.service');

async function verify() {
  console.log('🔍 Running Indian Food Macros Verification...\n');

  // 1. Verify high priority count in DB
  const priorityCount = await prisma.food.count({
    where: { isHighPriority: true, deletedAt: null },
  });
  console.log(`📊 High Priority Foods in DB: ${priorityCount} (Expected: >= 53)`);

  // 2. Sample key items to inspect macros & servings
  const sampleNames = [
    'Roti / Chapati (plain, no oil)',
    'Steamed white rice (chawal)',
    'Toor dal (tadka)',
    'Paneer Butter Masala',
    'Masala chai (with sugar)',
  ];

  console.log('\n--- Checking Sample Records ---');
  for (const name of sampleNames) {
    const food = await prisma.food.findFirst({
      where: { name, deletedAt: null },
      include: { servings: true },
    });
    if (food) {
      console.log(`✅ Found: "${food.name}"`);
      console.log(`   - Priority: ${food.isHighPriority}`);
      console.log(`   - Macros / 100g: ${food.calories} kcal | P: ${food.protein}g | C: ${food.carbohydrates}g | F: ${food.fat}g | Fiber: ${food.fiber}g`);
      console.log(`   - Servings:`, food.servings.map(s => `${s.unitLabel} (${s.weightGrams}g, default: ${s.isDefault}, type: ${s.unitType})`).join(', '));
    } else {
      console.log(`❌ Not found: "${name}"`);
    }
  }

  // 3. Test Search Queries
  const testQueries = ['roti', 'chawal', 'toor dal', 'paneer butter masala', 'chai', 'poha', 'paratha'];
  console.log('\n--- Testing Search Ranking for Indian Staples ---');
  for (const q of testQueries) {
    const res = await searchFoods(q, null, null, 3, 1);
    console.log(`\n🔎 Query: "${q}" -> ${res.foods.length} top results:`);
    res.foods.forEach((f, idx) => {
      console.log(`   ${idx + 1}. ${f.name} [Priority: ${f.isHighPriority}] (Default serving: ${f.servingUnit} / ${f.servingWeight}g, ${f.calories} kcal/100g)`);
    });
  }
}

verify()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
