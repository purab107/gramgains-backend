const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

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
  await prisma.food.deleteMany({});

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
        data: { name, aliases, category, servingUnit: 'g', servingWeight: 100, calories: Math.max(0, calories), protein: Math.max(0, protein), carbohydrates: Math.max(0, carbs), fat: Math.max(0, fat), fiber: Math.max(0, fiber), source: 'IFCT 2017', layer: 1 },
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
    { name: 'Dal Tadka (Cooked)',          aliases: ['Yellow Dal', 'Toor Dal Fry', 'Tarka Dal'],                     category: 'Prepared Lentils & Curries',  servingUnit: 'bowl',  servingWeight: 200, calories: 180,  protein: 8.5,  carbohydrates: 24.0, fat: 6.2,  fiber: 4.5 },
    { name: 'Dal Makhani',                 aliases: ['Black Dal', 'Makhani Dal'],                                     category: 'Prepared Lentils & Curries',  servingUnit: 'bowl',  servingWeight: 200, calories: 260,  protein: 9.2,  carbohydrates: 22.5, fat: 15.0, fiber: 5.1 },
    { name: 'Steamed Basmati Rice',        aliases: ['Cooked Rice', 'Paka Chawal', 'Boiled Rice'],                   category: 'Prepared Rice Dishes',        servingUnit: 'bowl',  servingWeight: 150, calories: 195,  protein: 4.1,  carbohydrates: 42.5, fat: 0.4,  fiber: 0.8 },
    { name: 'Jeera Rice',                  aliases: ['Cumin Rice', 'Tadka Rice'],                                     category: 'Prepared Rice Dishes',        servingUnit: 'bowl',  servingWeight: 150, calories: 220,  protein: 4.2,  carbohydrates: 43.0, fat: 3.5,  fiber: 0.9 },
    { name: 'Plain Phulka / Roti',         aliases: ['Chapati', 'Wheat Roti', 'Fulka'],                              category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 35,  calories: 90,   protein: 3.1,  carbohydrates: 18.2, fat: 0.5,  fiber: 2.8 },
    { name: 'Butter Roti',                 aliases: ['Ghee Roti', 'Butter Chapati'],                                  category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 40,  calories: 125,  protein: 3.1,  carbohydrates: 18.2, fat: 4.5,  fiber: 2.8 },
    { name: 'Plain Paratha',               aliases: ['Plain Parautha'],                                               category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 60,  calories: 190,  protein: 4.2,  carbohydrates: 27.5, fat: 7.2,  fiber: 3.2 },
    { name: 'Aloo Paratha',               aliases: ['Potato Paratha', 'Stuffed Aloo Roti'],                          category: 'Prepared Breads',             servingUnit: 'piece', servingWeight: 120, calories: 290,  protein: 6.1,  carbohydrates: 44.0, fat: 9.8,  fiber: 4.1 },
    { name: 'Paneer Butter Masala',        aliases: ['Paneer Makhani', 'Paneer Gravy'],                              category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 250, calories: 360,  protein: 14.2, carbohydrates: 14.0, fat: 28.5, fiber: 3.1 },
    { name: 'Palak Paneer',                aliases: ['Spinach Paneer', 'Saag Paneer'],                               category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 250, calories: 270,  protein: 13.8, carbohydrates: 9.5,  fat: 20.0, fiber: 4.2 },
    { name: 'Rajma Masala',                aliases: ['Kidney Bean Curry', 'Rajma Gravy'],                            category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 200, calories: 210,  protein: 11.2, carbohydrates: 31.0, fat: 4.8,  fiber: 6.5 },
    { name: 'Chole / Chana Masala',        aliases: ['Chickpea Curry', 'Kabuli Chana'],                              category: 'Prepared Curries',            servingUnit: 'bowl',  servingWeight: 200, calories: 240,  protein: 10.5, carbohydrates: 34.0, fat: 7.0,  fiber: 7.2 },
    { name: 'Chicken Curry (Home Style)',  aliases: ['Indian Chicken Gravy', 'Chicken Salan'],                       category: 'Prepared Meat Curries',       servingUnit: 'bowl',  servingWeight: 250, calories: 310,  protein: 26.5, carbohydrates: 8.4,  fat: 19.2, fiber: 2.0 },
    { name: 'Butter Chicken',             aliases: ['Murgh Makhani'],                                                category: 'Prepared Meat Curries',       servingUnit: 'bowl',  servingWeight: 250, calories: 420,  protein: 28.0, carbohydrates: 12.0, fat: 29.0, fiber: 1.8 },
    { name: 'Chicken Biryani',            aliases: ['Hyderabadi Chicken Biryani'],                                   category: 'Prepared Rice Dishes',        servingUnit: 'plate', servingWeight: 350, calories: 520,  protein: 31.0, carbohydrates: 62.0, fat: 16.5, fiber: 2.5 },
    { name: 'Egg Curry (2 Eggs)',         aliases: ['Anda Curry', 'Egg Gravy'],                                      category: 'Prepared Egg Dishes',         servingUnit: 'bowl',  servingWeight: 250, calories: 260,  protein: 14.5, carbohydrates: 6.5,  fat: 19.0, fiber: 1.2 },
    { name: 'Plain Idli',                 aliases: ['Steamed Idli', 'Rice Lentil Cake'],                             category: 'South Indian Breakfast',      servingUnit: 'piece', servingWeight: 60,  calories: 78,   protein: 2.2,  carbohydrates: 16.5, fat: 0.3,  fiber: 1.1 },
    { name: 'Plain Dosa',                 aliases: ['Sada Dosa', 'Crispy Dosa'],                                     category: 'South Indian Breakfast',      servingUnit: 'piece', servingWeight: 100, calories: 168,  protein: 3.8,  carbohydrates: 29.0, fat: 4.2,  fiber: 1.5 },
    { name: 'Masala Dosa',               aliases: ['Potato Dosa'],                                                   category: 'South Indian Breakfast',      servingUnit: 'piece', servingWeight: 180, calories: 320,  protein: 5.5,  carbohydrates: 51.0, fat: 10.5, fiber: 3.2 },
    { name: 'Sambar',                     aliases: ['South Indian Sambar', 'Lentil Veg Soup'],                       category: 'Prepared Lentils & Curries',  servingUnit: 'bowl',  servingWeight: 200, calories: 130,  protein: 4.8,  carbohydrates: 19.5, fat: 3.8,  fiber: 4.0 },
    { name: 'Vegetable Poha',            aliases: ['Flattened Rice Breakfast', 'Kanda Poha'],                        category: 'Breakfast Dishes',            servingUnit: 'plate', servingWeight: 150, calories: 220,  protein: 4.5,  carbohydrates: 38.0, fat: 5.8,  fiber: 3.0 },
    { name: 'Rava Upma',                 aliases: ['Sooji Upma', 'Semolina Breakfast'],                              category: 'Breakfast Dishes',            servingUnit: 'plate', servingWeight: 150, calories: 210,  protein: 5.0,  carbohydrates: 34.0, fat: 6.2,  fiber: 2.2 },
  ];

  for (const food of layer2Foods) {
    await prisma.food.create({ data: { ...food, source: 'INDB', layer: 2 } });
  }

  const total = await prisma.food.count();
  console.log(`✅ Seeded ${layer2Foods.length} INDB dishes.`);
  console.log(`🎉 Total foods in database: ${total}`);
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
