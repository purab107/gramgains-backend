const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  const total = await prisma.food.count();
  const bySource = await prisma.food.groupBy({
    by: ['source', 'layer'],
    _count: { id: true },
  });
  console.log('Total Foods in Database:', total);
  console.log('\nBreakdown by Source & Layer:');
  console.table(bySource);

  // Sample brand search
  const cadbury = await prisma.food.findMany({
    where: {
      OR: [
        { brand: { contains: 'Cadbury', mode: 'insensitive' } },
        { name: { contains: 'Cadbury', mode: 'insensitive' } },
      ],
    },
    include: { servings: true },
    take: 3,
  });
  console.log('\nSample Brand Search ("Cadbury"):');
  console.log(
    cadbury.map((f) => ({
      name: f.name,
      brand: f.brand,
      servingUnit: f.servings?.[0]?.unitLabel || 'g',
      servingWeight: f.servings?.[0]?.weightGrams || 100,
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbohydrates,
      fat: f.fat,
    }))
  );

  // Sample barcode lookup
  const barcodeItem = await prisma.food.findFirst({
    where: { barcode: '8904083302490' },
    include: { servings: true },
  });
  console.log('\nSample Barcode Lookup ("8904083302490"):');
  if (barcodeItem) {
    console.log({
      id: barcodeItem.id,
      name: barcodeItem.name,
      brand: barcodeItem.brand,
      barcode: barcodeItem.barcode,
      servingUnit: barcodeItem.servings?.[0]?.unitLabel || 'g',
      servingWeight: barcodeItem.servings?.[0]?.weightGrams || 100,
      calories: barcodeItem.calories,
      protein: barcodeItem.protein,
      source: barcodeItem.source,
      layer: barcodeItem.layer,
    });
  } else {
    console.log('No barcode item found yet.');
  }
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
