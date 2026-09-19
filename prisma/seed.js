const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { importINDB } = require('./indb-import');
const { importOpenFoodFacts } = require('./openfoodfacts-import');

const prisma = new PrismaClient();

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((val) => val.replace(/^"|"$/g, ''));
}

function extractAliases(langStr, nameStr) {
  const aliases = new Set();
  if (langStr) {
    for (const part of langStr.split(';')) {
      const cleaned = part.replace(/^[A-Za-z]+\.\s*/, '').trim();
      if (cleaned && cleaned.length > 1) aliases.add(cleaned);
    }
  }
  const nameParts = nameStr.split(',').map((s) => s.trim());
  if (nameParts.length > 1) aliases.add(nameParts.reverse().join(' '));
  return Array.from(aliases);
}

async function main() {
  console.log('🌱 Starting GramGains Database Import...');
  await prisma.mealLog.deleteMany({});
  await prisma.savedMealItem.deleteMany({});
  await prisma.savedMeal.deleteMany({});
  await prisma.foodServing.deleteMany({});
  await prisma.favoriteFood.deleteMany({});
  await prisma.food.deleteMany({});

  // Seed default user & profile if not exists
  const defaultUser = await prisma.user.upsert({
    where: { email: 'athlete@gramgains.app' },
    update: {},
    create: {
      id: 'default-user',
      name: 'Athlete',
      email: 'athlete@gramgains.app',
      emailVerified: true,
      profile: {
        create: {
          age: 25,
          gender: 'MALE',
          heightCm: 175,
          activityLevel: 'MODERATE',
          goal: 'MAINTAIN',
          timezone: 'UTC',
          bmr: 1650,
          tdee: 2200,
          targetCalories: 2200,
          targetProtein: 140,
          targetCarbs: 250,
          targetFat: 65,
          targetFiber: 30,
        },
      },
    },
  });
  console.log(`👤 Seeded default user: ${defaultUser.email}`);

  // Layer 1 — IFCT 2017
  const ifctCsvPath = path.join(__dirname, '../ifct2017-main/compositions/index.csv');
  if (fs.existsSync(ifctCsvPath)) {
    console.log(`📦 Found IFCT 2017 at: ${ifctCsvPath}`);
    const lines = fs.readFileSync(ifctCsvPath, 'utf-8').split(/\r?\n/).filter((l) => l.trim().length > 0);
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 24) continue;
      const name = cols[1];
      const scie = cols[2];
      const lang = cols[3];
      const category = cols[4] || 'General Foods';
      const enercKj = parseFloat(cols[7]) || 0;
      const calories = Math.round((enercKj / 4.184) * 10) / 10;
      const fat = parseFloat(cols[15]) || 0;
      const fiber = parseFloat(cols[19]) || 0;
      const carbs = parseFloat(cols[21]) || 0;
      const protein = parseFloat(cols[23]) || 0;
      const aliases = extractAliases(lang, name);
      if (scie) aliases.push(scie);
      await prisma.food.create({
        data: {
          name,
          aliases,
          category,
          calories: Math.max(0, calories),
          protein: Math.max(0, protein),
          carbohydrates: Math.max(0, carbs),
          fat: Math.max(0, fat),
          fiber: Math.max(0, fiber),
          source: 'IFCT_2017',
          layer: 1,
          servings: {
            create: [
              {
                unitLabel: 'g',
                weightGrams: 100,
                isDefault: true,
              },
            ],
          },
        },
      });
      count++;
    }
    console.log(`✅ Extracted ${count} raw ingredients from IFCT 2017.`);
  } else {
    console.warn(`⚠️ IFCT 2017 dataset not found at ${ifctCsvPath}`);
  }

  // Layer 2 — INDB Prepared Dishes
  console.log('🍲 Seeding Layer 2 INDB Prepared Indian Recipes...');
  const layer2Foods = [
    { name: 'Dal Tadka (Cooked)',          aliases: ['Yellow Dal', 'Toor Dal Fry', 'Tarka Dal'],                     category: 'Prepared Lentils & Curries',  servingUnit: 'bowl',  servingWeight: 200, calories: 90.0,  protein: 4.25, carbohydrates: 12.0,  fat: 3.1,   fiber: 2.25 },
    { name: 'Dal Makhani',                 aliases: ['Black Dal', 'Makhani Dal'],                                     category: 'Prepared Lentils & Curries',  servingUnit: 'bowl',  servingWeight: 200, calories: 130.0, protein: 4.6,  carbohydrates: 11.25, fat: 7.5,   fiber: 2.55 },
    { name: 'Steamed Basmati Rice',        aliases: ['Cooked Rice', 'Paka Chawal', 'Boiled Rice'],                   category: 'Prepared Rice Dishes',        servingUnit: 'bowl',  servingWeight: 150, calories: 130.0, protein: 2.73, carbohydrates: 28.33, fat: 0.27,  fiber: 0.53 },
    { name: 'Jeera Rice',                  aliases: ['Cumin Rice', 'Tadka Rice'],                                     category: 'Prepared Rice Dishes',        servingUnit: 'bowl',  servingWeight: 150, calories: 146.7, protein: 2.8,  carbohydrates: 28.67, fat: 2.33,  fiber: 0.6 },
    { name: 'Plain Phulka / Roti',         aliases: ['Chapati', 'Wheat Roti', 'Fulka'],                              category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 35,  calories: 257.1, protein: 8.86, carbohydrates: 52.0,  fat: 1.43,  fiber: 8.0 },
    { name: 'Butter Roti',                 aliases: ['Ghee Roti', 'Butter Chapati'],                                  category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 40,  calories: 312.5, protein: 7.75, carbohydrates: 45.5,  fat: 11.25, fiber: 7.0 },
    { name: 'Plain Paratha',               aliases: ['Plain Parautha'],                                               category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 60,  calories: 316.7, protein: 7.0,  carbohydrates: 45.83, fat: 12.0,  fiber: 5.33 },
    { name: 'Aloo Paratha',               aliases: ['Potato Paratha', 'Stuffed Aloo Roti'],                          category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 120, calories: 241.7, protein: 5.08, carbohydrates: 36.67, fat: 8.17,  fiber: 3.42 },
    { name: 'Paneer Butter Masala',        aliases: ['Paneer Makhani', 'Paneer Gravy'],                              category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 250, calories: 144.0, protein: 5.68, carbohydrates: 5.6,   fat: 11.4,  fiber: 1.24 },
    { name: 'Palak Paneer',                aliases: ['Spinach Paneer', 'Saag Paneer'],                               category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 250, calories: 108.0, protein: 5.52, carbohydrates: 3.8,   fat: 8.0,   fiber: 1.68 },
    { name: 'Rajma Masala',                aliases: ['Kidney Bean Curry', 'Rajma Gravy'],                            category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 200, calories: 105.0, protein: 5.6,  carbohydrates: 15.5,  fat: 2.4,   fiber: 3.25 },
    { name: 'Chole / Chana Masala',        aliases: ['Chickpea Curry', 'Kabuli Chana'],                              category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 200, calories: 120.0, protein: 5.25, carbohydrates: 17.0,  fat: 3.5,   fiber: 3.6 },
    { name: 'Chicken Curry (Home Style)',  aliases: ['Indian Chicken Gravy', 'Chicken Salan'],                       category: 'Prepared Meat Curries',       servingUnit: 'bowl',  servingWeight: 250, calories: 124.0, protein: 10.6, carbohydrates: 3.36,  fat: 7.68,  fiber: 0.8 },
    { name: 'Butter Chicken',             aliases: ['Murgh Makhani'],                                                category: 'Prepared Meat Curries',       servingUnit: 'bowl',  servingWeight: 250, calories: 168.0, protein: 11.2, carbohydrates: 4.8,   fat: 11.6,  fiber: 0.72 },
    { name: 'Chicken Biryani',            aliases: ['Hyderabadi Chicken Biryani'],                                   category: 'Prepared Rice Dishes',        servingUnit: 'plate', servingWeight: 350, calories: 148.6, protein: 8.86, carbohydrates: 17.71, fat: 4.71,  fiber: 0.71 },
    { name: 'Egg Curry (2 Eggs)',         aliases: ['Anda Curry', 'Egg Gravy'],                                      category: 'Prepared Egg Dishes',         servingUnit: 'bowl',  servingWeight: 250, calories: 104.0, protein: 5.8,  carbohydrates: 2.6,   fat: 7.6,   fiber: 0.48 },
    { name: 'Plain Idli',                 aliases: ['Steamed Idli', 'Rice Lentil Cake'],                             category: 'South Indian Breakfast',      servingUnit: 'piece', servingWeight: 60,  calories: 130.0, protein: 3.67, carbohydrates: 27.5,  fat: 0.5,   fiber: 1.83 },
    { name: 'Plain Dosa',                 aliases: ['Sada Dosa', 'Crispy Dosa'],                                     category: 'South Indian Breakfast',      servingUnit: 'piece', servingWeight: 100, calories: 168.0, protein: 3.8,  carbohydrates: 29.0,  fat: 4.2,   fiber: 1.5 },
    { name: 'Masala Dosa',               aliases: ['Potato Dosa'],                                                   category: 'South Indian Breakfast',      servingUnit: 'piece', servingWeight: 180, calories: 177.8, protein: 3.06, carbohydrates: 28.33, fat: 5.83,  fiber: 1.78 },
    { name: 'Sambar',                     aliases: ['South Indian Sambar', 'Lentil Veg Soup'],                       category: 'Prepared Lentils & Curries',  servingUnit: 'bowl',  servingWeight: 200, calories: 65.0,  protein: 2.4,  carbohydrates: 9.75,  fat: 1.9,   fiber: 2.0 },
    { name: 'Vegetable Poha',            aliases: ['Flattened Rice Breakfast', 'Kanda Poha'],                        category: 'Breakfast Dishes',            servingUnit: 'plate', servingWeight: 150, calories: 146.7, protein: 3.0,  carbohydrates: 25.33, fat: 3.87,  fiber: 2.0 },
    { name: 'Rava Upma',                 aliases: ['Sooji Upma', 'Semolina Breakfast'],                              category: 'Breakfast Dishes',            servingUnit: 'plate', servingWeight: 150, calories: 140.0, protein: 3.33, carbohydrates: 22.67, fat: 4.13,  fiber: 1.47 },
  ];

  for (const item of layer2Foods) {
    const { servingUnit, servingWeight, ...foodData } = item;
    await prisma.food.create({
      data: {
        ...foodData,
        source: 'INDB',
        layer: 2,
        servings: {
          create: [
            {
              unitLabel: servingUnit || 'bowl',
              weightGrams: servingWeight || 200,
              isDefault: true,
            },
          ],
        },
      },
    });
  }
  console.log(`✅ Seeded ${layer2Foods.length} hand-coded INDB dishes (legacy).`);

  // Layer 2 — INDB 2024 (Anuvaad dataset, 1,014 items)
  console.log('\n📥 Starting INDB 2024 import...');
  await importINDB();

  // Layer 3 — OpenFoodFacts Curated Dataset (13,020 branded & packaged items)
  console.log('\n📥 Starting OpenFoodFacts import...');
  await importOpenFoodFacts();

  const total = await prisma.food.count();
  console.log(`\n🎉 Total foods in database: ${total}`);
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
