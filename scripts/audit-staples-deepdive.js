const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deepDiveTargets() {
  await prisma.$connect();

  // 1. All rotis / chapatis
  const rotis = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: 'roti', mode: 'insensitive' } },
        { name: { contains: 'chapati', mode: 'insensitive' } },
        { name: { contains: 'phulka', mode: 'insensitive' } },
      ],
      deletedAt: null,
    },
    include: { servings: true },
    orderBy: { name: 'asc' },
  });

  // 2. Staple Dals
  const dals = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: 'dal', mode: 'insensitive' } },
        { name: { contains: 'daal', mode: 'insensitive' } },
        { name: { contains: 'sambar', mode: 'insensitive' } },
      ],
      deletedAt: null,
    },
    include: { servings: true },
    take: 40,
    orderBy: { name: 'asc' },
  });

  // 3. Puris
  const puris = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: 'puri', mode: 'insensitive' } },
        { name: { contains: 'poori', mode: 'insensitive' } },
      ],
      deletedAt: null,
    },
    include: { servings: true },
  });

  // 4. Duplicate checks on common foods
  const commonTerms = ['roti', 'chapati', 'paneer', 'milk', 'white rice', 'dal fry', 'egg', 'banana', 'idli'];
  const searchDuplicates = {};

  for (const term of commonTerms) {
    const matches = await prisma.food.findMany({
      where: {
        name: { contains: term, mode: 'insensitive' },
        deletedAt: null,
      },
      include: { servings: true },
      take: 10,
    });
    searchDuplicates[term] = matches.map(m => ({
      id: m.id,
      name: m.name,
      brand: m.brand,
      calories: m.calories,
      protein: m.protein,
      carbs: m.carbohydrates,
      fat: m.fat,
      servings: m.servings.map(s => `${s.unitLabel} (${s.weightGrams}g, type:${s.unitType}, dispQty:${s.displayQuantity})`),
    }));
  }

  const result = {
    rotis: rotis.map(r => ({
      id: r.id,
      name: r.name,
      source: r.source,
      brand: r.brand,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbohydrates,
      fat: r.fat,
      servings: r.servings.map(s => ({
        id: s.id,
        label: s.unitLabel,
        weight: s.weightGrams,
        type: s.unitType,
        displayQty: s.displayQuantity,
        isDefault: s.isDefault,
      })),
    })),
    puris: puris.map(p => ({
      id: p.id,
      name: p.name,
      source: p.source,
      calories: p.calories,
      servings: p.servings.map(s => ({ label: s.unitLabel, weight: s.weightGrams, type: s.unitType })),
    })),
    dalsSample: dals.slice(0, 15).map(d => ({
      id: d.id,
      name: d.name,
      source: d.source,
      calories: d.calories,
      servings: d.servings.map(s => ({ label: s.unitLabel, weight: s.weightGrams, type: s.unitType })),
    })),
    searchDuplicates,
  };

  fs.writeFileSync(path.join(__dirname, 'deep-dive-results.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log('Deep dive completed. Saved to deep-dive-results.json');
  await prisma.$disconnect();
}

deepDiveTargets().catch(console.error);
