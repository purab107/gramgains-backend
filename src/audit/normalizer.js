/**
 * Deterministic text normalizer and token extractor.
 * Fully CPU-friendly, non-allocating where possible, no external dependencies.
 */

const STOP_WORDS = new Set([
  'and',
  'or',
  'with',
  'in',
  'of',
  'the',
  'a',
  'an',
  'for',
  'by',
  'to',
  'at',
  'style',
  'fresh',
  'natural',
  'classic',
  'premium',
  'original',
]);

/**
 * Normalizes a food or brand name:
 * 1. Unicode NFKD decomposition
 * 2. Strip diacritical marks
 * 3. Lowercase
 * 4. Replace non-alphanumeric characters with space
 * 5. Collapse duplicate whitespace
 * @param {string|null|undefined} text - The text to normalize
 * @returns {string} The normalized text
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts distinct, meaningful tokens from a name (excluding common stopwords and numbers).
 * @param {string|null|undefined} text - The text to extract tokens from
 * @returns {string[]} Array of distinct tokens
 */
function extractTokens(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  const rawTokens = norm.split(' ');
  const result = new Set();
  for (const t of rawTokens) {
    if (t.length > 1 && !STOP_WORDS.has(t)) {
      result.add(t);
    }
  }
  return Array.from(result);
}

/**
 * Computes Jaccard similarity between two token sets:
 * J(A, B) = |A ∩ B| / |A ∪ B|
 * @param {string[]} tokensA - First token set
 * @param {string[]} tokensB - Second token set
 * @returns {number} Jaccard similarity coefficient (0.0 to 1.0)
 */
function calculateJaccardSimilarity(tokensA, tokensB) {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const setA = new Set(tokensA);
  let intersectionCount = 0;
  for (const t of tokensB) {
    if (setA.has(t)) {
      intersectionCount++;
    }
  }
  const unionCount = setA.size + tokensB.length - intersectionCount;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

/**
 * Generates an indexing/blocking key for a food item to avoid O(N^2) comparisons.
 * Items with different blocking keys are not compared for near-duplicate similarity.
 *
 * Format: `<normalized_category>:<brand_or_none>:<sorted_top_tokens>`
 * @param {string|null|undefined} category - The food category
 * @param {string|null|undefined} brand - The food brand
 * @param {string|null|undefined} name - The food name
 * @returns {string} The blocking key for the food item
 */
function generateBlockingKey(category, brand, name) {
  const normCat = normalizeText(category) || 'other';
  const normBrand = normalizeText(brand) || 'nobrand';
  const tokens = extractTokens(name);
  // Sort tokens and pick up to first 2 to create bucket
  const prefix = tokens.slice(0, 2).sort().join('_') || 'empty';
  return `${normCat}::${normBrand}::${prefix}`;
}

module.exports = {
  normalizeText,
  extractTokens,
  calculateJaccardSimilarity,
  generateBlockingKey,
};