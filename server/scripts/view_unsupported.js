const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Querying messages...');
  const session = await prisma.whatsAppSession.findFirst({
    where: { phone: { contains: '18668392077' } }
  });
  
  if (!session) {
    console.log('Session not found');
    return;
  }
  
  console.log('Session found:', session);
  
  const messages = await prisma.whatsAppMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  console.log('Last 10 messages:');
  console.log(JSON.stringify(messages, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
