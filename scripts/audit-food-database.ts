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

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type {
  AuditConfig,
  AuditIssue,
  AuditReport,
  AuditSummaryStats,
  FoodRecord,
  IssueCode,
  Severity,
  SourceStats,
} from '../src/audit/types.ts';
import { DEFAULT_AUDIT_CONFIG } from '../src/audit/config.ts';
import { auditNutritionRules } from '../src/audit/rules/nutrition-rules.ts';
import { auditServingRules } from '../src/audit/rules/serving-rules.ts';
import { auditUsabilityRules } from '../src/audit/rules/usability-rules.ts';
import { auditSourceRules } from '../src/audit/rules/source-rules.ts';
import { DeduplicationAuditor } from '../src/audit/deduplication.ts';
import { IndbReferenceAdapter } from '../src/audit/adapters/indb-adapter.ts';
import { OffReferenceAdapter } from '../src/audit/adapters/off-adapter.ts';
import { writeJsonReport } from '../src/audit/reporters/json-reporter.ts';
import { writeCsvReport } from '../src/audit/reporters/csv-reporter.ts';
import { writeMarkdownReport } from '../src/audit/reporters/markdown-reporter.ts';

// Initialize Prisma Client (Read-Only usage)
const prisma = new PrismaClient();

// Parse CLI Flags
function parseArgs(): AuditConfig {
  const args = process.argv.slice(2);
  const config: AuditConfig = { ...DEFAULT_AUDIT_CONFIG };

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
  const allIssues: AuditIssue[] = [];

  let processedCount = 0;
  let activeFoods = 0;
  let softDeletedFoods = 0;
  let withAliasesCount = 0;
  let withServingsCount = 0;
  let withDefaultServingCount = 0;

  const sourceMap = new Map<string, SourceStats>();
  const categoryMap: Record<string, number> = {};

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

    for (const food of batch as FoodRecord[]) {
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

      const foodIssues = [
        ...nutrIssues,
        ...servIssues,
        ...usabIssues,
        ...srcIssues,
        ...indbIssues,
        ...offIssues,
      ];

      for (const iss of foodIssues) {
        allIssues.push(iss);
        if (iss.severity === 'ERROR') srcStats.errorCount++;
        else if (iss.severity === 'WARNING') srcStats.warningCount++;
        else if (iss.severity === 'INFO') srcStats.infoCount++;
      }
    }

    skip += batch.length;
    process.stdout.write(`   ... Audited ${processedCount.toLocaleString()} / ${totalFoodsCount.toLocaleString()} records (${Math.round((processedCount / totalFoodsCount) * 100)}%)\r`);
  }

  // Deduplication & Barcode collisions
  console.log('\n🧩 Running CPU-efficient token deduplication and barcode audit...');
  const dedupIssues = dedupAuditor.generateIssues(config.duplicateSimilarityThreshold);
  for (const iss of dedupIssues) {
    allIssues.push(iss);
  }

  // Compute aggregate statistics
  const countsBySeverity = {
    ERROR: 0,
    WARNING: 0,
    INFO: 0,
  };
  const countsByCode: Record<string, number> = {};
  const foodsRequiringReview = new Set<string>();

  for (const iss of allIssues) {
    countsBySeverity[iss.severity]++;
    countsByCode[iss.issueCode] = (countsByCode[iss.issueCode] || 0) + 1;
    if (iss.severity === 'ERROR' || iss.severity === 'WARNING') {
      foodsRequiringReview.add(iss.foodId);
    }
  }

  const durationMs = Date.now() - startTime;

  const summaryStats: AuditSummaryStats = {
    totalFoods: processedCount,
    totalServings: totalServingsCount,
    activeFoods,
    softDeletedFoods,
    bySource: Array.from(sourceMap.values()).sort((a, b) => a.layer - b.layer),
    byCategory: categoryMap,
    percentageWithAliases: processedCount > 0 ? (withAliasesCount / processedCount) * 100 : 0,
    percentageWithServings: processedCount > 0 ? (withServingsCount / processedCount) * 100 : 0,
    percentageWithDefaultServing: processedCount > 0 ? (withDefaultServingCount / processedCount) * 100 : 0,
    countsBySeverity,
    countsByCode: countsByCode as Record<IssueCode, number>,
    totalIssues: allIssues.length,
    foodsRequiringManualReview: foodsRequiringReview.size,
  };

  const report: AuditReport = {
    metadata: {
      runTimestamp: new Date().toISOString(),
      durationMs,
      databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/gramgains',
      auditVersion: '1.0.0',
      nutritionalInvariant: 'All nutritional fields represent values per 100g edible food',
      strictMode: config.strict,
      config,
    },
    summary: summaryStats,
    topIssues: allIssues.filter((i) => i.severity === 'ERROR').slice(0, 50),
    issues: allIssues,
  };

  // Write reports
  const outDir = path.resolve(process.cwd(), config.outDir);
  const jsonPath = path.join(outDir, 'food-audit-report.json');
  const csvPath = path.join(outDir, 'food-audit-report.csv');
  const mdPath = path.join(outDir, 'food-audit-summary.md');

  console.log(`\n💾 Writing audit reports to: ${outDir}`);
  writeJsonReport(report, jsonPath);
  console.log(`   ✓ ${jsonPath} (${(fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2)} MB)`);
  writeCsvReport(allIssues, csvPath);
  console.log(`   ✓ ${csvPath} (${(fs.statSync(csvPath).size / 1024 / 1024).toFixed(2)} MB)`);
  writeMarkdownReport(report, mdPath);
  console.log(`   ✓ ${mdPath} (${(fs.statSync(mdPath).size / 1024).toFixed(1)} KB)`);

  // Print Summary Table
  console.log('\n' + '═'.repeat(82));
  console.log('                          AUDIT EXECUTIVE SUMMARY');
  console.log('═'.repeat(82));
  console.log(`  Total Foods Audited:            ${summaryStats.totalFoods.toLocaleString()}`);
  console.log(`  Active / Soft-Deleted:          ${summaryStats.activeFoods.toLocaleString()} / ${summaryStats.softDeletedFoods.toLocaleString()}`);
  console.log(`  Search Aliases Coverage:        ${summaryStats.percentageWithAliases.toFixed(1)}%`);
  console.log(`  Serving Portions Coverage:      ${summaryStats.percentageWithServings.toFixed(1)}%`);
  console.log(`  Default Serving Coverage:       ${summaryStats.percentageWithDefaultServing.toFixed(1)}%`);
  console.log('─'.repeat(82));
  console.log(`  🔴 Errors:                      ${summaryStats.countsBySeverity.ERROR.toLocaleString()}`);
  console.log(`  🟡 Warnings:                    ${summaryStats.countsBySeverity.WARNING.toLocaleString()}`);
  console.log(`  🔵 Info / Usability Notices:    ${summaryStats.countsBySeverity.INFO.toLocaleString()}`);
  console.log(`  📋 Foods Requiring Review:      ${summaryStats.foodsRequiringManualReview.toLocaleString()} (${((summaryStats.foodsRequiringManualReview / summaryStats.totalFoods) * 100).toFixed(1)}%)`);
  console.log(`  ⏱️  Audit Execution Time:        ${(durationMs / 1000).toFixed(2)}s`);
  console.log('═'.repeat(82));

  // Top issue codes
  console.log('\nTop Issue Codes:');
  const sortedCodes = Object.entries(summaryStats.countsByCode)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [code, count] of sortedCodes) {
    const prefix = code.startsWith('ERR_') ? '🔴' : code.startsWith('WARN_') ? '🟡' : '🔵';
    console.log(`   ${prefix} ${code.padEnd(35)} : ${count.toLocaleString()}`);
  }
  console.log('');

  await prisma.$disconnect();

  if (config.strict && summaryStats.countsBySeverity.ERROR > 0) {
    console.error(`❌ Audit failed in --strict mode: ${summaryStats.countsBySeverity.ERROR} ERROR-level issues found.\n`);
    process.exit(1);
  } else {
    console.log('✅ Audit completed successfully.\n');
  }
}

runAudit().catch(async (e) => {
  console.error('\n❌ Fatal Audit Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
