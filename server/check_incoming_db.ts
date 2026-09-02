const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function checkIncomingMessages() {
  console.log('=== VERIFICANDO ÚLTIMOS MENSAJES ENTRANTES EN LA BASE DE DATOS ===');
  
  // Get last 20 INCOMING messages
  const incoming = await p.whatsAppMessage.findMany({
    where: { direction: 'IN' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { session: { select: { phone: true, customerName: true } } }
  });

  console.log(`Encontrados ${incoming.length} mensajes entrantes recientes:`);
  for (const m of incoming) {
    console.log(`[${m.createdAt.toISOString()}] ${m.session?.customerName} (${m.session?.phone}): "${m.content}" (type: ${m.messageType})`);
  }

  // Check count of incoming messages received TODAY (August 12, 2026)
  const today = new Date('2026-08-12T00:00:00.000Z');
  const countToday = await p.whatsAppMessage.count({
    where: { direction: 'IN', createdAt: { gte: today } }
  });
  console.log(`\nTotal mensajes ENTRANTES recibidos hoy (12 Ago): ${countToday}`);

  // Check last 5 sessions updated
  const recentSessions = await p.whatsAppSession.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: 10,
    select: { id: true, phone: true, customerName: true, lastMessageAt: true, active: true }
  });
  console.log('\nÚltimas 10 sesiones actualizadas:');
  for (const s of recentSessions) {
    console.log(`- ${s.customerName} (${s.phone}) | Último mensaje: ${s.lastMessageAt?.toISOString()} | Active: ${s.active}`);
  }

  await p.$disconnect();
}

checkIncomingMessages().catch(e => console.error(e));
