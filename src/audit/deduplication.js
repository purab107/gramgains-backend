const {
  normalizeText,
  extractTokens,
  calculateJaccardSimilarity,
  generateBlockingKey,
} = require('./normalizer');

/**
 * Deterministic, CPU-friendly duplicate and barcode collision detector.
 * Uses blocked inverted indexes to guarantee linear O(N) performance on tens/hundreds of thousands of records.
 * @class
 */
class DeduplicationAuditor {
  /**
   * @private
   * @type {Map<string, Array<{id: string, name: string, source: string}>>}
   */
  #barcodeMap = new Map();

  /**
   * @private
   * @type {Map<string, Array<{id: string, name: string, brand: string|null, source: string, layer: number}>>}
   */
  #exactNameMap = new Map();

  /**
   * @private
   * @type {Map<string, Array<{id: string, name: string, tokens: string[], source: string, layer: number, category: string}>>}
   */
  #blockBuckets = new Map();

  /**
   * Registers a food record into the deduplication indexes.
   * @public
   * @param {import('./types').FoodRecord} food - The food record to register
   */
  registerFood(food) {
    // 1. Barcode registration
    if (food.barcode && food.barcode.trim().length > 0) {
      const code = food.barcode.trim();
      const existing = this.#barcodeMap.get(code) || [];
      existing.push({ id: food.id, name: food.name, source: food.source });
      this.#barcodeMap.set(code, existing);
    }

    // 2. Exact normalized name registration (within brand)
    const normName = normalizeText(food.name);
    const normBrand = normalizeText(food.brand) || 'nobrand';
    const exactKey = `${normBrand}:::${normName}`;
    const existingExact = this.#exactNameMap.get(exactKey) || [];
    existingExact.push({
      id: food.id,
      name: food.name,
      brand: food.brand,
      source: food.source,
      layer: food.layer,
    });
    this.#exactNameMap.set(exactKey, existingExact);

    // 3. Blocking bucket registration for near-duplicate search
    const blockKey = generateBlockingKey(food.category, food.brand, food.name);
    const bucket = this.#blockBuckets.get(blockKey) || [];
    bucket.push({
      id: food.id,
      name: food.name,
      tokens: extractTokens(food.name),
      source: food.source,
      layer: food.layer,
      category: food.category,
    });
    this.#blockBuckets.set(blockKey, bucket);
  }

  /**
   * Audits registered foods for barcode collisions and duplicate candidates.
   * @public
   * @param {number} [similarityThreshold=0.85] - The Jaccard similarity threshold for near-duplicate detection
   * @returns {import('./types').AuditIssue[]} Array of audit issues found
   */
  generateIssues(similarityThreshold = 0.85) {
    const issues = [];

    // 1. Check duplicate barcodes
    for (const [barcode, foods] of this.#barcodeMap.entries()) {
      if (foods.length > 1) {
        for (const f of foods) {
          const others = foods.filter((o) => o.id !== f.id).map((o) => `"${o.name}" (${o.id})`).join(', ');
          issues.push({
            id: `barcode-dup-${barcode}-${f.id}`,
            foodId: f.id,
            foodName: f.name,
            source: f.source,
            layer: 0,
            category: 'Packaging',
            barcode,
            severity: 'ERROR',
            issueCategory: 'DUPLICATION',
            issueCode: 'ERR_DUPLICATE_BARCODE',
            field: 'barcode',
            storedValue: barcode,
            expectedValue: 'Unique barcode',
            explanation: `Barcode "${barcode}" is duplicated across multiple foods: ${others}`,
          });
        }
      }
    }

    // 2. Check exact duplicate foods within same brand
    const seenExactPairs = new Set();
    for (const [, foods] of this.#exactNameMap.entries()) {
      if (foods.length > 1) {
        for (let i = 0; i < foods.length; i++) {
          for (let j = i + 1; j < foods.length; j++) {
            const pairKey = [foods[i].id, foods[j].id].sort().join(':::');
            if (seenExactPairs.has(pairKey)) continue;
            seenExactPairs.add(pairKey);

            issues.push({
              id: `dup-exact-${pairKey}`,
              foodId: foods[i].id,
              foodName: foods[i].name,
              source: foods[i].source,
              layer: foods[i].layer,
              category: 'General',
              brand: foods[i].brand,
              severity: 'WARNING',
              issueCategory: 'DUPLICATION',
              issueCode: 'WARN_DUPLICATE_CANDIDATE',
              field: 'name',
              storedValue: foods[i].name,
              expectedValue: `Unique entry, collides with "${foods[j].name}" (${foods[j].id})`,
              explanation: `Exact duplicate food detected within same brand: "${foods[i].name}" (ID: ${foods[i].id}) and "${foods[j].name}" (ID: ${foods[j].id})`,
            });
          }
        }
      }
    }

    // 3. Check near-duplicates within each block bucket
    const seenCandidatePairs = new Set();
    for (const [, bucket] of this.#blockBuckets.entries()) {
      if (bucket.length <= 1) continue;

      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          const pairKey = [a.id, b.id].sort().join(':::');
          if (seenCandidatePairs.has(pairKey) || seenExactPairs.has(pairKey)) continue;

          // Check token Jaccard similarity
          const sim = calculateJaccardSimilarity(a.tokens, b.tokens);
          if (sim >= similarityThreshold && a.tokens.length > 1 && b.tokens.length > 1) {
            seenCandidatePairs.add(pairKey);
            issues.push({
              id: `dup-sim-${pairKey}`,
              foodId: a.id,
              foodName: a.name,
              source: a.source,
              layer: a.layer,
              category: a.category,
              severity: 'WARNING',
              issueCategory: 'DUPLICATION',
              issueCode: 'WARN_DUPLICATE_CANDIDATE',
              field: 'name',
              storedValue: a.name,
              expectedValue: `Dissimilar to "${b.name}"`,
              discrepancy: `Jaccard similarity: ${(sim * 100).toFixed(1)}%`,
              explanation: `High-similarity duplicate candidate: "${a.name}" vs "${b.name}" (similarity: ${(sim * 100).toFixed(1)}%)`,
            });
          }
        }
      }
    }

    return issues;
  }
}

module.exports = { DeduplicationAuditor };