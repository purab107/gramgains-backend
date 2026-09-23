#!/usr/bin/env node
/**
 * GramGains Food Database QA Audit Tool
 *
 * A deterministic, CPU-friendly, read-only QA audit tool that inspects Food
 * and FoodServing database records against physical invariants, Atwater energy consistency,
 * Indian real-world usability rules, portion plausibility, and reference datasets.
 *
 * Core Invariant:
 * All nutritional fields (calories, protein, carbohydrates, fat, fiber) represent
 * values PER 100 GRAMS of edible food unless explicitly documented.
 */

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const __dirname = path.dirname(__filename);
const { DEFAULT_AUDIT_CONFIG } = require('../src/audit/config');
const { auditNutritionRules } = require('../src/audit/rules/nutrition-rules');
const { auditServingRules } = require('../src/audit/rules/serving-rules');
const { auditUsabilityRules } = require('../src/audit/rules/usability-rules');
const { auditSourceRules } = require('../src/audit/rules/source-rules');
const { DeduplicationAuditor } = require('../src/audit/deduplication');
const { IndbReferenceAdapter } = require('../src/audit/adapters/indb-adapter');
const { OffReferenceAdapter } = require('../src/audit/adapters/off-adapter');
const { writeJsonReport } = require('../src/audit/reporters/json-reporter');
const { writeCsvReport } = require('../src/audit/reporters/csv-reporter');
const { writeMarkdownReport } = require('../src/audit/reporters/markdown-reporter');

// Initialize Prisma Client (Read-Only usage)
const prisma = new PrismaClient();

