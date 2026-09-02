import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetSystemToZero() {
  console.log('Reiniciando sistema The Villa Dog a cero...');

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

  console.log('Sistema listo para arrancar limpio.');
  console.log('Productos: 0');
  console.log('Categorias de menu: 0');
  console.log('Ingredientes e inventario: 0');
  console.log('Usuarios, roles, cajas, zonas y configuracion: intactos.');
}

resetSystemToZero()
  .catch((error) => {
    console.error('Error al reiniciar el sistema:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
