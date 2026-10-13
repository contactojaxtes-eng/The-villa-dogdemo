import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const targetSiteId = String(process.env.TARGET_SITE_ID || '').trim();

async function restoreBackup() {
  if (!targetSiteId) {
    throw new Error(
      'Define TARGET_SITE_ID. La restauración de menú nunca puede ejecutarse globalmente.',
    );
  }
  const site = await prisma.site.findUnique({
    where: { id: targetSiteId },
    select: { id: true, name: true },
  });
  if (!site) throw new Error(`La sede ${targetSiteId} no existe.`);

  const backupPath = path.join(__dirname, '..', '..', 'scratch', 'menu_backup_20260728.json');
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Archivo de backup no encontrado en: ${backupPath}`);
    process.exit(1);
  }

  console.log(`🔄 Restaurando menú de ${site.name} desde la copia de seguridad...`);
  const backupRaw = fs.readFileSync(backupPath, 'utf8');
  const backupData = JSON.parse(backupRaw);

  const backupCatIds = new Set(backupData.categories.map((c: any) => c.id));
  const backupItemIds = new Set(backupData.categories.flatMap((c: any) => c.items || []).map((i: any) => i.id));

  const conflictingCategories = await prisma.menuCategory.count({
    where: {
      id: { in: Array.from(backupCatIds) as string[] },
      siteId: { not: targetSiteId },
    },
  });
  const conflictingItems = await prisma.menuItem.count({
    where: {
      id: { in: Array.from(backupItemIds) as string[] },
      siteId: { not: targetSiteId },
    },
  });
  if (conflictingCategories > 0 || conflictingItems > 0) {
    throw new Error(
      'El backup contiene IDs que pertenecen a otra sede. No se modificó ningún dato.',
    );
  }

  // 1. Desactivar todos los ítems y categorías actuales
  await prisma.menuItem.updateMany({ where: { siteId: targetSiteId }, data: { active: false } });
  await prisma.menuCategory.updateMany({ where: { siteId: targetSiteId }, data: { active: false } });

  // 2. Eliminar de la base de datos ítems que NO pertenecen a este backup (y que no estén en pedidos)
  const orderItems = await prisma.orderItem.findMany({
    where: { menuItem: { siteId: targetSiteId } },
    select: { menuItemId: true },
  });
  const usedMenuItemIds = new Set(orderItems.map(oi => oi.menuItemId).filter(Boolean));

  const itemsToDelete = await prisma.menuItem.findMany({
    where: {
      siteId: targetSiteId,
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
        siteId: targetSiteId,
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        active: true,
      },
      create: {
        id: cat.id,
        siteId: targetSiteId,
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
            siteId: targetSiteId,
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
            siteId: targetSiteId,
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
