import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- SINCRONIZANDO LAST_MESSAGE_AT DE SESIONES DE WHATSAPP ---');
  
  // Ejecutar update SQL directo para poner lastMessageAt = MAX(messages.createdAt)
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "whatsapp_sessions" s
    SET "lastMessageAt" = sub.max_created
    FROM (
      SELECT "sessionId", MAX("createdAt") as max_created
      FROM "whatsapp_messages"
      GROUP BY "sessionId"
    ) sub
    WHERE s."id" = sub."sessionId"
      AND sub.max_created IS NOT NULL
      AND s."lastMessageAt" > sub.max_created;
  `);

  console.log(`✅ Sesiones sincronizadas con la hora real de su último mensaje: ${result}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
