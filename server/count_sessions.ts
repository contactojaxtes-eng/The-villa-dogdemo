import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.whatsAppSession.count({ where: { active: true } });
  console.log('Total active sessions in DB:', total);

  // Unread messages count
  const unreadMessages = await prisma.whatsAppMessage.count({
    where: { direction: 'IN', status: { not: 'read' } }
  });
  console.log('Total unread messages in DB:', unreadMessages);
}

main().catch(console.error).finally(() => prisma.$disconnect());
