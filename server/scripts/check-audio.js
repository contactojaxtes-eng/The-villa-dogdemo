const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get last audio messages sent to 573215580510
  const audioMessages = await prisma.whatsAppMessage.findMany({
    where: {
      session: { phone: '573215580510' },
      messageType: 'audio',
      direction: 'OUT',
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log(`Audio messages sent to José Martinez (${audioMessages.length}):`);
  for (const m of audioMessages) {
    console.log(`  waMessageId: ${m.waMessageId}`);
    console.log(`  content (mediaId): ${m.content}`);
    console.log(`  status: ${m.status}`);
    console.log(`  createdAt: ${m.createdAt}`);
    console.log('');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
