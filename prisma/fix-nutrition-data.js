// prisma/fix-nutrition-data.js
// One-time data correction script:
// 1. Normalizes the 22 legacy hand-coded Layer 2 foods in PostgreSQL to canonical per-100g values.
// 2. Recalculates all existing MealLog rows using (weightGrams / 100) * food.nutrient.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const NORMALIZED_FOODS = [
  { name: 'Dal Tadka (Cooked)',         calories: 90.0,  protein: 4.25, carbohydrates: 12.0,  fat: 3.1,   fiber: 2.25 },
  { name: 'Dal Makhani',                calories: 130.0, protein: 4.6,  carbohydrates: 11.25, fat: 7.5,   fiber: 2.55 },
  { name: 'Steamed Basmati Rice',       calories: 130.0, protein: 2.73, carbohydrates: 28.33, fat: 0.27,  fiber: 0.53 },
  { name: 'Jeera Rice',                 calories: 146.7, protein: 2.8,  carbohydrates: 28.67, fat: 2.33,  fiber: 0.6 },
  { name: 'Plain Phulka / Roti',        calories: 257.1, protein: 8.86, carbohydrates: 52.0,  fat: 1.43,  fiber: 8.0 },
  { name: 'Butter Roti',                calories: 312.5, protein: 7.75, carbohydrates: 45.5,  fat: 11.25, fiber: 7.0 },
  { name: 'Plain Paratha',              calories: 316.7, protein: 7.0,  carbohydrates: 45.83, fat: 12.0,  fiber: 5.33 },
  { name: 'Aloo Paratha',              calories: 241.7, protein: 5.08, carbohydrates: 36.67, fat: 8.17,  fiber: 3.42 },
  { name: 'Paneer Butter Masala',       calories: 144.0, protein: 5.68, carbohydrates: 5.6,   fat: 11.4,  fiber: 1.24 },
  { name: 'Palak Paneer',               calories: 108.0, protein: 5.52, carbohydrates: 3.8,   fat: 8.0,   fiber: 1.68 },
  { name: 'Rajma Masala',               calories: 105.0, protein: 5.6,  carbohydrates: 15.5,  fat: 2.4,   fiber: 3.25 },
  { name: 'Chole / Chana Masala',       calories: 120.0, protein: 5.25, carbohydrates: 17.0,  fat: 3.5,   fiber: 3.6 },
  { name: 'Chicken Curry (Home Style)', calories: 124.0, protein: 10.6, carbohydrates: 3.36,  fat: 7.68,  fiber: 0.8 },
  { name: 'Butter Chicken',            calories: 168.0, protein: 11.2, carbohydrates: 4.8,   fat: 11.6,  fiber: 0.72 },
  { name: 'Chicken Biryani',           calories: 148.6, protein: 8.86, carbohydrates: 17.71, fat: 4.71,  fiber: 0.71 },
  { name: 'Egg Curry (2 Eggs)',        calories: 104.0, protein: 5.8,  carbohydrates: 2.6,   fat: 7.6,   fiber: 0.48 },
  { name: 'Plain Idli',                calories: 130.0, protein: 3.67, carbohydrates: 27.5,  fat: 0.5,   fiber: 1.83 },
  { name: 'Plain Dosa',                calories: 168.0, protein: 3.8,  carbohydrates: 29.0,  fat: 4.2,   fiber: 1.5 },
  { name: 'Masala Dosa',              calories: 177.8, protein: 3.06, carbohydrates: 28.33, fat: 5.83,  fiber: 1.78 },
  { name: 'Sambar',                    calories: 65.0,  protein: 2.4,  carbohydrates: 9.75,  fat: 1.9,   fiber: 2.0 },
  { name: 'Vegetable Poha',           calories: 146.7, protein: 3.0,  carbohydrates: 25.33, fat: 3.87,  fiber: 2.0 },
  { name: 'Rava Upma',                calories: 140.0, protein: 3.33, carbohydrates: 22.67, fat: 4.13,  fiber: 1.47 },
];

async function run() {
  console.log('🔧 Starting database nutrition data standardization...');

  // 1. Update hand-coded Layer 2 dishes
  let updatedCount = 0;
  for (const item of NORMALIZED_FOODS) {
    const { name, ...macros } = item;
    const result = await prisma.food.updateMany({
      where: { name, source: 'INDB', layer: 2 },
      data: macros,
    });
    if (result.count > 0) {
      updatedCount += result.count;
      console.log(`  ✓ Updated ${name} -> ${macros.calories} kcal/100g`);
    }
  }
  console.log(`✅ Normalized ${updatedCount} hand-coded food records to per-100g baseline.\n`);

  // 2. Recalculate existing MealLog rows
  console.log('🔄 Recalculating existing meal logs with (weightGrams / 100) * food.nutrient...');
  const mealLogs = await prisma.mealLog.findMany({
    include: { food: true },
  });

  for (const log of mealLogs) {
    const food = log.food;
    const multiplier = (log.weightGrams || 100) / 100;
    const newCal = Math.round(food.calories * multiplier * 10) / 10;
    const newP = Math.round(food.protein * multiplier * 10) / 10;
    const newC = Math.round(food.carbohydrates * multiplier * 10) / 10;
    const newF = Math.round(food.fat * multiplier * 10) / 10;
    const newFib = Math.round(food.fiber * multiplier * 10) / 10;

    await prisma.mealLog.update({
      where: { id: log.id },
      data: {
        calories: newCal,
        protein: newP,
        carbohydrates: newC,
        fat: newF,
        fiber: newFib,
      },
    });
    console.log(`  ✓ Log ${log.id} (${food.name}, ${log.weightGrams}g): ${log.calories} kcal -> ${newCal} kcal`);
  }

  console.log(`\n🎉 Done! All foods and ${mealLogs.length} meal logs are now standardized.`);
}

run()
  .catch((e) => {
    console.error('❌ Error fixing nutrition data:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
