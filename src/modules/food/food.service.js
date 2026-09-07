const { prisma } = require('../../config/db');

async function searchFoods(query, layer, category) {
  const whereClause = {};

  if (query && query.trim() !== '') {
    whereClause.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { aliases: { hasSome: [query.trim()] } },
      { category: { contains: query, mode: 'insensitive' } },
    ];
  }

  if (layer && (layer === 1 || layer === 2)) {
    whereClause.layer = layer;
  }

  if (category) {
    whereClause.category = { contains: category, mode: 'insensitive' };
  }

  return await prisma.food.findMany({
    where: whereClause,
    orderBy: [{ layer: 'asc' }, { name: 'asc' }],
  });
}

async function getFoodById(id) {
  return await prisma.food.findUnique({ where: { id } });
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

module.exports = { searchFoods, getFoodById, createFood };
