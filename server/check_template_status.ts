const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const today = new Date('2026-08-12T00:00:00.000Z');
  
  const templateMsgsToday = await p.whatsAppMessage.findMany({
    where: { messageType: 'template', direction: 'OUT', createdAt: { gte: today } },
    select: { status: true }
  });
  
  const statusCount: Record<string, number> = {};
  for (const m of templateMsgsToday) {
    statusCount[m.status] = (statusCount[m.status] || 0) + 1;
  }
  
  console.log('=== ESTADO DE PLANTILLAS ENVIADAS HOY ===');
  console.log(JSON.stringify(statusCount, null, 2));
  console.log('Total plantillas hoy:', templateMsgsToday.length);

  // Check a few with delivered/read status
  const delivered = await p.whatsAppMessage.findMany({
    where: { messageType: 'template', direction: 'OUT', createdAt: { gte: today }, status: { in: ['delivered', 'read'] } },
    take: 5,
    include: { session: { select: { phone: true } } }
  });
  console.log('\nEjemplos de ENTREGADOS/LEÍDOS:', delivered.length);
  for (const d of delivered) {
    console.log(`  ${d.session?.phone} -> ${d.status}`);
  }

  // Check the first batch sent (before today's new sends)
  const allTimeStatuses = await p.whatsAppMessage.findMany({
    where: { messageType: 'template', direction: 'OUT' },
    select: { status: true }
  });
  const allStatusCount: Record<string, number> = {};
  for (const m of allTimeStatuses) {
    allStatusCount[m.status] = (allStatusCount[m.status] || 0) + 1;
  }
  console.log('\n=== ESTADO DE TODAS LAS PLANTILLAS ENVIADAS (TOTAL HISTÓRICO) ===');
  console.log(JSON.stringify(allStatusCount, null, 2));

  await p.$disconnect();
}

run().catch(e => console.error(e));
