import fs from 'fs';
import path from 'path';
import type { AuditReport, AuditIssue } from '../types.ts';

/**
 * Generates an exhaustive, beautifully formatted executive Markdown audit report.
 */
export function writeMarkdownReport(report: AuditReport, targetPath: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const { metadata, summary, topIssues, issues } = report;

  // Group issues by category and code
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');
  const infos = issues.filter((i) => i.severity === 'INFO');

  // Filter specific interesting categories
  const rawVsCookedIssues = issues.filter((i) => i.issueCategory === 'RAW_VS_COOKED');
  const servingIssues = issues.filter((i) => i.issueCategory === 'SERVING');
  const duplicateIssues = issues.filter((i) => i.issueCategory === 'DUPLICATION');
  const consistencyIssues = issues.filter((i) => i.issueCategory === 'CONSISTENCY');
  const indianUsabilityIssues = issues.filter((i) => i.issueCategory === 'USABILITY_INDIAN');

  const md: string[] = [];

  md.push('# GramGains Food Database QA Audit Summary');
  md.push('');
  md.push('> **Audit Version:** 1.0.0 | **Generated At:** ' + metadata.runTimestamp + ' | **Duration:** ' + (metadata.durationMs / 1000).toFixed(2) + 's');
  md.push('');

  // 1. Nutritional Data Invariant
  md.push('## 1. Nutritional-Data Invariant & Scientific Baseline');
  md.push('');
  md.push('> [!IMPORTANT]');
  md.push('> **Core Project Invariant:**');
  md.push('> All nutritional values (`calories`, `protein`, `carbohydrates`, `fat`, `fiber`) in the `Food` table represent **values per 100 g of edible food**, unless explicitly flagged otherwise.');
  md.push('>');
  md.push('> **Audit Policy:** Any records whose convention cannot be reliably confirmed are flagged (`ERR_CONVENTION_UNCERTAIN` or `WARN_CALORIE_MACRO_MISMATCH`) rather than silently adjusted.');
  md.push('');

  // 2. Audit Run Configuration
  md.push('## 2. Audit Configuration & Environment');
  md.push('');
  md.push('| Parameter | Value | Description |');
  md.push('| :--- | :--- | :--- |');
  md.push(`| **Target Database** | \`${metadata.databaseUrl.replace(/:[^:@]+@/, ':***@')}\` | PostgreSQL via Prisma Client |`);
  md.push(`| **Mode** | \`${metadata.strictMode ? 'STRICT (fails on ERROR)' : 'STANDARD'}\` | CI / manual execution flag |`);
  md.push(`| **Calorie Rel Discrepancy Warn** | \`${(metadata.config.calorieRelThreshold * 100).toFixed(0)}%\` | Atwater ($4P + 4C + 9F$) vs kcal warning threshold |`);
  md.push(`| **Calorie Abs Discrepancy Warn** | \`${metadata.config.calorieAbsThreshold} kcal\` | Minimum kcal deviation required to trigger warning |`);
  md.push(`| **Calorie Rel Discrepancy Error** | \`${(metadata.config.calorieRelErrorThreshold * 100).toFixed(0)}%\` | Extreme discrepancy triggering error |`);
  md.push(`| **Calorie Abs Discrepancy Error** | \`${metadata.config.calorieAbsErrorThreshold} kcal\` | Extreme absolute discrepancy |`);
  md.push(`| **Macro Sum Upper Bound** | \`${metadata.config.macroSumToleranceGrams} g\` | Physical maximum $P + C + F$ per 100g (accounting for moisture/ash) |`);
  md.push(`| **Max Plausible Energy** | \`${metadata.config.maxPlausibleKcalPer100g} kcal\` | Upper ceiling per 100g (pure lipid equivalent) |`);
  md.push(`| **Duplicate Jaccard Threshold** | \`${(metadata.config.duplicateSimilarityThreshold * 100).toFixed(0)}%\` | Token similarity threshold within category block |`);
  md.push('');

  // 3. Executive Metrics & Health Overview
  md.push('## 3. Executive Health Overview');
  md.push('');
  md.push('| Metric | Value | Health Assessment |');
  md.push('| :--- | :--- | :--- |');
  md.push(`| **Total Foods Audited** | **${summary.totalFoods.toLocaleString()}** | Complete catalog |`);
  md.push(`| **Total Servings Audited** | **${summary.totalServings.toLocaleString()}** | Portion records |`);
  md.push(`| **Active Foods** | ${summary.activeFoods.toLocaleString()} | \`deletedAt == null\` |`);
  md.push(`| **Soft-Deleted Foods** | ${summary.softDeletedFoods.toLocaleString()} | Preserved in database |`);
  md.push(`| **Coverage: With Search Aliases** | **${summary.percentageWithAliases.toFixed(1)}%** | ${summary.percentageWithAliases > 80 ? '🟢 Excellent' : summary.percentageWithAliases > 50 ? '🟡 Moderate' : '🔴 Low'} |`);
  md.push(`| **Coverage: With Serving Portions** | **${summary.percentageWithServings.toFixed(1)}%** | ${summary.percentageWithServings === 100 ? '🟢 100% Complete' : '🔴 Missing Servings Found'} |`);
  md.push(`| **Coverage: With Default Serving** | **${summary.percentageWithDefaultServing.toFixed(1)}%** | ${summary.percentageWithDefaultServing >= 99 ? '🟢 Robust' : '🟡 Review Default Servings'} |`);
  md.push(`| **Critical Errors (ERROR)** | **${summary.countsBySeverity.ERROR}** | ${summary.countsBySeverity.ERROR === 0 ? '🟢 Zero Errors' : '🔴 Requires Immediate Attention'} |`);
  md.push(`| **Warnings (WARNING)** | **${summary.countsBySeverity.WARNING}** | Inconsistencies & ambiguities |`);
  md.push(`| **Usability & Info Notices (INFO)** | **${summary.countsBySeverity.INFO}** | Indian real-world logging improvements |`);
  md.push(`| **Foods Requiring Manual Review** | **${summary.foodsRequiringManualReview.toLocaleString()}** | Foods with at least one Error or Warning |`);
  md.push('');

  // 4. Breakdown by Source & Layer
  md.push('## 4. Catalog Breakdown by Source & Ingestion Layer');
  md.push('');
  md.push('| Source | Layer | Total Foods | Servings Present | Default Serving % | Errors | Warnings | Info |');
  md.push('| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const s of summary.bySource) {
    const defPct = s.totalFoods > 0 ? ((s.withDefaultServing / s.totalFoods) * 100).toFixed(1) + '%' : '0%';
    md.push(`| \`${s.source}\` | Layer ${s.layer} | ${s.totalFoods.toLocaleString()} | ${s.withServings.toLocaleString()} (${((s.withServings / s.totalFoods) * 100).toFixed(1)}%) | ${defPct} | ${s.errorCount} | ${s.warningCount} | ${s.infoCount} |`);
  }
  md.push('');

  // 5. Issues by Issue Code Table
  md.push('## 5. Detected Issues Grouped by Code & Severity');
  md.push('');
  md.push('| Severity | Issue Code | Count | Category | Description |');
  md.push('| :--- | :--- | :---: | :--- | :--- |');

  const codeEntries = Object.entries(summary.countsByCode).filter(([, count]) => count > 0);
  codeEntries.sort((a, b) => b[1] - a[1]);

  for (const [code, count] of codeEntries) {
    let sevBadge = '🔵 INFO';
    if (code.startsWith('ERR_')) sevBadge = '🔴 ERROR';
    else if (code.startsWith('WARN_')) sevBadge = '🟡 WARNING';
    md.push(`| ${sevBadge} | \`${code}\` | **${count}** | ${getIssueCategoryName(code)} | ${getIssueCodeDescription(code)} |`);
  }
  md.push('');

  // 6. Detailed Analysis: Critical Physical & Nutritional Invariant Errors
  if (errors.length > 0) {
    md.push('## 6. Critical Invariant Violations (ERROR Severity)');
    md.push('');
    md.push('> [!CAUTION]');
    md.push(`> Found **${errors.length}** critical errors in the database. These violate physical bounds, chemical mass balance, or fundamental relational rules.`);
    md.push('');
    md.push('| Food Name | Source | Field | Stored | Expected | Explanation |');
    md.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const err of errors.slice(0, 20)) {
      md.push(`| **${err.foodName.slice(0, 30)}** | \`${err.source}\` | \`${err.field || '-'}\` | \`${err.storedValue ?? '-'}\` | \`${err.expectedValue ?? '-'}\` | ${err.explanation} |`);
    }
    if (errors.length > 20) {
      md.push(`| *... and ${errors.length - 20} more errors* | | | | | *(See food-audit-report.csv for complete list)* |`);
    }
    md.push('');
  } else {
    md.push('## 6. Critical Invariant Violations (ERROR Severity)');
    md.push('');
    md.push('✅ **No critical physical errors found!** All foods adhere to non-negative bounds and physical mass limits.');
    md.push('');
  }

  // 7. Detailed Analysis: Energy Consistency (Atwater 4P+4C+9F vs Stored Kcal)
  md.push('## 7. Nutritional Consistency: Atwater Energy vs Stored Calories');
  md.push('');
  md.push('Food composition tables determine energy through Atwater factors ($4\\times P + 4\\times C + 9\\times F$), specific food-matrix heat of combustion factors, and fiber deductions. Discrepancies beyond 20% / 25 kcal typically indicate:');
  md.push('- High-fiber foods where carbohydrate was reported as net carbs vs total carbs');
  md.push('- Soups/diluted liquid recipes where water content or cooking yield caused estimation artifacts');
  md.push('- Packaging labeling rounding conventions (e.g. FDA/FSSAI rounding rules)');
  md.push('');
  md.push(`- **Total Flagged Inconsistencies:** ${consistencyIssues.length}`);
  md.push('');
  if (consistencyIssues.length > 0) {
    md.push('| Food Name | Source | Stored Kcal | Calculated (4P+4C+9F) | Discrepancy | Explanation |');
    md.push('| :--- | :--- | :---: | :---: | :---: | :--- |');
    for (const c of consistencyIssues.slice(0, 15)) {
      md.push(`| ${c.foodName.slice(0, 32)} | \`${c.source}\` | \`${c.storedValue} kcal\` | \`${c.expectedValue}\` | **${c.discrepancy}** | ${c.explanation} |`);
    }
    if (consistencyIssues.length > 15) {
      md.push(`| *... and ${consistencyIssues.length - 15} more records* | | | | | *(See food-audit-report.csv)* |`);
    }
    md.push('');
  }

  // 8. Raw vs Cooked Staple Ambiguity
  md.push('## 8. High-Risk Raw vs Cooked Staple Ambiguities');
  md.push('');
  md.push('> [!WARNING]');
  md.push('> Staples such as **rice, dal, soya chunks, oats, pasta, and potatoes** expand by 2x-3x during cooking by absorbing water. If a record does not explicitly specify "raw" or "cooked", user calorie intake can be miscalculated by 200% to 300%!');
  md.push('');
  md.push(`- **Total Ambiguous Staple Foods Detected:** ${rawVsCookedIssues.length}`);
  md.push('');
  if (rawVsCookedIssues.length > 0) {
    md.push('| Food Name | Source | Category | Calorie Discrepancy Risk |');
    md.push('| :--- | :--- | :--- | :--- |');
    for (const r of rawVsCookedIssues.slice(0, 15)) {
      md.push(`| **${r.foodName}** | \`${r.source}\` | ${r.category} | ${r.discrepancy || '-'} |`);
    }
    if (rawVsCookedIssues.length > 15) {
      md.push(`| *... and ${rawVsCookedIssues.length - 15} more staple entries* | | | *(See food-audit-report.csv)* |`);
    }
    md.push('');
  }

  // 9. Real-World Usability for Indian Calorie Tracking
  md.push('## 9. Usability for Indian Real-World Diet Logging');
  md.push('');
  md.push('To ensure an intuitive experience for Indian users logging everyday meals:');
  md.push('- **Vernacular & Common Names:** Foods should have aliases in Hindi/Hinglish (e.g. `Palak`, `Dahi`, `Chawal`, `Atta`, `Besan`).');
  md.push('- **Household Portions:** Common dishes should have intuitive portion units like `bowl`, `katori`, `piece`, `roti`, `glass`, rather than forcing gram weight estimation.');
  md.push('');
  md.push(`- **Foods Lacking Household Servings:** ${issues.filter((i) => i.issueCode === 'INFO_LACKS_HOUSEHOLD_SERVING').length}`);
  md.push(`- **Foods Lacking Indian Vernacular Aliases:** ${issues.filter((i) => i.issueCode === 'INFO_MISSING_INDIAN_ALIAS').length}`);
  md.push(`- **Generic Ambiguous Names:** ${issues.filter((i) => i.issueCode === 'WARN_GENERIC_UNQUALIFIED_NAME').length}`);
  md.push('');

  // 10. Serving Integrity & Portion Plausibility
  md.push('## 10. Serving Integrity & Portion Plausibility');
  md.push('');
  md.push(`- **Total Serving Issues:** ${servingIssues.length}`);
  md.push(`- **Zero/Negative Weight Servings:** ${issues.filter((i) => i.issueCode === 'ERR_SERVING_ZERO_WEIGHT').length}`);
  md.push(`- **Multiple Default Servings:** ${issues.filter((i) => i.issueCode === 'ERR_MULTIPLE_DEFAULT_SERVINGS').length}`);
  md.push(`- **Implausible Serving Weights (e.g. 100g label with wrong weight):** ${issues.filter((i) => i.issueCode === 'WARN_IMPLAUSIBLE_SERVING_WEIGHT').length}`);
  md.push(`- **Duplicate Servings on Same Food:** ${issues.filter((i) => i.issueCode === 'WARN_DUPLICATE_SERVING').length}`);
  md.push('');

  // 11. Deduplication & Barcode Collision Findings
  md.push('## 11. Deduplication & Barcode Collisions');
  md.push('');
  md.push(`- **Barcode Collisions (Duplicate Barcodes):** ${issues.filter((i) => i.issueCode === 'ERR_DUPLICATE_BARCODE').length}`);
  md.push(`- **Duplicate Candidates (Token Jaccard >= 85%):** ${issues.filter((i) => i.issueCode === 'WARN_DUPLICATE_CANDIDATE').length}`);
  md.push('');

  // 12. Strategic Recommendations
  md.push('## 12. Strategic Recommendations & Data Quality Roadmap');
  md.push('');
  md.push('1. **Enforce Per-100g Invariant in All Future Ingestion Pipelines:** Any new scraper or importer must validate $P + C + F \\le 102$ and Atwater deviation before inserting.');
  md.push('2. **Disambiguate Staple Grains & Pulses:** Append `(Raw)` or `(Cooked)` to all generic staple entries in Layer 1 and Layer 2.');
  md.push('3. **Add Household Portions for Everyday Indian Dishes:** Layer 2 prepared foods should all offer `1 katori (150g)` and `1 bowl (200g)` in addition to `100g`.');
  md.push('4. **Resolve Barcode Collisions:** Investigate and clean up duplicated barcodes in OpenFoodFacts data.');
  md.push('5. **Incorporate Audit into CI/CD:** Run `npm run audit:food --strict` on PRs modifying food seed datasets or schema.');
  md.push('');
  md.push('---');
  md.push('*Report generated automatically by GramGains Deterministic Database Audit Tool.*');

  fs.writeFileSync(targetPath, md.join('\n'), 'utf-8');
}

