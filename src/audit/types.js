/**
 * Types and schema definitions for the GramGains Food Database QA Audit Tool.
 *
 * Core Invariant:
 * Unless explicitly documented otherwise, all nutritional values (calories, protein,
 * carbohydrates, fat, fiber) are defined PER 100 GRAMS of edible food.
 */

/**
 * @typedef {'ERROR'|'WARNING'|'INFO'} Severity
 */

/**
 * @typedef {'INVARIANT'|'PHYSICAL_BOUNDS'|'CONSISTENCY'|'SERVING'|'USABILITY_INDIAN'|'RAW_VS_COOKED'|'METADATA_SOURCE'|'DUPLICATION'|'REFERENCE_DIFF'} IssueCategory
 */

/**
 * Error severity: violations of physical or schema invariants
 * @typedef {'ERR_NUTRITION_NEGATIVE'|'ERR_NUTRITION_EXTREME'|'ERR_MACRO_SUM_EXCEEDS_100'|'ERR_FIBER_EXCEEDS_CARBS'|'ERR_CONVENTION_UNCERTAIN'|'ERR_INVALID_SOURCE_LAYER'|'ERR_FOOD_NO_SERVINGS'|'ERR_SERVING_ZERO_WEIGHT'|'ERR_MULTIPLE_DEFAULT_SERVINGS'|'ERR_DUPLICATE_BARCODE'} ErrorCodeError
 */

/**
 * Warning severity: suspected errors, inconsistencies, or high-risk ambiguities
 * @typedef {'WARN_CALORIE_MACRO_MISMATCH'|'WARN_AMBIGUOUS_PREP_STATE'|'WARN_GENERIC_UNQUALIFIED_NAME'|'WARN_SUSPICIOUS_NAME'|'WARN_IMPLAUSIBLE_SERVING_WEIGHT'|'WARN_DUPLICATE_SERVING'|'WARN_NO_DEFAULT_SERVING'|'WARN_BRANDED_LACKS_MANUFACTURER'|'WARN_DUPLICATE_CANDIDATE'|'WARN_REFERENCE_MISMATCH'} ErrorCodeWarning
 */

/**
 * Info severity: completeness, ergonomics, and real-world logging usability
 * @typedef {'INFO_MISSING_INDIAN_ALIAS'|'INFO_LACKS_HOUSEHOLD_SERVING'|'INFO_MISSING_GRAM_SERVING'|'INFO_EMPTY_ALIASES'|'INFO_SOFT_DELETED_RECORD'} ErrorCodeInfo
 */

/**
 * @typedef {ErrorCodeError|ErrorCodeWarning|ErrorCodeInfo} IssueCode
 */

/**
 * @typedef {Object} AuditIssue
 * @property {string} id
 * @property {string} foodId
 * @property {string} foodName
 * @property {string} source
 * @property {number} layer
 * @property {string} category
 * @property {string|null} [brand]
 * @property {string|null} [barcode]
 * @property {Severity} severity
 * @property {IssueCategory} issueCategory
 * @property {IssueCode} issueCode
 * @property {string} [field]
 * @property {string|number|null} [storedValue]
 * @property {string|number|null} [expectedValue]
 * @property {string|number|null} [discrepancy]
 * @property {string} explanation
 */

/**
 * @typedef {Object} FoodServingRecord
 * @property {string} id
 * @property {string} foodId
 * @property {string} unitLabel
 * @property {number} weightGrams
 * @property {boolean} isDefault
 */

/**
 * @typedef {Object} FoodRecord
 * @property {string} id
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} category
 * @property {string|null} brand
 * @property {string|null} brandOwner
 * @property {string|null} genericName
 * @property {string|null} barcode
 * @property {number} calories
 * @property {number} protein
 * @property {number} carbohydrates
 * @property {number} fat
 * @property {number} fiber
 * @property {'IFCT_2017'|'INDB'|'OPEN_FOOD_FACTS'|'USER_CREATED'|string} source
 * @property {number} layer
 * @property {Date|null} deletedAt
 * @property {FoodServingRecord[]} [servings]
 */

/**
 * @typedef {Object} AuditConfig
 * @property {number} calorieRelThreshold - e.g. 0.20 for 20%
 * @property {number} calorieAbsThreshold - e.g. 25 kcal
 * @property {number} calorieRelErrorThreshold - e.g. 0.50 for 50%
 * @property {number} calorieAbsErrorThreshold - e.g. 60 kcal
 * @property {number} maxPlausibleKcalPer100g - e.g. 900
 * @property {number} extremeKcalThreshold - e.g. 1000
 * @property {number} maxMacroGramsPer100g - 100
 * @property {number} macroSumToleranceGrams - 102 (accounts for moisture/ash/organic acids/rounding)
 * @property {number} duplicateSimilarityThreshold - 0.85
 * @property {number} batchSize - 2000
 * @property {string} outDir
 * @property {boolean} strict
 * @property {boolean} skipReferenceAdapters
 */

/**
 * @typedef {Object} SourceStats
 * @property {string} source
 * @property {number} layer
 * @property {number} totalFoods
 * @property {number} withAliases
 * @property {number} withServings
 * @property {number} withDefaultServing
 * @property {number} errorCount
 * @property {number} warningCount
 * @property {number} infoCount
 */

/**
 * @typedef {Object} SeverityCounts
 * @property {number} ERROR
 * @property {number} WARNING
 * @property {number} INFO
 */

/**
 * @typedef {Object} AuditSummaryStats
 * @property {number} totalFoods
 * @property {number} totalServings
 * @property {number} activeFoods
 * @property {number} softDeletedFoods
 * @property {SourceStats[]} bySource
 * @property {Object.<string, number>} byCategory
 * @property {number} percentageWithAliases
 * @property {number} percentageWithServings
 * @property {number} percentageWithDefaultServing
 * @property {SeverityCounts} countsBySeverity
 * @property {Object.<IssueCode, number>} countsByCode
 * @property {number} totalIssues
 * @property {number} foodsRequiringManualReview
 */

/**
 * @typedef {Object} AuditReportMetadata
 * @property {string} runTimestamp
 * @property {number} durationMs
 * @property {string} databaseUrl
 * @property {string} auditVersion
 * @property {string} nutritionalInvariant
 * @property {boolean} strictMode
 * @property {AuditConfig} config
 */

/**
 * @typedef {Object} AuditReport
 * @property {AuditReportMetadata} metadata
 * @property {AuditSummaryStats} summary
 * @property {AuditIssue[]} topIssues
 * @property {AuditIssue[]} issues
 */

// Export empty object for module compatibility
module.exports = {};