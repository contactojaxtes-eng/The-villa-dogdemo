import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetCleanMenu() {
  console.log('🧹 Limpiando y eliminando por completo todas las categorías y productos antiguos...');

  // 1. Eliminar recetas vinculadas
  await prisma.recipe.deleteMany({});

  // 2. Obtener IDs de MenuItems usados en órdenes históricas
  const orderItems = await prisma.orderItem.findMany({
    select: { menuItemId: true }
  });
  const usedMenuItemIds = Array.from(new Set(orderItems.map(oi => oi.menuItemId).filter(Boolean))) as string[];

  console.log(`MenuItems referenciados en ventas previas: ${usedMenuItemIds.length}`);

  // 3. Eliminar FÍSICAMENTE todos los MenuItems no usados en ventas
  const deletedItems = await prisma.menuItem.deleteMany({
    where: {
      id: { notIn: usedMenuItemIds }
    }
  });
  console.log(`🗑️ MenuItems antiguos eliminados de la BD: ${deletedItems.count}`);

  // 4. Marcar como INACTIVOS y remover códigos únicos de los pocos MenuItems históricos que están en ventas pasadas
  await prisma.menuItem.updateMany({
    where: { id: { in: usedMenuItemIds } },
    data: {
      active: false,
      code: null // para evitar duplicación de códigos únicos con el nuevo menú
    }
  });

  // 5. Eliminar FÍSICAMENTE todas las categorías que ya no tengan ítems activos o vinculados
  const itemsWithCats = await prisma.menuItem.findMany({
    select: { categoryId: true }
  });
  const remainingCatIds = Array.from(new Set(itemsWithCats.map(i => i.categoryId).filter(Boolean))) as string[];

  const deletedCats = await prisma.menuCategory.deleteMany({
    where: {
      id: { notIn: remainingCatIds }
    }
  });
  console.log(`🗑️ Categorías antiguas eliminadas de la BD: ${deletedCats.count}`);

  // Marcar inactivas las categorías que hayan quedado con referencias históricas
  await prisma.menuCategory.updateMany({
    where: { id: { in: remainingCatIds } },
    data: { active: false }
  });

  console.log('✅ Base de datos desinfectada de categorías y productos viejos.');
}

resetCleanMenu()
  .catch(e => {
    console.error('Error al limpiar el catálogo:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
