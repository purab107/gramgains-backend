const {
  STAPLE_RAW_VS_COOKED_STEMS,
  PREPARATION_STATE_TOKENS,
  GENERIC_AMBIGUOUS_NAMES,
  INDIAN_VERNACULAR_DICTIONARY,
} = require('../config');
const { normalizeText, extractTokens } = require('../normalizer');

/**
 * Audits food name and alias usability for Indian diet logging.
 * Identifies raw-vs-cooked ambiguity, unqualified generic names,
 * missing vernacular aliases, and corrupted/suspicious strings.
 * @param {import('../types').FoodRecord} food - The food record to audit
 * @returns {import('../types').AuditIssue[]} Array of audit issues found
 */
function auditUsabilityRules(food) {
  const issues = [];
  const rawName = food.name.trim();
  const normName = normalizeText(rawName);
  const nameTokens = extractTokens(rawName);

  // 1. Raw vs Cooked state ambiguity check for staples
  for (const staple of STAPLE_RAW_VS_COOKED_STEMS) {
    if (normName.includes(staple.stem) || normName.includes(staple.vernacular)) {
      const hasPrepToken = PREPARATION_STATE_TOKENS.some((p) => normName.includes(p));
      if (!hasPrepToken) {
        issues.push({
          id: `prep-state-ambig-${food.id}`,
          foodId: food.id,
          foodName: food.name,
          source: food.source,
          layer: food.layer,
          category: food.category,
          brand: food.brand,
          severity: 'WARNING',
          issueCategory: 'RAW_VS_COOKED',
          issueCode: 'WARN_AMBIGUOUS_PREP_STATE',
          field: 'name',
          storedValue: food.name,
          expectedValue: `Specify state (e.g. "${staple.stem} (raw)" or "${staple.stem} (cooked)")`,
          discrepancy: `Calorie risk: Raw ~${staple.rawDensityKcal} kcal vs Cooked ~${staple.cookedDensityKcal} kcal/100g`,
          explanation: `Food "${food.name}" contains staple "${staple.stem}" without preparation state. Raw vs cooked varies by 2x-3x in calories!`,
        });
        break;
      }
    }
  }

  // 2. Generic ambiguous names
  if (GENERIC_AMBIGUOUS_NAMES.has(normName) && !food.brand) {
    issues.push({
      id: `generic-name-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'WARNING',
      issueCategory: 'USABILITY_INDIAN',
      issueCode: 'WARN_GENERIC_UNQUALIFIED_NAME',
      field: 'name',
      storedValue: food.name,
      expectedValue: 'Qualified name with variety, preparation, or brand',
      explanation: `Generic unqualified name "${food.name}". Users cannot differentiate variety (e.g., Boiled Basmati Rice vs Raw White Rice).`,
    });
  }

  // 3. Suspicious naming patterns
  // All uppercase check (longer than 3 chars)
  if (rawName.length > 3 && rawName === rawName.toUpperCase() && /[A-Z]/.test(rawName)) {
    issues.push({
      id: `suspicious-all-caps-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'WARNING',
      issueCategory: 'METADATA_SOURCE',
      issueCode: 'WARN_SUSPICIOUS_NAME',
      field: 'name',
      storedValue: food.name,
      expectedValue: 'Proper Title Case or mixed case',
      explanation: `Food name "${food.name}" is in ALL CAPS. Typical of raw barcode scanner / POS dumps.`,
    });
  }

  // Code fragments / HTML entities / trailing punctuation
  if (/(&amp;|&quot;|&#\d+;|[{}\[\]_`]|[.]{2,}|[-_]{2,})/.test(rawName)) {
    issues.push({
      id: `suspicious-artifacts-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'WARNING',
      issueCategory: 'METADATA_SOURCE',
      issueCode: 'WARN_SUSPICIOUS_NAME',
      field: 'name',
      storedValue: food.name,
      expectedValue: 'Clean human-readable string without escape codes or artifacts',
      explanation: `Food name "${food.name}" contains HTML entities or code artifacts.`,
    });
  }

  if (rawName.length < 2) {
    issues.push({
      id: `suspicious-short-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'WARNING',
      issueCategory: 'METADATA_SOURCE',
      issueCode: 'WARN_SUSPICIOUS_NAME',
      field: 'name',
      storedValue: food.name,
      expectedValue: '>= 2 characters',
      explanation: `Food name "${food.name}" is suspiciously short (< 2 characters).`,
    });
  }

  // 4. Missing/poor aliases check
  const aliases = food.aliases || [];
  if (aliases.length === 0) {
    issues.push({
      id: `alias-empty-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'INFO',
      issueCategory: 'USABILITY_INDIAN',
      issueCode: 'INFO_EMPTY_ALIASES',
      field: 'aliases',
      storedValue: '[]',
      expectedValue: 'Common alternative names / search keywords',
      explanation: `Food "${food.name}" has no search aliases configured.`,
    });
  }

  // 5. Vernacular Indian alias check
  const normAliases = aliases.map((a) => normalizeText(a));
  for (const [englishTerm, expectedVernaculars] of Object.entries(INDIAN_VERNACULAR_DICTIONARY)) {
    if (normName.includes(englishTerm)) {
      const hasVernacular = expectedVernaculars.some((v) =>
        normName.includes(v) || normAliases.some((a) => a.includes(v))
      );
      if (!hasVernacular) {
        issues.push({
          id: `vernacular-${food.id}-${englishTerm}`,
          foodId: food.id,
          foodName: food.name,
          source: food.source,
          layer: food.layer,
          category: food.category,
          brand: food.brand,
          severity: 'INFO',
          issueCategory: 'USABILITY_INDIAN',
          issueCode: 'INFO_MISSING_INDIAN_ALIAS',
          field: 'aliases',
          storedValue: aliases.join('; ') || 'None',
          expectedValue: `Indian vernacular alias: ${expectedVernaculars.join(', ')}`,
          explanation: `Food "${food.name}" matches "${englishTerm}" but lacks common Indian alias (${expectedVernaculars.join(', ')}).`,
        });
        break; // one vernacular flag per food
      }
    }
  }

  return issues;
}

module.exports = { auditUsabilityRules };