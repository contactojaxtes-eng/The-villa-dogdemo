import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  
  // Find sessions assigned to cashier or inactive for > 15m
  const res = await prisma.whatsAppSession.updateMany({
    where: {
      active: true,
      assignedToId: { not: null },
      lastMessageAt: { lt: fifteenMinutesAgo },
    },
    data: {
      assignedToId: null,
      waitingForAdvisor: false,
    }
  });

  console.log(`Successfully released ${res.count} stale assigned WhatsApp sessions.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
