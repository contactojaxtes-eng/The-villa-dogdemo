import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const recentMsgs = await prisma.whatsAppMessage.findMany({
    take: 25,
    orderBy: { createdAt: 'desc' },
    include: {
      session: {
        select: {
          id: true,
          phone: true,
          customerName: true
        }
      }
    }
  });

  console.log("=== 25 MOST RECENT MESSAGES ===");
  for (const m of recentMsgs) {
    console.log(`[${m.direction}] [${m.status}] [${m.createdAt.toISOString()}] | Customer: "${m.session?.customerName}" (${m.session?.phone}) | Type: ${m.messageType}`);
    console.log(`  waId: ${m.waMessageId}`);
    console.log(`  Content: ${m.content?.slice(0, 100)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
