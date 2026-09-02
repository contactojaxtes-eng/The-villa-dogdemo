const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const url = 'http://localhost:5173/menu';
  await prisma.appSetting.upsert({
    where: { key: 'digital_menu_url' },
    update: { value: url },
    create: { key: 'digital_menu_url', value: url },
  });
  console.log('URL de menú digital actualizada a:', url);
}

main().catch(console.error).finally(() => prisma.$disconnect());
