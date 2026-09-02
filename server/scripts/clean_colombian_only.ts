import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('=== VERIFICANDO QUE SOLO SE GUARDEN NÚMEROS COLOMBIANOS (3XXXXXXXXX) ===');

  // Find any customerPhone that does not start with 3 or is not 10 digits
  const allSessions = await prisma.whatsAppSession.findMany({
    where: { customerPhone: { not: null } },
    select: { id: true, phone: true, customerName: true, customerPhone: true }
  });

  let invalidCount = 0;
  for (const s of allSessions) {
    const cp = s.customerPhone || '';
    const clean = cp.replace(/\D/g, '');
    const isCol10 = clean.length === 10 && clean.startsWith('3');
    const isCol12 = clean.length === 12 && clean.startsWith('573');
    
    if (isCol12) {
      await prisma.whatsAppSession.update({
        where: { id: s.id },
        data: { customerPhone: clean.slice(2) }
      });
    } else if (!isCol10) {
      await prisma.whatsAppSession.update({
        where: { id: s.id },
        data: { customerPhone: null }
      });
      invalidCount++;
      console.log(`🧹 Limpiado ID/número no colombiano: [${s.customerName}] phone="${s.phone}" cp="${s.customerPhone}"`);
    }
  }

  console.log(`Total limpiados (no eran números colombianos 3XXXXXXXXX): ${invalidCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
