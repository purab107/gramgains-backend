const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const CSV_PATH = path.join(__dirname, '../fruits_macros.csv');

// Curated search aliases with English, Hindi, and regional variants
const CURATED_FRUIT_ALIASES = {
  1: ['Apple', 'Seb', 'Fresh Apple', 'Red Apple', 'Green Apple', 'Seb Fal', 'Raw Apple'],
  2: ['Banana', 'Kela', 'Ripe Banana', 'Peeled Banana', 'Kele', 'Fresh Banana', 'Cavendish Banana'],
  3: ['Orange', 'Santara', 'Santra', 'Nagpur Orange', 'Narangi', 'Fresh Orange', 'Sweet Orange'],
  4: ['Mosambi', 'Sweet Lime', 'Mousambi', 'Mausambi', 'Sweet Lemon', 'Mosambi Fruit'],
  5: ['Grapefruit', 'Chakotra', 'Pink Grapefruit', 'Red Grapefruit', 'Citrus Paradise'],
  6: ['Mango', 'Aam', 'Alphonso', 'Kesar Mango', 'Ripe Mango', 'Aam Fal', 'Fresh Mango', 'Sweet Mango'],
  7: ['Papaya', 'Papita', 'Ripe Papaya', 'Pawpaw', 'Papita Fal', 'Fresh Papaya'],
  8: ['Pineapple', 'Ananas', 'Fresh Pineapple', 'Ananaas', 'Pineapple Chunks'],
  9: ['Guava', 'Amrud', 'Amrood', 'Peru', 'Peyara', 'Pink Guava', 'White Guava', 'Fresh Guava'],
  10: ['Jackfruit', 'Kathal', 'Ripe Jackfruit', 'Kathal Pulp', 'Sweet Jackfruit'],
  11: ['Custard Apple', 'Sitaphal', 'Seethaphal', 'Sharifa', 'Sugar Apple', 'Sita Phal'],
  12: ['Chikoo', 'Chiku', 'Sapota', 'Sapodilla', 'Sapota Fruit'],
  13: ['Dragon Fruit', 'Pitaya', 'Red Dragon Fruit', 'White Dragon Fruit'],
  14: ['Lychee', 'Litchi', 'Fresh Lychee', 'Lichi', 'Lychee Fruit'],
  15: ['Avocado', 'Makhanphal', 'Butter Fruit', 'Fresh Avocado', 'Hass Avocado'],
  16: ['Coconut', 'Fresh Coconut', 'Nariyal', 'Coconut Meat', 'Kopra', 'Taza Nariyal', 'Raw Coconut'],
  17: ['Watermelon', 'Tarbooz', 'Tarbuj', 'Water Melon', 'Red Watermelon', 'Fresh Tarbooz'],
  18: ['Muskmelon', 'Kharbooja', 'Kharbooza', 'Cantaloupe', 'Rockmelon', 'Sweet Melon', 'Kharbuja'],
  19: ['Grapes', 'Angoor', 'Green Grapes', 'Black Grapes', 'Seedless Grapes', 'Red Grapes', 'Fresh Angoor'],
  20: ['Strawberries', 'Strawberry', 'Fresh Strawberry', 'Red Strawberry', 'Strawberries Whole'],
  21: ['Blueberries', 'Blueberry', 'Fresh Blueberry', 'Blueberries Whole'],
  22: ['Blackberries', 'Blackberry', 'Fresh Blackberry'],
  23: ['Raspberries', 'Raspberry', 'Fresh Raspberry', 'Red Raspberries'],
  24: ['Mulberries', 'Shahtoot', 'Fresh Mulberries', 'Shehtoot'],
  25: ['Jamun', 'Indian Blackberry', 'Black Plum', 'Java Plum', 'Jamoon', 'Kala Jamun'],
  26: ['Amla', 'Indian Gooseberry', 'Awla', 'Amalaki', 'Fresh Amla'],
  27: ['Kiwi', 'Kiwi Fruit', 'Green Kiwi', 'Kiwifruit', 'Chinese Gooseberry'],
  28: ['Pear', 'Nashpati', 'Fresh Pear', 'Green Pear', 'Asian Pear', 'Babugosha'],
  29: ['Peach', 'Aadu', 'Fresh Peach', 'Aaloo Peach', 'Aadu Fruit'],
  30: ['Plum', 'Aaloo Bukhara', 'Alubukhara', 'Fresh Plum', 'Black Plum Fruit'],
  31: ['Cherries', 'Cherry', 'Sweet Cherries', 'Fresh Cherry', 'Red Cherries'],
  32: ['Apricot', 'Khubani', 'Fresh Apricot', 'Khumani', 'Jardalu'],
  33: ['Pomegranate', 'Anar', 'Anaar', 'Pomegranate Seeds', 'Anardana', 'Pomegranate Arils'],
  34: ['Fig', 'Anjeer', 'Fresh Fig', 'Taza Anjeer', 'Fresh Figs'],
  35: ['Dates', 'Khajoor', 'Khajur', 'Medjool Dates', 'Dry Dates', 'Meetha Khajoor'],
  36: ['Raisins', 'Kishmish', 'Kismis', 'Sultanas', 'Munakka', 'Dry Grapes'],
  37: ['Dried Figs', 'Dry Anjeer', 'Anjeer', 'Sukha Anjeer', 'Dried Fig'],
};

