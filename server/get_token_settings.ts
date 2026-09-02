import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const settings = await prisma.appSetting.findMany();
  console.log(settings.filter(s => s.key.includes('whatsapp') || s.key.includes('token')));
}
main().finally(() => prisma.$disconnect());
