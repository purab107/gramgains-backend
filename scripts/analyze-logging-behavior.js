#!/usr/bin/env node
/**
 * GramGains Food-Logging Behavior Analysis
 *
 * Mines MealLog records to understand how users actually record quantities:
 * - Global distribution of weightGrams
 * - Unit label frequency
 * - Preset vs. custom quantity usage rate
 * - Per-food deep dive (mode, median, P90, preset-match rate)
 * - Unit appropriateness (grams vs. mL for liquid foods)
 * - Anomaly detection
 *
 * Read-only: makes no database mutations.
 * Output: ../../food-logging-behavior-report.md (gramgains root)
 */

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// ─── Constants ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const MIN_LOGS_FOR_FOOD_ANALYSIS = 10;
const PRESET_MISMATCH_THRESHOLD = 0.20; // 20% deviation from default preset
const ML_PREFERENCE_THRESHOLD = 0.50;   // 50% mL usage → flag for unit switch
const OUTLIER_RATIO = 5;                 // P95 > 5× median → outlier flag

const LIQUID_KEYWORDS = [
  'milk', 'juice', 'water', 'lassi', 'buttermilk', 'chai', 'coffee',
  'tea', 'soup', 'broth', 'shake', 'smoothie', 'drink', 'beverage',
  'yogurt', 'dahi', 'curd', 'oil', 'ghee',
];

const LIQUID_CATEGORIES = [
  'dairy', 'beverage', 'beverages', 'drinks', 'soups', 'soup',
  'juices', 'milk', 'oil', 'oils',
];

const ML_UNIT_LABELS = ['ml', 'ml.', 'milliliter', 'millilitre', 'milliliters', 'millilitres'];

