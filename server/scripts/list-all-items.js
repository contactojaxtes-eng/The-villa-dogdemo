const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.menuItem.findMany({
    include: { category: true },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }]
  });
  console.log(`TOTAL ITEMS: ${items.length}`);
  items.forEach(i => {
    console.log(`[${i.code || 'NO_CODE'}] (${i.category.name}) - ${i.name}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