// Map food names / patterns to find existing duplicate items to replace
const REPLACEMENT_PATTERNS = {
  1: ['Apple (with skin)', 'Apple', 'Red Apple', 'Green Apple', 'Fresh Apple'],
  2: ['Banana', 'Ripe Banana', 'Peeled Banana', 'Kela'],
  3: ['Orange', 'Santara', 'Santra', 'Sweet Orange'],
  4: ['Mosambi (sweet lime)', 'Mosambi', 'Sweet Lime'],
  5: ['Grapefruit', 'Pink Grapefruit'],
  6: ['Mango', 'Alphonso Mango', 'Ripe Mango', 'Aam'],
  7: ['Papaya', 'Ripe Papaya', 'Papita'],
  8: ['Pineapple', 'Fresh Pineapple', 'Ananas'],
  9: ['Guava', 'Amrud', 'Peru', 'Pink Guava'],
  10: ['Jackfruit (ripe)', 'Jackfruit', 'Kathal'],
  11: ['Custard apple', 'Custard Apple', 'Sitaphal'],
  12: ['Chikoo (sapota)', 'Chikoo', 'Sapota', 'Chiku'],
  13: ['Dragon fruit', 'Dragon Fruit', 'Pitaya'],
  14: ['Lychee', 'Litchi'],
  15: ['Avocado', 'Butter Fruit', 'Hass Avocado'],
  16: ['Coconut (fresh meat)', 'Fresh Coconut', 'Coconut Meat', 'Nariyal'],
  17: ['Watermelon', 'Tarbooz', 'Water Melon'],
  18: ['Muskmelon (cantaloupe)', 'Muskmelon', 'Kharbooja', 'Cantaloupe'],
  19: ['Grapes (green/red)', 'Grapes', 'Green Grapes', 'Black Grapes', 'Angoor'],
  20: ['Strawberries', 'Strawberry'],
  21: ['Blueberries', 'Blueberry'],
  22: ['Blackberries', 'Blackberry'],
  23: ['Raspberries', 'Raspberry'],
  24: ['Mulberries', 'Shahtoot'],
  25: ['Jamun (Indian blackberry)', 'Jamun', 'Indian Blackberry'],
  26: ['Amla (Indian gooseberry)', 'Amla', 'Indian Gooseberry'],
  27: ['Kiwi', 'Green Kiwi'],
  28: ['Pear', 'Nashpati'],
  29: ['Peach', 'Aadu'],
  30: ['Plum', 'Aaloo bukhara'],
  31: ['Cherries (sweet)', 'Cherries', 'Cherry'],
  32: ['Apricot (fresh)', 'Apricot', 'Khubani'],
  33: ['Pomegranate (arils)', 'Pomegranate', 'Anar'],
  34: ['Fig (fresh)', 'Fig', 'Fresh Fig', 'Anjeer'],
  35: ['Medjool dates', 'Dates', 'Khajoor'],
  36: ['Raisins', 'Kishmish'],
  37: ['Dried figs', 'Dry Anjeer', 'Dried Fig'],
};

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

