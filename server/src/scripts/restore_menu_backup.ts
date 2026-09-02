import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function restoreBackup() {
  const backupPath = path.join(__dirname, '..', '..', 'scratch', 'menu_backup_20260728.json');
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Archivo de backup no encontrado en: ${backupPath}`);
    process.exit(1);
  }

  console.log('🔄 Restaurando menú completo desde la copia de seguridad...');
  const backupRaw = fs.readFileSync(backupPath, 'utf8');
  const backupData = JSON.parse(backupRaw);

  const backupCatIds = new Set(backupData.categories.map((c: any) => c.id));
  const backupItemIds = new Set(backupData.categories.flatMap((c: any) => c.items || []).map((i: any) => i.id));

  // 1. Desactivar todos los ítems y categorías actuales
  await prisma.menuItem.updateMany({ data: { active: false } });
  await prisma.menuCategory.updateMany({ data: { active: false } });

  // 2. Eliminar de la base de datos ítems que NO pertenecen a este backup (y que no estén en pedidos)
  const orderItems = await prisma.orderItem.findMany({ select: { menuItemId: true } });
  const usedMenuItemIds = new Set(orderItems.map(oi => oi.menuItemId).filter(Boolean));

  const itemsToDelete = await prisma.menuItem.findMany({
    where: {
      id: { notIn: Array.from(backupItemIds) as string[] }
    },
    select: { id: true }
  });

  const deletableItemIds = itemsToDelete.map(i => i.id).filter(id => !usedMenuItemIds.has(id));

  if (deletableItemIds.length > 0) {
    const delCount = await prisma.menuItem.deleteMany({
      where: { id: { in: deletableItemIds } }
    });
    console.log(`🗑️ Eliminados ${delCount.count} productos temporales que no estaban en el backup.`);
  }

  // 3. Restaurar Categorías e Ítems del Backup
  let totalItemsRestored = 0;
  for (const cat of backupData.categories) {
    const createdCat = await prisma.menuCategory.upsert({
      where: { id: cat.id },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        active: true,
      },
      create: {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        active: true,
      },
    });

    if (cat.items && cat.items.length > 0) {
      for (const item of cat.items) {
        await prisma.menuItem.upsert({
          where: { id: item.id },
          update: {
            name: item.name,
            code: item.code,
            description: item.description,
            price: item.price,
            categoryId: createdCat.id,
            active: true,
            image: item.image,
            type: item.type || 'NORMAL',
            prepTime: item.prepTime || 10,
          },
          create: {
            id: item.id,
            name: item.name,
            code: item.code,
            description: item.description,
            price: item.price,
            categoryId: createdCat.id,
            active: true,
            image: item.image,
            type: item.type || 'NORMAL',
            prepTime: item.prepTime || 10,
          },
        });
        totalItemsRestored++;
      }
    }
  }

  console.log(`✅ ¡ÉXITO! Menú restaurado por completo desde el backup.`);
  console.log(`📊 Categorías restauradas: ${backupData.categories.length}`);
  console.log(`📊 Productos restaurados: ${totalItemsRestored}`);
}

restoreBackup()
  .catch(e => {
    console.error('❌ Error restaurando backup:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
