// prisma/indb-import.js
// Imports Anuvaad INDB 2024.11 dataset into the GramGains Food table.
// Run standalone: node prisma/indb-import.js
// Or called from seed.js after IFCT 2017 layer.

const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// XLSX file path
// ---------------------------------------------------------------------------
const XLSX_PATH = path.join(__dirname, '../Anuvaad_INDB_2024.11 (1).xlsx');

// ---------------------------------------------------------------------------
// Category keyword map — ordered, first match wins.
// Each entry: { category: string, keywords: string[] }
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  {
    category: 'Beverages',
    keywords: [
      'chai', 'tea', 'coffee', 'juice', 'milkshake', 'lassi', 'sharbat',
      'cooler', 'drink', 'sherbet', 'smoothie', 'lemonade', 'thandai',
      'kanji', 'canjee', 'cocoa', 'egg nog', 'nimbu', 'aam panna',
      'jal jeera', 'sattu', 'saffron milk', 'mintade', 'gingo',
    ],
  },
  {
    category: 'Soups',
    keywords: ['soup', 'consomme', 'broth', 'rasam'],
  },
  {
    category: 'Salads & Raita',
    keywords: ['salad', 'raita', 'kachumber', 'pachadi'],
  },
  {
    category: 'Chutneys & Pickles',
    keywords: ['chutney', 'pickle', 'achaar', 'papad', 'murabba', 'sauce'],
  },
  {
    category: 'Dal & Legumes',
    keywords: [
      'dal ', 'daal ', 'lentil', 'rajmah', 'rajma', 'chana', 'chole',
      'sambar', 'sambhar', 'moth', 'lobiya', 'cowpea', 'chickpea',
      'black-eyed', 'kadala', 'urad', 'moong', 'masoor', 'toor',
    ],
  },
  {
    category: 'Rice & Pulao',
    keywords: ['rice', 'biryani', 'pulao', 'khichdi', 'khichri', 'pongal', 'bisi bele'],
  },
  {
    category: 'Breads',
    keywords: [
      'roti', 'paratha', 'parantha', 'poori', 'puri', 'naan', 'kulcha',
      'bhatura', 'chapati', 'thepla', 'missi', 'appam', 'pathiri',
      'phulka', 'roomali', 'makki',
    ],
  },
  {
    category: 'Breakfast',
    keywords: [
      'idli', 'dosa', 'upma', 'poha', 'omelette', 'omlet', 'pancake',
      'uttapam', 'pesarattu', 'adai', 'puttu', 'porridge', 'daliya',
      'sheera', 'vermicelli porridge', 'semolina porridge',
    ],
  },
  {
    category: 'Snacks',
    keywords: [
      'sandwich', 'tikki', 'cutlet', 'chaat', 'vada', 'bhel', 'pav',
      'burger', 'pakoda', 'pakora', 'samosa', 'kachori', 'dhokla',
      'handvo', 'dabeli', 'frankie', 'spring roll', 'nugget', 'patty',
      'roll', 'toast', 'bruschetta',
    ],
  },
  {
    category: 'Egg Dishes',
    keywords: ['egg', 'anda', 'omelette', 'omlet', 'frittata'],
  },
  {
    category: 'Chicken Dishes',
    keywords: ['chicken', 'murgh', 'poultry'],
  },
  {
    category: 'Meat & Seafood',
    keywords: [
      'mutton', 'lamb', 'fish', 'prawn', 'shrimp', 'seafood', 'crab',
      'lobster', 'beef', 'pork', 'meat', 'keema', 'kheema', 'rogan',
      'boti', 'nihari', 'haleem', 'seekh', 'kebab',
    ],
  },
  {
    category: 'Paneer Dishes',
    keywords: ['paneer', 'cottage cheese'],
  },
  {
    category: 'Desserts & Sweets',
    keywords: [
      'kheer', 'halwa', 'sweet', 'dessert', 'pudding', 'payasam',
      'barfi', 'barfee', 'ladoo', 'laddoo', 'mithai', 'malpua', 'rabri',
      'gulab', 'jalebi', 'modak', 'peda', 'mysore pak', 'shrikhand',
      'basundi', 'kulfi', 'ice cream', 'sorbet', 'fudge', 'burfi',
      'kesari', 'cake', 'pudding', 'custard',
    ],
  },
  {
    category: 'Baked Goods',
    keywords: ['biscuit', 'cookie', 'bread', 'muffin', 'brownie', 'scone', 'cracker', 'rusk'],
  },
  {
    category: 'Curries & Gravies',
    keywords: [
      'curry', 'masala', 'makhani', 'gravy', 'korma', 'kofta', 'bhuji',
      'sabzi', 'bhaji', 'kootu', 'avial', 'thoran', 'stew', 'salan',
    ],
  },
];
const FALLBACK_CATEGORY = 'Indian Prepared Dish';

