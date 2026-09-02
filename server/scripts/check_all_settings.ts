import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const allSettings = await prisma.appSetting.findMany();
  console.log('=== TODOS LOS APP SETTINGS EN DB ===');
  for (const s of allSettings) {
    console.log(`${s.key} = ${s.value}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
