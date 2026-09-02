const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.menuCategory.findMany({
    include: { items: { select: { id: true, name: true, active: true, price: true } } },
    orderBy: { name: 'asc' },
  });

  console.log(`\n=== AUDITORÍA DEL MENÚ ===`);
  console.log(`Total categorías: ${categories.length}`);
  console.log(`Total ítems: ${categories.reduce((sum, c) => sum + c.items.length, 0)}`);
  
  console.log(`\n=== CATEGORÍAS ===`);
  for (const cat of categories) {
    const activeItems = cat.items.filter(i => i.active).length;
    const inactiveItems = cat.items.filter(i => !i.active).length;
    console.log(`${cat.active ? '✅' : '❌'} "${cat.name}" - ${cat.items.length} ítems (${activeItems} activos, ${inactiveItems} inactivos)`);
  }
  
  const catNames = categories.map(c => c.name.toLowerCase().trim());
  const duplicates = catNames.filter((name, index) => catNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    console.log(`\n=== CATEGORÍAS DUPLICADAS ===`);
    for (const dup of [...new Set(duplicates)]) {
      const cats = categories.filter(c => c.name.toLowerCase().trim() === dup);
      console.log(`"${dup}" aparece ${cats.length} veces:`);
      for (const c of cats) {
        console.log(`  - ID: ${c.id}, activa: ${c.active}, ítems: ${c.items.length}`);
      }
    }
  }
  
  const allItems = categories.flatMap(c => c.items);
  console.log(`\n=== RESUMEN DE ÍTEMS ===`);
  console.log(`Activos: ${allItems.filter(i => i.active).length}`);
  console.log(`Inactivos: ${allItems.filter(i => !i.active).length}`);
  
  const inactiveCats = categories.filter(c => !c.active);
  if (inactiveCats.length > 0) {
    console.log(`\n=== CATEGORÍAS INACTIVAS ===`);
    for (const cat of inactiveCats) {
      console.log(`❌ "${cat.name}" - ${cat.items.length} ítems`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
