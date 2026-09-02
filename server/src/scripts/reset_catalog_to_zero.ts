import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetCatalogToZero() {
  console.log('Reiniciando The Villa Dog a cero operativo...');

  await prisma.stockMovement.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.customerPayment.deleteMany({});
  await prisma.cashClosing.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.printJob.deleteMany({});
  await prisma.whatsAppMessage.deleteMany({});
  await prisma.whatsAppSession.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.waiterBadge.deleteMany({});
  await prisma.waiterMetric.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.errorLog.deleteMany({});

  await prisma.purchaseItem.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.recipeIngredient.deleteMany({});
  await prisma.recipe.deleteMany({});
  await prisma.ingredient.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.menuItem.deleteMany({});
  await prisma.menuCategory.deleteMany({});

  console.log('Listo: productos, categorias, recetas, inventario, compras y movimientos quedaron en cero.');
  console.log('Usuarios, roles, zonas, cajas, categorias de gasto y configuracion se conservaron.');
}

resetCatalogToZero()
  .catch((error) => {
    console.error('Error al reiniciar catalogo e inventario:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
