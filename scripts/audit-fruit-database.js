#!/usr/bin/env node
/**
 * GramGains Fruit Database Coverage & Macro Accuracy Audit
 *
 * Runs an exhaustive audit of all reference benchmark fruits against the database,
 * calculates coverage percentages, macro error margins per 100g, Atwater consistency,
 * and serving unit availability.
 */

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const { findFruitMatches } = require('../src/audit/fruit-benchmark/fruit-matcher');
const { evaluateFruitAccuracy } = require('../src/audit/fruit-benchmark/fruit-evaluator');

const benchmarkFruits = require('../src/audit/fruit-benchmark/fruit-reference-dataset.json');

const prisma = new PrismaClient();

async function runFruitAudit() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║             🍎 GRAMGAINS FRUIT DATABASE COVERAGE & MACRO ACCURACY AUDIT            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════╝');
  console.log(` ▸ Reference Fruits: ${benchmarkFruits.length} items`);
  console.log(` ▸ Standard:         USDA SR Legacy / Foundation Foods & ICMR-NIN IFCT 2017`);
  console.log(` ▸ Basis:            per 100 grams edible portion`);
  console.log('──────────────────────────────────────────────────────────────────────────────────────\n');

  await prisma.$connect();

  const results = [];
  const layerStats = {
    IFCT_2017: 0,
    INDB: 0,
    OPEN_FOOD_FACTS: 0,
    USER_CREATED: 0
  };

  const tierCounts = {
    EXACT: 0,
    ACCEPTABLE: 0,
    HIGH_DIVERGENCE: 0,
    CRITICAL_ANOMALY: 0,
    MISSING: 0
  };

  for (let i = 0; i < benchmarkFruits.length; i++) {
    const refFruit = benchmarkFruits[i];
    process.stdout.write(` [${i + 1}/${benchmarkFruits.length}] Testing "${refFruit.canonicalName}"... `);

    const matchData = await findFruitMatches(prisma, refFruit);
    const evaluation = evaluateFruitAccuracy(refFruit, matchData.primaryMatch);

    tierCounts[evaluation.accuracyTier] = (tierCounts[evaluation.accuracyTier] || 0) + 1;

    if (evaluation.dbFood && evaluation.dbFood.source) {
      layerStats[evaluation.dbFood.source] = (layerStats[evaluation.dbFood.source] || 0) + 1;
    }

    results.push({
      refFruit,
      matchData,
      evaluation
    });

    const badge =
      evaluation.accuracyTier === 'EXACT' ? '🟢 EXACT' :
      evaluation.accuracyTier === 'ACCEPTABLE' ? '🟡 ACCEPTABLE' :
      evaluation.accuracyTier === 'HIGH_DIVERGENCE' ? '🟠 HIGH DIVERGENCE' :
      evaluation.accuracyTier === 'CRITICAL_ANOMALY' ? '🔴 CRITICAL ANOMALY' :
      '❌ MISSING';

    if (evaluation.status === 'FOUND') {
      console.log(`${badge} -> Found: "${evaluation.dbFood.name}" [${evaluation.dbFood.source}] (${evaluation.dbFood.calories} kcal vs Ref: ${refFruit.standard100g.calories} kcal)`);
    } else {
      console.log(`${badge} -> Not found in DB`);
    }
  }

  // Summary Metrics
  const totalFruits = benchmarkFruits.length;
  const foundFruits = totalFruits - tierCounts.MISSING;
  const coveragePercent = Math.round((foundFruits / totalFruits) * 1000) / 10;
  const highAccuracyPercent = Math.round(((tierCounts.EXACT + tierCounts.ACCEPTABLE) / totalFruits) * 1000) / 10;

  console.log('\n══════════════════════════════════════════════════════════════════════════════════════');
  console.log('📊 AUDIT SUMMARY METRICS');
  console.log('══════════════════════════════════════════════════════════════════════════════════════');
  console.log(` • Database Fruit Coverage:       ${foundFruits} / ${totalFruits} (${coveragePercent}%)`);
  console.log(` • Accurate / Plausible (<20%):   ${tierCounts.EXACT + tierCounts.ACCEPTABLE} / ${totalFruits} (${highAccuracyPercent}%)`);
  console.log(`   ├─ 🟢 Exact / High Accuracy:    ${tierCounts.EXACT}`);
  console.log(`   ├─ 🟡 Acceptable Variance:      ${tierCounts.ACCEPTABLE}`);
  console.log(`   ├─ 🟠 High Divergence:          ${tierCounts.HIGH_DIVERGENCE}`);
  console.log(`   ├─ 🔴 Critical Anomaly:         ${tierCounts.CRITICAL_ANOMALY}`);
  console.log(`   └─ ❌ Missing:                  ${tierCounts.MISSING}`);
  console.log(` • Primary Match Sources:`);
  console.log(`   ├─ IFCT_2017:                   ${layerStats.IFCT_2017}`);
  console.log(`   ├─ INDB:                        ${layerStats.INDB}`);
  console.log(`   ├─ OPEN_FOOD_FACTS:             ${layerStats.OPEN_FOOD_FACTS}`);
  console.log(`   └─ USER_CREATED:                ${layerStats.USER_CREATED}`);
  console.log('══════════════════════════════════════════════════════════════════════════════════════\n');

  // Generate Reports
  const outDir = path.resolve(__dirname, '..');
  writeMarkdownSummary(results, tierCounts, layerStats, path.join(outDir, 'fruit-audit-summary.md'));
  writeCsvMatrix(results, path.join(outDir, 'fruit-audit-matrix.csv'));
  writeJsonReport(results, path.join(outDir, 'fruit-audit-report.json'));

  console.log(`✅ Reports generated:`);
  console.log(`   📄 Summary: ${path.join(outDir, 'fruit-audit-summary.md')}`);
  console.log(`   📊 CSV:     ${path.join(outDir, 'fruit-audit-matrix.csv')}`);
  console.log(`   📦 JSON:    ${path.join(outDir, 'fruit-audit-report.json')}`);

  await prisma.$disconnect();
}

