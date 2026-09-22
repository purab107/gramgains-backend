const { prisma } = require('../../config/db');
const { normalizeText, tokenize, scoreFood } = require('./food-search.engine');

function formatFoodWithServings(food) {
  if (!food) return null;
  const defaultServing = food.servings?.find((s) => s.isDefault) || food.servings?.[0];
  return {
    ...food,
    servings: food.servings || [],
    servingUnit: defaultServing?.unitLabel || 'g',
    servingWeight: defaultServing?.weightGrams || 100,
  };
}

async function searchFoods(query, layer, category, limit = 50, page = 1, barcode = null) {
  const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const skip = (currentPage - 1) * take;

  // 1. Barcode fast path
  const rawBarcode = barcode && barcode.trim() !== '' ? barcode.trim() : null;
  const isQueryBarcode = !rawBarcode && query && /^\d{8,14}$/.test(query.trim());
  const targetBarcode = rawBarcode || (isQueryBarcode ? query.trim() : null);

  if (targetBarcode) {
    const barcodeWhere = { barcode: targetBarcode, deletedAt: null };
    if (layer && [1, 2, 3].includes(layer)) {
      barcodeWhere.layer = layer;
    }
    if (category && category.trim() !== '' && category.toUpperCase() !== 'ALL') {
      barcodeWhere.category = { contains: category.trim(), mode: 'insensitive' };
    }

    const matchedFood = await prisma.food.findFirst({
      where: barcodeWhere,
      include: { servings: true },
    });

    if (matchedFood) {
      return {
        foods: [formatFoodWithServings(matchedFood)],
        total: 1,
        page: 1,
        limit: take,
      };
    }

    // If explicit barcode search failed, return empty
    if (rawBarcode) {
      return {
        foods: [],
        total: 0,
        page: 1,
        limit: take,
      };
    }
  }

  // 2. Relevance-based text search
  const trimmedQuery = query ? query.trim() : '';
  const normalizedQuery = normalizeText(trimmedQuery);
  const tokens = tokenize(trimmedQuery);

  if (tokens.length > 0) {
    const params = [];
    let paramIdx = 1;

    // Build token conditions across name, brand, genericName, and aliases
    const tokenConditions = [];
    for (const t of tokens) {
      params.push(`%${t}%`);
      tokenConditions.push(`(
        f.name ILIKE $${paramIdx}
        OR f.brand ILIKE $${paramIdx}
        OR f."genericName" ILIKE $${paramIdx}
        OR array_to_string(f.aliases, ' ') ILIKE $${paramIdx}
      )`);
      paramIdx++;
    }

    const anyTokenClause = tokenConditions.join(' OR ');
    const allTokensClause = tokenConditions.join(' AND ');

    let extraFilterClause = '';

    if (layer && [1, 2, 3].includes(layer)) {
      params.push(layer);
      extraFilterClause += ` AND f.layer = $${paramIdx}`;
      paramIdx++;
    }

    if (category && category.trim() !== '' && category.toUpperCase() !== 'ALL') {
      params.push(`%${category.trim()}%`);
      extraFilterClause += ` AND f.category ILIKE $${paramIdx}`;
      paramIdx++;
    }

    // Retrieve broad candidate set without paginating in DB to allow global relevance ranking
    const candidateSql = `
      SELECT f.id, f.name, f.brand, f."genericName", f.aliases, f.layer, f.category
      FROM "Food" f
      WHERE f."deletedAt" IS NULL
        AND (${anyTokenClause})
        ${extraFilterClause}
      ORDER BY (CASE WHEN (${allTokensClause}) THEN 0 ELSE 1 END) ASC, f.layer ASC, f.name ASC
      LIMIT 2000
    `;

    const candidates = await prisma.$queryRawUnsafe(candidateSql, ...params);

    // Score all candidates deterministically in Node.js
    const scored = candidates.map((food) => ({
      food,
      score: scoreFood(food, trimmedQuery, tokens, normalizedQuery),
    }));

    // Rank primarily by relevance score DESC, then layer ASC, then name ASC
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.food.layer !== b.food.layer) return a.food.layer - b.food.layer;
      return a.food.name.localeCompare(b.food.name);
    });

    const total = scored.length;
    const pageCandidates = scored.slice(skip, skip + take);

    // Fetch full food rows with servings for the sliced page only
    const pageIds = pageCandidates.map((p) => p.food.id);
    let fullFoods = [];
    if (pageIds.length > 0) {
      fullFoods = await prisma.food.findMany({
        where: { id: { in: pageIds } },
        include: { servings: true },
      });
    }

    const foodMap = new Map(fullFoods.map((f) => [f.id, f]));
    const finalFoods = pageCandidates
      .map((p) => foodMap.get(p.food.id))
      .filter(Boolean)
      .map(formatFoodWithServings);

    return {
      foods: finalFoods,
      total,
      page: currentPage,
      limit: take,
    };
  }

  // 3. Fallback: No query string (browse / filter mode)
  const whereClause = {
    deletedAt: null,
  };

  if (layer && [1, 2, 3].includes(layer)) {
    whereClause.layer = layer;
  }

  if (category && category.trim() !== '' && category.toUpperCase() !== 'ALL') {
    whereClause.category = { contains: category.trim(), mode: 'insensitive' };
  }

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

  return {
    foods: foods.map(formatFoodWithServings),
    total,
    page: currentPage,
    limit: take,
  };
}

async function getFoodById(id) {
  const food = await prisma.food.findUnique({
    where: { id },
    include: { servings: true },
  });
  return formatFoodWithServings(food);
}

async function getFoodByBarcode(barcode) {
  if (!barcode) return null;
  const food = await prisma.food.findFirst({
    where: { barcode: barcode.trim(), deletedAt: null },
    include: { servings: true },
  });
  return formatFoodWithServings(food);
}

async function createFood(data, userId = null) {
  const { servingUnit, servingWeight, servings, ...rest } = data;
  const servingsList = servings && servings.length > 0
    ? servings
    : [
        {
          unitLabel: servingUnit || 'g',
          weightGrams: servingWeight ? parseFloat(servingWeight) : 100,
          isDefault: true,
        },
      ];

  const created = await prisma.food.create({
    data: {
      ...rest,
      aliases: data.aliases || [],
      fiber: data.fiber || 0,
      source: data.source || 'USER_CREATED',
      layer: data.layer || 2,
      createdByUserId: userId,
      servings: {
        create: servingsList,
      },
    },
    include: { servings: true },
  });

  return formatFoodWithServings(created);
}

module.exports = { searchFoods, getFoodById, getFoodByBarcode, createFood };
