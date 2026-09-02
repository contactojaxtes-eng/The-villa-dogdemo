const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

async function run() {
  console.log('=== AUDITORÍA DE SESIONES DUPLICADAS Y MENSAJES ATASCADOS ===');

  const allSessions = await p.whatsAppSession.findMany({
    select: { id: true, phone: true, customerName: true, lastMessageAt: true, active: true }
  });

  const phoneMap = new Map();
  allSessions.forEach((s: any) => {
    const clean = (s.phone || '').replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (!phoneMap.has(p10)) phoneMap.set(p10, []);
    phoneMap.get(p10).push(s);
  });

  let duplicateCount = 0;
  console.log('\n--- Sesiones duplicadas encontradas ---');
  for (const [phone10, list] of phoneMap.entries()) {
    if (list.length > 1) {
      duplicateCount++;
      if (duplicateCount <= 10) {
        console.log(`Teléfono 10d: ${phone10} tiene ${list.length} sesiones:`);
        list.forEach((item: any) => {
          console.log(`   - ID: ${item.id} | Phone exacto: "${item.phone}" | Nombre: "${item.customerName}" | LastMsg: ${item.lastMessageAt?.toISOString()} | Active: ${item.active}`);
        });
      }
    }
  }
  console.log(`Total números con sesiones DUPLICADAS en DB: ${duplicateCount}`);

  // Check incoming messages in the last 24 hours
  const today = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentIncoming = await p.whatsAppMessage.findMany({
    where: { direction: 'IN', createdAt: { gte: today } },
    include: { session: true },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\nMensajes entrantes en las últimas 24 horas: ${recentIncoming.length}`);
  
  const inactiveSessionMsgs = recentIncoming.filter((m: any) => !m.session?.active);
  console.log(`Mensajes entrantes vinculados a sesiones INACTIVAS: ${inactiveSessionMsgs.length}`);
  if (inactiveSessionMsgs.length > 0) {
    inactiveSessionMsgs.slice(0, 5).forEach((m: any) => {
      console.log(`  - Msg ID: ${m.id} | Session Phone: ${m.session?.phone} | Content: "${m.content}" | Date: ${m.createdAt.toISOString()}`);
    });
  }

  await p.$disconnect();
}

run().catch((e: any) => console.error(e));
