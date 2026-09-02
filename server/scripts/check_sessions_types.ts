import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.whatsAppSession.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    include: {
      messages: {
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { waMessageId: true, content: true, direction: true, messageType: true, createdAt: true }
      }
    }
  });

  console.log(`Total analizadas: ${sessions.length}`);
  for (const s of sessions) {
    const raw = (s.phone || '').trim();
    const clean = raw.replace(/\D/g, '');
    const isSpecial = raw.startsWith('CO.') || raw.includes('@') || clean.length > 12 || (s.customerName && s.customerName.includes('@'));
    if (isSpecial) {
      console.log('\n==============================');
      console.log(`Session: ${s.id}`);
      console.log(`Phone (DB): "${s.phone}" | Name: "${s.customerName}"`);
      console.log('Messages:');
      for (const m of s.messages) {
        console.log(`  [${m.direction}] (${m.messageType}) wamid: ${m.waMessageId} -> "${m.content.slice(0, 70)}"`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
