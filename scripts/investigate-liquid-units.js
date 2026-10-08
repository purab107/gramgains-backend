#!/usr/bin/env node
/**
 * GramGains — Liquid Food Unit Investigation
 *
 * Queries the Food + FoodServing tables to identify:
 * 1. Foods that are likely liquids (by category or name keyword)
 * 2. Their current unitLabel and weightGrams in FoodServing
 * 3. Whether any FoodServing entry uses mL or volume labels
 * 4. Foods with NO serving entries at all
 *
 * Read-only. No mutations.
 */

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const LIQUID_KEYWORDS = [
  'milk', 'juice', 'water', 'lassi', 'buttermilk', 'chai', 'coffee',
  'tea', 'soup', 'broth', 'shake', 'smoothie', 'drink', 'beverage',
  'yogurt', 'dahi', 'curd', 'oil', 'ghee', 'sharbat', 'nimbu pani',
  'coconut water', 'ras', 'rasam', 'dal', 'sambar', 'kadhi',
];

const LIQUID_CATEGORIES = [
  'dairy', 'beverage', 'beverages', 'drinks', 'soups', 'soup',
  'juices', 'milk', 'oil', 'oils', 'fat', 'fats and oils',
  'liquid', 'liquids', 'tea', 'coffee',
];

const ML_LABELS = ['ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres', 'litre', 'liter', 'l', 'fl oz', 'cup', 'glass', 'tbsp', 'tsp'];

function isLiquid(name, category) {
  const n = (name || '').toLowerCase();
  const c = (category || '').toLowerCase();
  if (LIQUID_CATEGORIES.some(lc => c.includes(lc))) return true;
  if (LIQUID_KEYWORDS.some(kw => n.includes(kw))) return true;
  return false;
}