function parseServingUnit(description, weightGrams) {
  const desc = (description || '').trim();
  const lowerDesc = desc.toLowerCase();

  let unitLabel = desc;
  let unitType = 'COUNT';
  let displayQuantity = 1;

  if (lowerDesc.includes('cup')) {
    unitType = 'VOLUME';
  } else if (lowerDesc.includes('handful')) {
    unitType = 'HOUSEHOLD';
  } else if (lowerDesc.includes('medium') || lowerDesc.includes('fruit') || lowerDesc.includes('pieces') || lowerDesc.includes('piece') || lowerDesc.includes('dates')) {
    unitType = 'COUNT';
  } else if (lowerDesc.endsWith(' g') || lowerDesc === '100 g') {
    unitType = 'WEIGHT';
    displayQuantity = weightGrams;
  } else {
    unitType = 'COUNT';
  }

  // Check displayQuantity from description (e.g., "2 medium", "10 pieces", "1/2 medium", "3 pieces", "2 dates")
  if (lowerDesc.startsWith('1/2')) {
    displayQuantity = 0.5;
  } else {
    const matchQty = desc.match(/^(\d+(\.\d+)?)/);
    if (matchQty && unitType !== 'WEIGHT') {
      displayQuantity = parseFloat(matchQty[1]);
    }
  }

  return {
    unitLabel,
    unitType,
    displayQuantity,
    weightGrams: parseFloat(weightGrams) || 100,
  };
}

async function seedFruitsMacros() {
  console.log('🍎 Starting Fruits Macros Seeding...');
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV file not found at: ${CSV_PATH}`);
    return;
  }

  const fileContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = fileContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length <= 1) {
    console.warn('⚠️ CSV contains no rows.');
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 18) continue;

    const id = parseInt(cols[0], 10);
    const rawFruitName = cols[1].trim();
    const category = cols[3].trim() || 'Fruits';
    const servingDescription = cols[4].trim();
    const servingWeightG = parseFloat(cols[5]) || 100;

    const caloriesPer100g = parseFloat(cols[12]) || 0;
    const proteinPer100g = parseFloat(cols[13]) || 0;
    const carbsPer100g = parseFloat(cols[14]) || 0;
    const fiberPer100g = parseFloat(cols[16]) || 0;
    const fatPer100g = parseFloat(cols[17]) || 0;

    const aliases = CURATED_FRUIT_ALIASES[id] || [rawFruitName];
    const serving = parseServingUnit(servingDescription, servingWeightG);

    // Identify candidate existing foods to replace
    const candidateNames = REPLACEMENT_PATTERNS[id] || [rawFruitName];

    // Find existing food by exact candidate names or case-insensitive match
    let existingFood = await prisma.food.findFirst({
      where: {
        OR: [
          { name: { in: candidateNames, mode: 'insensitive' } },
          { name: rawFruitName },
        ],
        deletedAt: null,
      },
    });

    const foodData = {
      name: rawFruitName,
      aliases,
      category: `Fruits & Berries`,
      calories: Math.max(0, caloriesPer100g),
      protein: Math.max(0, proteinPer100g),
      carbohydrates: Math.max(0, carbsPer100g),
      fat: Math.max(0, fatPer100g),
      fiber: Math.max(0, fiberPer100g),
      source: 'IFCT_2017',
      layer: 1, // Raw whole agricultural fruits
      isHighPriority: true,
    };

    let targetFoodId;

    if (existingFood) {
      // Update existing record
      await prisma.food.update({
        where: { id: existingFood.id },
        data: foodData,
      });
      targetFoodId = existingFood.id;
      // Remove old servings
      await prisma.foodServing.deleteMany({
        where: { foodId: targetFoodId },
      });
      updatedCount++;
    } else {
      // Create new record
      const created = await prisma.food.create({
        data: foodData,
      });
      targetFoodId = created.id;
      createdCount++;
    }

    // Insert primary portion serving
    await prisma.foodServing.create({
      data: {
        foodId: targetFoodId,
        unitLabel: serving.unitLabel,
        unitType: serving.unitType,
        displayQuantity: serving.displayQuantity,
        weightGrams: serving.weightGrams,
        isDefault: true,
      },
    });

    // Also insert 100g weight serving if default is not already 100g
    if (serving.unitLabel !== '100 g' && serving.unitLabel !== 'g' && serving.weightGrams !== 100) {
      await prisma.foodServing.create({
        data: {
          foodId: targetFoodId,
          unitLabel: 'g',
          unitType: 'WEIGHT',
          displayQuantity: 100,
          weightGrams: 100,
          isDefault: false,
        },
      });
    }
  }

  console.log(`✅ Fruits Macros Seeding complete:`);
  console.log(`   - Updated / Replaced: ${updatedCount} existing fruit items`);
  console.log(`   - Created: ${createdCount} new high-priority fruit items`);
  console.log(`   - Total Processed: ${lines.length - 1} items.`);
}

if (require.main === module) {
  seedFruitsMacros()
    .catch((err) => {
      console.error('❌ Error seeding fruits macros:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { seedFruitsMacros };
