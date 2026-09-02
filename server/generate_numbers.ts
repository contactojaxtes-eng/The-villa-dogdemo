const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

async function run() {
  // 1. Get excluded phones
  const templateMsgs = await p.whatsAppMessage.findMany({
    where: { messageType: 'template', direction: 'OUT' },
    select: { sessionId: true }
  });
  const sessionIds = [...new Set(templateMsgs.map(m => m.sessionId))];
  const sessions = await p.whatsAppSession.findMany({
    where: { id: { in: sessionIds } },
    select: { phone: true }
  });
  const phonesWithTemplate = sessions.map(s => s.phone);
  
  const ordersSinceSunday = await p.order.findMany({
    where: { createdAt: { gte: new Date('2026-08-09T00:00:00.000Z') } },
    select: { customer: { select: { phone: true } } }
  });
  const orderPhones = ordersSinceSunday.filter(o => o.customer?.phone).map(o => o.customer.phone);
  const excludedPhones = new Set([...phonesWithTemplate, ...orderPhones]);

  // 2. Read the master CSV
  const inputPath = 'C:/Users/Jose/Downloads/00_CONTACTOS_REALES_ORDEN_EXACTO_WHATSAPP.csv';
  const content = fs.readFileSync(inputPath, 'utf8');
  
  // 3. Extract 10-digit numbers using regex
  const allMatches = content.match(/3\d{9}/g) || [];
  const allPhones = [...new Set(allMatches)];
  
  // 4. Filter and select 1000
  const validPhones = allPhones.filter(phone => !excludedPhones.has(phone));
  const toSend = validPhones.slice(0, 1000);
  
  // 5. Write output
  const outputPath = 'C:/Users/Jose/Downloads/1000_CONTACTOS_NUEVOS_PARA_HOY_FINAL_REAL.txt';
  fs.writeFileSync(outputPath, toSend.join('\n'), 'utf8');
  
  console.log('✅ Archivo:', outputPath);
  console.log('Encontrados en archivo maestro:', allPhones.length);
  console.log('Excluidos (ya enviados/pidieron):', allPhones.length - validPhones.length);
  console.log('Disponibles:', validPhones.length);
  console.log('En archivo final:', toSend.length);
  
  await p.$disconnect();
}

run().catch(e => console.error(e));
