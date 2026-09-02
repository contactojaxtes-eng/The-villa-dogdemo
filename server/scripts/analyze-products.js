const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.menuCategory.findMany({
    include: { items: { orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' }
  });
  
  for (const cat of categories) {
    console.log(`\n=== CATEGORIA: ${cat.name} (${cat.items.length} items) ===`);
    cat.items.forEach(item => {
      console.log(`  ID: ${item.id} | CODE: ${item.code || 'NULL'} | NAME: "${item.name}"`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
