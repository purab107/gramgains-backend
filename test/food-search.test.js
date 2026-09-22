const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const FoodService = require('../src/modules/food/food.service');
const { prisma } = require('../src/config/db');

describe('Food Search Engine Tests', () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it('1. "amul milk" satisfies tokens across brand & name, returning "Amul Taaza Milk" in top results', async () => {
    const res = await FoodService.searchFoods('amul milk', undefined, undefined, 10);
    assert.ok(res.foods.length > 0, 'Should return results for "amul milk"');
    
    // Top match should be an Amul Milk product (Amul Taaza Milk)
    const topMatch = res.foods[0];
    assert.ok(
      topMatch.name.toLowerCase().includes('milk') && 
      (topMatch.brand?.toLowerCase() === 'amul' || topMatch.name.toLowerCase().includes('amul')),
      `Expected top match to be an Amul Milk product, got: "${topMatch.name}" (brand: ${topMatch.brand})`
    );
    assert.equal(topMatch.name, 'Amul Taaza Milk');
  });

  it('2. "amul" returns Amul-branded foods even when "Amul" is absent from the food name', async () => {
    const res = await FoodService.searchFoods('amul', undefined, undefined, 50);
    assert.ok(res.foods.length > 0, 'Should return results for "amul"');
    
    // Find an item where brand is Amul, but name does not contain Amul (e.g., Mithai Mate)
    const brandOnlyMatch = res.foods.find(f => 
      f.brand?.toLowerCase() === 'amul' && 
      !f.name.toLowerCase().includes('amul')
    );
    assert.ok(
      brandOnlyMatch,
      'Should return Amul-branded items whose names do not contain "Amul" (e.g. Mithai Mate)'
    );
    assert.equal(brandOnlyMatch.brand, 'Amul');
  });

  it('3. "banana" prioritizes generic whole banana over compound recipes (Banana Cake, Banana Chips)', async () => {
    const res = await FoodService.searchFoods('banana', undefined, undefined, 10);
    assert.ok(res.foods.length > 0, 'Should return results for "banana"');

    // Generic Banana (Layer 1 raw fruit) should be in the top results
    const topMatch = res.foods[0];
    assert.equal(topMatch.layer, 1, `Expected top match for "banana" to be Layer 1 generic fruit, got Layer ${topMatch.layer} (${topMatch.name})`);
    assert.ok(topMatch.name.toLowerCase().startsWith('banana'), `Expected top match to start with "Banana", got: ${topMatch.name}`);

    // Verify Banana Cake and Banana Chips rank lower than generic banana
    const bananaCakeIdx = res.foods.findIndex(f => f.name.toLowerCase().includes('cake'));
    const bananaChipsIdx = res.foods.findIndex(f => f.name.toLowerCase().includes('chips'));

    if (bananaCakeIdx !== -1) {
      assert.ok(bananaCakeIdx > 0, 'Banana Cake should rank lower than generic Banana for query "banana"');
    }
    if (bananaChipsIdx !== -1) {
      assert.ok(bananaChipsIdx > 0, 'Banana Chips should rank lower than generic Banana for query "banana"');
    }
  });

  it('4. "banana cake" prioritizes Banana Cake above generic Banana', async () => {
    const res = await FoodService.searchFoods('banana cake', undefined, undefined, 10);
    assert.ok(res.foods.length > 0, 'Should return results for "banana cake"');

    const topMatch = res.foods[0];
    assert.ok(
      topMatch.name.toLowerCase().includes('banana cake'),
      `Expected top match for "banana cake" to be Banana Cake, got: "${topMatch.name}"`
    );

    // If generic banana is also present in results, it must be ranked lower than Banana Cake
    const genericBananaIdx = res.foods.findIndex(f => f.layer === 1 && f.name.toLowerCase().startsWith('banana, ripe'));
    if (genericBananaIdx !== -1) {
      assert.ok(genericBananaIdx > 0, 'Generic banana should rank lower than Banana Cake for query "banana cake"');
    }
  });

  it('5. "taaza milk" returns "Amul Taaza Milk" as top result', async () => {
    const res = await FoodService.searchFoods('taaza milk', undefined, undefined, 5);
    assert.ok(res.foods.length > 0, 'Should return results for "taaza milk"');
    assert.equal(res.foods[0].name, 'Amul Taaza Milk');
  });

  it('6. Aliases: Indian-language / regional alias searches match correct items', async () => {
    // "kela" or "kele" matches plantain/banana items via aliases
    const res = await FoodService.searchFoods('kela', undefined, undefined, 10);
    assert.ok(res.foods.length > 0, 'Should return results for Hindi alias "kela"');
    const hasAliasMatch = res.foods.some(f => 
      (f.aliases || []).some(a => a.toLowerCase().includes('kela') || a.toLowerCase().includes('kele')) ||
      f.name.toLowerCase().includes('kela')
    );
    assert.ok(hasAliasMatch, 'Should find foods matching alias "kela"');
  });

  it('7. Barcode search returns exact item immediately', async () => {
    // Test with existing barcode: 8901262120029 (Mithai Mate)
    const barcode = '8901262120029';
    const res = await FoodService.searchFoods(barcode, undefined, undefined, 10);
    assert.equal(res.foods.length, 1);
    assert.equal(res.foods[0].barcode, barcode);
    assert.equal(res.foods[0].name, 'Mithai Mate');

    // Also test with barcode parameter
    const resParam = await FoodService.searchFoods('', undefined, undefined, 10, 1, barcode);
    assert.equal(resParam.foods.length, 1);
    assert.equal(resParam.foods[0].barcode, barcode);
  });

  it('8. Partial prefix queries return relevant foods', async () => {
    const res = await FoodService.searchFoods('banan', undefined, undefined, 10);
    assert.ok(res.foods.length > 0, 'Prefix query "banan" should return banana products');
    assert.ok(res.foods[0].name.toLowerCase().includes('banana'));
  });

  it('9. Layer and Category filters are properly applied with text search', async () => {
    // Query "banana" restricted to Layer 1
    const resLayer1 = await FoodService.searchFoods('banana', 1, undefined, 10);
    assert.ok(resLayer1.foods.length > 0);
    assert.ok(resLayer1.foods.every(f => f.layer === 1), 'All results must belong to layer 1');

    // Query "milk" restricted to category "Dairy"
    const resDairy = await FoodService.searchFoods('milk', undefined, 'Dairy', 10);
    assert.ok(resDairy.foods.length > 0);
    assert.ok(resDairy.foods.every(f => f.category.toLowerCase().includes('dairy')), 'All results must match category "Dairy"');
  });

  it('10. Pagination: relevance ordering is computed before slicing, and pages are consistent', async () => {
    const page1 = await FoodService.searchFoods('milk', undefined, undefined, 5, 1);
    const page2 = await FoodService.searchFoods('milk', undefined, undefined, 5, 2);

    assert.equal(page1.foods.length, 5);
    assert.equal(page2.foods.length, 5);
    assert.equal(page1.total, page2.total);
    assert.ok(page1.total > 10);

    // Page 1 and Page 2 items must be disjoint
    const page1Ids = new Set(page1.foods.map(f => f.id));
    for (const food of page2.foods) {
      assert.ok(!page1Ids.has(food.id), `Duplicate food ID ${food.id} across page 1 and page 2`);
    }
  });

  it('11. Regression: "amul milk" strictly prioritizes items satisfying ALL tokens (AND semantics) over single-token matches', async () => {
    const res = await FoodService.searchFoods('amul milk', undefined, undefined, 5);
    assert.ok(res.foods.length >= 3, 'Should have multiple Amul Milk results');

    // Every item in the top 3 must satisfy BOTH "amul" and "milk"
    for (const food of res.foods.slice(0, 3)) {
      const text = `${food.name} ${food.brand || ''}`.toLowerCase();
      assert.ok(text.includes('amul'), `Food "${food.name}" should match "amul"`);
      assert.ok(text.includes('milk'), `Food "${food.name}" should match "milk"`);
    }

    // "Amul Taaza Milk" should outrank "High Protein Milk"
    const taazaIdx = res.foods.findIndex(f => f.name === 'Amul Taaza Milk');
    const highProteinIdx = res.foods.findIndex(f => f.name.includes('High Protein Milk'));
    assert.ok(taazaIdx !== -1, 'Amul Taaza Milk must be in results');
    if (highProteinIdx !== -1) {
      assert.ok(taazaIdx < highProteinIdx, 'Amul Taaza Milk must rank higher than High Protein Milk');
    }
  });

  it('12. Regression: Fallback ordering for "amul milk" prioritizes Brand constraint ("Amul Cheese") over non-brand partials ("Almond Dairy Milk")', async () => {
    const res = await FoodService.searchFoods('amul milk', undefined, undefined, 50);
    const amulCheeseIdx = res.foods.findIndex(f => f.name.toLowerCase().includes('amul cheese') || (f.brand?.toLowerCase() === 'amul' && f.name.toLowerCase().includes('cheese')));
    const nonAmulMilkIdx = res.foods.findIndex(f => f.brand?.toLowerCase() !== 'amul' && !f.name.toLowerCase().includes('amul') && f.name.toLowerCase().includes('milk'));

    if (amulCheeseIdx !== -1 && nonAmulMilkIdx !== -1) {
      assert.ok(
        amulCheeseIdx < nonAmulMilkIdx,
        `Expected Amul Cheese (idx ${amulCheeseIdx}) to rank before non-Amul milk (idx ${nonAmulMilkIdx}) in fallback`
      );
    }
  });

  it('13. Regression: "roti" prioritizes Indian flatbreads and does NOT return "Rotini" pasta in top 5', async () => {
    const res = await FoodService.searchFoods('roti', undefined, undefined, 5);
    assert.ok(res.foods.length > 0, 'Should return results for "roti"');

    // None of the top 5 results should be pasta / rotini
    for (const food of res.foods) {
      assert.ok(
        !food.name.toLowerCase().startsWith('rotini'),
        `Top 5 result "${food.name}" should NOT be Rotini pasta for query "roti"`
      );
    }

    // Top result should be an actual roti / chapati flatbread
    const topName = res.foods[0].name.toLowerCase();
    assert.ok(topName.includes('roti') || topName.includes('chapati'), `Top match "${res.foods[0].name}" should be a roti or chapati`);
  });

  it('14. Multi-word brand: "mother dairy milk" recognizes Mother Dairy brand and returns milk products as top match', async () => {
    const res = await FoodService.searchFoods('mother dairy milk', undefined, undefined, 5);
    assert.ok(res.foods.length > 0, 'Should return results for "mother dairy milk"');

    const topMatch = res.foods[0];
    assert.equal(topMatch.brand, 'Mother Dairy', 'Top match brand must be "Mother Dairy"');
    assert.ok(topMatch.name.toLowerCase().includes('milk'), 'Top match name must include "milk"');
  });
});
