import { PrismaClient } from '@prisma/client';
import { MONTERIA_BARRIOS } from './src/zones/monteria-barrios';

const prisma = new PrismaClient();

async function main() {
  let created = 0;
  let updated = 0;
  for (const barrio of MONTERIA_BARRIOS) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { name: { equals: barrio.name, mode: 'insensitive' } },
    });
    if (existing) {
      await prisma.deliveryZone.update({
        where: { id: existing.id },
        data: { rate: barrio.rate, zoneGroup: barrio.zoneGroup, active: true },
      });
      updated++;
    } else {
      await prisma.deliveryZone.create({
        data: {
          name: barrio.name,
          zoneGroup: barrio.zoneGroup,
          rate: barrio.rate,
          active: true,
        },
      });
      created++;
    }
  }
  console.log(`Seeded barrios: ${created} creados, ${updated} actualizados. Total en archivo: ${MONTERIA_BARRIOS.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
