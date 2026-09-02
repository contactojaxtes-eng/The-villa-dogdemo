const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Unassign the session for phone 573215580510 so chatbot can respond
  const result = await prisma.whatsAppSession.updateMany({
    where: { phone: '573215580510' },
    data: { assignedToId: null },
  });
  console.log('Updated sessions:', result.count);
  
  // Verify
  const session = await prisma.whatsAppSession.findUnique({ where: { phone: '573215580510' } });
  console.log('Session now:', {
    phone: session.phone,
    assignedToId: session.assignedToId,
    customerName: session.customerName,
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
