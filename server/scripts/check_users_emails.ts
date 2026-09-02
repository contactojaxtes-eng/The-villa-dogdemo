import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  console.log('--- USUARIOS EN BASE DE DATOS ---');
  console.log(users);
}

main().finally(() => prisma.$disconnect());
