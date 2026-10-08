const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const CSV_PATH = path.join(__dirname, '../indian_food_macros.csv');

// Curated aliases for the Indian food staples to maximize search hit rate
const CURATED_ALIASES = {
  1: ['Roti', 'Chapati', 'Phulka', 'Atta Roti', 'Fulka', 'Plain Roti', 'Chapatti', 'Ghar Ki Roti', 'Indian Flatbread'],
  2: ['Phulka', 'Fulka', 'Roti', 'Dry Roti', 'Puff Roti', 'Thin Roti', 'Oil Free Roti'],
  3: ['Roti with Ghee', 'Ghee Roti', 'Ghee Chapati', 'Butter Roti', 'Chopdi Roti', 'Ghee Phulka'],
  4: ['Plain Paratha', 'Parantha', 'Tawa Paratha', 'Plain Parotha', 'Triangle Paratha', 'Layered Paratha'],
  5: ['Aloo Paratha', 'Aloo Parantha', 'Potato Paratha', 'Stuffed Aloo Roti', 'Alu Paratha'],
  6: ['Puri', 'Poori', 'Fried Puri', 'Deep Fried Puri', 'Wheat Puri'],
  7: ['Naan', 'Plain Naan', 'Tandoori Naan', 'Restaurant Naan', 'Butter Naan'],
  8: ['Missi Roti', 'Besan Roti', 'Missi Roti Tandoori', 'Chana Atta Roti'],
  9: ['White Rice', 'Cooked Rice', 'Chawal', 'Boiled Rice', 'Steamed Rice', 'Bhaat', 'Paka Chawal', 'Plain Rice'],
  10: ['Brown Rice', 'Cooked Brown Rice', 'Brown Chawal', 'Whole Grain Rice'],
  11: ['Jeera Rice', 'Cumin Rice', 'Zeera Rice', 'Tadka Rice', 'Jeera Chawal'],
  12: ['Vegetable Pulao', 'Veg Pulao', 'Veg Pulav', 'Mixed Veg Rice', 'Vegetable Rice'],
  13: ['Moong Dal Khichdi', 'Khichdi', 'Khichri', 'Dal Khichdi', 'Moong Khichdi'],
  14: ['Vegetable Biryani', 'Veg Biryani', 'Hyderabadi Veg Biryani', 'Biriyani', 'Dum Biryani'],
  15: ['Toor Dal', 'Arhar Dal', 'Yellow Dal', 'Dal Tadka', 'Dal Fry', 'Tuvar Dal', 'Peele Dal'],
  16: ['Moong Dal', 'Yellow Moong Dal', 'Dhuli Moong Dal', 'Moong Dal Tadka', 'Moong Dal Fry'],
  17: ['Masoor Dal', 'Red Lentil Curry', 'Lal Dal', 'Masoor Dal Tadka', 'Brown Lentils'],
  18: ['Chana Dal', 'Bengal Gram Dal', 'Chana Dal Tadka', 'Chana Dal Fry'],
  19: ['Dal Fry', 'Restaurant Dal Fry', 'Mixed Dal Fry', 'Dhaba Dal Fry'],
  20: ['Dal Makhani', 'Makhani Dal', 'Black Dal', 'Urad Dal Makhani', 'Kali Dal'],
  21: ['Rajma', 'Rajma Masala', 'Kidney Bean Curry', 'Rajma Gravy', 'Rajma Chawal Curry'],
  22: ['Chole', 'Chole Masala', 'Chana Masala', 'Chickpea Curry', 'Kabuli Chana', 'Amritsari Chole'],
  23: ['Sambar', 'South Indian Sambar', 'Sambhar', 'Lentil Veg Stew', 'Toor Sambar'],
  24: ['Aloo Bhurji', 'Dry Aloo Sabzi', 'Jeera Aloo', 'Aloo Sukhi Sabzi', 'Batata Bhaji', 'Aloo Masala'],
  25: ['Aloo Gobi', 'Aloo Gobhi', 'Potato Cauliflower', 'Gobi Aloo Masala', 'Dry Aloo Gobi'],
  26: ['Bhindi Sabzi', 'Bhindi Masala', 'Okra Stir Fry', 'Bhindi Fry', 'Ladyfinger Curry', 'Sukhi Bhindi'],
  27: ['Palak Paneer', 'Spinach Paneer', 'Saag Paneer', 'Palak Gravy Paneer'],
  28: ['Paneer Butter Masala', 'Paneer Makhani', 'Shahi Paneer', 'Butter Paneer', 'Paneer Gravy'],
  29: ['Matar Paneer', 'Mutter Paneer', 'Peas Paneer', 'Muttar Paneer Gravy'],
  30: ['Baingan Bharta', 'Roasted Eggplant Mash', 'Vangi Bharit', 'Aubergine Bharta', 'Baingan Ka Bharta'],
  31: ['Lauki Sabzi', 'Doodhi Sabzi', 'Bottle Gourd Curry', 'Ghiya Sabzi', 'Lauki Ki Sabji'],
  32: ['Mixed Vegetable Sabzi', 'Mix Veg', 'Mix Vegetable Curry', 'Vegetable Handi'],
  33: ['Paneer Bhurji', 'Scrambled Paneer', 'Spiced Cottage Cheese', 'Crumbled Paneer Fry'],
  34: ['Egg Bhurji', 'Anda Bhurji', 'Scrambled Eggs Indian Style', 'Egg Scramble', '2 Egg Bhurji'],
  35: ['Chicken Curry', 'Indian Chicken Curry', 'Home Style Chicken', 'Chicken Gravy', 'Murgh Curry', 'Tariwala Chicken'],
  36: ['Egg Curry', 'Anda Curry', 'Boiled Egg Curry', 'Egg Gravy', '2 Egg Curry', 'Dimer Jhol'],
  37: ['Curd', 'Dahi', 'Plain Curd', 'Yogurt', 'Full Fat Curd', 'Thick Curd', 'Fresh Dahi'],
  38: ['Boondi Raita', 'Bundi Raita', 'Curd Boondi', 'Spiced Dahi Boondi'],
  39: ['Paneer', 'Raw Paneer', 'Fresh Paneer', 'Full Fat Paneer', 'Cottage Cheese Block', 'Malai Paneer'],
  40: ['Cow Milk', 'Whole Milk', 'Full Cream Milk', 'Doodh', 'Gay Ka Doodh', 'Fresh Milk'],
  41: ['Boiled Egg', 'Hard Boiled Egg', 'Ubla Anda', 'Whole Boiled Egg', 'Cooked Egg'],
  42: ['Idli', 'Plain Idli', 'Steamed Idli', 'Rice Idli', 'South Indian Idli'],
  43: ['Plain Dosa', 'Sada Dosa', 'Crispy Dosa', 'Indian Crepe', 'Dosa'],
  44: ['Masala Dosa', 'Potato Dosa', 'Mysore Masala Dosa', 'Aloo Dosa'],
  45: ['Poha', 'Vegetable Poha', 'Kanda Poha', 'Flattened Rice', 'Batata Poha', 'Chivda Breakfast'],
  46: ['Upma', 'Rava Upma', 'Sooji Upma', 'Semolina Upma', 'Suji Upma'],
  47: ['Besan Chilla', 'Besan Cheela', 'Gram Flour Pancake', 'Veg Chilla', 'Besan Puda'],
  48: ['Samosa', 'Punjabi Samosa', 'Aloo Samosa', 'Fried Samosa'],
  49: ['Dhokla', 'Khaman Dhokla', 'Besan Dhokla', 'Steamed Dhokla', 'Gujarati Dhokla'],
  50: ['Roasted Chana', 'Bhuna Chana', 'Roasted Bengal Gram', 'Chana Snack', 'Dry Chana'],
  51: ['Masala Chai', 'Chai', 'Indian Tea', 'Milk Tea', 'Adrak Chai', 'Kadak Chai'],
  52: ['Gulab Jamun', 'Gulaab Jamun', 'Gulabjamun', 'Indian Sweet'],
  53: ['Kheer', 'Rice Kheer', 'Chawal Ki Kheer', 'Payasam', 'Rice Pudding'],
};

