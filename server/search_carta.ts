const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function searchCarta() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const msgs = await p.whatsAppMessage.findMany({
    where: {
      direction: 'IN',
      createdAt: { gte: twoHoursAgo },
      content: { contains: 'carta', mode: 'insensitive' }
    },
    orderBy: { createdAt: 'desc' },
    include: { session: { select: { phone: true, customerName: true } } }
  });

  console.log('=== MENSAJES CON "carta" EN LAS ÚLTIMAS 2 HORAS ===');
  console.log(JSON.stringify(msgs, null, 2));

  await p.$disconnect();
}

searchCarta().catch(e => console.error(e));
