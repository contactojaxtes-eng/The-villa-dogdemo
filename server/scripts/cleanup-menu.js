const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🧹 === LIMPIEZA DE MENÚ THE VILLA DOG ===\n');

  // 1. Eliminar categoría basura "hamburguesas 2"
  const trash = await prisma.menuCategory.findMany({ where: { name: { contains: 'hamburguesas 2', mode: 'insensitive' } } });
  for (const t of trash) {
    const itemCount = await prisma.menuItem.count({ where: { categoryId: t.id } });
    if (itemCount === 0) {
      await prisma.menuCategory.delete({ where: { id: t.id } });
      console.log(`🗑️  Eliminada categoría basura: "${t.name}" (${t.id})`);
    }
  }

  // 2. Para cada nombre de categoría, mantener solo la ACTIVA (o la más reciente si ninguna es activa)
  const allCats = await prisma.menuCategory.findMany({
    include: { items: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Agrupar por nombre normalizado
  const catGroups = new Map();
  for (const cat of allCats) {
    const key = cat.name.toLowerCase().trim();
    if (!catGroups.has(key)) catGroups.set(key, []);
    catGroups.get(key).push(cat);
  }

  let deletedCats = 0;
  let deletedItems = 0;
  let activatedCats = 0;
  let activatedItems = 0;

  for (const [name, cats] of catGroups) {
    if (cats.length <= 1) {
      // Solo una, asegurarse de que esté activa
      const cat = cats[0];
      if (!cat.active) {
        await prisma.menuCategory.update({ where: { id: cat.id }, data: { active: true } });
        activatedCats++;
      }
      // Activar todos sus ítems
      const result = await prisma.menuItem.updateMany({
        where: { categoryId: cat.id, active: false },
        data: { active: true },
      });
      activatedItems += result.count;
      continue;
    }

    // Múltiples categorías con el mismo nombre
    // Mantener la activa, o la primera si ninguna es activa
    let keeper = cats.find(c => c.active) || cats[0];
    const toDelete = cats.filter(c => c.id !== keeper.id);

    // Asegurarse de que la keeper esté activa
    if (!keeper.active) {
      await prisma.menuCategory.update({ where: { id: keeper.id }, data: { active: true } });
      activatedCats++;
    }

    // Activar todos los ítems del keeper
    const activated = await prisma.menuItem.updateMany({
      where: { categoryId: keeper.id, active: false },
      data: { active: true },
    });
    activatedItems += activated.count;

    // Eliminar duplicados
    for (const dup of toDelete) {
      // Verificar si algún ítem de la categoría duplicada está referenciado en pedidos
      const itemsInOrders = await prisma.orderItem.findMany({
        where: { menuItem: { categoryId: dup.id } },
        select: { menuItemId: true },
      });

      const itemIdsInOrders = new Set(itemsInOrders.map(i => i.menuItemId));

      // Eliminar ítems que NO están en pedidos
      const allDupItems = await prisma.menuItem.findMany({
        where: { categoryId: dup.id },
        select: { id: true },
      });

      for (const item of allDupItems) {
        if (itemIdsInOrders.has(item.id)) {
          // Mover al keeper en vez de eliminar
          await prisma.menuItem.update({
            where: { id: item.id },
            data: { categoryId: keeper.id, active: false },
          });
          console.log(`  ↪️  Movido ítem en pedidos ${item.id} a la categoría keeper`);
        } else {
          // Eliminar receta si tiene
          await prisma.recipeIngredient.deleteMany({ where: { recipe: { menuItemId: item.id } } });
          await prisma.recipe.deleteMany({ where: { menuItemId: item.id } });
          await prisma.menuItem.delete({ where: { id: item.id } });
          deletedItems++;
        }
      }

      // Verificar que no quedan ítems en la categoría
      const remaining = await prisma.menuItem.count({ where: { categoryId: dup.id } });
      if (remaining === 0) {
        await prisma.menuCategory.delete({ where: { id: dup.id } });
        deletedCats++;
        console.log(`🗑️  Eliminada categoría duplicada: "${dup.name}" (${dup.id})`);
      } else {
        // Desactivar en vez de eliminar
        await prisma.menuCategory.update({ where: { id: dup.id }, data: { active: false } });
        console.log(`⚠️  Categoría "${dup.name}" tiene ${remaining} ítems en pedidos, desactivada`);
      }
    }
  }

  console.log(`\n✅ === RESULTADO ===`);
  console.log(`Categorías eliminadas: ${deletedCats}`);
  console.log(`Ítems eliminados: ${deletedItems}`);
  console.log(`Categorías activadas: ${activatedCats}`);
  console.log(`Ítems activados: ${activatedItems}`);

  // Verificación final
  const finalCats = await prisma.menuCategory.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { name: 'asc' },
  });
  console.log(`\n📊 Estado final: ${finalCats.length} categorías`);
  for (const cat of finalCats) {
    console.log(`  ${cat.active ? '✅' : '❌'} "${cat.name}" - ${cat._count.items} ítems`);
  }

  const totalItems = await prisma.menuItem.count();
  const activeItems = await prisma.menuItem.count({ where: { active: true } });
  console.log(`\n📊 Total ítems: ${totalItems} (${activeItems} activos, ${totalItems - activeItems} inactivos)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
