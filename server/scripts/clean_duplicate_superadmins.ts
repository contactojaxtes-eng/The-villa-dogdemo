import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- LIMPIANDO CUENTAS SUPERADMIN DUPLICADAS Y DE PRUEBA ---');

  // 1. Eliminar cuentas temporales o inactivas
  const deletedTemp = await prisma.user.deleteMany({
    where: {
      OR: [
        { email: 'temp_admin@thevilladog.local' },
        { email: 'superusuario' },
        { email: { startsWith: 'deleted_' } },
      ],
    },
  });
  console.log(`Cuentas de prueba eliminadas: ${deletedTemp.count}`);

  // 2. Verificar usuarios restantes
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  console.log('--- USUARIOS FINALES ACTIVOS ---');
  console.log(users);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
