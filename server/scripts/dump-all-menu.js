const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
  const categories = await prisma.menuCategory.findMany({
    include: { items: { orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' }
  });
  
  let out = [];
  for (const cat of categories) {
    cat.items.forEach(item => {
      out.push({
        id: item.id,
        category: cat.name,
        name: item.name,
        code: item.code
      });
    });
  }
  fs.writeFileSync('./all_menu_items.json', JSON.stringify(out, null, 2));
  console.log(`Saved ${out.length} items to all_menu_items.json`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
