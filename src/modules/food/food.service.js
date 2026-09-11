const { prisma } = require('../../config/db');

function formatFoodWithServings(food) {
  if (!food) return null;
  const defaultServing = food.servings?.find((s) => s.isDefault) || food.servings?.[0];
  return {
    ...food,
    servingUnit: defaultServing?.unitLabel || 'g',
    servingWeight: defaultServing?.weightGrams || 100,
  };
}

async function searchFoods(query, layer, category, limit = 50, page = 1, barcode = null) {
  const whereClause = {
    deletedAt: null,
  };

  if (barcode && barcode.trim() !== '') {
    whereClause.barcode = barcode.trim();
  } else if (query && query.trim() !== '') {
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

  return {
    foods: foods.map(formatFoodWithServings),
    total,
    page: parseInt(page, 10) || 1,
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
