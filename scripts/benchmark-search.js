const { prisma } = require('../src/config/db');
const FoodService = require('../src/modules/food/food.service');

// Baseline (Old) search logic for direct comparison
async function baselineSearch(query, layer, category, limit = 50, page = 1) {
  const whereClause = { deletedAt: null };
  if (query && query.trim() !== '') {
    const trimmed = query.trim();
    whereClause.OR = [
      { name: { contains: trimmed, mode: 'insensitive' } },
      { brand: { contains: trimmed, mode: 'insensitive' } },
      { genericName: { contains: trimmed, mode: 'insensitive' } },
      { category: { contains: trimmed, mode: 'insensitive' } },
      { aliases: { hasSome: [trimmed] } },
      { barcode: { equals: trimmed } },
    ];
  }
  if (layer && [1, 2, 3].includes(layer)) {
    whereClause.layer = layer;
  }
  if (category && category.trim() !== '' && category.toUpperCase() !== 'ALL') {
    whereClause.category = { contains: category.trim(), mode: 'insensitive' };
  }
  const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = ((parseInt(page, 10) || 1) - 1) * take;

  const [foods, total] = await Promise.all([
    prisma.food.findMany({
      where: whereClause,
      include: { servings: true },
      orderBy: [{ layer: 'asc' }, { name: 'asc' }],
      take,
      skip,
    }),
    prisma.food.count({ where: whereClause }),
  ]);

  return { foods, total };
}

async function runBenchmark() {
  console.log('========================================================================');
  console.log('       GRAMGAINS FOOD SEARCH BENCHMARK: BASELINE vs NEW RELEVANCE        ');
  console.log('========================================================================\n');

  const testQueries = [
    { q: 'amul milk', desc: 'Multi-token cross-field query (brand + name)' },
    { q: 'amul', desc: 'Brand-dominant query with brand-only foods' },
    { q: 'banana', desc: 'Generic ingredient query vs compound products' },
    { q: 'banana cake', desc: 'Specific composite recipe query' },
    { q: 'taaza milk', desc: 'Product descriptor + category token' },
    { q: 'kela', desc: 'Indian-language regional alias search' },
    { q: 'oat milk', desc: 'Multi-word compound beverage' },
  ];

  const results = [];

  for (const { q, desc } of testQueries) {
    // Warmup
    await baselineSearch(q);
    await FoodService.searchFoods(q);

    // Measure Baseline (3 iterations)
    const baseTimes = [];
    let baseRes;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      baseRes = await baselineSearch(q);
      baseTimes.push(performance.now() - t0);
    }
    const avgBase = (baseTimes.reduce((a, b) => a + b, 0) / baseTimes.length).toFixed(2);

    // Measure New Implementation (3 iterations)
    const newTimes = [];
    let newRes;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      newRes = await FoodService.searchFoods(q);
      newTimes.push(performance.now() - t0);
    }
    const avgNew = (newTimes.reduce((a, b) => a + b, 0) / newTimes.length).toFixed(2);

    results.push({
      query: q,
      desc,
      baseCount: baseRes.total,
      baseTop: baseRes.foods[0] ? `${baseRes.foods[0].name} (${baseRes.foods[0].brand || 'no brand'})` : 'NONE',
      baseLatency: `${avgBase}ms`,
      newCount: newRes.total,
      newTop: newRes.foods[0] ? `${newRes.foods[0].name} (${newRes.foods[0].brand || 'no brand'})` : 'NONE',
      newLatency: `${avgNew}ms`,
    });
  }

  console.table(results.map(r => ({
    'Query': r.query,
    'Base Count': r.baseCount,
    'Base Top Match': r.baseTop.slice(0, 30),
    'Base Latency': r.baseLatency,
    'New Count': r.newCount,
    'New Top Match': r.newTop.slice(0, 30),
    'New Latency': r.newLatency,
  })));

  console.log('\nDetailed Breakdown:');
  for (const r of results) {
    console.log(`\nQuery: "${r.query}" (${r.desc})`);
    console.log(`  - Baseline: ${r.baseCount} matches | Avg Latency: ${r.baseLatency} | Top: ${r.baseTop}`);
    console.log(`  - New Engine: ${r.newCount} matches | Avg Latency: ${r.newLatency} | Top: ${r.newTop}`);
  }
}

runBenchmark()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
