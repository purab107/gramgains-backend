const { prisma } = require('../src/config/db');

async function main() {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "SavedMeal" 
      ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
      ADD COLUMN IF NOT EXISTS "imagePublicId" TEXT;
    `);
    console.log('Successfully added imageUrl and imagePublicId columns to SavedMeal!');
    const meals = await prisma.savedMeal.findMany();
    console.log(`SavedMeal query success! Total meals: ${meals.length}`);
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
