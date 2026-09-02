import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- AUDITORÍA HISTÓRICA DE ERROR_LOGS EN THE VILLA DOG ---');
  const count = await prisma.errorLog.count();
  console.log('Total de logs de error registrados:', count);

  const recent = await prisma.errorLog.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' }
  });

  console.log('\nÚltimos 20 errores:');
  for (const log of recent) {
    console.log(`[${log.createdAt.toISOString()}] Path: ${log.method} ${log.path} | Status: ${log.statusCode}`);
    console.log(`  Mensaje: ${log.message.slice(0, 150)}`);
    console.log('--------------------------------------------------');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
