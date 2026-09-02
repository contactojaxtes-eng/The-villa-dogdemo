import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const atSessions = await prisma.whatsAppSession.findMany({
    where: {
      OR: [
        { customerName: { startsWith: '@' } },
        { customerName: { contains: '@' } },
        { phone: { startsWith: 'CO.' } },
        { phone: { startsWith: '4' } },
        { phone: { startsWith: '1' } }
      ]
    },
    take: 20
  });

  console.log('Sample Sessions:');
  for (const s of atSessions) {
    console.log('Name: ' + s.customerName + ' | Phone: ' + s.phone + ' | CustPhone: ' + (s.customerPhone || 'NULL'));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
