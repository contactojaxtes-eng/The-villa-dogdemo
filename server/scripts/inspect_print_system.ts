import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('=== INSPECCIONANDO COLA DE IMPRESION RECIENTE ===');
  
  // 1. Settings de impresoras
  const settings = await prisma.appSetting.findMany({
    where: {
      key: { in: ['printer_kitchen_ip', 'printer_pizza_ip', 'printer_bar_ip', 'printer_enabled', 'printer_service_status'] }
    }
  });
  console.log('Ajustes de impresoras en DB:', settings);

  // 2. Ultimos 15 print jobs
  const jobs = await (prisma as any).printJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15
  });
  console.log(`Total trabajos recientes encontrados: ${jobs.length}`);
  for (const j of jobs) {
    console.log(`[Job #${j.id}] Fecha: ${j.createdAt.toISOString()} | Tipo: ${j.tipo} | Estacion: ${j.estacion} | IP: ${j.ipDestino} | Estado: ${j.estado} | Intentos: ${j.intentos} | Error: ${j.error || 'Ninguno'}`);
  }

  // 3. Conteo de trabajos por estado
  const byStatus = await (prisma as any).printJob.groupBy({
    by: ['estado'],
    _count: { id: true }
  });
  console.log('Trabajos por estado:', byStatus);
}

main().catch(console.error).finally(() => prisma.$disconnect());
