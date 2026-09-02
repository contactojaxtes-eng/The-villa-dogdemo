import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phones = ['573188941170', '3188941170', '3002332588', '573002332588', '3128622227', '573128622227', '3045384558'];

  console.log('--- INSPECCIÓN DE MENSAJES Y SESIONES ---');
  
  const sessions = await prisma.whatsAppSession.findMany({
    where: {
      OR: [
        { phone: { in: phones } },
        { customerPhone: { in: phones } },
        { customerName: { in: ['Maripaz Naranjo', 'maira henao', 'JM'] } }
      ]
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 5
      }
    }
  });

  for (const s of sessions) {
    console.log(`\n========================================`);
    console.log(`Session ID: ${s.id}`);
    console.log(`Name: ${s.customerName} | Phone: ${s.phone} | customerPhone: ${s.customerPhone}`);
    console.log(`Session lastMessageAt: ${s.lastMessageAt.toISOString()} (Local: ${s.lastMessageAt.toString()})`);
    console.log(`Mensajes (${s.messages.length} recientes):`);
    for (const m of s.messages) {
      console.log(`  [${m.direction}] ${m.createdAt.toISOString()} (Local: ${m.createdAt.toString()}) - [${m.status}] "${m.content.slice(0, 50)}"`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