/**
 * Write Markdown Summary File
 */
function writeMarkdownSummary(results, tierCounts, layerStats, filepath) {
  const total = results.length;
  const found = total - tierCounts.MISSING;
  const coveragePercent = Math.round((found / total) * 1000) / 10;
  const accuratePercent = Math.round(((tierCounts.EXACT + tierCounts.ACCEPTABLE) / total) * 1000) / 10;

  let md = `# Fruit Database QA & Macro Accuracy Audit Report\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}  \n`;
  md += `**Reference Ground Truth:** USDA FoodData Central SR Legacy & ICMR-NIN IFCT 2017 (per 100g raw)  \n\n`;

  md += `## 1. Executive Summary\n\n`;
  md += `| Metric | Value | Percentage |\n`;
  md += `| :--- | :--- | :--- |\n`;
  md += `| **Total Reference Fruits Tested** | **${total}** | 100% |\n`;
  md += `| **Fruits Found in Database** | **${found}** | **${coveragePercent}%** |\n`;
  md += `| **🟢 Exact / High Accuracy (<10% error)** | **${tierCounts.EXACT}** | ${Math.round((tierCounts.EXACT/total)*100)}% |\n`;
  md += `| **🟡 Acceptable Natural Variance (<20% error)** | **${tierCounts.ACCEPTABLE}** | ${Math.round((tierCounts.ACCEPTABLE/total)*100)}% |\n`;
  md += `| **🟠 High Divergence (>25% error)** | **${tierCounts.HIGH_DIVERGENCE}** | ${Math.round((tierCounts.HIGH_DIVERGENCE/total)*100)}% |\n`;
  md += `| **🔴 Critical Anomaly (Unit/Scaling Error)** | **${tierCounts.CRITICAL_ANOMALY}** | ${Math.round((tierCounts.CRITICAL_ANOMALY/total)*100)}% |\n`;
  md += `| **❌ Missing Fruits** | **${tierCounts.MISSING}** | ${Math.round((tierCounts.MISSING/total)*100)}% |\n\n`;

  md += `### Source Layer Distribution for Found Fruits\n`;
  md += `- **IFCT 2017 (Gold Standard Indian):** ${layerStats.IFCT_2017}\n`;
  md += `- **INDB (Indian Nutrient Database):** ${layerStats.INDB}\n`;
  md += `- **Open Food Facts (Crowdsourced):** ${layerStats.OPEN_FOOD_FACTS}\n`;
  md += `- **User Created:** ${layerStats.USER_CREATED}\n\n`;

  md += `## 2. Complete Fruit Verification Matrix\n\n`;
  md += `| Fruit | Status / Tier | DB Match Name | Source | DB Cal (Ref) | DB Carb (Ref) | DB Fiber (Ref) | Servings Defined | Issues / Diagnostics |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const r of results) {
    const ev = r.evaluation;
    const ref = r.refFruit.standard100g;

    if (ev.status === 'MISSING') {
      md += `| **${r.refFruit.canonicalName}** | ❌ **MISSING** | *None* | - | - (${ref.calories}) | - (${ref.carbohydrates}) | - (${ref.fiber}) | 0 | Fruit not present in database |\n`;
    } else {
      const db = ev.dbFood;
      const tierBadge =
        ev.accuracyTier === 'EXACT' ? '🟢 Exact' :
        ev.accuracyTier === 'ACCEPTABLE' ? '🟡 Acceptable' :
        ev.accuracyTier === 'HIGH_DIVERGENCE' ? '🟠 High Div' :
        '🔴 Critical';

      const calStr = `${db.calories} (${ref.calories})`;
      const carbStr = `${db.carbohydrates} (${ref.carbohydrates})`;
      const fiberStr = `${db.fiber} (${ref.fiber})`;
      const issueStr = ev.issues.length > 0 ? ev.issues.join('; ') : 'None (Passed)';

      md += `| **${r.refFruit.canonicalName}** | ${tierBadge} | ${db.name} | \`${db.source}\` | ${calStr} | ${carbStr} | ${fiberStr} | ${ev.servingCheck.servingCount} | ${issueStr} |\n`;
    }
  }

  md += `\n## 3. Recommended Remediation Actions\n\n`;
  md += `1. **Seed Missing Fruits**: Ensure all core staple & regional fruits (e.g. Amla, Jamun, Sitaphal, Mosambi) are present with primary source \`IFCT_2017\` or \`INDB\`.\n`;
  md += `2. **Populate Standard Piece Servings**: For all whole fruits, verify presence of \`1 medium\`, \`1 small\`, \`1 cup sliced\` in \`FoodServing\` table with correct weights and \`ServingUnitType.COUNT\` / \`VOLUME\`.\n`;
  md += `3. **Correct Missing Fiber**: Review foods with 0g fiber where the reference contains significant dietary fiber (e.g., Guava, Berries, Chikoo).\n`;

  fs.writeFileSync(filepath, md, 'utf-8');
}

