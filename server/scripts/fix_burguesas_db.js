const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.menuCategory.findMany();
  for (const cat of categories) {
    if (cat.name.toLowerCase().trim() === 'burguesas' || cat.name.toLowerCase().trim() === 'burguesa') {
      await prisma.menuCategory.update({
        where: { id: cat.id },
        data: { name: 'Hamburguesas' }
      });
      console.log(`Updated category ID ${cat.id} from "${cat.name}" to "Hamburguesas"`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
