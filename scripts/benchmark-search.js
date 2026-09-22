const { prisma } = require('d:/Projects/gramgains/gramgains-backend/src/config/db');
const FoodService = require('d:/Projects/gramgains/gramgains-backend/src/modules/food/food.service');
const { scoreFood, tokenize, normalizeText } = require('d:/Projects/gramgains/gramgains-backend/src/modules/food/food-search.engine');

const QUERIES = [
  // (1) Generic single-ingredient foods
  { q: 'milk',          cat: 'generic' },
  { q: 'dahi',          cat: 'generic' },
  { q: 'curd',          cat: 'generic' },
  { q: 'atta',          cat: 'generic' },
  { q: 'wheat flour',   cat: 'generic' },
  { q: 'roti',          cat: 'generic' },
  { q: 'chapati',       cat: 'generic' },
  { q: 'rice',          cat: 'generic' },
  { q: 'basmati rice',  cat: 'multi' },
  { q: 'dal',           cat: 'generic' },
  { q: 'toor dal',      cat: 'multi' },
  { q: 'paneer',        cat: 'generic' },
  { q: 'banana',        cat: 'generic' },
  { q: 'potato',        cat: 'generic' },

  // (2) Multi-token food queries
  { q: 'banana cake',   cat: 'multi' },
  { q: 'oat milk',      cat: 'multi' },
  { q: 'peanut butter', cat: 'multi' },

  // (3) Indian-language / alias queries
  { q: 'kela',          cat: 'alias' },
  { q: 'aloo',          cat: 'alias' },
  { q: 'chawal',        cat: 'alias' },

  // (4) Brand-only queries
  { q: 'amul',          cat: 'brand' },
  { q: 'saffola',       cat: 'brand' },
  { q: 'maggi',         cat: 'brand' },
  { q: 'parle',         cat: 'brand' },

  // (5) Brand + food queries
  { q: 'amul milk',          cat: 'brand+food' },
  { q: 'amul paneer',        cat: 'brand+food' },
  { q: 'saffola oats',       cat: 'brand+food' },
  { q: 'aashirvaad atta',    cat: 'brand+food' },
  { q: 'britannia biscuits', cat: 'brand+food' },
  { q: 'india gate rice',    cat: 'brand+food' },
  { q: 'haldiram bhujia',    cat: 'brand+food' },
  { q: 'mother dairy milk',  cat: 'brand+food' },

  // (6) Brand / product ambiguity queries
  { q: 'nestle milk',     cat: 'ambiguity' },
  { q: 'nestle coffee',   cat: 'ambiguity' },
  { q: 'britannia milk',  cat: 'ambiguity' },
];

async function runBenchmark() {
  const allResults = [];
  const latencies = [];

  for (const { q, cat } of QUERIES) {
    // Warm up
    await FoodService.searchFoods(q, undefined, undefined, 5);

    // Timed run (average of 2)
    const times = [];
    let result;
    for (let i = 0; i < 2; i++) {
      const t0 = performance.now();
      result = await FoodService.searchFoods(q, undefined, undefined, 5);
      times.push(performance.now() - t0);
    }
    const avgLatency = times.reduce((a, b) => a + b, 0) / times.length;
    latencies.push(avgLatency);

    allResults.push({ q, cat, result, latency: avgLatency });
  }

  return { allResults, latencies };
}

function classify(q, food) {
  if (!food) return 'Irrelevant';
  const qLow = q.toLowerCase();
  const nameLow = food.name.toLowerCase();
  const brandLow = (food.brand || '').toLowerCase();
  const aliasStr = (food.aliases || []).join(' ').toLowerCase();
  const genericLow = (food.genericName || '').toLowerCase();
  const allText = nameLow + ' ' + brandLow + ' ' + aliasStr + ' ' + genericLow;

  const tokens = qLow.split(' ').filter(Boolean);
  const exactName = nameLow === qLow;
  const allTokensInRecord = tokens.every(t => allText.includes(t));
  const majorityTokensInRecord = tokens.filter(t => allText.includes(t)).length >= Math.ceil(tokens.length * 0.5);

  if (exactName) return 'Highly Relevant';
  if (allTokensInRecord) return 'Highly Relevant';
  if (majorityTokensInRecord) return 'Relevant';

  const anyToken = tokens.some(t => allText.includes(t));
  if (anyToken) return 'Weakly Relevant';
  return 'Irrelevant';
}

