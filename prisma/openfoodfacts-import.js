// prisma/openfoodfacts-import.js
// Imports OpenFoodFacts curated dataset (GramGains_OpenFoodFacts_Final_Import.csv) into the GramGains Food table.
// Run standalone: node prisma/openfoodfacts-import.js
// Or called from seed.js after IFCT 2017 & INDB layers.

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const prisma = new PrismaClient();

const CSV_PATH = path.resolve(__dirname, '../../csvsss/GramGains_OpenFoodFacts_Final_Import.csv');

function parseCSVLine(line) {
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
  return result.map((val) => val.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
}

function buildAliases(name, brand, genericName) {
  const aliases = new Set();
  if (brand && brand.length > 1) {
    aliases.add(brand);
    if (!name.toLowerCase().includes(brand.toLowerCase())) {
      aliases.add(`${brand} ${name}`.trim());
    }
  }
  if (genericName && genericName.length > 2 && genericName.toLowerCase() !== name.toLowerCase()) {
    aliases.add(genericName);
  }
  return Array.from(aliases);
}

async function importOpenFoodFacts() {
  console.log(`\n======================================================`);
  console.log(`📦 OpenFoodFacts Curated Dataset Importer (Layer 3)`);
  console.log(`======================================================`);

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV dataset not found at: ${CSV_PATH}`);
    return;
  }

  console.log(`📄 Reading CSV from: ${CSV_PATH}`);

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  const crypto = require('crypto');
  let header = null;
  let headerMap = {};
  const batchSize = 1000;
  let foodBatch = [];
  let servingBatch = [];
  let totalProcessed = 0;
  let totalInserted = 0;
  const startTime = Date.now();

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!header) {
      header = parseCSVLine(line);
      header.forEach((colName, index) => {
        headerMap[colName] = index;
      });
      continue;
    }

    const cols = parseCSVLine(line);
    const name = cols[headerMap['name']] || '';
    if (!name) continue;

    const barcode = cols[headerMap['barcode']] || null;
    const genericName = cols[headerMap['generic_name']] || null;
    const brand = cols[headerMap['brand']] || null;
    const brandOwner = cols[headerMap['brand_owner']] || null;
    const category = cols[headerMap['category']] || 'Other';
    const servingUnit = cols[headerMap['servingUnit']] || 'g';
    const servingWeight = parseFloat(cols[headerMap['servingWeight']]) || 100;
    const calories = Math.max(0, parseFloat(cols[headerMap['calories']]) || 0);
    const protein = Math.max(0, parseFloat(cols[headerMap['protein']]) || 0);
    const carbohydrates = Math.max(0, parseFloat(cols[headerMap['carbohydrates']]) || 0);
    const fat = Math.max(0, parseFloat(cols[headerMap['fat']]) || 0);
    const fiber = Math.max(0, parseFloat(cols[headerMap['fiber']]) || 0);

    const aliases = buildAliases(name, brand, genericName);
    const foodId = crypto.randomUUID();

    foodBatch.push({
      id: foodId,
      name,
      aliases,
      category,
      brand,
      brandOwner,
      genericName,
      barcode,
      calories: Math.round(calories * 10) / 10,
      protein: Math.round(protein * 10) / 10,
      carbohydrates: Math.round(carbohydrates * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      fiber: Math.round(fiber * 10) / 10,
      source: 'OPEN_FOOD_FACTS',
      layer: 3,
    });

    servingBatch.push({
      id: crypto.randomUUID(),
      foodId,
      unitLabel: servingUnit,
      weightGrams: servingWeight,
      isDefault: true,
    });

    totalProcessed++;

    if (foodBatch.length >= batchSize) {
      const res = await prisma.food.createMany({
        data: foodBatch,
        skipDuplicates: true,
      });
      await prisma.foodServing.createMany({
        data: servingBatch,
        skipDuplicates: true,
      });
      totalInserted += res.count;
      process.stdout.write(`  ⏳ Processed: ${totalProcessed} | Inserted: ${totalInserted}\r`);
      foodBatch = [];
      servingBatch = [];
    }
  }

  if (foodBatch.length > 0) {
    const res = await prisma.food.createMany({
      data: foodBatch,
      skipDuplicates: true,
    });
    await prisma.foodServing.createMany({
      data: servingBatch,
      skipDuplicates: true,
    });
    totalInserted += res.count;
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ OpenFoodFacts import complete!`);
  console.log(`   - Total items parsed:   ${totalProcessed}`);
  console.log(`   - Total items inserted: ${totalInserted}`);
  console.log(`   - Time taken:           ${durationSec}s\n`);
}

module.exports = { importOpenFoodFacts };

if (require.main === module) {
  (async () => {
    try {
      await importOpenFoodFacts();
    } catch (err) {
      console.error('❌ Import error:', err);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  })();
}
