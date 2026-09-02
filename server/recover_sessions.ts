const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const p = new PrismaClient();

async function recoverMessages() {
  console.log('=== RECUPERACIÓN DE MENSAJES Y RE-ACTIVACIÓN DE CHATS ===');

  // 1. Check all sessions in DB that have messages but active: false or dormant
  const sessions = await p.whatsAppSession.findMany({
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }
  });

  console.log(`Total sesiones en la base de datos: ${sessions.length}`);

  let reactivatedCount = 0;
  for (const s of sessions) {
    if (!s.active && s.messages && s.messages.length > 0) {
      reactivatedCount++;
      await p.whatsAppSession.update({
        where: { id: s.id },
        data: { active: true, lastMessageAt: s.messages[0].createdAt }
      });
    }
  }

  console.log(`\n✅ Sesiones reactivadas automáticamente: ${reactivatedCount}`);

  // 2. Inspect whatsapp-incoming-msg.json if present
  const incomingFile = path.join(process.cwd(), 'whatsapp-incoming-msg.json');
  if (fs.existsSync(incomingFile)) {
    const raw = fs.readFileSync(incomingFile, 'utf8');
    console.log(`\n📄 whatsapp-incoming-msg.json encontrado (${(raw.length / 1024).toFixed(1)} KB)`);
  } else {
    console.log('\nNo hay whatsapp-incoming-msg.json local.');
  }

  // 3. Count total INCOMING messages saved in DB
  const totalInMsgs = await p.whatsAppMessage.count({ where: { direction: 'IN' } });
  console.log(`\n💬 Total mensajes ENTRANTES guardados en la DB: ${totalInMsgs}`);

  await p.$disconnect();
}

recoverMessages().catch(e => console.error(e));
