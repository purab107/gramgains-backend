const { prisma } = require('../../config/db');

async function searchFoods(query, layer, category, limit = 50, page = 1, barcode = null) {
  const whereClause = {};

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
      orderBy: [{ layer: 'asc' }, { name: 'asc' }],
      take,
      skip,
    }),
    prisma.food.count({ where: whereClause }),
  ]);

  return { foods, total, page: parseInt(page, 10) || 1, limit: take };
}

async function getFoodById(id) {
  return await prisma.food.findUnique({ where: { id } });
}

async function getFoodByBarcode(barcode) {
  if (!barcode) return null;
  return await prisma.food.findFirst({
    where: { barcode: barcode.trim() },
  });
}

async function createFood(data) {
  return await prisma.food.create({
    data: {
      ...data,
      aliases: data.aliases || [],
      fiber: data.fiber || 0,
    },
  });
}

module.exports = { searchFoods, getFoodById, getFoodByBarcode, createFood };
