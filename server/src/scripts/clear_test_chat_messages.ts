import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearTestMessages() {
  console.log('🧹 Limpiando historial de mensajes de prueba de WhatsApp...');

  try {
    const deletedMsgs = await prisma.whatsAppMessage.deleteMany({});
    console.log(`✓ Eliminados ${deletedMsgs.count} mensajes del historial de chat.`);

    // Also update WhatsAppSession lastMessage text if needed
    await prisma.whatsAppSession.updateMany({
      data: {
        lastMessageAt: new Date(),
        waitingForAdvisor: false
      }
    });

    console.log('✔ Chats limpiados con éxito. El panel de chat está 100% limpio y listo para enviar la plantilla.');
  } catch (err) {
    console.error('Error limpiando mensajes:', err);
  } finally {
    await prisma.$disconnect();
  }
}

clearTestMessages();