function assignCategory(foodName) {
  const lower = foodName.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.category;
    }
  }
  return FALLBACK_CATEGORY;
}

// ---------------------------------------------------------------------------
// Safe float parser — always returns >= 0
// ---------------------------------------------------------------------------
function flt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.max(0, n);
}

// ---------------------------------------------------------------------------
// Derive serving weight from kcal ratio, clamp to [5, 500]g
// ---------------------------------------------------------------------------
const MAX_SERVING_G = 500;
const MIN_SERVING_G = 5;

function deriveServingWeight(baseKcal, unitKcal) {
  if (!baseKcal || !unitKcal || baseKcal === 0) return null;
  const raw = (unitKcal / baseKcal) * 100;
  return Math.min(MAX_SERVING_G, Math.max(MIN_SERVING_G, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Source label mapping from primarysource codes
// ---------------------------------------------------------------------------
function mapSource(primarySource) {
  switch ((primarySource || '').toLowerCase()) {
    case 'asc_manual':          return 'INDB 2024 (ASC)';
    case 'bfp_manual':          return 'INDB 2024 (BFP)';
    case 'open_source_recipes': return 'INDB 2024 (OSR)';
    default:                    return 'INDB 2024';
  }
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------
async function importINDB() {
  console.log('📥 Loading INDB 2024 xlsx from:', XLSX_PATH);
  const workbook = XLSX.readFile(XLSX_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  console.log(`📊 Found ${rows.length} rows in spreadsheet.\n`);

  const stats = {
    imported: 0,
    skipped_dupe: 0,
    skipped_bad: 0,
    clamped: 0,
    soup_anomaly: 0,
    no_serving_unit: 0,
  };
  const clampLog   = [];
  const anomalyLog = [];

  for (const row of rows) {
    const foodCode = (row['food_code'] || '').toString().trim();
    const foodName = (row['food_name'] || '').toString().trim();

    // Skip rows missing name or code
    if (!foodName || !foodCode) {
      stats.skipped_bad++;
      continue;
    }

    // Per-100g macros — rounded for clean storage
    const calories      = Math.round(flt(row['energy_kcal'])  * 10)  / 10;
    const protein       = Math.round(flt(row['protein_g'])    * 100) / 100;
    const carbohydrates = Math.round(flt(row['carb_g'])        * 100) / 100;
    const fat           = Math.round(flt(row['fat_g'])         * 100) / 100;
    const fiber         = Math.round(flt(row['fibre_g'])       * 100) / 100;

    // Serving unit
    const rawServingUnit = (row['servings_unit'] || '').toString().trim();
    const servingUnit    = rawServingUnit || '100g';
    if (!rawServingUnit) stats.no_serving_unit++;

    // Serving weight — derived from kcal ratio, clamped
    const baseKcal      = flt(row['energy_kcal']);
    const unitKcal      = flt(row['unit_serving_energy_kcal']);
    let servingWeight   = 100; // fallback for items with no serving data

    if (rawServingUnit && baseKcal > 0 && unitKcal > 0) {
      const rawG    = (unitKcal / baseKcal) * 100;
      const clamped = Math.min(MAX_SERVING_G, Math.max(MIN_SERVING_G, Math.round(rawG)));
      if (Math.round(rawG) > MAX_SERVING_G || Math.round(rawG) < MIN_SERVING_G) {
        stats.clamped++;
        clampLog.push({
          code:      foodCode,
          name:      foodName,
          rawG:      Math.round(rawG),
          clampedG:  clamped,
          unit:      servingUnit,
        });
      }
      servingWeight = clamped;
    }

    // Flag calorie anomaly items (soups/liquids where P*4+C*4+F*9 >> actual kcal)
    const estimated = protein * 4 + carbohydrates * 4 + fat * 9;
    if (calories > 0 && estimated > 0) {
      const pctDiff = Math.abs(calories - estimated) / calories;
      if (pctDiff > 0.20) {
        stats.soup_anomaly++;
        anomalyLog.push({ code: foodCode, name: foodName, actual: calories, estimated: Math.round(estimated) });
      }
    }

    // Category
    const category = assignCategory(foodName);

    // Source
    const source = mapSource(row['primarysource']);

    // Aliases — food_code as index 0 (stable dedup key)
    const aliases = [foodCode];

    // Dedup — skip if food_code already present in aliases
    const existing = await prisma.food.findFirst({
      where:  { aliases: { has: foodCode } },
      select: { id: true },
    });
    if (existing) {
      stats.skipped_dupe++;
      continue;
    }

    await prisma.food.create({
      data: {
        name:          foodName,
        aliases,
        category,
        calories,
        protein,
        carbohydrates,
        fat,
        fiber,
        source:        'INDB',
        layer:         2,
        servings: {
          create: [
            {
              unitLabel: servingUnit || 'g',
              weightGrams: servingWeight || 100,
              isDefault: true,
            },
          ],
        },
      },
    });

    stats.imported++;
    if (stats.imported % 100 === 0) {
      process.stdout.write(`   ... ${stats.imported} imported\r`);
    }
  }

  // ---------------------------------------------------------------------------
  // Print summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '═'.repeat(62));
  console.log('  INDB 2024 Import Summary');
  console.log('═'.repeat(62));
  console.log(`  ✅  Imported:                     ${stats.imported}`);
  console.log(`  ⏭️   Skipped (already exists):    ${stats.skipped_dupe}`);
  console.log(`  ❌  Skipped (bad/empty data):     ${stats.skipped_bad}`);
  console.log(`  📦  No serving unit (→ 100g):    ${stats.no_serving_unit}`);
  console.log(`  📐  Serving weights clamped:      ${stats.clamped}`);
  console.log(`  🍲  Soup calorie anomalies:       ${stats.soup_anomaly}`);
  console.log('═'.repeat(62));

  if (clampLog.length > 0) {
    console.log('\n  📐 Clamped serving weights:');
    for (const c of clampLog) {
      console.log(`     [${c.code}] ${c.name.slice(0, 38).padEnd(38)} raw=${c.rawG}g → ${c.clampedG}g (${c.unit})`);
    }
  }

  if (anomalyLog.length > 0) {
    console.log(`\n  🍲 Calorie anomaly items — kcal stored as authoritative (first 10):`);
    for (const a of anomalyLog.slice(0, 10)) {
      console.log(`     [${a.code}] ${a.name.slice(0, 35).padEnd(35)} kcal=${a.actual} (4P+4C+9F=${a.estimated})`);
    }
    if (anomalyLog.length > 10) {
      console.log(`     ... and ${anomalyLog.length - 10} more`);
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  importINDB()
    .then(async (stats) => {
      const total = await prisma.food.count();
      console.log(`\n  🎉 Total foods in database now: ${total}`);
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error('\n❌ INDB import error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { importINDB };
