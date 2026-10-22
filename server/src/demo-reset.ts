import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runDemoSeed } from './demo-seed';

// ============================================================================
// GUARDAS DE SEGURIDAD OBLIGATORIAS
// ============================================================================
if (process.env.APP_ENV !== 'demo') {
  console.error('⛔ SEGURIDAD: demo-reset abortado. APP_ENV no es "demo".');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';
if ((!dbUrl.toLowerCase().includes('demo') && !dbUrl.toLowerCase().includes('neon.tech'))) {
  console.error('⛔ SEGURIDAD: demo-reset abortado. DATABASE_URL no apunta a una base demo.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 [DEMO RESET] Reiniciando entorno de demostración con datos sintéticos limpios...');

  // Limpieza ordenada de tablas en la base demo
  await prisma.whatsAppMessage.deleteMany();
  await prisma.whatsAppSession.deleteMany();
  await prisma.whatsAppAccount.deleteMany();
  await prisma.kitchenTicketItem.deleteMany();
  await prisma.kitchenTicket.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.diningTable.deleteMany();
  await prisma.cashClosing.deleteMany();
  await prisma.cashRegister.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.kitchenStation.deleteMany();
  await prisma.deliveryZone.deleteMany();
  await prisma.userSiteMembership.deleteMany();
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'admin@demo.local',
          'cajero@demo.local',
          'mesero@demo.local',
          'cocina@demo.local',
          'domicilios@demo.local',
        ],
      },
    },
  });

  console.log('🧹 Tablas operativas limpias.');

  // Volver a sembrar los datos sintéticos frescos
  await runDemoSeed();

  console.log('✨ [DEMO RESET COMPLETADO] Entorno restaurado al estado ideal de demostración.');
}

main()
  .catch(err => {
    console.error('Error durante el reset de la demo:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
