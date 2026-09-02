import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  console.log('Adding column chatSessionId to orders table in PostgreSQL...');
  await prisma.$executeRawUnsafe(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "chatSessionId" TEXT;`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "orders_chatSessionId_idx" ON "orders"("chatSessionId");`);
  console.log('Column and index created successfully!');
  await prisma.$disconnect();
}

main().catch(console.error);
