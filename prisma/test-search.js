const FoodService = require('../src/modules/food/food.service');
const { prisma } = require('../src/config/db');

async function testSearch() {
  console.log('--- Testing Food Search API ---');

  // Test 1: Brand search "Milky Mist"
  const r1 = await FoodService.searchFoods('Milky Mist');
  console.log(`\nQuery "Milky Mist" -> count: ${r1.foods.length}, total: ${r1.total}`);
  console.log('Top match:', r1.foods[0]?.name, '| Brand:', r1.foods[0]?.brand);

  // Test 2: Barcode search "8904083302490"
  const r2 = await FoodService.searchFoods('8904083302490');
  console.log(`\nQuery barcode "8904083302490" -> count: ${r2.foods.length}`);
  console.log('Match:', r2.foods[0]?.name, '| Barcode:', r2.foods[0]?.barcode);

  // Test 3: Layer 3 search
  const r3 = await FoodService.searchFoods('Oreo', 3);
  console.log(`\nQuery "Oreo" (Layer 3) -> count: ${r3.foods.length}, total: ${r3.total}`);
  console.log('Top match:', r3.foods[0]?.name, '| Brand:', r3.foods[0]?.brand);

  // Test 4: Beverage with ml unit
  const r4 = await FoodService.searchFoods('Green Ice Tea');
  console.log(`\nQuery "Green Ice Tea" -> count: ${r4.foods.length}`);
  console.log('Match:', r4.foods[0]?.name, '| Unit:', r4.foods[0]?.servingUnit, '| Weight:', r4.foods[0]?.servingWeight);
}

testSearch()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
