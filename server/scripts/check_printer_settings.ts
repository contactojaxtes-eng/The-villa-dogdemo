import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const printerSettings = await prisma.appSetting.findMany({
    where: { key: { contains: 'print' } }
  });
  console.log('=== APP SETTINGS DE IMPRESORAS ===');
  for (const s of printerSettings) {
    console.log(`${s.key} = ${s.value}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
