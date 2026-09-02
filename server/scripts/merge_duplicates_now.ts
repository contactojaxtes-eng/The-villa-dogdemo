import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  console.log('--- Limpieza y Fusión de Sesiones Duplicadas ---');

  // Buscar sesiones donde phone es un ID de Meta (longitud >= 14)
  const metaSessions = await prisma.whatsAppSession.findMany({
    where: {
      phone: { not: { startsWith: '3' } },
      active: true,
    },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 5 }
    }
  });

  for (const mSess of metaSessions) {
    if (mSess.phone.length < 14 && !mSess.phone.startsWith('@')) continue;

    const isGenericName = !mSess.customerName || mSess.customerName.length < 3 || mSess.customerName === '.' || mSess.customerName.startsWith('@') || mSess.customerName.toLowerCase() === 'cliente';

    // Buscar pedidos asociados a este cliente
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          ...(!isGenericName ? [{ customerName: { equals: mSess.customerName, mode: 'insensitive' as const } }] : []),
          { chatSessionId: mSess.id },
          ...(mSess.customerPhone ? [{ customerPhone: mSess.customerPhone }] : [])
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    if (orders.length > 0) {
      const bestOrder = orders[0];
      const realPhone = bestOrder.customerPhone;
      console.log(`Found Meta session ${mSess.id} (${mSess.customerName}, Meta ID: ${mSess.phone}) linked to order #${bestOrder.orderNumber} with real phone: ${realPhone}`);

      // Actualizar sesión principal con su teléfono real
      if (realPhone && realPhone.length >= 7 && realPhone !== '3000000000') {
        const cleanP = realPhone.replace(/\D/g, '');
        const p10 = (cleanP.length === 12 && cleanP.startsWith('57')) ? cleanP.slice(2) : cleanP;
        await prisma.whatsAppSession.update({
          where: { id: mSess.id },
          data: { customerPhone: p10 }
        });

        // Actualizar pedidos para vincular su chatSessionId
        await prisma.order.updateMany({
          where: {
            OR: [
              { customerPhone: realPhone },
              { customerPhone: p10 },
              { customerPhone: `57${p10}` }
            ]
          },
          data: { chatSessionId: mSess.id }
        });

        // Buscar si se creó una sesión duplicada con el número de teléfono como phone
        const duplicateSessions = await prisma.whatsAppSession.findMany({
          where: {
            id: { not: mSess.id },
            OR: [
              { phone: p10 },
              { phone: `57${p10}` },
              { phone: `+57${p10}` },
              { phone: realPhone }
            ]
          }
        });

        for (const dup of duplicateSessions) {
          console.log(`  -> Fusionando sesión duplicada ${dup.id} (phone=${dup.phone}) dentro de la principal ${mSess.id}`);
          // Mover mensajes de la duplicada a la principal
          await prisma.whatsAppMessage.updateMany({
            where: { sessionId: dup.id },
            data: { sessionId: mSess.id }
          });
          // Eliminar la sesión duplicada
          await prisma.whatsAppSession.delete({
            where: { id: dup.id }
          });
        }
      }
    }
  }

  console.log('--- Limpieza completada con éxito ---');
  await prisma.$disconnect();
}

main().catch(console.error);
