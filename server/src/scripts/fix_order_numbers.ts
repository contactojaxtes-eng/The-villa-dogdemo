import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixOrderNumbers() {
  console.log('🔧 Corrigiendo números de pedido #1, #2, #3, #4 -> #57, #58, #59, #60...');

  // Buscar pedidos creados el 29/07/2026 entre las 12:00 AM y la 1:00 AM con orderNumber 1, 2, 3, 4
  const start = new Date('2026-07-29T00:00:00.000-05:00');
  const end = new Date('2026-07-29T01:00:00.000-05:00');

  const ordersToFix = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      orderNumber: { in: [1, 2, 3, 4] },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Encontrados ${ordersToFix.length} pedidos para reasignar número de secuencia:`);

  const numberMap: Record<number, number> = {
    1: 57,
    2: 58,
    3: 59,
    4: 60,
  };

  for (const ord of ordersToFix) {
    const newNum = numberMap[ord.orderNumber];
    if (newNum) {
      await prisma.order.update({
        where: { id: ord.id },
        data: { orderNumber: newNum },
      });
      console.log(`✅ Pedido ID ${ord.id} (${ord.customerName}) cambiado de #${ord.orderNumber} -> #${newNum}`);
    }
  }

  console.log('🚀 ¡Secuencia de pedidos actualizada correctamente!');
}

fixOrderNumbers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
