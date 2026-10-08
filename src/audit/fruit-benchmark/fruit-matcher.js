/**
 * Fruit Database Matcher Engine
 * Locates candidate fruit records in the database, disambiguates raw foods from processed variants,
 * and returns scored matches per source layer.
 */

const { normalizeText, extractTokens, calculateJaccardSimilarity } = require('../normalizer');

// Penalty keywords to exclude processed items when looking for whole fresh fruits
const PROCESSED_PENALTY_TERMS = [
  'juice', 'ras', 'syrup', 'canned', 'dried', 'chips', 'freeze dried',
  'candy', 'jelly', 'jam', 'crush', 'sauce', 'concentrate', 'powder',
  'shake', 'smoothie', 'ice cream', 'custard', 'pie', 'cookie',
  'cake', 'snack', 'pickle', 'achar', 'chutney', 'murabba', 'flavored',
  'flavoured', 'beverage', 'drink', 'soda', 'puree', 'pulp sweetened'
];

/**
 * Checks if a string contains processed/distorted food keywords
 * @param {string} text 
 * @param {boolean} allowDriedOrWater 
 * @returns {boolean}
 */
function containsProcessedTerms(text, allowDriedOrWater = false) {
  const norm = normalizeText(text);
  for (const term of PROCESSED_PENALTY_TERMS) {
    if (allowDriedOrWater && (term === 'dried' || term === 'water')) {
      continue;
    }
    if (norm.includes(term)) {
      return true;
    }
  }
  return false;
}

/**
 * Searches the database for matching food items given a fruit reference definition.
 * 
 * @param {import('@prisma/client').PrismaClient} prisma 
 * @param {Object} refFruit - Benchmark fruit definition
 * @returns {Promise<{ primaryMatch: Object|null, matchesByLayer: Record<string, Object>, allCandidates: Object[] }>}
 */
async function findFruitMatches(prisma, refFruit) {
  const isDried = refFruit.canonicalName.toLowerCase().includes('dried') || refFruit.canonicalName.toLowerCase().includes('raisins');
  const isLiquid = refFruit.canonicalName.toLowerCase().includes('coconut water');

  // 1. Build search queries from canonical name and aliases
  const searchTerms = [
    refFruit.canonicalName,
    ...refFruit.aliases
  ];

  // Unique tokens to search in Postgres using OR ilike / contains
  const queryConditions = [];
  for (const term of searchTerms) {
    const clean = term.trim();
    if (clean.length >= 2) {
      queryConditions.push({ name: { contains: clean, mode: 'insensitive' } });
      queryConditions.push({ genericName: { contains: clean, mode: 'insensitive' } });
      queryConditions.push({ aliases: { has: clean } });
    }
  }

  // 2. Fetch candidates from database
  const rawCandidates = await prisma.food.findMany({
    where: {
      deletedAt: null,
      OR: queryConditions
    },
    include: {
      servings: true
    },
    take: 100
  });

  if (rawCandidates.length === 0) {
    return {
      primaryMatch: null,
      matchesByLayer: {},
      allCandidates: []
    };
  }

  // 3. Score candidates
  const refTokens = new Set([
    ...extractTokens(refFruit.canonicalName),
    ...refFruit.aliases.flatMap(a => extractTokens(a))
  ]);

  const scoredCandidates = rawCandidates.map(food => {
    let score = 0;
    const foodNameNorm = normalizeText(food.name);
    const foodTokens = extractTokens(food.name);

    // Exact name match
    if (foodNameNorm === normalizeText(refFruit.canonicalName)) {
      score += 50;
    }

    // Exact alias match
    for (const alias of refFruit.aliases) {
      const aliasNorm = normalizeText(alias);
      if (foodNameNorm === aliasNorm) {
        score += 45;
      } else if (foodNameNorm.startsWith(aliasNorm) || foodNameNorm.endsWith(aliasNorm)) {
        score += 25;
      } else if (food.aliases && food.aliases.some(a => normalizeText(a) === aliasNorm)) {
        score += 30;
      }
    }

    // Jaccard Token Similarity
    const jaccard = calculateJaccardSimilarity(Array.from(refTokens), foodTokens);
    score += jaccard * 30;

    // Layer preference
    if (food.source === 'IFCT_2017') score += 15;
    else if (food.source === 'INDB') score += 12;
    else if (food.source === 'OPEN_FOOD_FACTS') score += 5;

    // Generic name presence
    if (food.genericName && !food.brand) score += 10;

    // Shorter food name preference (e.g. "Apple" over "Apple Cinnamon Oat Crunch Bar")
    if (food.name.length < 25) score += 8;

    // Penalize processed keywords if searching for whole fruit
    if (!isDried && !isLiquid && containsProcessedTerms(food.name)) {
      score -= 40;
    }

    return {
      ...food,
      matchScore: score,
      jaccardSimilarity: jaccard
    };
  });

  // Sort descending by score
  scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

  // Group best match by layer
  const matchesByLayer = {};
  for (const item of scoredCandidates) {
    if (item.matchScore > 10 && !matchesByLayer[item.source]) {
      matchesByLayer[item.source] = item;
    }
  }

  // Best primary match (must meet minimum threshold)
  const primaryMatch = scoredCandidates.length > 0 && scoredCandidates[0].matchScore > 10
    ? scoredCandidates[0]
    : null;

  return {
    primaryMatch,
    matchesByLayer,
    allCandidates: scoredCandidates
  };
}

module.exports = {
  findFruitMatches,
  containsProcessedTerms
};
