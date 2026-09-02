import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const latency = Date.now() - t0;

  const t1 = Date.now();
  const orders = await prisma.order.count();
  const customers = await prisma.customer.count();
  const messages = await prisma.whatsAppMessage.count();
  const dtStats = Date.now() - t1;

  console.log('--- RENDIMIENTO REAL DE AIVEN POSTGRESQL ---');
  console.log(`Ping / Latencia simple: ${latency} ms`);
  console.log(`Consulta de conteos (Orders: ${orders}, Customers: ${customers}, Messages: ${messages}): ${dtStats} ms`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
