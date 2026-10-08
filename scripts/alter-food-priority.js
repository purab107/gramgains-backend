const { prisma } = require('../src/config/db');

async function main() {
  try {
    console.log('Adding isHighPriority column and index to Food table...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Food" 
      ADD COLUMN IF NOT EXISTS "isHighPriority" BOOLEAN NOT NULL DEFAULT false;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Food_isHighPriority_idx" ON "Food"("isHighPriority");
    `);
    console.log('✅ Successfully added isHighPriority column and index to Food table!');

    const count = await prisma.food.count();
    console.log(`Food table total count: ${count}`);
  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
