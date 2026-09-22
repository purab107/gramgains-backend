/**
 * Types and schema definitions for the GramGains Food Database QA Audit Tool.
 *
 * Core Invariant:
 * Unless explicitly documented otherwise, all nutritional values (calories, protein,
 * carbohydrates, fat, fiber) are defined PER 100 GRAMS of edible food.
 */

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export type IssueCategory =
  | 'INVARIANT'
  | 'PHYSICAL_BOUNDS'
  | 'CONSISTENCY'
  | 'SERVING'
  | 'USABILITY_INDIAN'
  | 'RAW_VS_COOKED'
  | 'METADATA_SOURCE'
  | 'DUPLICATION'
  | 'REFERENCE_DIFF';

export type IssueCode =
  // Error severity: violations of physical or schema invariants
  | 'ERR_NUTRITION_NEGATIVE'
  | 'ERR_NUTRITION_EXTREME'
  | 'ERR_MACRO_SUM_EXCEEDS_100'
  | 'ERR_FIBER_EXCEEDS_CARBS'
  | 'ERR_CONVENTION_UNCERTAIN'
  | 'ERR_INVALID_SOURCE_LAYER'
  | 'ERR_FOOD_NO_SERVINGS'
  | 'ERR_SERVING_ZERO_WEIGHT'
  | 'ERR_MULTIPLE_DEFAULT_SERVINGS'
  | 'ERR_DUPLICATE_BARCODE'

  // Warning severity: suspected errors, inconsistencies, or high-risk ambiguities
  | 'WARN_CALORIE_MACRO_MISMATCH'
  | 'WARN_AMBIGUOUS_PREP_STATE'
  | 'WARN_GENERIC_UNQUALIFIED_NAME'
  | 'WARN_SUSPICIOUS_NAME'
  | 'WARN_IMPLAUSIBLE_SERVING_WEIGHT'
  | 'WARN_DUPLICATE_SERVING'
  | 'WARN_NO_DEFAULT_SERVING'
  | 'WARN_BRANDED_LACKS_MANUFACTURER'
  | 'WARN_DUPLICATE_CANDIDATE'
  | 'WARN_REFERENCE_MISMATCH'

  // Info severity: completeness, ergonomics, and real-world logging usability
  | 'INFO_MISSING_INDIAN_ALIAS'
  | 'INFO_LACKS_HOUSEHOLD_SERVING'
  | 'INFO_MISSING_GRAM_SERVING'
  | 'INFO_EMPTY_ALIASES'
  | 'INFO_SOFT_DELETED_RECORD';

export interface AuditIssue {
  id: string;
  foodId: string;
  foodName: string;
  source: string;
  layer: number;
  category: string;
  brand?: string | null;
  barcode?: string | null;
  severity: Severity;
  issueCategory: IssueCategory;
  issueCode: IssueCode;
  field?: string;
  storedValue?: string | number | null;
  expectedValue?: string | number | null;
  discrepancy?: string | number | null;
  explanation: string;
}

export interface FoodServingRecord {
  id: string;
  foodId: string;
  unitLabel: string;
  weightGrams: number;
  isDefault: boolean;
}

export interface FoodRecord {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  brand: string | null;
  brandOwner: string | null;
  genericName: string | null;
  barcode: string | null;
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
  source: 'IFCT_2017' | 'INDB' | 'OPEN_FOOD_FACTS' | 'USER_CREATED' | string;
  layer: number;
  deletedAt: Date | null;
  servings?: FoodServingRecord[];
}

export interface AuditConfig {
  calorieRelThreshold: number; // e.g. 0.20 for 20%
  calorieAbsThreshold: number; // e.g. 25 kcal
  calorieRelErrorThreshold: number; // e.g. 0.50 for 50%
  calorieAbsErrorThreshold: number; // e.g. 60 kcal
  maxPlausibleKcalPer100g: number; // e.g. 900
  extremeKcalThreshold: number; // e.g. 1000
  maxMacroGramsPer100g: number; // 100
  macroSumToleranceGrams: number; // 102 (accounts for moisture/ash/organic acids/rounding)
  duplicateSimilarityThreshold: number; // 0.85
  batchSize: number; // 2000
  outDir: string;
  strict: boolean;
  skipReferenceAdapters: boolean;
}

export interface SourceStats {
  source: string;
  layer: number;
  totalFoods: number;
  withAliases: number;
  withServings: number;
  withDefaultServing: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface AuditSummaryStats {
  totalFoods: number;
  totalServings: number;
  activeFoods: number;
  softDeletedFoods: number;
  bySource: SourceStats[];
  byCategory: Record<string, number>;
  percentageWithAliases: number;
  percentageWithServings: number;
  percentageWithDefaultServing: number;
  countsBySeverity: {
    ERROR: number;
    WARNING: number;
    INFO: number;
  };
  countsByCode: Record<IssueCode, number>;
  totalIssues: number;
  foodsRequiringManualReview: number;
}

export interface AuditReport {
  metadata: {
    runTimestamp: string;
    durationMs: number;
    databaseUrl: string;
    auditVersion: string;
    nutritionalInvariant: string;
    strictMode: boolean;
    config: AuditConfig;
  };
  summary: AuditSummaryStats;
  topIssues: AuditIssue[];
  issues: AuditIssue[];
}