// Map food names / patterns to find existing duplicate items to replace
const REPLACEMENT_PATTERNS = {
  1: ['Plain Phulka / Roti', 'Roti / Chapati (plain, no oil)', 'Roti', 'Chapati'],
  2: ['Phulka (plain)', 'Phulka'],
  3: ['Butter Roti', 'Roti with ghee', 'Ghee Roti'],
  4: ['Plain Paratha'],
  5: ['Aloo Paratha'],
  6: ['Puri (deep fried)', 'Puri', 'Poori'],
  7: ['Naan (plain, restaurant style)', 'Naan', 'Plain Naan'],
  8: ['Missi roti', 'Missi Roti'],
  9: ['Steamed Basmati Rice', 'Steamed white rice (chawal)', 'Cooked Rice', 'White Rice'],
  10: ['Brown rice (cooked)', 'Brown Rice'],
  11: ['Jeera Rice', 'Jeera rice'],
  12: ['Vegetable pulao', 'Vegetable Pulao'],
  13: ['Moong dal khichdi', 'Moong Dal Khichdi'],
  14: ['Vegetable biryani', 'Vegetable Biryani', 'Chicken Biryani'],
  15: ['Dal Tadka (Cooked)', 'Toor dal (tadka)', 'Toor Dal Tadka', 'Dal Tadka'],
  16: ['Moong dal (yellow, tadka)', 'Moong Dal'],
  17: ['Masoor dal (tadka)', 'Masoor Dal'],
  18: ['Chana dal (tadka)', 'Chana Dal'],
  19: ['Dal fry (restaurant style)', 'Dal Fry'],
  20: ['Dal Makhani', 'Dal makhani'],
  21: ['Rajma Masala', 'Rajma masala'],
  22: ['Chole / Chana Masala', 'Chole masala', 'Chole Masala'],
  23: ['Sambar', 'South Indian Sambar'],
  24: ['Aloo bhurji (dry aloo sabzi)', 'Aloo Bhurji'],
  25: ['Aloo gobi', 'Aloo Gobi'],
  26: ['Bhindi sabzi', 'Bhindi Sabzi'],
  27: ['Palak Paneer', 'Palak paneer'],
  28: ['Paneer Butter Masala', 'Paneer butter masala'],
  29: ['Matar paneer', 'Matar Paneer'],
  30: ['Baingan bharta', 'Baingan Bharta'],
  31: ['Lauki sabzi', 'Lauki Sabzi'],
  32: ['Mixed vegetable sabzi', 'Mixed Vegetable Sabzi'],
  33: ['Paneer bhurji', 'Paneer Bhurji'],
  34: ['Egg bhurji (2 eggs)', 'Egg Bhurji'],
  35: ['Chicken Curry (Home Style)', 'Chicken curry (home style)'],
  36: ['Egg Curry (2 Eggs)', 'Egg curry (2 eggs)'],
  37: ['Curd / Dahi (whole milk)', 'Curd', 'Dahi'],
  38: ['Boondi raita', 'Boondi Raita'],
  39: ['Paneer (raw, full fat)', 'Paneer (Raw)'],
  40: ['Cow milk (whole)', 'Cow Milk'],
  41: ['Boiled egg', 'Boiled Egg'],
  42: ['Plain Idli', 'Idli'],
  43: ['Plain Dosa', 'Plain dosa'],
  44: ['Masala Dosa', 'Masala dosa'],
  45: ['Vegetable Poha', 'Poha'],
  46: ['Rava Upma', 'Upma (rava)', 'Upma'],
  47: ['Besan chilla', 'Besan Chilla'],
  48: ['Samosa', 'Aloo Samosa'],
  49: ['Dhokla', 'Khaman Dhokla'],
  50: ['Roasted chana', 'Roasted Chana'],
  51: ['Masala chai (with sugar)', 'Masala Chai', 'Chai'],
  52: ['Gulab jamun', 'Gulab Jamun'],
  53: ['Kheer (rice pudding)', 'Kheer'],
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
  let unitType = 'HOUSEHOLD';
  let displayQuantity = 1;

  if (lowerDesc.includes('roti') || lowerDesc.includes('phulka') || lowerDesc.includes('paratha') || lowerDesc.includes('puri') || lowerDesc.includes('naan') || lowerDesc.includes('chilla') || lowerDesc.includes('dosa') || lowerDesc.includes('samosa') || lowerDesc.includes('dhokla') || lowerDesc.includes('egg') || lowerDesc.includes('idli') || lowerDesc.includes('gulab jamun')) {
    unitType = 'COUNT';
  } else if (lowerDesc.includes('glass') || lowerDesc.includes('cup') || lowerDesc.includes('ml')) {
    unitType = 'VOLUME';
  } else if (lowerDesc.endsWith(' g') || lowerDesc === '100 g') {
    unitType = 'WEIGHT';
    displayQuantity = weightGrams;
  } else {
    unitType = 'HOUSEHOLD';
  }

  // Check displayQuantity from description
  const matchQty = desc.match(/^(\d+(\.\d+)?)/);
  if (matchQty && unitType !== 'WEIGHT') {
    displayQuantity = parseFloat(matchQty[1]);
  }

  return {
    unitLabel,
    unitType,
    displayQuantity,
    weightGrams: parseFloat(weightGrams) || 100,
  };
}

