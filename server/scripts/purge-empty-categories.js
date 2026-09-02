const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.menuCategory.deleteMany({
    where: {
      items: { none: {} },
      name: { in: ['jose', 'perros grandes'], mode: 'insensitive' }
    }
  });
  console.log(`✅ Se eliminaron ${result.count} categorías vacías de prueba.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
