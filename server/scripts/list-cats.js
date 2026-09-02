const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.menuCategory.findMany().then(c => {
  console.log(c.map(x => x.name));
  process.exit(0);
});