/**
 * Parse CLI Flags
 * @returns {import('../src/audit/types').AuditConfig} Audit configuration
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_AUDIT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--strict') {
      config.strict = true;
    } else if (arg === '--skip-reference') {
      config.skipReferenceAdapters = true;
    } else if (arg === '--rel-threshold' && args[i + 1]) {
      config.calorieRelThreshold = parseFloat(args[++i]);
    } else if (arg === '--abs-threshold' && args[i + 1]) {
      config.calorieAbsThreshold = parseFloat(args[++i]);
    } else if (arg === '--batch-size' && args[i + 1]) {
      config.batchSize = parseInt(args[++i], 10);
    } else if (arg === '--out-dir' && args[i + 1]) {
      config.outDir = args[++i];
    }
  }

  return config;
}

async function runAudit() {
  const startTime = Date.now();
  const config = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                🥗 GRAMGAINS FOOD DATABASE COMPREHENSIVE QA AUDIT                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════╝');
  console.log(` ▸ Mode:           ${config.strict ? 'STRICT (fails on ERROR)' : 'STANDARD'}`);
  console.log(` ▸ Calorie Warn:   ±${(config.calorieRelThreshold * 100).toFixed(0)}% and ±${config.calorieAbsThreshold} kcal`);
  console.log(` ▸ Macro Max Sum:  ${config.macroSumToleranceGrams} g / 100 g`);
  console.log(` ▸ Batch Size:     ${config.batchSize}`);
  console.log(` ▸ Output Dir:     ${config.outDir}`);
  console.log('──────────────────────────────────────────────────────────────────────────────────────\n');

  // Verify DB connection
  await prisma.$connect();
  const totalFoodsCount = await prisma.food.count();
  const totalServingsCount = await prisma.foodServing.count();

  console.log(`📊 Found ${totalFoodsCount.toLocaleString()} foods and ${totalServingsCount.toLocaleString()} servings in database.`);

  // Initialize reference adapters if available
  const indbPath = path.resolve(__dirname, '../Anuvaad_INDB_2024.11 (1).xlsx');
  const offPath = path.resolve(__dirname, '../../csvsss/GramGains_OpenFoodFacts_Final_Import.csv');

  const indbAdapter = new IndbReferenceAdapter(indbPath);
  const offAdapter = new OffReferenceAdapter(offPath);

  if (!config.skipReferenceAdapters) {
    if (fs.existsSync(indbPath)) {
      process.stdout.write(' 📦 Loading INDB 2024 reference dataset... ');
      const ok = indbAdapter.load();
      console.log(ok ? 'Loaded ✅' : 'Skipped ⚠️');
    }
    if (fs.existsSync(offPath)) {
      process.stdout.write(' 📦 Loading OpenFoodFacts CSV reference index... ');
      const ok = await offAdapter.load(15000);
      console.log(ok ? 'Loaded ✅' : 'Skipped ⚠️');
    }
  }

  const dedupAuditor = new DeduplicationAuditor();
  const allIssues = [];

  let processedCount = 0;
  let activeFoods = 0;
  let softDeletedFoods = 0;
  let withAliasesCount = 0;
  let withServingsCount = 0;
  let withDefaultServingCount = 0;

  const sourceMap = new Map();
  const categoryMap = {};

  console.log('\n🔍 Auditing records in streaming batches...');

  // Stream through records in efficient batches
  let skip = 0;
  while (skip < totalFoodsCount) {
    const batch = await prisma.food.findMany({
      skip,
      take: config.batchSize,
      select: {
        id: true,
        name: true,
        aliases: true,
        category: true,
        brand: true,
        brandOwner: true,
        genericName: true,
        barcode: true,
        calories: true,
        protein: true,
        carbohydrates: true,
        fat: true,
        fiber: true,
        source: true,
        layer: true,
        deletedAt: true,
        servings: {
          select: {
            id: true,
            foodId: true,
            unitLabel: true,
            weightGrams: true,
            isDefault: true,
          },
        },
      },
    });

    if (batch.length === 0) break;

    for (const food of batch) {
      processedCount++;
      if (food.deletedAt) {
        softDeletedFoods++;
      } else {
        activeFoods++;
      }

      // Track source stats
      const srcKey = `${food.source}::L${food.layer}`;
      let srcStats = sourceMap.get(srcKey);
      if (!srcStats) {
        srcStats = {
          source: food.source,
          layer: food.layer,
          totalFoods: 0,
          withAliases: 0,
          withServings: 0,
          withDefaultServing: 0,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
        };
        sourceMap.set(srcKey, srcStats);
      }
      srcStats.totalFoods++;

      // Category count
      categoryMap[food.category] = (categoryMap[food.category] || 0) + 1;

      // Aliases stats
      if (food.aliases && food.aliases.length > 0) {
        withAliasesCount++;
        srcStats.withAliases++;
      }

      // Servings stats
      const servings = food.servings || [];
      if (servings.length > 0) {
        withServingsCount++;
        srcStats.withServings++;
      }
      if (servings.some((s) => s.isDefault)) {
        withDefaultServingCount++;
        srcStats.withDefaultServing++;
      }

      // Register for deduplication and barcode collision checks
      dedupAuditor.registerFood(food);

      // 1. Run Nutrition & Invariant Rules
      const nutrIssues = auditNutritionRules(food, config);

      // 2. Run Serving Rules
      const servIssues = auditServingRules(food);

      // 3. Run Usability Rules
      const usabIssues = auditUsabilityRules(food);

      // 4. Run Source Rules
      const srcIssues = auditSourceRules(food);

      // 5. Run Reference Comparison Rules
      const indbIssues = indbAdapter.auditFood(food);
      const offIssues = offAdapter.auditFood(food);

      // Collect all issues
      allIssues.push(...nutrIssues, ...servIssues, ...usabIssues, ...srcIssues, ...indbIssues, ...offIssues);

      // Update source stats with issue counts
      const issueCount = nutrIssues.length + servIssues.length + usabIssues.length + srcIssues.length + indbIssues.length + offIssues.length;
      for (const issue of allIssues) {
        if (issue.severity === 'ERROR') srcStats.errorCount++;
        else if (issue.severity === 'WARNING') srcStats.warningCount++;
        else if (issue.severity === 'INFO') srcStats.infoCount++;
      }

      // Progress update every 1000 foods
      if (processedCount % 1000 === 0) {
        process.stdout.write(`\r   Processed: ${processedCount}/${totalFoodsCount} foods (${((processedCount / totalFoodsCount) * 100).toFixed(1)}%)`);
      }
    }

    skip += config.batchSize;
  }

  console.log(`\r   Processed: ${processedCount}/${totalFoodsCount} foods (100%)`);

  // Generate deduplication issues
  const dedupIssues = dedupAuditor.generateIssues(config.duplicateSimilarityThreshold);
  allIssues.push(...dedupIssues);

  // Build summary statistics
  const countsBySeverity = { ERROR: 0, WARNING: 0, INFO: 0 };
  const countsByCode = {};
  for (const issue of allIssues) {
    countsBySeverity[issue.severity]++;
    countsByCode[issue.issueCode] = (countsByCode[issue.issueCode] || 0) + 1;
  }

  const summary = {
    totalFoods: totalFoodsCount,
    totalServings: totalServingsCount,
    activeFoods,
    softDeletedFoods,
    bySource: Array.from(sourceMap.values()),
    byCategory: categoryMap,
    percentageWithAliases: (withAliasesCount / totalFoodsCount) * 100,
    percentageWithServings: (withServingsCount / totalFoodsCount) * 100,
    percentageWithDefaultServing: (withDefaultServingCount / totalFoodsCount) * 100,
    countsBySeverity,
    countsByCode,
    totalIssues: allIssues.length,
    foodsRequiringManualReview: new Set(allIssues.filter((i) => i.severity !== 'INFO').map((i) => i.foodId)).size,
  };

  // Sort issues by severity and code
  allIssues.sort((a, b) => {
    const severityOrder = { ERROR: 0, WARNING: 1, INFO: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return a.issueCode.localeCompare(b.issueCode);
  });

  const topIssues = allIssues.slice(0, 100);

  const report = {
    metadata: {
      runTimestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      databaseUrl: process.env.DATABASE_URL || 'postgresql://***:***@localhost:5432/gramgains',
      auditVersion: '1.0.0',
      nutritionalInvariant: 'All nutritional values represent values per 100g of edible food unless explicitly documented.',
      strictMode: config.strict,
      config,
    },
    summary,
    topIssues,
    issues: allIssues,
  };

  // Write reports
  const outDir = config.outDir;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  
  const jsonPath = path.join(outDir, `food-audit-report-${timestamp}.json`);
  const csvPath = path.join(outDir, `food-audit-report-${timestamp}.csv`);
  const mdPath = path.join(outDir, `food-audit-report-${timestamp}.md`);

  writeJsonReport(report, jsonPath);
  writeCsvReport(allIssues, csvPath);
  writeMarkdownReport(report, mdPath);

  console.log(`\n✅ Audit complete!`);
  console.log(`   📄 JSON Report:   ${jsonPath}`);
  console.log(`   📊 CSV Report:    ${csvPath}`);
  console.log(`   📝 Markdown Report: ${mdPath}`);
  console.log(`\n📈 Summary:`);
  console.log(`   Total Foods:        ${summary.totalFoods.toLocaleString()}`);
  console.log(`   Total Issues:       ${summary.totalIssues.toLocaleString()}`);
  console.log(`   Errors:             ${summary.countsBySeverity.ERROR}`);
  console.log(`   Warnings:           ${summary.countsBySeverity.WARNING}`);
  console.log(`   Info:               ${summary.countsBySeverity.INFO}`);
  console.log(`   Manual Review Needed: ${summary.foodsRequiringManualReview.toLocaleString()}`);

  if (config.strict && summary.countsBySeverity.ERROR > 0) {
    console.log(`\n❌ STRICT MODE: ${summary.countsBySeverity.ERROR} errors found. Exiting with error code 1.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();
  process.exit(0);
}

runAudit().catch((error) => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});