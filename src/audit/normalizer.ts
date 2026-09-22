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
 */
export function normalizeText(text: string | null | undefined): string {
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
 */
export function extractTokens(text: string | null | undefined): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  const rawTokens = norm.split(' ');
  const result = new Set<string>();
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
 */
export function calculateJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
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
 */
export function generateBlockingKey(
  category: string | null | undefined,
  brand: string | null | undefined,
  name: string | null | undefined
): string {
  const normCat = normalizeText(category) || 'other';
  const normBrand = normalizeText(brand) || 'nobrand';
  const tokens = extractTokens(name);
  // Sort tokens and pick up to first 2 to create bucket
  const prefix = tokens.slice(0, 2).sort().join('_') || 'empty';
  return `${normCat}::${normBrand}::${prefix}`;
}
