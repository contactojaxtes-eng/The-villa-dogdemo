import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Let's find sessions that have orders or interesting conversations with IDs / @ / CO.
  const sessions = await prisma.whatsAppSession.findMany({
    where: {
      OR: [
        { customerName: { startsWith: '@' } },
        { phone: { startsWith: 'CO.' } },
        { phone: { startsWith: '4' } },
        { phone: { startsWith: '1' } },
        { phone: { startsWith: '2' } }
      ]
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 8
      }
    },
    take: 15
  });

  for (const s of sessions) {
    console.log('\n======================================================');
    console.log(`SESSION: phone="${s.phone}" | customerName="${s.customerName}" | customerPhone="${s.customerPhone || 'NULL'}"`);
    console.log(`MESSAGES (newest first, count: ${s.messages.length}):`);
    for (const m of s.messages) {
      console.log(`  [${m.direction} ${m.createdAt.toISOString().slice(0,16)}] ${m.content.replace(/\n/g, ' ')}`);
    }
  }

  // Also let's check recent orders to see what customerPhone was recorded on them
  console.log('\n================ RECENT ORDERS ================');
  const recentOrders = await prisma.order.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerPhone: true,
      customerAddress: true,
      status: true,
      createdAt: true
    }
  });

  for (const o of recentOrders) {
    console.log(`ORDER #${o.orderNumber}: name="${o.customerName}" | phone="${o.customerPhone}" | address="${o.customerAddress}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
