import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const allActive = await prisma.whatsAppSession.count({ where: { active: true } });
  
  const allActiveIds = await prisma.whatsAppSession.findMany({ where: { active: true }, select: { id: true, phone: true } });
  
  const uniquePhones = new Set();
  allActiveIds.forEach(s => {
    const cleanDigits = (s.phone || '').replace(/\D/g, '');
    const phone10 = cleanDigits.length === 12 && cleanDigits.startsWith('57') ? cleanDigits.slice(2) : cleanDigits;
    uniquePhones.add(phone10);
  });
  
  console.log("Total Active Sessions in DB:", allActive);
  console.log("Unique Active Phones:", uniquePhones.size);
}

main().finally(() => prisma.$disconnect());
