const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check chatbot_enabled setting
  const chatbotSetting = await prisma.appSetting.findUnique({ where: { key: 'chatbot_enabled' } });
  console.log('chatbot_enabled:', chatbotSetting?.value ?? '(not set - defaults to true)');

  // Check all active sessions
  const sessions = await prisma.whatsAppSession.findMany({
    where: { active: true },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 3 },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  console.log(`\n--- Active Sessions (${sessions.length}) ---`);
  for (const s of sessions) {
    console.log(`\nPhone: ${s.phone}`);
    console.log(`  customerName: ${s.customerName}`);
    console.log(`  assignedToId: ${s.assignedToId || '(none)'}`);
    console.log(`  lastMessageAt: ${s.lastMessageAt}`);
    console.log(`  Last messages:`);
    for (const m of s.messages) {
      console.log(`    [${m.direction}] ${m.messageType}: ${m.content?.substring(0, 80)} (${m.createdAt})`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
