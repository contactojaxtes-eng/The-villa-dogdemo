import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const sessions = await prisma.whatsAppSession.findMany({
    where: { active: true },
    include: {
      _count: { select: { messages: true } },
      messages: { take: 2, orderBy: { createdAt: 'desc' } }
    },
    orderBy: { lastMessageAt: 'desc' }
  });

  console.log('Total active sessions:', sessions.length);
  for (const s of sessions.slice(0, 20)) {
    console.log(`Session ${s.id}: phone="${s.phone}", customerPhone="${s.customerPhone}", name="${s.customerName}", msgs=${s._count.messages}, lastMsg="${s.messages[0]?.content?.substring(0, 40)}"`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