/**
 * Write CSV Matrix File
 */
function writeCsvMatrix(results, filepath) {
  const headers = [
    'Fruit Canonical Name',
    'Status',
    'Accuracy Tier',
    'DB Food ID',
    'DB Food Name',
    'Source',
    'DB Calories (100g)',
    'Ref Calories (100g)',
    'Delta Calories',
    'Rel Var Cal (%)',
    'DB Carbs (g)',
    'Ref Carbs (g)',
    'DB Protein (g)',
    'Ref Protein (g)',
    'DB Fat (g)',
    'Ref Fat (g)',
    'DB Fiber (g)',
    'Ref Fiber (g)',
    'Macro Mass Sum (g)',
    'Atwater Pass',
    'Serving Count',
    'Issues'
  ];

  const rows = results.map(r => {
    const ev = r.evaluation;
    const ref = r.refFruit.standard100g;

    if (ev.status === 'MISSING') {
      return [
        `"${r.refFruit.canonicalName}"`,
        'MISSING',
        'MISSING',
        '',
        '',
        '',
        '',
        ref.calories,
        '',
        '',
        '',
        ref.carbohydrates,
        '',
        ref.protein,
        '',
        ref.fat,
        '',
        ref.fiber,
        '',
        '',
        0,
        '"Fruit not found in database"'
      ].join(',');
    }

    const db = ev.dbFood;
    const deltas = ev.deltas;

    return [
      `"${r.refFruit.canonicalName}"`,
      ev.status,
      ev.accuracyTier,
      db.id,
      `"${db.name.replace(/"/g, '""')}"`,
      db.source,
      db.calories,
      ref.calories,
      deltas.calories.delta,
      deltas.calories.relPercent,
      db.carbohydrates,
      ref.carbohydrates,
      db.protein,
      ref.protein,
      db.fat,
      ref.fat,
      db.fiber,
      ref.fiber,
      ev.atwaterCheck.macroMassSum,
      ev.atwaterCheck.isConsistent ? 'PASS' : 'FAIL',
      ev.servingCheck.servingCount,
      `"${ev.issues.join('; ').replace(/"/g, '""')}"`
    ].join(',');
  });

  fs.writeFileSync(filepath, [headers.join(','), ...rows].join('\n'), 'utf-8');
}

/**
 * Write JSON Report
 */
function writeJsonReport(results, filepath) {
  const data = {
    timestamp: new Date().toISOString(),
    totalAudited: results.length,
    results: results.map(r => ({
      canonicalName: r.refFruit.canonicalName,
      reference: r.refFruit,
      evaluation: r.evaluation
    }))
  };
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

if (require.main === module) {
  runFruitAudit().catch(err => {
    console.error('Audit failed with error:', err);
    process.exit(1);
  });
}

module.exports = { runFruitAudit };
