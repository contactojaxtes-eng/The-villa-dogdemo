import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const msgs = await prisma.whatsAppMessage.findMany({
    where: { direction: 'OUT' },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.log('--- ULTIMOS 5 MENSAJES SALIENTES ---');
  for (const m of msgs) {
    console.log(`[${m.createdAt.toISOString()}] ID: ${m.id} | Status: "${m.status}" | waMessageId: ${m.waMessageId} | Content: "${m.content}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
