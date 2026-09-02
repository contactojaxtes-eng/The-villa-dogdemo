import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAllSessions() {
  console.log('🧹 Eliminando todas las conversaciones activas (WhatsAppSession)...');

  try {
    // First delete all messages just in case
    await prisma.whatsAppMessage.deleteMany({});
    
    // Delete all sessions
    const deletedSessions = await prisma.whatsAppSession.deleteMany({});
    
    console.log(`✓ Eliminadas ${deletedSessions.count} conversaciones activas.`);
    console.log('✔ El panel izquierdo de CONVERSACIONES ACTIVAS ahora está en 0 y 100% limpio.');
  } catch (err) {
    console.error('Error eliminando sesiones:', err);
  } finally {
    await prisma.$disconnect();
  }
}

clearAllSessions();
