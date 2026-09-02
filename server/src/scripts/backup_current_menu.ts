import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando copia de seguridad del menú actual...');
  
  const categories = await prisma.menuCategory.findMany({
    include: {
      items: true
    },
    orderBy: { sortOrder: 'asc' }
  });

  const backupData = {
    createdAt: new Date().toISOString(),
    totalCategories: categories.length,
    totalItems: categories.reduce((sum, c) => sum + c.items.length, 0),
    categories
  };

  const backupPath = path.join(__dirname, '..', '..', 'scratch', 'menu_backup_20260728.json');
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');

  console.log(`✅ Copia de seguridad guardada exitosamente en: ${backupPath}`);
  console.log(`Categorías respaldadas: ${categories.length}`);
  console.log(`Productos respaldados: ${backupData.totalItems}`);
}

main()
  .catch(e => {
    console.error('Error en backup:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
