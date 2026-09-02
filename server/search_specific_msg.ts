const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function searchMessage() {
  const msgs = await p.whatsAppMessage.findMany({
    where: {
      content: { contains: 'Regálame la carta', mode: 'insensitive' }
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { session: { select: { phone: true, customerName: true, createdAt: true, active: true } } }
  });

  console.log('=== MENSAJES CON "Regálame la carta" ===');
  console.log(JSON.stringify(msgs, null, 2));

  await p.$disconnect();
}

searchMessage().catch(e => console.error(e));
