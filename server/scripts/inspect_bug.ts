import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const sessions = await prisma.whatsAppSession.findMany({
    where: {
      OR: [
        { customerName: { contains: 'DL' } },
        { phone: { contains: 'DL' } },
        { customerPhone: { contains: '3000000000' } }
      ]
    },
    take: 10
  });
  console.log('SESSIONS FOUND:', JSON.stringify(sessions.map(s => ({
    id: s.id,
    phone: s.phone,
    customerPhone: s.customerPhone,
    customerName: s.customerName
  })), null, 2));

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { customerName: { contains: 'DL' } },
        { customerPhone: '3000000000' }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log('ORDERS FOUND:', JSON.stringify(orders.map(o => ({
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    customerAddress: o.customerAddress,
    status: o.status,
    createdAt: o.createdAt
  })), null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
