import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetSystemToZero() {
  console.log('🧹 Reiniciando sistema a CERO (Pedidos, Ventas, Cajas, Chats y Métricas)...');

  // 1. Eliminar movimientos de inventario asociados a pedidos
  await prisma.stockMovement.deleteMany({});
  console.log('✅ Movimientos de inventario limpios.');

  // 2. Eliminar pagos y detalles de pedidos
  await prisma.payment.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  console.log('✅ Pedidos, ventas e ítems eliminados por completo.');

  // 3. Eliminar chats de WhatsApp (mensajes y sesiones)
  await prisma.whatsAppMessage.deleteMany({});
  await prisma.whatsAppSession.deleteMany({});
  console.log('✅ Historial de chats de WhatsApp reiniciado.');

  // 4. Eliminar cierres y aperturas de caja
  await prisma.cashClosing.deleteMany({});
  await prisma.customerPayment.deleteMany({});
  await prisma.expense.deleteMany({});
  console.log('✅ Cajas registradoras liberadas (Arqueos y cierres en 0).');

  // 5. Eliminar trabajos de impresión, métricas y registros de turnos/notificaciones
  await prisma.printJob.deleteMany({});
  await prisma.waiterMetric.deleteMany({});
  await prisma.waiterBadge.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.errorLog.deleteMany({});
  console.log('✅ Notificaciones, impresiones y métricas reiniciadas.');

  console.log('🚀 ¡SISTEMA LISTO PARA UTILIZAR DESDE CERO!');
  console.log('📌 Productos e Ingredientes: Intactos (359 productos, 32 categorías).');
  console.log('📌 Usuarios y Configuración: Intactos.');
}

resetSystemToZero()
  .catch((e) => {
    console.error('❌ Error al reiniciar el sistema:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
