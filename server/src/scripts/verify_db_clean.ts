import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verify() {
  const catTotal = await prisma.menuCategory.count();
  const catActive = await prisma.menuCategory.count({ where: { active: true } });
  const itemTotal = await prisma.menuItem.count();
  const itemActive = await prisma.menuItem.count({ where: { active: true } });

  console.log(`📊 TOTAL Categorías en DB: ${catTotal} (Activas: ${catActive})`);
  console.log(`📊 TOTAL Productos en DB: ${itemTotal} (Activos: ${itemActive})`);
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