async function seedIndianFoodMacros() {
  console.log('🌾 Starting Indian Food Macros Seeding...');
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
    if (cols.length < 14) continue;

    const id = parseInt(cols[0], 10);
    const rawFoodName = cols[1].trim();
    const category = cols[2].trim() || 'Indian Staples';
    const servingDescription = cols[3].trim();
    const servingWeightG = parseFloat(cols[4]) || 100;
    const fiberG = parseFloat(cols[9]) || 0;

    const caloriesPer100g = parseFloat(cols[10]) || 0;
    const proteinPer100g = parseFloat(cols[11]) || 0;
    const carbsPer100g = parseFloat(cols[12]) || 0;
    const fatPer100g = parseFloat(cols[13]) || 0;
    const fiberPer100g = servingWeightG > 0
      ? Math.round(((fiberG / servingWeightG) * 100) * 10) / 10
      : 0;

    const aliases = CURATED_ALIASES[id] || [rawFoodName];
    const serving = parseServingUnit(servingDescription, servingWeightG);

    // Identify candidate existing foods to replace
    const candidateNames = REPLACEMENT_PATTERNS[id] || [rawFoodName];
    
    // Check if food exists by name or candidate names
    let existingFood = await prisma.food.findFirst({
      where: {
        OR: [
          { name: { in: candidateNames, mode: 'insensitive' } },
          { name: rawFoodName },
        ],
        deletedAt: null,
      },
    });

    const isRawStaple = id === 39 || id === 40 || id === 41; // Paneer raw, Cow milk, Boiled egg
    const layer = isRawStaple ? 1 : 2;

    const foodData = {
      name: rawFoodName,
      aliases,
      category,
      calories: Math.max(0, caloriesPer100g),
      protein: Math.max(0, proteinPer100g),
      carbohydrates: Math.max(0, carbsPer100g),
      fat: Math.max(0, fatPer100g),
      fiber: Math.max(0, fiberPer100g),
      source: 'INDB',
      layer,
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

  console.log(`✅ Indian Food Macros Seeding complete:`);
  console.log(`   - Updated / Replaced: ${updatedCount} existing foods`);
  console.log(`   - Created: ${createdCount} new high-priority foods`);
  console.log(`   - Total Processed: ${lines.length - 1} items.`);
}

if (require.main === module) {
  seedIndianFoodMacros()
    .catch((err) => {
      console.error('❌ Error seeding Indian food macros:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { seedIndianFoodMacros };