async function main() {
  const { allResults, latencies } = await runBenchmark();

  // === REPORT ===
  console.log('\n');
  console.log('══════════════════════════════════════════════════════════════════════════════════════');
  console.log('  GRAMGAINS FOOD SEARCH ENGINE — 34-QUERY RELEVANCE BENCHMARK REPORT');
  console.log('══════════════════════════════════════════════════════════════════════════════════════\n');

  let top1Correct = 0;
  let top1Wrong = [];
  let queriesWithExcessWeak = [];
  const totalQueries = allResults.length;

  for (const { q, cat, result, latency } of allResults) {
    const foods = result.foods;
    const total = result.total;

    const topRelevance = foods.length > 0 ? classify(q, foods[0]) : 'Irrelevant';
    if (topRelevance === 'Highly Relevant' || topRelevance === 'Relevant') {
      top1Correct++;
    } else {
      top1Wrong.push({ q, cat, top: foods[0]?.name || 'NONE', topBrand: foods[0]?.brand || 'None' });
    }

    const top5Ratings = foods.map(f => classify(q, f));
    const weakCount = top5Ratings.filter(r => r === 'Weakly Relevant' || r === 'Irrelevant').length;
    if (weakCount >= 3) {
      queriesWithExcessWeak.push({ q, weakCount });
    }

    console.log(`─────────────────────────────────────────────────────────────────`);
    console.log(`Query: "${q}"  [${cat}]  |  Candidates: ${total}  |  Latency: ${latency.toFixed(1)}ms`);
    console.log(`─────────────────────────────────────────────────────────────────`);
    if (foods.length === 0) {
      console.log('  [NO RESULTS]');
    } else {
      foods.forEach((f, idx) => {
        const rel = classify(q, f);
        const relIcon = rel === 'Highly Relevant' ? '✅' : rel === 'Relevant' ? '🟡' : rel === 'Weakly Relevant' ? '🟠' : '❌';
        console.log(`  ${idx + 1}. ${relIcon} [L${f.layer}] "${f.name}"  |  Brand: ${f.brand || 'None'}  |  ${rel}`);
      });
    }
    console.log('');
  }

  // === STATISTICS ===
  const sortedLat = [...latencies].sort((a, b) => a - b);
  const medianLat = sortedLat[Math.floor(sortedLat.length / 2)].toFixed(1);
  const p95Lat = sortedLat[Math.floor(sortedLat.length * 0.95)].toFixed(1);
  const minLat = sortedLat[0].toFixed(1);
  const maxLat = sortedLat[sortedLat.length - 1].toFixed(1);
  const avgLat = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1);

  const candidateCounts = allResults.map(r => r.result.total);
  const sortedCounts = [...candidateCounts].sort((a, b) => a - b);
  const medianCount = sortedCounts[Math.floor(sortedCounts.length / 2)];
  const maxCount = sortedCounts[sortedCounts.length - 1];
  const minCount = sortedCounts[0];
  const avgCount = (candidateCounts.reduce((a, b) => a + b, 0) / candidateCounts.length).toFixed(0);

  const top1Pct = ((top1Correct / totalQueries) * 100).toFixed(1);

  console.log('══════════════════════════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK SUMMARY STATISTICS');
  console.log('══════════════════════════════════════════════════════════════════════════════════════\n');

  console.log(`📊 Total Queries Benchmarked  : ${totalQueries}`);
  console.log(`✅ Top-1 Accuracy             : ${top1Correct}/${totalQueries} (${top1Pct}%)`);
  console.log(`   (Highly Relevant or Relevant as rank #1 result)`);
  console.log('');

  if (top1Wrong.length > 0) {
    console.log(`⚠️  Queries with wrong Top-1   : ${top1Wrong.length}`);
    top1Wrong.forEach(r => {
      console.log(`   • "${r.q}" [${r.cat}] → Got: "${r.top}" (Brand: ${r.topBrand})`);
    });
    console.log('');
  }

  if (queriesWithExcessWeak.length > 0) {
    console.log(`🟠 Queries with ≥3/5 weak/irrelevant results:`);
    queriesWithExcessWeak.forEach(r => console.log(`   • "${r.q}" — ${r.weakCount}/5 weak matches`));
    console.log('');
  }

  console.log(`⏱️  Latency Statistics`);
  console.log(`   Min   : ${minLat}ms`);
  console.log(`   Median: ${medianLat}ms`);
  console.log(`   Avg   : ${avgLat}ms`);
  console.log(`   p95   : ${p95Lat}ms`);
  console.log(`   Max   : ${maxLat}ms`);
  console.log('');
  console.log(`📦 Candidate-Count Statistics (matches before pagination)`);
  console.log(`   Min   : ${minCount}`);
  console.log(`   Median: ${medianCount}`);
  console.log(`   Avg   : ${avgCount}`);
  console.log(`   Max   : ${maxCount}`);
  console.log('');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