function isVolumicLabel(label) {
  return ML_LABELS.includes((label || '').toLowerCase().trim());
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║    🥛 GRAMGAINS — LIQUID FOOD UNIT INVESTIGATION             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await prisma.$connect();

  // Load ALL foods with their servings
  const totalFoods = await prisma.food.count({ where: { deletedAt: null } });
  console.log(`📦 Active foods: ${totalFoods.toLocaleString()}`);

  const totalServings = await prisma.foodServing.count();
  console.log(`🍽️  Total FoodServing records: ${totalServings.toLocaleString()}\n`);

  // What unit labels exist globally?
  const allServings = await prisma.foodServing.findMany({
    select: { unitLabel: true, weightGrams: true, isDefault: true, foodId: true },
  });

  const unitLabelFreq = new Map();
  for (const s of allServings) {
    const ul = (s.unitLabel || '(null)').trim().toLowerCase();
    unitLabelFreq.set(ul, (unitLabelFreq.get(ul) || 0) + 1);
  }

  console.log('📊 All unit labels used in FoodServing:');
  const sortedLabels = [...unitLabelFreq.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ul, count] of sortedLabels) {
    console.log(`   "${ul}" → ${count} serving records`);
  }
  console.log('');

  // Sample foods by category to see the landscape
  const categoryCounts = new Map();
  const allFoods = await prisma.food.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      category: true,
      servings: {
        select: { unitLabel: true, weightGrams: true, isDefault: true },
      },
    },
  });

  for (const f of allFoods) {
    const cat = (f.category || 'Unknown').toLowerCase();
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
  }

  console.log('📂 All categories in DB:');
  const sortedCats = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats) {
    console.log(`   "${cat}" → ${count} foods`);
  }
  console.log('');

  // Filter to liquid foods
  const liquidFoods = allFoods.filter(f => isLiquid(f.name, f.category));
  console.log(`🥛 Detected liquid foods: ${liquidFoods.length} out of ${allFoods.length}`);

  // Among liquid foods — what unit labels do they use?
  const liquidNoServings = liquidFoods.filter(f => f.servings.length === 0);
  const liquidWithMlServing = liquidFoods.filter(f => f.servings.some(s => isVolumicLabel(s.unitLabel)));
  const liquidWithGramsOnly = liquidFoods.filter(f =>
    f.servings.length > 0 && !f.servings.some(s => isVolumicLabel(s.unitLabel))
  );

  console.log(`   ├─ With volume-type unit label (ml/cup/etc): ${liquidWithMlServing.length}`);
  console.log(`   ├─ With gram-only servings (no volume label): ${liquidWithGramsOnly.length}`);
  console.log(`   └─ With NO serving entries at all:            ${liquidNoServings.length}\n`);

  // Build the report
  const lines = [];
  const h = (...args) => lines.push(...args, '');
  const row = cells => `| ${cells.join(' | ')} |`;

  h('# GramGains — Liquid Food Unit Investigation Report', '');
  h(`> **Generated**: ${new Date().toISOString()}`);
  h(`> **Active foods in DB**: ${totalFoods.toLocaleString()}`);
  h(`> **Total FoodServing records**: ${totalServings.toLocaleString()}`);
  h(`> **Detected liquid foods**: ${liquidFoods.length}`, '');
  h('---', '');

  // Section 1: Global unit label landscape
  h('## 1. All Unit Labels in FoodServing (Global)', '');
  h(row(['Unit Label', 'Count', 'Is Volumic?']));
  h(row(['---', '---', '---']));
  for (const [ul, count] of sortedLabels) {
    h(row([ul, count, isVolumicLabel(ul) ? '✅ Yes' : '—']));
  }
  h('');

  // Section 2: Category landscape
  h('## 2. Food Categories in DB', '');
  h(row(['Category', 'Food Count']));
  h(row(['---', '---']));
  for (const [cat, count] of sortedCats) {
    const liquidFlag = LIQUID_CATEGORIES.some(lc => cat.includes(lc)) ? '🥛' : '';
    h(row([`${liquidFlag} ${cat}`.trim(), count]));
  }
  h('');

  // Section 3: Liquid foods breakdown
  h('## 3. Liquid Food Detection Summary', '');
  h(`- Total liquid foods detected: **${liquidFoods.length}**`);
  h(`- With a volume-type unit label (ml, cup, glass, etc.): **${liquidWithMlServing.length}**`);
  h(`- With gram-only servings (**problem foods**): **${liquidWithGramsOnly.length}**`);
  h(`- With no serving entries at all: **${liquidNoServings.length}**`, '');

  // Section 4: Liquid foods using grams only (the problem)
  h('## 4. ⚠️ Liquid Foods Using Grams Only (No mL Preset)', '');
  h('> These are foods that are naturally measured in mL but only have gram-based presets.', '');
  if (liquidWithGramsOnly.length === 0) {
    h('None found — all liquid foods already have a volumic serving option.');
  } else {
    h(row(['Food Name', 'Category', 'Servings (label → grams)']));
    h(row(['---', '---', '---']));
    for (const f of liquidWithGramsOnly.slice(0, 100)) {
      const servingStr = f.servings
        .map(s => `${s.unitLabel || '?'} → ${s.weightGrams}g${s.isDefault ? ' ★' : ''}`)
        .join(', ');
      h(row([f.name, f.category, servingStr]));
    }
    if (liquidWithGramsOnly.length > 100) {
      h(`\n*...and ${liquidWithGramsOnly.length - 100} more. See full list below.*`);
    }
  }
  h('');

  // Section 5: Liquid foods with mL servings (good examples)
  h('## 5. ✅ Liquid Foods with Volume-Type Servings', '');
  if (liquidWithMlServing.length === 0) {
    h('None found — no liquid foods have a volumic serving option in the DB.');
  } else {
    h(row(['Food Name', 'Category', 'Servings (label → grams)']));
    h(row(['---', '---', '---']));
    for (const f of liquidWithMlServing.slice(0, 50)) {
      const servingStr = f.servings
        .map(s => `${s.unitLabel || '?'} → ${s.weightGrams}g${s.isDefault ? ' ★' : ''}`)
        .join(', ');
      h(row([f.name, f.category, servingStr]));
    }
  }
  h('');

  // Section 6: Liquid foods with NO servings at all
  h('## 6. Liquid Foods With No FoodServing Entries', '');
  if (liquidNoServings.length === 0) {
    h('All liquid foods have at least one serving entry.');
  } else {
    h(row(['Food Name', 'Category']));
    h(row(['---', '---']));
    for (const f of liquidNoServings.slice(0, 50)) {
      h(row([f.name, f.category]));
    }
    if (liquidNoServings.length > 50) h(`\n*...and ${liquidNoServings.length - 50} more.*`);
  }
  h('');

  // Section 7: Sample of 30 liquid-named foods to spot-check
  h('## 7. Sample — 30 Liquid-Keyword Foods (Full Serving Detail)', '');
  const milkLike = liquidFoods.filter(f => {
    const n = f.name.toLowerCase();
    return n.includes('milk') || n.includes('lassi') || n.includes('juice')
      || n.includes('water') || n.includes('tea') || n.includes('coffee')
      || n.includes('curd') || n.includes('dahi');
  }).slice(0, 30);

  h(row(['Food', 'Category', 'Serving Labels', 'Default']));
  h(row(['---', '---', '---', '---']));
  for (const f of milkLike) {
    const servings = f.servings.length === 0
      ? '*(none)*'
      : f.servings.map(s => `${s.unitLabel || '?'} = ${s.weightGrams}g`).join(' | ');
    const def = f.servings.find(s => s.isDefault);
    h(row([f.name, f.category, servings, def ? `${def.unitLabel} = ${def.weightGrams}g` : '—']));
  }
  h('');

  // Section 8: Recommendations
  h('## 8. Recommendations', '');
  h('| Priority | Finding | Recommended Action |');
  h('|---|---|---|');
  if (liquidWithGramsOnly.length > 0) {
    h(`| 🔴 High | ${liquidWithGramsOnly.length} liquid food(s) only have gram presets | Add \`FoodServing\` entries with \`unitLabel: "ml"\` and correct density-adjusted \`weightGrams\` |`);
  }
  if (liquidNoServings.length > 0) {
    h(`| 🔴 High | ${liquidNoServings.length} liquid food(s) have NO serving entries | Add at least one default serving with mL label |`);
  }
  h('| 🟠 Medium | UI shows gram-based quantity selector for all foods | UI should detect liquid foods (by category or unitLabel) and show mL selector instead |');
  h('| 🟡 Low | No volumic unit labels at all in DB | Consider adding standardized labels: `ml`, `cup`, `glass`, `tbsp` |');
  h('');
  h('---', '');
  h('*Report generated by `gramgains-backend/scripts/investigate-liquid-units.js`*');

  const reportPath = path.resolve(__dirname, '../../liquid-food-unit-investigation.md');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

  console.log(`✅ Report saved to: ${reportPath}\n`);
  await prisma.$disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Investigation failed:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
