import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.whatsAppSession.findMany({
    where: { assignedToId: { not: null } },
    include: { assignedTo: { select: { id: true, name: true, role: true } } }
  });

  console.log(`Total assigned sessions currently in DB: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`Session ${s.phone} (${s.customerName}) -> Assigned to: ${s.assignedTo?.name} (${s.assignedTo?.role}) | Last Msg: ${s.lastMessageAt}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
