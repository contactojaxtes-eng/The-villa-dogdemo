import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ids = ['1723718208911748', '1746490179773926', '2886150991742872'];
  for (const id of ids) {
    const s = await prisma.whatsAppSession.findFirst({
      where: { phone: { contains: id } },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 15 }
      }
    });

    console.log('================================================');
    console.log('SESSION for', id, ':', s?.customerName, '| customerPhone:', (s as any)?.customerPhone);
    if (s) {
      for (const m of s.messages) {
        console.log('  [' + m.direction + ' ' + m.createdAt.toISOString().slice(0, 16) + '] ' + m.content.replace(/\n/g, ' '));
      }
      // Check orders matching customerName or phone
      const orders = await prisma.order.findMany({
        where: {
          OR: [
            { customerName: { contains: s.customerName?.slice(0, 10) || '___', mode: 'insensitive' } },
            { customerPhone: { contains: id } }
          ]
        },
        take: 5
      });
      console.log('  Matching orders:');
      for (const o of orders) {
        console.log('    Order #' + o.orderNumber + ' | phone: ' + o.customerPhone + ' | name: ' + o.customerName + ' | addr: ' + o.customerAddress);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
