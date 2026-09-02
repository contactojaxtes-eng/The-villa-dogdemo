const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const chatbotSetting = await prisma.appSetting.findUnique({ where: { key: 'chatbot_enabled' } });
    console.log('chatbot_enabled:', chatbotSetting?.value ?? '(not set - defaults to true)');

    const sessions = await prisma.whatsAppSession.findMany({
      where: { active: true },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 5,
    });

    console.log(`\nActive Sessions: ${sessions.length}`);
    for (const s of sessions) {
      console.log(`\nPhone: ${s.phone} | Name: ${s.customerName} | assignedToId: ${s.assignedToId || 'null'} | lastMsg: ${s.lastMessageAt}`);
      for (const m of s.messages) {
        console.log(`  [${m.direction}] ${m.messageType}: ${(m.content || '').substring(0, 60)} | status: ${m.status} | ${m.createdAt}`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
