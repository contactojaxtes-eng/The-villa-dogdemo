import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyBroadcast() {
  console.log('📊 Verificando estado de la campaña de envío masivo...');

  try {
    const totalSessions = await prisma.whatsAppSession.count();
    const totalMessages = await prisma.whatsAppMessage.count();
    
    // Status distribution
    const statusCounts = await prisma.whatsAppMessage.groupBy({
      by: ['status'],
      _count: { status: true }
    });

    console.log(`\n========================================`);
    console.log(`TOTAL CONVERSACIONES CREADAS: ${totalSessions}`);
    console.log(`TOTAL MENSAJES ENVIADOS EN BASE DE DATOS: ${totalMessages}`);
    console.log(`========================================\n`);

    console.log('Distribución de estado de entrega de Meta WhatsApp:');
    statusCounts.forEach(sc => {
      console.log(`  - Estado '${sc.status}': ${sc._count.status} mensajes`);
    });

    // Sample latest sent messages
    const latestMsgs = await prisma.whatsAppMessage.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { session: true }
    });

    console.log('\nMuestra de los últimos 5 mensajes enviados por Meta API:');
    latestMsgs.forEach((m, idx) => {
      console.log(`  #${idx + 1}: Para ${m.session.phone} | Status: ${m.status} | Content: ${m.content.slice(0, 40)}...`);
    });

  } catch (err) {
    console.error('Error verificando campaña:', err);
  } finally {
    await prisma.$disconnect();
  }
}

verifyBroadcast();