function getIssueCategoryName(code: string): string {
  if (code.includes('NUTRITION') || code.includes('MACRO') || code.includes('FIBER')) return 'Physical Bounds';
  if (code.includes('CONVENTION') || code.includes('CALORIE')) return 'Nutritional Consistency';
  if (code.includes('SERVING')) return 'Serving Architecture';
  if (code.includes('PREP_STATE')) return 'Raw vs Cooked Clarity';
  if (code.includes('BARCODE') || code.includes('DUPLICATE')) return 'Deduplication';
  if (code.includes('SOURCE') || code.includes('BRANDED') || code.includes('SUSPICIOUS')) return 'Metadata Quality';
  if (code.includes('INDIAN') || code.includes('GENERIC') || code.includes('ALIAS')) return 'Indian Diet Usability';
  return 'General QA';
}

function getIssueCodeDescription(code: string): string {
  const map: Record<string, string> = {
    ERR_NUTRITION_NEGATIVE: 'Negative values in nutritional fields violating physics',
    ERR_NUTRITION_EXTREME: 'Unrealistically high nutrients (>100g/100g or >1000 kcal/100g)',
    ERR_MACRO_SUM_EXCEEDS_100: 'Sum of protein + carbohydrates + fat exceeds 100g per 100g',
    ERR_FIBER_EXCEEDS_CARBS: 'Fiber reported higher than total carbohydrates',
    ERR_CONVENTION_UNCERTAIN: 'Calorie scale diverges radically from Atwater expectation',
    ERR_INVALID_SOURCE_LAYER: 'FoodSource enum does not match expected architectural layer',
    ERR_FOOD_NO_SERVINGS: 'Food record has zero serving records configured',
    ERR_SERVING_ZERO_WEIGHT: 'Serving unit has non-positive weight (<= 0g)',
    ERR_MULTIPLE_DEFAULT_SERVINGS: 'More than one serving marked as default on same food',
    ERR_DUPLICATE_BARCODE: 'Barcode repeated across multiple distinct food items',
    WARN_CALORIE_MACRO_MISMATCH: 'Stored kcal differs from 4P+4C+9F by >20% and >25 kcal',
    WARN_AMBIGUOUS_PREP_STATE: 'Staple grain/pulse/vegetable without raw vs cooked state',
    WARN_GENERIC_UNQUALIFIED_NAME: 'Ambiguous generic name (e.g. rice, dal, milk, roti)',
    WARN_SUSPICIOUS_NAME: 'Corrupted text, ALL CAPS, HTML artifacts, or <2 chars',
    WARN_IMPLAUSIBLE_SERVING_WEIGHT: 'Serving label contradicts weight (e.g. 100g label with 25g weight)',
    WARN_DUPLICATE_SERVING: 'Multiple identical serving units/weights on same food',
    WARN_NO_DEFAULT_SERVING: 'Food has servings but none marked as default',
    WARN_BRANDED_LACKS_MANUFACTURER: 'OpenFoodFacts item missing brand or manufacturer metadata',
    WARN_DUPLICATE_CANDIDATE: 'High token similarity (>85%) duplicate candidate',
    WARN_REFERENCE_MISMATCH: 'Discrepancy against original raw source file',
    INFO_MISSING_INDIAN_ALIAS: 'Common food lacks vernacular Hindi/Hinglish search alias',
    INFO_LACKS_HOUSEHOLD_SERVING: 'Category typically logged by household unit lacks piece/bowl/cup',
    INFO_MISSING_GRAM_SERVING: 'Food lacks explicit standard gram ("g" or "100g") serving',
    INFO_EMPTY_ALIASES: 'Food has empty search aliases array',
    INFO_SOFT_DELETED_RECORD: 'Soft-deleted food record preserved in database',
  };
  return map[code] || 'Data quality check';
}