const HISTOGRAM_BUCKETS = [
  { label: '0–25g',    min: 0,   max: 25  },
  { label: '25–50g',   min: 25,  max: 50  },
  { label: '50–75g',   min: 50,  max: 75  },
  { label: '75–100g',  min: 75,  max: 100 },
  { label: '100–150g', min: 100, max: 150 },
  { label: '150–200g', min: 150, max: 200 },
  { label: '200–300g', min: 200, max: 300 },
  { label: '300–500g', min: 300, max: 500 },
  { label: '500g+',    min: 500, max: Infinity },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function median(sortedArr) {
  return percentile(sortedArr, 50);
}

function mode(arr) {
  const freq = new Map();
  for (const v of arr) freq.set(v, (freq.get(v) || 0) + 1);
  let maxCount = 0, modeVal = null;
  for (const [v, c] of freq) {
    if (c > maxCount) { maxCount = c; modeVal = v; }
  }
  return modeVal;
}

function round5(x) {
  return Math.round(x / 5) * 5;
}

function isLiquidFood(name, category) {
  const lname = (name || '').toLowerCase();
  const lcat = (category || '').toLowerCase();
  if (LIQUID_CATEGORIES.some(lc => lcat.includes(lc))) return true;
  if (LIQUID_KEYWORDS.some(kw => lname.includes(kw))) return true;
  return false;
}

function isMlUnit(label) {
  return ML_UNIT_LABELS.includes((label || '').toLowerCase().trim());
}

function topN(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ─── Main Analysis ────────────────────────────────────────────────────────────

async function run() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       📊 GRAMGAINS FOOD-LOGGING BEHAVIOR ANALYSIS            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await prisma.$connect();

  // ── Phase 1: Count ──────────────────────────────────────────────────────────
  const totalLogs = await prisma.mealLog.count();
  const totalFoods = await prisma.food.count();
  console.log(`📦 MealLog records : ${totalLogs.toLocaleString()}`);
  console.log(`🍎 Food records    : ${totalFoods.toLocaleString()}\n`);

  if (totalLogs === 0) {
    console.log('⚠️  No MealLog records found. Cannot run analysis.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ── Phase 2: Load all FoodServing presets into memory ─────────────────────
  console.log('🔄 Loading FoodServing presets...');
  const allServings = await prisma.foodServing.findMany({
    select: { foodId: true, unitLabel: true, weightGrams: true, isDefault: true },
  });

  // Map: foodId -> { presetWeights: Set<number>, defaultWeight: number|null, defaultLabel: string|null }
  const foodPresetsMap = new Map();
  for (const s of allServings) {
    if (!foodPresetsMap.has(s.foodId)) {
      foodPresetsMap.set(s.foodId, { presetWeights: new Set(), defaultWeight: null, defaultLabel: null });
    }
    const entry = foodPresetsMap.get(s.foodId);
    entry.presetWeights.add(s.weightGrams);
    if (s.isDefault) {
      entry.defaultWeight = s.weightGrams;
      entry.defaultLabel = s.unitLabel;
    }
  }
  console.log(`   Loaded presets for ${foodPresetsMap.size.toLocaleString()} foods.\n`);

  // ── Phase 3: Stream MealLog records in batches ────────────────────────────
  console.log('🔄 Streaming MealLog records...');

  const allWeights = [];                    // all weightGrams values for global stats
  const unitLabelFreq = new Map();          // unitLabel -> count
  const histBuckets = HISTOGRAM_BUCKETS.map(b => ({ ...b, count: 0 }));

  // Per-food accumulator
  // foodId -> { name, category, weights: number[], unitLabels: string[], presetMatches: number, mlCount: number }
  const perFood = new Map();

  let skip = 0;
  let processed = 0;

  while (skip < totalLogs) {
    const batch = await prisma.mealLog.findMany({
      skip,
      take: BATCH_SIZE,
      select: {
        foodId: true,
        weightGrams: true,
        unitLabel: true,
        food: {
          select: { name: true, category: true },
        },
      },
    });

    if (batch.length === 0) break;

    for (const log of batch) {
      const w = log.weightGrams;
      const ul = (log.unitLabel || '').trim() || null;
      const foodId = log.foodId;
      const foodName = log.food?.name || 'Unknown';
      const foodCat = log.food?.category || 'Unknown';

      // Global weight accumulation
      allWeights.push(w);

      // Histogram
      for (const bucket of histBuckets) {
        if (w >= bucket.min && w < bucket.max) { bucket.count++; break; }
      }

      // Unit label frequency
      const ulKey = ul === null ? '(null)' : ul;
      unitLabelFreq.set(ulKey, (unitLabelFreq.get(ulKey) || 0) + 1);

      // Per-food accumulation
      if (!perFood.has(foodId)) {
        perFood.set(foodId, {
          name: foodName,
          category: foodCat,
          weights: [],
          unitLabels: [],
          presetMatches: 0,
          mlCount: 0,
        });
      }
      const fd = perFood.get(foodId);
      fd.weights.push(w);
      fd.unitLabels.push(ul);

      // Preset match
      const presets = foodPresetsMap.get(foodId);
      if (presets && presets.presetWeights.has(w)) {
        fd.presetMatches++;
      }

      // mL usage
      if (isMlUnit(ul)) fd.mlCount++;

      processed++;
    }

    skip += BATCH_SIZE;
    process.stdout.write(`\r   Processed: ${processed.toLocaleString()} / ${totalLogs.toLocaleString()} logs`);
  }
  console.log('\n   ✅ Done streaming.\n');

  // ── Phase 4: Global Aggregation ───────────────────────────────────────────
  allWeights.sort((a, b) => a - b);
  const globalP25  = percentile(allWeights, 25);
  const globalP50  = percentile(allWeights, 50);
  const globalP75  = percentile(allWeights, 75);
  const globalP90  = percentile(allWeights, 90);
  const globalP95  = percentile(allWeights, 95);
  const globalMean = allWeights.reduce((s, v) => s + v, 0) / allWeights.length;

  // Top 20 most common exact quantities
  const exactQuantFreq = new Map();
  for (const w of allWeights) exactQuantFreq.set(w, (exactQuantFreq.get(w) || 0) + 1);
  const top20Quantities = topN(exactQuantFreq, 20);

  // ── Phase 5: Per-Food Analysis ────────────────────────────────────────────
  const foodResults = [];
  let globalPresetMatches = 0;
  let globalLogs = 0;

  // Category roll-up
  const catStats = new Map(); // category -> { logs, presetMatches }

  for (const [foodId, fd] of perFood) {
    const logCount = fd.weights.length;
    globalLogs += logCount;
    globalPresetMatches += fd.presetMatches;

    // Category stats
    if (!catStats.has(fd.category)) catStats.set(fd.category, { logs: 0, presetMatches: 0 });
    const cs = catStats.get(fd.category);
    cs.logs += logCount;
    cs.presetMatches += fd.presetMatches;

    if (logCount < MIN_LOGS_FOR_FOOD_ANALYSIS) continue;

    const sortedW = [...fd.weights].sort((a, b) => a - b);
    const foodMedian = median(sortedW);
    const foodP90    = percentile(sortedW, 90);
    const foodP95    = percentile(sortedW, 95);
    const foodMode   = mode(fd.weights.map(round5));
    const presetMatchRate = fd.presetMatches / logCount;
    const mlRate = fd.mlCount / logCount;

    const presets = foodPresetsMap.get(foodId);
    const defaultWeight = presets?.defaultWeight ?? null;
    const defaultLabel  = presets?.defaultLabel  ?? null;
    const presetList    = presets ? [...presets.presetWeights].sort((a, b) => a - b) : [];

    // Preset mismatch: mode differs from default by > threshold
    let presetMismatch = false;
    if (defaultWeight && defaultWeight > 0) {
      const deviation = Math.abs(foodMode - defaultWeight) / defaultWeight;
      presetMismatch = deviation > PRESET_MISMATCH_THRESHOLD;
    }

    // Outlier: P95 > OUTLIER_RATIO × median
    const outlier = foodMedian > 0 && foodP95 > OUTLIER_RATIO * foodMedian;

    // Single-value artifact
    const uniqueValues = new Set(fd.weights).size;
    const singleValue = uniqueValues === 1;

    // Zero-weight entries
    const zeroCount = fd.weights.filter(w => w === 0).length;

    // Liquid food + unit analysis
    const isLiquid = isLiquidFood(fd.name, fd.category);

    // Top 5 actual quantities
    const wFreq = new Map();
    for (const w of fd.weights.map(round5)) wFreq.set(w, (wFreq.get(w) || 0) + 1);
    const top5Actual = topN(wFreq, 5).map(([q, c]) => `${q}g (×${c})`);

    foodResults.push({
      foodId,
      name: fd.name,
      category: fd.category,
      logCount,
      mode: foodMode,
      median: foodMedian,
      p90: foodP90,
      p95: foodP95,
      presetMatchRate,
      presetMismatch,
      defaultWeight,
      defaultLabel,
      presets: presetList,
      top5Actual,
      mlRate,
      isLiquid,
      outlier,
      singleValue,
      zeroCount,
    });
  }

  // Sort by logCount desc
  foodResults.sort((a, b) => b.logCount - a.logCount);

  const globalPresetMatchRate = globalLogs > 0 ? globalPresetMatches / globalLogs : 0;

  // ── Phase 6: Derived Lists ─────────────────────────────────────────────────
  const top20ByCustom = [...foodResults]
    .sort((a, b) => a.presetMatchRate - b.presetMatchRate)
    .slice(0, 20);

  const presetMismatchFoods = foodResults.filter(f => f.presetMismatch);

  const liquidUnitFlags = foodResults.filter(f => f.isLiquid && f.mlRate >= ML_PREFERENCE_THRESHOLD);

  const anomalies = {
    outliers:     foodResults.filter(f => f.outlier),
    zeroWeight:   foodResults.filter(f => f.zeroCount > 0),
    singleValue:  foodResults.filter(f => f.singleValue),
  };

  const catTable = [...catStats.entries()]
    .map(([cat, s]) => ({
      category: cat,
      logs: s.logs,
      presetMatchRate: s.logs > 0 ? s.presetMatches / s.logs : 0,
    }))
    .sort((a, b) => b.logs - a.logs);

  // ── Phase 7: Build Markdown Report ────────────────────────────────────────
  console.log('📝 Generating Markdown report...');

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const runTs = new Date().toISOString();

  const lines = [];

  const h = (...args) => lines.push(...args, '');
  const row = cells => `| ${cells.join(' | ')} |`;
  const hr = cols => row(cols.map(() => '---'));

  h('# GramGains — Food-Logging Behavior Analysis Report', '');
  h(`> **Generated**: ${runTs}  `);
  h(`> **Duration**: ${durationSec}s  `);
  h(`> **Total MealLog records analyzed**: ${totalLogs.toLocaleString()}  `);
  h(`> **Distinct foods logged**: ${perFood.size.toLocaleString()}  `);
  h(`> **Foods with ≥${MIN_LOGS_FOR_FOOD_ANALYSIS} logs (analyzed)**: ${foodResults.length.toLocaleString()}  `);
  h('');
  h('---', '');

  // ── 1. Executive Summary ──
  h('## 1. Executive Summary', '');
  h('| Metric | Value |');
  h('|---|---|');
  h(`| Total logs analyzed | ${totalLogs.toLocaleString()} |`);
  h(`| Distinct foods logged | ${perFood.size.toLocaleString()} |`);
  h(`| Global preset-match rate | ${(globalPresetMatchRate * 100).toFixed(1)}% |`);
  h(`| Global median quantity | ${globalP50.toFixed(1)}g |`);
  h(`| Global mean quantity | ${globalMean.toFixed(1)}g |`);
  h(`| P90 quantity | ${globalP90.toFixed(1)}g |`);
  h(`| Foods with preset mismatch | ${presetMismatchFoods.length} |`);
  h(`| Liquid foods preferring mL | ${liquidUnitFlags.length} |`);
  h(`| Foods with zero-weight logs | ${anomalies.zeroWeight.length} |`);
  h('');

  // ── 2. Global Quantity Distribution ──
  h('## 2. Global Quantity Distribution', '');
  h('### 2.1 Histogram of weightGrams', '');
  h(row(['Bucket', 'Count', 'Share']));
  h(row(['---', '---', '---']));
  for (const b of histBuckets) {
    const share = totalLogs > 0 ? ((b.count / totalLogs) * 100).toFixed(1) : '0.0';
    h(row([b.label, b.count.toLocaleString(), `${share}%`]));
  }
  h('');

  h('### 2.2 Global Percentiles', '');
  h(row(['P25', 'P50 (Median)', 'P75', 'P90', 'P95', 'Mean']));
  h(row(['---', '---', '---', '---', '---', '---']));
  h(row([
    `${globalP25.toFixed(1)}g`,
    `${globalP50.toFixed(1)}g`,
    `${globalP75.toFixed(1)}g`,
    `${globalP90.toFixed(1)}g`,
    `${globalP95.toFixed(1)}g`,
    `${globalMean.toFixed(1)}g`,
  ]));
  h('');

  h('### 2.3 Top 20 Most Common Exact Quantities', '');
  h(row(['Rank', 'Quantity (g)', 'Log Count', 'Share']));
  h(row(['---', '---', '---', '---']));
  top20Quantities.forEach(([q, c], i) => {
    const share = ((c / totalLogs) * 100).toFixed(2);
    h(row([i + 1, `${q}g`, c.toLocaleString(), `${share}%`]));
  });
  h('');

  // ── 3. Unit Label Frequency ──
  h('## 3. Unit Label Frequency', '');
  h(row(['Unit Label', 'Count', 'Share']));
  h(row(['---', '---', '---']));
  const sortedUnits = [...unitLabelFreq.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ul, c] of sortedUnits) {
    const share = ((c / totalLogs) * 100).toFixed(1);
    h(row([ul || '(empty)', c.toLocaleString(), `${share}%`]));
  }
  h('');

  // ── 4. Preset vs. Custom Rate ──
  h('## 4. Preset vs. Custom Usage Rate', '');
  h(`- **Global preset-match rate**: ${(globalPresetMatchRate * 100).toFixed(1)}%`);
  h(`- **Custom rate**: ${((1 - globalPresetMatchRate) * 100).toFixed(1)}%`);
  h('');
  h('### 4.1 By Category', '');
  h(row(['Category', 'Logs', 'Preset-Match Rate', 'Custom Rate']));
  h(row(['---', '---', '---', '---']));
  for (const c of catTable) {
    h(row([
      c.category,
      c.logs.toLocaleString(),
      `${(c.presetMatchRate * 100).toFixed(1)}%`,
      `${((1 - c.presetMatchRate) * 100).toFixed(1)}%`,
    ]));
  }
  h('');

  // ── 5. Top 20 Foods by Custom Usage ──
  h('## 5. Top 20 Foods by Custom Usage (Lowest Preset-Match Rate)', '');
  h('> These foods have the most users logging quantities that don\'t match any preset.', '');
  h(row(['Rank', 'Food', 'Category', 'Logs', 'Preset-Match', 'Mode (rounded)', 'Default Preset', 'Top 5 Actual']));
  h(row(['---', '---', '---', '---', '---', '---', '---', '---']));
  top20ByCustom.forEach((f, i) => {
    h(row([
      i + 1,
      f.name,
      f.category,
      f.logCount,
      `${(f.presetMatchRate * 100).toFixed(1)}%`,
      `${f.mode}g`,
      f.defaultWeight ? `${f.defaultWeight}g` : 'none',
      f.top5Actual.join(', '),
    ]));
  });
  h('');

  // ── 6. Preset Mismatch Foods ──
  h('## 6. Foods with Preset Mismatch (mode differs from default by >20%)', '');
  if (presetMismatchFoods.length === 0) {
    h('No preset mismatches found.');
  } else {
    h(row(['Food', 'Category', 'Logs', 'Mode', 'Current Default', 'Deviation', 'Top 5 Actual']));
    h(row(['---', '---', '---', '---', '---', '---', '---']));
    for (const f of presetMismatchFoods) {
      const dev = f.defaultWeight
        ? `${(Math.abs(f.mode - f.defaultWeight) / f.defaultWeight * 100).toFixed(0)}%`
        : 'N/A';
      h(row([
        f.name, f.category, f.logCount,
        `${f.mode}g`, f.defaultWeight ? `${f.defaultWeight}g` : 'none',
        dev, f.top5Actual.join(', '),
      ]));
    }
  }
  h('');

  // ── 7. Per-Food Breakdown (all qualifying foods) ──
  h('## 7. Per-Food Breakdown (all foods with ≥' + MIN_LOGS_FOR_FOOD_ANALYSIS + ' logs)', '');
  h(row(['Food', 'Cat', 'Logs', 'Mode', 'Median', 'P90', 'Preset-Match', 'Default', 'Presets', 'Top 5 Actual', 'mL%', '⚠️']));
  h(row(['---','---','---','---','---','---','---','---','---','---','---','---']));
  for (const f of foodResults) {
    const flags = [];
    if (f.presetMismatch) flags.push('MISMATCH');
    if (f.isLiquid && f.mlRate >= ML_PREFERENCE_THRESHOLD) flags.push('USE-ML');
    if (f.outlier) flags.push('OUTLIER');
    if (f.singleValue) flags.push('SINGLE-VAL');
    if (f.zeroCount > 0) flags.push('ZERO-WT');
    h(row([
      f.name, f.category, f.logCount,
      `${f.mode}g`, `${f.median.toFixed(0)}g`, `${f.p90.toFixed(0)}g`,
      `${(f.presetMatchRate * 100).toFixed(1)}%`,
      f.defaultWeight ? `${f.defaultWeight}g (${f.defaultLabel || '?'})` : 'none',
      f.presets.map(p => `${p}g`).join(', ') || 'none',
      f.top5Actual.join(', '),
      `${(f.mlRate * 100).toFixed(1)}%`,
      flags.join(' ') || '—',
    ]));
  }
  h('');

  // ── 8. Unit Appropriateness ──
  h('## 8. Unit Appropriateness — Liquid Foods Preferring mL', '');
  if (liquidUnitFlags.length === 0) {
    h('No liquid foods found where mL usage exceeds 50%.');
  } else {
    h(row(['Food', 'Category', 'Logs', 'mL Usage', 'Current Default Unit', 'Action']));
    h(row(['---', '---', '---', '---', '---', '---']));
    for (const f of liquidUnitFlags) {
      h(row([
        f.name, f.category, f.logCount,
        `${(f.mlRate * 100).toFixed(1)}%`,
        f.defaultLabel || 'none',
        '→ Switch to mL',
      ]));
    }
  }
  h('');

  // ── 9. Anomalies ──
  h('## 9. Anomaly Detection', '');

  h('### 9.1 Outlier Foods (P95 > 5× Median)', '');
  if (anomalies.outliers.length === 0) {
    h('No outlier foods detected.');
  } else {
    h(row(['Food', 'Category', 'Logs', 'Median', 'P95']));
    h(row(['---', '---', '---', '---', '---']));
    for (const f of anomalies.outliers) {
      h(row([f.name, f.category, f.logCount, `${f.median.toFixed(0)}g`, `${f.p95.toFixed(0)}g`]));
    }
  }
  h('');

  h('### 9.2 Foods with Zero-Weight Logs', '');
  if (anomalies.zeroWeight.length === 0) {
    h('No zero-weight log entries found.');
  } else {
    h(row(['Food', 'Category', 'Total Logs', 'Zero-Weight Count']));
    h(row(['---', '---', '---', '---']));
    for (const f of anomalies.zeroWeight) {
      h(row([f.name, f.category, f.logCount, f.zeroCount]));
    }
  }
  h('');

  h('### 9.3 Foods Logged at a Single Quantity (Possible Automation)', '');
  if (anomalies.singleValue.length === 0) {
    h('No single-value foods detected.');
  } else {
    h(row(['Food', 'Category', 'Logs', 'Only Quantity']));
    h(row(['---', '---', '---', '---']));
    for (const f of anomalies.singleValue) {
      h(row([f.name, f.category, f.logCount, `${f.mode}g`]));
    }
  }
  h('');

  // ── 10. Recommendations ──
  h('## 10. Recommendations', '');
  h('Based on this analysis, the following actions are suggested:', '');
  h('| Priority | Finding | Action |');
  h('|---|---|---|');

  if (presetMismatchFoods.length > 0) {
    h(`| 🔴 High | ${presetMismatchFoods.length} food(s) have mode quantity deviating >20% from default preset | Update \`FoodServing.weightGrams\` defaults for these foods |`);
  }
  if (liquidUnitFlags.length > 0) {
    h(`| 🔴 High | ${liquidUnitFlags.length} liquid food(s) are predominantly logged in mL | Switch \`FoodServing.unitLabel\` to \`ml\` for flagged foods |`);
  }
  if (top20ByCustom.filter(f => f.presetMatchRate < 0.3).length > 0) {
    const n = top20ByCustom.filter(f => f.presetMatchRate < 0.3).length;
    h(`| 🟠 Medium | ${n} food(s) have preset-match rate < 30% | Add 2–3 new \`FoodServing\` presets matching top logged quantities |`);
  }
  if (Math.abs(globalP50 - 100) > 10) {
    h(`| 🟠 Medium | Global P50 is ${globalP50.toFixed(0)}g (not 100g) | Reconsider whether 100g should remain the universal fallback default |`);
  }
  if (anomalies.zeroWeight.length > 0) {
    h(`| 🟡 Low | ${anomalies.zeroWeight.length} food(s) have zero-weight log entries | Investigate and clean up these records |`);
  }
  h('');
  h('---', '');
  h('*Report generated by `gramgains-backend/scripts/analyze-logging-behavior.js`*');

  // ── Write Report ──────────────────────────────────────────────────────────
  const reportPath = path.resolve(__dirname, '../../food-logging-behavior-report.md');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

  console.log(`\n✅ Analysis complete in ${durationSec}s`);
  console.log(`   📝 Report saved to: ${reportPath}\n`);

  // Summary to console
  console.log('📈 Quick Summary:');
  console.log(`   Global preset-match rate : ${(globalPresetMatchRate * 100).toFixed(1)}%`);
  console.log(`   Global P50 (median)      : ${globalP50.toFixed(1)}g`);
  console.log(`   Global P90               : ${globalP90.toFixed(1)}g`);
  console.log(`   Preset mismatch foods    : ${presetMismatchFoods.length}`);
  console.log(`   Liquid foods needing mL  : ${liquidUnitFlags.length}`);
  console.log(`   Zero-weight anomalies    : ${anomalies.zeroWeight.length}`);

  await prisma.$disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Analysis failed:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
